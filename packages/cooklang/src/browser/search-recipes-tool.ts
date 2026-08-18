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

interface SearchRecipesArgs {
    query?: string;
    tag?: string;
    limit?: number;
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
            args = JSON.parse(argString || '{}');
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) {
            return this.fail('No workspace is open.');
        }

        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
        const limit = this.normaliseLimit(args.limit);

        let entries: NativeRecipeEntry[];
        try {
            entries = JSON.parse(await this.languageService.searchRecipes(root.path.fsPath(), query));
        } catch (e) {
            return this.fail(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        const filtered = tag
            ? entries.filter(entry => entry.tags.some(t => t.toLowerCase() === tag))
            : entries;

        const recipes = filtered.slice(0, limit).map(entry => ({
            path: this.relativePath(root, entry.path),
            name: entry.name,
            title: entry.title,
            tags: entry.tags,
            isMenu: entry.isMenu,
            servings: entry.servings,
        }));
        return JSON.stringify({ recipes, total: filtered.length });
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
