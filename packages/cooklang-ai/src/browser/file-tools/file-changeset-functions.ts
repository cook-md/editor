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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest, ToolRequestParameters, ToolInvocationContext } from '@theia/ai-core/lib/common';
import { assertChatContext, ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElement } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { ContentReplacer, ContentReplacerV1Impl, Replacement } from '@theia/core/lib/common/content-replacer';
import { ContentReplacerV2Impl } from '@theia/core/lib/common/content-replacer-v2-impl';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import { ChatFileWriter } from './chat-file-writer';
import {
    SUGGEST_FILE_CONTENT_ID,
    SUGGEST_FILE_REPLACEMENTS_ID,
    CLEAR_FILE_CHANGES_ID,
} from './function-ids';

export { FileChangeSetTitleProvider, DefaultFileChangeSetTitleProvider } from './chat-file-writer';

/** Appended to every successful write result so the model reports the save truthfully. */
const UNDO_HINT = 'The change is saved; the user can undo it from the chat.';

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

// ── SuggestFileContent ──────────────────────────────────────────────────
// The tool keeps its historical `suggest*` id so cookbot prompts and saved
// chats keep working, but it writes the file immediately.

@injectable()
export class SuggestFileContent implements ToolProvider {
    static ID = SUGGEST_FILE_CONTENT_ID;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(ChatFileWriter)
    protected readonly chatFileWriter: ChatFileWriter;

    getTool(): ToolRequest {
        return {
            id: SuggestFileContent.ID,
            name: SuggestFileContent.ID,
            displayName: 'Write File',
            description:
                'Writes complete content to a file. The file is saved immediately; the user can undo the change from the chat. ' +
                'If the file exists, it is overwritten; otherwise it is created, together with any missing directories. ' +
                'If the new content is empty, the file is deleted. To move a file, delete it and re-create it at the new location. ' +
                'Use this for creating new files or complete file rewrites. ' +
                'For targeted edits, prefer suggestFileReplacements - it\'s more efficient and less error-prone.',
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
                try {
                    const { path, content } = JSON.parse(args);
                    const uri = await this.workspaceFunctionScope.resolveRelativePath(path);
                    const result = await this.chatFileWriter.write(ctx, uri, content);
                    switch (result) {
                        case 'unchanged': return `No changes needed for file ${path}. Content already matches the requested state.`;
                        case 'delete': return `Deleted file ${path}. ${UNDO_HINT}`;
                        case 'add': return `Created file ${path}. ${UNDO_HINT}`;
                        default: return `Wrote file ${path}. ${UNDO_HINT}`;
                    }
                } catch (error) {
                    return JSON.stringify({ error: (error as Error).message });
                }
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

    @inject(ChatFileWriter)
    protected readonly chatFileWriter: ChatFileWriter;

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
            },
            required: ['path', 'replacements'],
        };

        const replacementSentence = supportMultipleReplace
            ? 'By default, a single occurrence of each old content in the tuples is expected to be replaced. '
              + 'If the optional \'multiple\' flag is set to true, all occurrences will be replaced. '
              + 'In either case, if the number of occurrences in the file does not match the expectation '
              + 'the function will return an error and nothing is written. In that case try a different approach.'
            : 'A single occurrence of each old content in the tuples is expected to be replaced. '
              + 'If the number of occurrences in the file does not match the expectation, '
              + 'the function will return an error and nothing is written. In that case try a different approach.';

        const replacementDescription =
            'Replaces sections of content in an existing file by providing a list of tuples with old content to be matched and replaced. ' +
            `${replacementSentence} For deletions, use an empty new content in the tuple. ` +
            'Make sure you use the same line endings and whitespace as in the original file content. ' +
            'The file is saved immediately; the user can undo the change from the chat.\n\n' +
            'IMPORTANT: Each oldContent must match exactly (including whitespace and indentation). ' +
            'If replacements fail with "Expected 1 occurrence but found 0": re-read the file, the content may have changed or whitespace differs. ' +
            'If replacements fail with "found 2+": include more surrounding context in oldContent to make it unique. ' +
            'Always use getFileContent to read the current file state before making replacements.';

        return {
            description: replacementDescription,
            parameters: replacementParameters,
        };
    }

    async writeReplacementsFromToolCall(toolCallString: string, ctx: ChatToolContext): Promise<string> {
        try {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const { path, replacements } = JSON.parse(toolCallString) as {
                path: string;
                replacements: Replacement[];
            };
            const fileUri = await this.workspaceFunctionScope.resolveRelativePath(path);
            const startingContent = await this.chatFileWriter.readCurrentContent(fileUri);
            if (startingContent === undefined) {
                return JSON.stringify({ error: `File not found: ${path}` });
            }
            const { updatedContent, errors } = this.replacer.applyReplacements(startingContent, replacements);
            if (errors.length > 0) {
                return `Errors encountered: ${errors.join('; ')}`;
            }
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            if (updatedContent === startingContent) {
                return `No changes needed for file ${path}. Content already matches the requested state.`;
            }
            await this.chatFileWriter.write(ctx, fileUri, updatedContent);
            return `Applied replacements to file ${path}. ${UNDO_HINT}`;
        } catch (error) {
            console.debug('Error processing replacements:', (error as Error).message);
            return JSON.stringify({ error: (error as Error).message });
        }
    }

    async undoFileChanges(path: string, ctx: ChatToolContext): Promise<string> {
        try {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const fileUri = await this.workspaceFunctionScope.resolveRelativePath(path);
            const element = ctx.request.session.changeSet.getElementByURI(fileUri);
            if (!(element instanceof ChangeSetFileElement)) {
                return `No changes from this chat found for file ${path}.`;
            }
            if (element.state === 'applied' || element.state === 'stale') {
                await element.revert();
            }
            ctx.request.session.changeSet.removeElements(fileUri);
            return `Undid this chat's changes to file ${path}.`;
        } catch (error) {
            console.debug('Error undoing file changes:', (error as Error).message);
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
                return this.replaceContentInFileFunctionHelper.writeReplacementsFromToolCall(args, ctx);
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
            displayName: 'Undo File Changes',
            description:
                'Undoes every change this chat made to a specific file, restoring the content it had before the chat first edited it ' +
                '(a file the chat created is deleted). Use this when an edit went wrong and you want to start over from the original.',
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
                return this.replaceContentInFileFunctionHelper.undoFileChanges(path, ctx);
            },
            getArgumentsShortLabel: (args: string) => createPathShortLabel(args, false),
        };
    }
}
