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
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { MAX_BATCH_ITEMS, parseBatchArg } from './batch-args';
import { RecipeMetadataSource, RecipeMetadataEntry } from './recipe-metadata-source';
import { WhereClause } from './metadata-matcher';

interface SearchRecipesArgs {
    query?: string;
    queries?: string[];
    tag?: string;
    limit?: number;
    fields?: string[];
    where?: WhereClause;
}

/** One query's outcome in a batched search. */
interface SearchResult {
    query: string;
    recipes?: ReturnType<SearchRecipesTool['toRecipe']>[];
    total?: number;
    error?: string;
    columns?: string[];
    rows?: string[][];
}

/** Shape produced by the native `searchRecipes` export. `name` is always `path`'s file stem — not read here. */
interface NativeRecipeEntry {
    path: string;
    title: string | null;
    tags: string[];
    isMenu: boolean;
    servings: number | null;
}

/** Trimmed recipe entry returned to the model: fields that would just repeat a default are omitted. */
interface TrimmedRecipe {
    path: string;
    title?: string;
    tags?: string[];
    isMenu?: boolean;
    servings?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LIMIT_DIGEST = 500;
const MAX_CELL_LENGTH = 200;

/** Frontmatter keys `fields` may request — kept in step with the tool description. */
const FIELD_NAMES = ['tags', 'source', 'cuisine', 'course', 'time', 'servings', 'diet', 'description', 'ingredients'] as const;
type FieldName = typeof FIELD_NAMES[number];

function truncateCell(value: string): string {
    return value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) : value;
}

/** Renders an arbitrary YAML-sourced value as one compact cell string. */
function cellValue(value: unknown): string {
    if (value === undefined || value === null) { // eslint-disable-line no-null/no-null
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(cellValue).join(', ');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

/** `source` renders as the URL or name string, never the map. */
function sourceCell(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.url === 'string') {
            return obj.url;
        }
        if (typeof obj.name === 'string') {
            return obj.name;
        }
        return '';
    }
    return cellValue(value);
}

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

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(RecipeMetadataSource)
    protected readonly metadataSource: RecipeMetadataSource;

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
                + 'title?, tags?, isMenu?, servings? }], total }. A missing field means empty/false/unknown; a missing title means '
                + 'it is the same as the file name.\n\n'
                + 'To answer "which of my recipes have X" (a metadata digest) WITHOUT reading file bodies, pass `fields` and/or '
                + '`where`: the response switches to a compact table `{ columns, rows, total }` (one row per matched recipe, cells '
                + `truncated to ${MAX_CELL_LENGTH} chars) and the max \`limit\` rises to ${MAX_LIMIT_DIGEST}. `
                + `\`fields\` (array, from ${FIELD_NAMES.map(f => `"${f}"`).join(', ')}) picks extra columns beyond path/title — `
                + '"source" is rendered as its URL or name (never the raw map), "ingredients" is the recipe\'s unique ingredient '
                + 'names. `where` filters by frontmatter, every key ANDed, case-insensitive: { contains: string|string[] } (ANY '
                + 'needle is a substring of ANY string leaf of the field — a map like source:{url,name,author} or an array is '
                + 'matched leaf-by-leaf), { equals: string }, { has: string } / { missing: string } (array membership and its '
                + 'inverse), { exists: boolean }. Never read file bodies to answer a "which recipes have/are/contain X" question '
                + '— use fields/where here instead.',
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
                        description: `Maximum number of recipes to return. Default 20, max 100 (${MAX_LIMIT_DIGEST} with fields/where).`,
                    },
                    fields: {
                        type: 'array',
                        items: { type: 'string', enum: [...FIELD_NAMES] },
                        description: 'Extra frontmatter columns to include (switches the response to the compact { columns, rows, total } '
                            + 'shape). See the tool description.',
                    },
                    where: {
                        type: 'object',
                        description: 'Frontmatter key -> condition, ANDed (switches the response to the compact { columns, rows, total } '
                            + 'shape). See the tool description for the condition grammar.',
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

        const digest = args.fields !== undefined || args.where !== undefined;
        let fields: FieldName[] = [];
        if (args.fields !== undefined) {
            if (!Array.isArray(args.fields)) {
                return this.fail('fields must be an array of strings.');
            }
            for (const f of args.fields) {
                if (!(FIELD_NAMES as readonly string[]).includes(f)) {
                    return this.fail(`Unknown field "${f}". Valid fields: ${FIELD_NAMES.join(', ')}.`);
                }
            }
            fields = args.fields as FieldName[];
        }
        if (args.where !== undefined && (typeof args.where !== 'object' || args.where === null || Array.isArray(args.where))) { // eslint-disable-line no-null/no-null
            return this.fail('where must be an object of frontmatter key -> condition.');
        }

        const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
        const limit = this.normaliseLimit(args.limit, digest ? MAX_LIMIT_DIGEST : MAX_LIMIT);

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
                searches.push(await this.searchOne(root, each, tag, limit, digest, fields, args.where));
            }
            return JSON.stringify({ searches });
        }

        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const single = await this.searchOne(root, query, tag, limit, digest, fields, args.where);
        if (single.error !== undefined) {
            return this.fail(single.error);
        }
        return digest
            ? JSON.stringify({ columns: single.columns, rows: single.rows, total: single.total })
            : JSON.stringify({ recipes: single.recipes, total: single.total });
    }

    /**
     * Runs one query, mapping a failure into the result rather than throwing.
     *
     * A batch reports each query in its own slot: one search that trips over a
     * native error should not discard the others, which is the saving the batch
     * exists for. The single-query path unwraps it back into a bare `{ error }`
     * so its long-standing result shape is unchanged.
     *
     * The digest path (`fields`/`where`) never calls the plain `searchRecipes`
     * native export — it goes through `RecipeMetadataSource`, which is the ONE
     * `searchRecipesFiltered` call that does query + where-matching + ranking +
     * frontmatter reading together, server-side.
     */
    protected async searchOne(
        root: URI, query: string, tag: string, limit: number, digest: boolean, fields: FieldName[], where: WhereClause | undefined,
    ): Promise<SearchResult> {
        if (digest) {
            return this.searchOneDigest(root, query, tag, limit, fields, where);
        }
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

    protected async searchOneDigest(
        root: URI, query: string, tag: string, limit: number, fields: FieldName[], where: WhereClause | undefined,
    ): Promise<SearchResult> {
        let entries: RecipeMetadataEntry[];
        try {
            entries = await this.metadataSource.list(root, query, { where });
        } catch (e) {
            return { query, error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        const tagFiltered = tag
            ? entries.filter(entry => entry.tags.some(t => t.toLowerCase() === tag))
            : entries;
        const total = tagFiltered.length;
        const candidates = tagFiltered.slice(0, limit);

        let ingredientsByPath: Map<string, string[]> | undefined;
        if (fields.includes('ingredients')) {
            ingredientsByPath = await this.readIngredients(root, candidates.map(c => c.path));
        }

        const columns = ['path', 'title', ...fields];
        const rows = candidates.map(entry => {
            const row = [entry.path, entry.title ?? ''];
            for (const field of fields) {
                row.push(this.fieldCell(field, entry, ingredientsByPath));
            }
            return row.map(truncateCell);
        });
        return { query, columns, rows, total };
    }

    protected fieldCell(field: FieldName, entry: RecipeMetadataEntry, ingredientsByPath?: Map<string, string[]>): string {
        if (field === 'tags') {
            return entry.tags.join(', ');
        }
        if (field === 'ingredients') {
            return (ingredientsByPath?.get(entry.path) ?? []).join(', ');
        }
        const value = entry.metadata[field];
        return field === 'source' ? sourceCell(value) : cellValue(value);
    }

    protected async readIngredients(root: URI, paths: string[]): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();
        for (const path of paths) {
            try {
                const content = (await this.fileService.read(root.resolve(path))).value.toString();
                const parsed = JSON.parse(await this.languageService.parse(content)) as {
                    recipe?: { ingredients?: Array<{ name?: string }> } | null;
                };
                const names = parsed.recipe?.ingredients?.map(i => i.name).filter((n): n is string => typeof n === 'string' && n.length > 0) ?? [];
                result.set(path, [...new Set(names)]);
            } catch {
                result.set(path, []);
            }
        }
        return result;
    }

    protected toRecipe(root: URI, entry: NativeRecipeEntry): TrimmedRecipe {
        const path = this.relativePath(root, entry.path);
        const recipe: TrimmedRecipe = { path };
        if (entry.title && entry.title !== this.fileStem(path)) {
            recipe.title = entry.title;
        }
        if (entry.tags.length > 0) {
            recipe.tags = entry.tags;
        }
        if (entry.isMenu) {
            recipe.isMenu = true;
        }
        if (entry.servings !== null && entry.servings !== undefined) { // eslint-disable-line no-null/no-null
            recipe.servings = entry.servings;
        }
        return recipe;
    }

    /** The file name without its final extension, e.g. `Dinner/Salmon.cook` -> `Salmon`. */
    protected fileStem(path: string): string {
        const name = path.split('/').pop() ?? path;
        const dot = name.lastIndexOf('.');
        return dot > 0 ? name.slice(0, dot) : name;
    }

    protected normaliseLimit(value: unknown, maxLimit: number): number {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n) || n < 1) {
            return Math.min(DEFAULT_LIMIT, maxLimit);
        }
        return Math.min(Math.floor(n), maxLimit);
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
