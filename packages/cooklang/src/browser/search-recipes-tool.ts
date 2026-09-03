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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { MAX_BATCH_ITEMS, parseBatchArg } from './batch-args';

interface SearchRecipesArgs {
    query?: string;
    queries?: string[];
    tag?: string;
    limit?: number;
}

/** One query's outcome in a batched search. */
interface SearchResult {
    query: string;
    recipes?: ReturnType<SearchRecipesTool['toRecipe']>[];
    total?: number;
    error?: string;
}

/** Shape produced by the native `searchRecipes` export. */
interface NativeRecipeEntry {
    path: string;
    name: string | null;
    title: string | null;
    tags: string[];
    isMenu: boolean;
    servings: number | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * AI tool: search the user's own recipes the way `cook search` does
 * (cooklang-find, filename + content terms), optionally filtered by tag.
 * Read-only, auto-executes.
 */
@injectable()
export class SearchRecipesTool implements ToolProvider {

    static ID = 'searchRecipes';

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: SearchRecipesTool.ID,
            name: SearchRecipesTool.ID,
            displayName: 'Search Recipes',
            description: 'Search the recipes in the user\'s workspace (their own .cook and .menu files) like `cook search`: '
                + 'query words are matched against file names and file contents (ingredients, steps, metadata), best match first. '
                + 'Optionally keep only recipes carrying a tag. With neither query nor tag it lists every recipe. '
                + 'Prefer this over findFilesByPattern + getFileContent for "which of my recipes…" questions. '
                + 'Returns { recipes: [{ path (workspace-relative — pass it to getFileContent, renderTemplate or generateShoppingList), '
                + 'name, title, tags, isMenu, servings }], total }.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Words to match against recipe file names and contents, e.g. "salmon", "chocolate cake".',
                    },
                    queries: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `Run several searches in one call (max ${MAX_BATCH_ITEMS}) instead of one call per query — `
                            + 'use it when you are casting about for candidates ("chicken", "lentil", "salmon"). '
                            + 'Returns { searches: [{ query, recipes, total }] } in the order given. `tag` and `limit` apply to '
                            + 'every query. Mutually exclusive with query.',
                    },
                    tag: {
                        type: 'string',
                        description: 'Keep only recipes whose tags include this value (case-insensitive), e.g. "vegetarian".',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Maximum number of recipes to return. Default 20, max 100.',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: SearchRecipesArgs;
        try {
            const parsed: unknown = JSON.parse(argString || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return this.fail('Invalid arguments: expected a JSON object.');
            }
            args = parsed as SearchRecipesArgs;
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) {
            return this.fail('No workspace is open.');
        }

        const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
        const limit = this.normaliseLimit(args.limit);

        if (args.queries !== undefined) {
            if (typeof args.query === 'string' && args.query.trim()) {
                return this.fail('Pass either query or queries, not both.');
            }
            const queries = parseBatchArg(args.queries, 'queries');
            if ('error' in queries) {
                return this.fail(queries.error);
            }
            const searches: SearchResult[] = [];
            for (const each of queries) {
                searches.push(await this.searchOne(root, each, tag, limit));
            }
            return JSON.stringify({ searches });
        }

        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const single = await this.searchOne(root, query, tag, limit);
        return single.error !== undefined
            ? this.fail(single.error)
            : JSON.stringify({ recipes: single.recipes, total: single.total });
    }

    /**
     * Runs one query, mapping a failure into the result rather than throwing.
     *
     * A batch reports each query in its own slot: one search that trips over a
     * native error should not discard the others, which is the saving the batch
     * exists for. The single-query path unwraps it back into a bare `{ error }`
     * so its long-standing result shape is unchanged.
     */
    protected async searchOne(root: URI, query: string, tag: string, limit: number): Promise<SearchResult> {
        let entries: NativeRecipeEntry[];
        try {
            entries = JSON.parse(await this.languageService.searchRecipes(root.path.fsPath(), query));
        } catch (e) {
            return { query, error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (!Array.isArray(entries)) {
            return { query, error: 'Search failed: unexpected result shape.' };
        }
        const filtered = tag
            ? entries.filter(entry => entry.tags.some(t => t.toLowerCase() === tag))
            : entries;
        return {
            query,
            recipes: filtered.slice(0, limit).map(entry => this.toRecipe(root, entry)),
            total: filtered.length,
        };
    }

    protected toRecipe(root: URI, entry: NativeRecipeEntry): {
        path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null;
    } {
        return {
            path: this.relativePath(root, entry.path),
            name: entry.name,
            title: entry.title,
            tags: entry.tags,
            isMenu: entry.isMenu,
            servings: entry.servings,
        };
    }

    protected normaliseLimit(value: unknown): number {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n) || n < 1) {
            return DEFAULT_LIMIT;
        }
        return Math.min(Math.floor(n), MAX_LIMIT);
    }

    /**
     * Workspace-relative path when the file is under the root, else the absolute path.
     * `withPath` sets the path verbatim (keeping the root's scheme/authority) —
     * `new URI(fsPath)` would *parse* it and truncate names containing `#` or `?`.
     */
    protected relativePath(root: URI, fsPath: string): string {
        return root.relative(root.withPath(fsPath))?.toString() ?? fsPath;
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }
}
