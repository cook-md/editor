// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { URI } from '@theia/core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest, ToolInvocationContext } from '@theia/ai-core/lib/common';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElement, ChangeSetFileElementFactory } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { Minimatch } from 'minimatch';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import { FileChangeSetTitleProvider } from './file-changeset-functions';
import { RecipeMetadataSource } from './recipe-metadata-source';
import { editFrontmatter, MetadataEditOps } from './frontmatter-editor';
import { WhereClause } from './metadata-matcher';
import { UPDATE_RECIPE_METADATA_ID } from './function-ids';

const MAX_SELECT_MATCHES = 1000;
const MAX_EDITS = 200;
const MAX_SKIPPED_REPORTED = 20;
const MAX_SAMPLE = 3;
const MAX_DRY_RUN_PATHS = 50;

interface SelectArgs {
    paths?: string[];
    glob?: string;
    where?: WhereClause;
    titleContains?: string | string[];
}

interface EditArgs extends MetadataEditOps {
    path: string;
}

interface UpdateRecipeMetadataArgs extends MetadataEditOps {
    select?: SelectArgs;
    edits?: EditArgs[];
    dryRun?: boolean;
}

interface SkippedEntry { path: string; reason: string }
interface SampleEntry { path: string; before: string; after: string }

interface UpdateRecipeMetadataResult {
    matched: number;
    staged: number;
    unchanged: number;
    skipped: SkippedEntry[];
    skippedTotal?: number;
    sample: SampleEntry[];
    dryRun: boolean;
    wouldStage?: number;
    paths?: string[];
}

function hasAnyOp(ops: MetadataEditOps): boolean {
    return (ops.addTags?.length ?? 0) > 0
        || (ops.removeTags?.length ?? 0) > 0
        || Object.keys(ops.set ?? {}).length > 0
        || (ops.unset?.length ?? 0) > 0;
}

function fail(message: string): string {
    return JSON.stringify({ error: message });
}

/**
 * AI tool: bulk-edit recipe frontmatter (tags/other keys) across many files
 * without the model ever reading a recipe body. Stages proposed changes into
 * the chat ChangeSet (same review/"Apply All" UX as `suggestFileReplacements`);
 * nothing is written to disk directly.
 */
@injectable()
export class UpdateRecipeMetadataTool implements ToolProvider {
    static ID = UPDATE_RECIPE_METADATA_ID;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(RecipeMetadataSource)
    protected readonly metadataSource: RecipeMetadataSource;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    getTool(): ToolRequest {
        return {
            id: UpdateRecipeMetadataTool.ID,
            name: UpdateRecipeMetadataTool.ID,
            displayName: 'Update Recipe Metadata',
            description:
                'Bulk-edit recipe frontmatter (tags and other metadata keys) across many `.cook` files in ONE call, without ' +
                'reading any recipe body — use this for ANY tag/metadata change, especially across many files (tagging, ' +
                're-cuisining, cleaning up a key). Do NOT call getFileContent first. ' +
                'Pick files with `select` (by explicit `paths`, a `glob`, a `where` metadata filter, and/or `titleContains`) ' +
                'plus the operations to apply to all of them (`addTags`/`removeTags`/`set`/`unset`); or give `edits` for ' +
                'per-file operations (max 200). `select` and `edits` are mutually exclusive; exactly one is required. ' +
                '`where` conditions on frontmatter keys are ANDed: { contains: string|string[] } (case-insensitive substring, ' +
                'ANY needle), { equals: string }, { has: string } / { missing: string } (array membership and its inverse), ' +
                '{ exists: boolean }. A map value (e.g. `source: { url, name, author }`) is matched against any of its string ' +
                'leaves; an array is matched against any element. ' +
                'It stages proposals for review exactly like `suggestFileReplacements` — the user accepts or rejects them, ' +
                'nothing is written to disk here. Use `dryRun: true` first for jobs over 25 files to preview matches/skips ' +
                'before staging. Only `.cook` files are supported.',
            parameters: {
                type: 'object',
                properties: {
                    select: {
                        type: 'object',
                        description: 'Which files to edit (mutually exclusive with `edits`). At least one of paths/glob/where/' +
                            'titleContains is required — pass glob: "**/*.cook" explicitly to target every recipe.',
                        properties: {
                            paths: { type: 'array', items: { type: 'string' }, description: 'Explicit workspace-relative .cook paths.' },
                            glob: { type: 'string', description: 'Glob over workspace-relative paths, e.g. "Banchan/**/*.cook". Default "**/*.cook".' },
                            where: {
                                type: 'object',
                                description: 'Frontmatter key -> condition, ANDed. See the tool description for the condition grammar.',
                            },
                            titleContains: {
                                description: 'string | string[]. Matches the file name (without extension) OR frontmatter title, case-insensitively.',
                            },
                        },
                    },
                    addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add (case-insensitively deduped against existing tags).' },
                    removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove (case-insensitive match).' },
                    set: { type: 'object', description: 'Frontmatter keys to set/overwrite, e.g. { "cuisine": "Korean" }.' },
                    unset: { type: 'array', items: { type: 'string' }, description: 'Frontmatter keys to remove entirely.' },
                    edits: {
                        type: 'array',
                        description: 'Per-file operations (mutually exclusive with `select`), max 200 entries.',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string' },
                                addTags: { type: 'array', items: { type: 'string' } },
                                removeTags: { type: 'array', items: { type: 'string' } },
                                set: { type: 'object' },
                                unset: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['path'],
                        },
                    },
                    dryRun: { type: 'boolean', description: 'Preview only: nothing is staged. Reports wouldStage and the first 50 matched paths.' },
                },
            },
            handler: async (args: string, ctx?: ToolInvocationContext) => this.execute(args, ctx),
        };
    }

    protected async execute(argString: string, ctx?: ToolInvocationContext): Promise<string> {
        if (!ChatToolContext.is(ctx)) {
            return fail('This tool requires a chat context. It can only be used within a chat session.');
        }
        if (ctx.cancellationToken?.isCancellationRequested) {
            return fail('Operation cancelled by user');
        }

        let args: UpdateRecipeMetadataArgs;
        try {
            const parsed: unknown = argString && argString.trim() ? JSON.parse(argString) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return fail('Invalid arguments: expected a JSON object.');
            }
            args = parsed as UpdateRecipeMetadataArgs;
        } catch {
            return fail('Invalid arguments: expected a JSON object.');
        }

        const guardError = this.validate(args);
        if (guardError) {
            return fail(guardError);
        }

        let root: URI;
        try {
            root = await this.workspaceFunctionScope.getWorkspaceRoot();
        } catch (e) {
            return fail(e instanceof Error ? e.message : String(e));
        }

        const dryRun = args.dryRun === true;

        try {
            if (args.edits !== undefined) {
                return await this.runEdits(root, args.edits, dryRun, ctx);
            }
            return await this.runSelect(root, args.select!, args, dryRun, ctx);
        } catch (e) {
            return fail(e instanceof Error ? e.message : String(e));
        }
    }

    protected validate(args: UpdateRecipeMetadataArgs): string | undefined {
        const hasSelect = args.select !== undefined;
        const hasEdits = args.edits !== undefined;
        if (hasSelect && hasEdits) {
            return 'Pass either select or edits, not both.';
        }
        if (!hasSelect && !hasEdits) {
            return 'Either select or edits is required.';
        }
        if (hasSelect) {
            const select = args.select!;
            if (!select.paths && !select.glob && !select.where && select.titleContains === undefined) {
                return 'select must include at least one of paths, glob, where, or titleContains '
                    + '(pass glob: "**/*.cook" explicitly to target every recipe).';
            }
            if (!hasAnyOp(args)) {
                return 'No operation given: provide at least one of addTags, removeTags, set, unset.';
            }
        }
        if (hasEdits) {
            const edits = args.edits!;
            if (!Array.isArray(edits) || edits.length === 0) {
                return 'edits must be a non-empty array.';
            }
            if (edits.length > MAX_EDITS) {
                return `edits accepts at most ${MAX_EDITS} items, got ${edits.length}.`;
            }
            for (const edit of edits) {
                if (!edit || typeof edit.path !== 'string' || !edit.path.trim()) {
                    return 'Every edits entry requires a non-empty path.';
                }
                if (!hasAnyOp(edit)) {
                    return `No operation given for ${edit.path}: provide at least one of addTags, removeTags, set, unset.`;
                }
            }
        }
        return undefined;
    }

    protected async runSelect(
        root: URI, select: SelectArgs, ops: MetadataEditOps, dryRun: boolean, ctx: ChatToolContext,
    ): Promise<string> {
        let candidatePaths: string[];
        if (select.paths && select.paths.length > 0) {
            candidatePaths = [...new Set(select.paths.map(p => p.trim()).filter(p => p.length > 0))];
        } else {
            const allPaths = await this.metadataSource.listCookPaths(root);
            if (select.glob) {
                const matcher = new Minimatch(select.glob, { dot: false });
                candidatePaths = allPaths.filter(p => matcher.match(p));
            } else {
                candidatePaths = allPaths;
            }
        }

        const nonCookPaths = candidatePaths.filter(p => !p.toLowerCase().endsWith('.cook'));
        candidatePaths = candidatePaths.filter(p => p.toLowerCase().endsWith('.cook'));

        let matchedPaths = candidatePaths;
        if (select.where || select.titleContains !== undefined) {
            const entries = await this.metadataSource.filterByMetadata(root, candidatePaths, {
                where: select.where,
                titleContains: select.titleContains,
            });
            matchedPaths = entries.filter(e => e.matched).map(e => e.path);
        }

        if (matchedPaths.length > MAX_SELECT_MATCHES) {
            return fail(
                `select matched ${matchedPaths.length} files, over the ${MAX_SELECT_MATCHES} cap. `
                + 'Narrow paths/glob/where before retrying.',
            );
        }

        const preSkipped: SkippedEntry[] = nonCookPaths.map(p => ({ path: p, reason: 'not a .cook file' }));
        return this.applyToPaths(root, matchedPaths, () => ops, dryRun, ctx, preSkipped);
    }

    protected async runEdits(root: URI, edits: EditArgs[], dryRun: boolean, ctx: ChatToolContext): Promise<string> {
        const dedupedPaths: string[] = [];
        const opsByPath = new Map<string, MetadataEditOps>();
        const preSkipped: SkippedEntry[] = [];
        for (const edit of edits) {
            const path = edit.path.trim();
            if (!path.toLowerCase().endsWith('.cook')) {
                preSkipped.push({ path, reason: 'not a .cook file' });
                continue;
            }
            if (!dedupedPaths.includes(path)) {
                dedupedPaths.push(path);
            }
            opsByPath.set(path, { addTags: edit.addTags, removeTags: edit.removeTags, set: edit.set, unset: edit.unset });
        }
        return this.applyToPaths(root, dedupedPaths, path => opsByPath.get(path)!, dryRun, ctx, preSkipped);
    }

    protected async applyToPaths(
        root: URI,
        paths: string[],
        opsFor: (path: string) => MetadataEditOps,
        dryRun: boolean,
        ctx: ChatToolContext,
        preSkipped: SkippedEntry[],
    ): Promise<string> {
        const skipped: SkippedEntry[] = [...preSkipped];
        const sample: SampleEntry[] = [];
        let staged = 0;
        let wouldStage = 0;
        let unchanged = 0;

        for (const path of paths) {
            if (ctx.cancellationToken?.isCancellationRequested) {
                return fail('Operation cancelled by user');
            }
            const uri = root.resolve(path);
            let withinWorkspace = true;
            try {
                this.workspaceFunctionScope.ensureWithinWorkspace(uri, root);
            } catch {
                withinWorkspace = false;
            }
            if (!withinWorkspace) {
                skipped.push({ path, reason: 'outside of the workspace' });
                continue;
            }

            const content = await this.readStartingContent(root, uri, path, ctx);
            if (content === undefined) {
                skipped.push({ path, reason: 'File not found' });
                continue;
            }

            const editResult = editFrontmatter(content, opsFor(path));
            if (editResult.status === 'skipped') {
                skipped.push({ path, reason: editResult.reason });
                continue;
            }
            if (editResult.status === 'unchanged') {
                unchanged++;
                continue;
            }

            wouldStage++;
            if (sample.length < MAX_SAMPLE) {
                sample.push({ path, before: editResult.beforeLines.join('\n'), after: editResult.afterLines.join('\n') });
            }
            if (!dryRun) {
                ctx.request.session.changeSet.addElements(this.fileChangeFactory({
                    uri,
                    type: 'modify',
                    state: 'pending',
                    targetState: editResult.content,
                    requestId: ctx.request.id,
                    chatSessionId: ctx.request.session.id,
                }));
                staged++;
            }
        }

        if (staged > 0) {
            ctx.request.session.changeSet.setTitle(this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
        }

        const skippedTotal = skipped.length > MAX_SKIPPED_REPORTED ? skipped.length : undefined;
        const result: UpdateRecipeMetadataResult = {
            matched: paths.length + preSkipped.length,
            staged,
            unchanged,
            skipped: skipped.slice(0, MAX_SKIPPED_REPORTED),
            sample,
            dryRun,
        };
        if (skippedTotal !== undefined) {
            result.skippedTotal = skippedTotal;
        }
        if (dryRun) {
            result.wouldStage = wouldStage;
            result.paths = paths.slice(0, MAX_DRY_RUN_PATHS);
        }
        return JSON.stringify(result);
    }

    /** Pending changeset target state (if any) takes priority over the open-editor/disk content. */
    protected async readStartingContent(root: URI, uri: URI, path: string, ctx: ChatToolContext): Promise<string | undefined> {
        const existing = ctx.request.session.changeSet?.getElementByURI(uri);
        if (existing instanceof ChangeSetFileElement && existing.targetState !== undefined) {
            return existing.targetState;
        }
        return this.metadataSource.readContent(root, path);
    }
}
