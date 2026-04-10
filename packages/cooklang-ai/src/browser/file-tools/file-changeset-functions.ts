// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls, URI } from '@theia/core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest, ToolRequestParameters, ToolInvocationContext } from '@theia/ai-core/lib/common';
import { assertChatContext, ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElement, ChangeSetFileElementFactory } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { ContentReplacer, ContentReplacerV1Impl, Replacement } from '@theia/core/lib/common/content-replacer';
import { ContentReplacerV2Impl } from '@theia/core/lib/common/content-replacer-v2-impl';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import {
    SUGGEST_FILE_CONTENT_ID,
    SUGGEST_FILE_REPLACEMENTS_ID,
    CLEAR_FILE_CHANGES_ID,
    GET_PROPOSED_CHANGES_ID,
} from './function-ids';

function createPathShortLabel(args: string, hasMore: boolean): { label: string; hasMore: boolean } | undefined {
    try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === 'object' && 'path' in parsed) {
            return { label: String(parsed.path), hasMore };
        }
    } catch {
        // ignore parse errors
    }
    return undefined;
}

// ── FileChangeSetTitleProvider ──────────────────────────────────────────

export const FileChangeSetTitleProvider = Symbol('FileChangeSetTitleProvider');
export interface FileChangeSetTitleProvider {
    getChangeSetTitle(ctx: ChatToolContext): string;
}

@injectable()
export class DefaultFileChangeSetTitleProvider implements FileChangeSetTitleProvider {
    getChangeSetTitle(_ctx: ChatToolContext): string {
        return nls.localize('theia/ai-chat/fileChangeSetTitle', 'Changes proposed');
    }
}

// ── SuggestFileContent ──────────────────────────────────────────────────

@injectable()
export class SuggestFileContent implements ToolProvider {
    static ID = SUGGEST_FILE_CONTENT_ID;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    getTool(): ToolRequest {
        return {
            id: SuggestFileContent.ID,
            name: SuggestFileContent.ID,
            displayName: 'Write File',
            description:
                'Proposes writing complete content to a file for user review. If the file exists, it will be overwritten when accepted. ' +
                'If the file does not exist, it will be created. This tool will automatically create any directories needed to write the file. ' +
                'If the new content is empty, the file will be deleted when accepted. To move a file, delete it and re-create it at the new location. ' +
                'Use this for creating new files or complete file rewrites. ' +
                'For targeted edits, prefer suggestFileReplacements - it\'s more efficient and less error-prone. ' +
                'The user will review the proposed changes and can accept or reject them.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file within the workspace (e.g., "src/index.ts", "config/settings.json").',
                    },
                    content: {
                        type: 'string',
                        description:
                            'The COMPLETE content to write to the file. You MUST include ALL parts of the file, even if they haven\'t been modified. ' +
                            'Do not truncate or omit any sections. Use empty string "" to delete the file.',
                    },
                },
                required: ['path', 'content'],
            },
            handler: async (args: string, ctx?: ToolInvocationContext) => {
                assertChatContext(ctx);
                if (ctx.cancellationToken?.isCancellationRequested) {
                    return JSON.stringify({ error: 'Operation cancelled by user' });
                }
                const { path, content } = JSON.parse(args);
                const chatSessionId = ctx.request.session.id;
                const uri = await this.workspaceFunctionScope.resolveRelativePath(path);
                let type: 'add' | 'modify' | 'delete' = 'modify';
                if (content === '') {
                    type = 'delete';
                }
                if (!(await this.fileService.exists(uri))) {
                    type = 'add';
                }
                ctx.request.session.changeSet.addElements(this.fileChangeFactory({
                    uri,
                    type,
                    state: 'pending',
                    targetState: content,
                    requestId: ctx.request.id,
                    chatSessionId,
                }));
                ctx.request.session.changeSet.setTitle(this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
                return `Proposed writing to file ${path}. The user will review and potentially apply the changes.`;
            },
            getArgumentsShortLabel: (args: string) => createPathShortLabel(args, true),
        };
    }
}

// ── ReplaceContentInFileFunctionHelper ──────────────────────────────────

@injectable()
export class ReplaceContentInFileFunctionHelper {

    protected replacer: ContentReplacer = new ContentReplacerV1Impl();

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    setReplacer(replacer: ContentReplacer): void {
        this.replacer = replacer;
    }

    getToolMetadata(supportMultipleReplace = false): { description: string; parameters: ToolRequestParameters } {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const replacementProperties: Record<string, any> = {
            oldContent: {
                type: 'string',
                description: 'The exact content to be replaced. Must match exactly, including whitespace, comments, etc.',
            },
            newContent: {
                type: 'string',
                description: 'The new content to insert in place of matched old content.',
            },
        };
        if (supportMultipleReplace) {
            replacementProperties.multiple = {
                type: 'boolean',
                description: 'Set to true if multiple occurrences of the oldContent are expected to be replaced.',
            };
        }
        const replacementParameters: ToolRequestParameters = {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Relative path to the file within the workspace (e.g., "src/index.ts"). Must read the file with getFileContent first.',
                },
                replacements: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: replacementProperties,
                        required: ['oldContent', 'newContent'],
                    },
                    description: 'An array of replacement objects, each containing oldContent and newContent strings.',
                },
                reset: {
                    type: 'boolean',
                    description: 'Set to true to clear any existing pending changes for this file and start fresh. Default is false, which merges with existing changes.',
                },
            },
            required: ['path', 'replacements'],
        };

        const replacementSentence = supportMultipleReplace
            ? 'By default, a single occurrence of each old content in the tuples is expected to be replaced. If the optional \'multiple\' flag is set to true, all occurrences will be replaced. In either case, if the number of occurrences in the file does not match the expectation the function will return an error. In that case try a different approach.'
            : 'A single occurrence of each old content in the tuples is expected to be replaced. If the number of occurrences in the file does not match the expectation, the function will return an error. In that case try a different approach.';

        const replacementDescription =
            `Propose to replace sections of content in an existing file by providing a list of tuples with old content to be matched and replaced. ` +
            `${replacementSentence} For deletions, use an empty new content in the tuple. ` +
            `Make sure you use the same line endings and whitespace as in the original file content. ` +
            `The proposed changes will be shown to the user for review before being applied. ` +
            `Multiple calls for the same file will merge replacements unless the reset parameter is set to true. ` +
            `Use the reset parameter to clear previous changes and start fresh if needed.\n\n` +
            `IMPORTANT: Each oldContent must match exactly (including whitespace and indentation). ` +
            `If replacements fail with "Expected 1 occurrence but found 0": re-read the file, the content may have changed or whitespace differs. ` +
            `If replacements fail with "found 2+": include more surrounding context in oldContent to make it unique. ` +
            `Always use getFileContent to read the current file state before making replacements.`;

        return {
            description: replacementDescription,
            parameters: replacementParameters,
        };
    }

    async createChangesetFromToolCall(toolCallString: string, ctx: ChatToolContext): Promise<string> {
        try {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const result = await this.processReplacementsCommon(toolCallString, ctx, this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
            if (result.errors.length > 0) {
                return `Errors encountered: ${result.errors.join('; ')}`;
            }
            if (result.fileElement) {
                const action = result.reset ? 'reset and ' : '';
                return `Proposed ${action}replacements to file ${result.path}. The user will review and potentially apply the changes.`;
            } else {
                return `No changes needed for file ${result.path}. Content already matches the requested state.`;
            }
        } catch (error) {
            console.debug('Error processing replacements:', (error as Error).message);
            return JSON.stringify({ error: (error as Error).message });
        }
    }

    protected async processReplacementsCommon(
        toolCallString: string,
        ctx: ChatToolContext,
        changeSetTitle: string,
    ): Promise<{ fileElement: ChangeSetFileElement | undefined; path: string; reset: boolean; errors: string[] }> {
        if (ctx.cancellationToken?.isCancellationRequested) {
            throw new Error('Operation cancelled by user');
        }
        const { path, replacements, reset } = JSON.parse(toolCallString) as {
            path: string;
            replacements: Replacement[];
            reset?: boolean;
        };
        const fileUri = await this.workspaceFunctionScope.resolveRelativePath(path);
        let startingContent: string;

        if (reset || !ctx.request.session.changeSet) {
            startingContent = (await this.fileService.read(fileUri)).value.toString();
        } else {
            const existingElement = this.findExistingChangeElement(ctx.request.session.changeSet, fileUri);
            if (existingElement) {
                startingContent = existingElement.targetState || (await this.fileService.read(fileUri)).value.toString();
            } else {
                startingContent = (await this.fileService.read(fileUri)).value.toString();
            }
        }

        if (ctx.cancellationToken?.isCancellationRequested) {
            throw new Error('Operation cancelled by user');
        }

        const { updatedContent, errors } = this.replacer.applyReplacements(startingContent, replacements);
        if (errors.length > 0) {
            return { fileElement: undefined, path, reset: reset || false, errors };
        }

        const originalContent = (await this.fileService.read(fileUri)).value.toString();
        if (updatedContent !== originalContent) {
            ctx.request.session.changeSet.setTitle(changeSetTitle);
            const fileElement = this.fileChangeFactory({
                uri: fileUri,
                type: 'modify',
                state: 'pending',
                targetState: updatedContent,
                requestId: ctx.request.id,
                chatSessionId: ctx.request.session.id,
            });
            ctx.request.session.changeSet.addElements(fileElement);
            return { fileElement, path, reset: reset || false, errors: [] };
        } else {
            return { fileElement: undefined, path, reset: reset || false, errors: [] };
        }
    }

    protected findExistingChangeElement(changeSet: { getElementByURI(uri: URI): unknown }, fileUri: URI): ChangeSetFileElement | undefined {
        const element = changeSet.getElementByURI(fileUri);
        if (element instanceof ChangeSetFileElement) {
            return element;
        }
        return undefined;
    }

    async clearFileChanges(path: string, ctx: ChatToolContext): Promise<string> {
        try {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const fileUri = await this.workspaceFunctionScope.resolveRelativePath(path);
            if (ctx.request.session.changeSet.removeElements(fileUri)) {
                return `Cleared pending change(s) for file ${path}.`;
            } else {
                return `No pending changes found for file ${path}.`;
            }
        } catch (error) {
            console.debug('Error clearing file changes:', (error as Error).message);
            return JSON.stringify({ error: (error as Error).message });
        }
    }

    async getProposedFileState(path: string, ctx: ChatToolContext): Promise<string> {
        try {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const fileUri = await this.workspaceFunctionScope.resolveRelativePath(path);
            if (!ctx.request.session.changeSet) {
                const originalContent = (await this.fileService.read(fileUri)).value.toString();
                return `File ${path} has no pending changes. Original content:\n\n${originalContent}`;
            }
            const existingElement = this.findExistingChangeElement(ctx.request.session.changeSet, fileUri);
            if (existingElement && existingElement.targetState) {
                return `File ${path} has pending changes. Proposed content:\n\n${existingElement.targetState}`;
            } else {
                const originalContent = (await this.fileService.read(fileUri)).value.toString();
                return `File ${path} has no pending changes. Original content:\n\n${originalContent}`;
            }
        } catch (error) {
            console.debug('Error getting proposed file state:', (error as Error).message);
            return JSON.stringify({ error: (error as Error).message });
        }
    }
}

// ── ReplaceContentInFileFunctionHelperV2 ────────────────────────────────

@injectable()
export class ReplaceContentInFileFunctionHelperV2 extends ReplaceContentInFileFunctionHelper {
    constructor() {
        super();
        this.setReplacer(new ContentReplacerV2Impl());
    }
}

// ── SuggestFileReplacements (V2) ────────────────────────────────────────

@injectable()
export class SuggestFileReplacements implements ToolProvider {
    static ID = SUGGEST_FILE_REPLACEMENTS_ID;

    @inject(ReplaceContentInFileFunctionHelperV2)
    protected readonly replaceContentInFileFunctionHelper: ReplaceContentInFileFunctionHelperV2;

    getTool(): ToolRequest {
        const metadata = this.replaceContentInFileFunctionHelper.getToolMetadata(true);
        return {
            id: SuggestFileReplacements.ID,
            name: SuggestFileReplacements.ID,
            displayName: 'Edit File',
            description: metadata.description,
            parameters: metadata.parameters,
            handler: async (args: string, ctx?: ToolInvocationContext) => {
                assertChatContext(ctx);
                if (ctx.cancellationToken?.isCancellationRequested) {
                    return JSON.stringify({ error: 'Operation cancelled by user' });
                }
                return this.replaceContentInFileFunctionHelper.createChangesetFromToolCall(args, ctx);
            },
            getArgumentsShortLabel: (args: string) => createPathShortLabel(args, true),
        };
    }
}

// ── ClearFileChanges ────────────────────────────────────────────────────

@injectable()
export class ClearFileChanges implements ToolProvider {
    static ID = CLEAR_FILE_CHANGES_ID;

    @inject(ReplaceContentInFileFunctionHelper)
    protected readonly replaceContentInFileFunctionHelper: ReplaceContentInFileFunctionHelper;

    getTool(): ToolRequest {
        return {
            id: ClearFileChanges.ID,
            name: ClearFileChanges.ID,
            displayName: 'Clear File Changes',
            description:
                'Clears all pending (not yet applied) changes for a specific file, allowing you to start fresh with new modifications. ' +
                'Use this when previous replacement attempts failed and you want to try a different approach. ' +
                'Does not affect already-applied changes or the actual file on disk.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file within the workspace (e.g., "src/index.ts").',
                    },
                },
                required: ['path'],
            },
            handler: async (args: string, ctx?: ToolInvocationContext) => {
                assertChatContext(ctx);
                if (ctx.cancellationToken?.isCancellationRequested) {
                    return JSON.stringify({ error: 'Operation cancelled by user' });
                }
                const { path } = JSON.parse(args);
                return this.replaceContentInFileFunctionHelper.clearFileChanges(path, ctx);
            },
            getArgumentsShortLabel: (args: string) => createPathShortLabel(args, false),
        };
    }
}

// ── GetProposedFileState ────────────────────────────────────────────────

@injectable()
export class GetProposedFileState implements ToolProvider {
    static ID = GET_PROPOSED_CHANGES_ID;

    @inject(ReplaceContentInFileFunctionHelper)
    protected readonly replaceContentInFileFunctionHelper: ReplaceContentInFileFunctionHelper;

    getTool(): ToolRequest {
        return {
            id: GET_PROPOSED_CHANGES_ID,
            name: GET_PROPOSED_CHANGES_ID,
            displayName: 'Get Proposed File State',
            description:
                'Returns the current proposed state of a file, including all pending changes that have been proposed ' +
                'but not yet applied. Use this to see what the file will look like after your changes are applied. ' +
                'This is useful when making incremental changes to verify the accumulated state is correct. ' +
                'If no pending changes exist for the file, returns the original file content.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file within the workspace (e.g., "src/index.ts").',
                    },
                },
                required: ['path'],
            },
            handler: async (args: string, ctx?: ToolInvocationContext) => {
                assertChatContext(ctx);
                if (ctx.cancellationToken?.isCancellationRequested) {
                    return JSON.stringify({ error: 'Operation cancelled by user' });
                }
                const { path } = JSON.parse(args);
                return this.replaceContentInFileFunctionHelper.getProposedFileState(path, ctx);
            },
            getArgumentsShortLabel: (args: string) => createPathShortLabel(args, false),
        };
    }
}
