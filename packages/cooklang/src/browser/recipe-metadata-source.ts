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
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { WhereClause } from './metadata-matcher';

export interface RecipeMetadataFilter {
    where?: WhereClause;
    titleContains?: string | string[];
}

export interface RecipeMetadataEntry {
    path: string;
    name: string | null;
    title: string | null;
    tags: string[];
    isMenu: boolean;
    servings: number | null;
    /** The recipe's frontmatter, `{}` when it has none. */
    metadata: Record<string, unknown>;
}

/** Shape produced by the native `searchRecipesFiltered` export (absolute `path`). */
interface NativeFilteredEntry extends Omit<RecipeMetadataEntry, 'path'> { path: string }

/**
 * Resolves "which recipes match a metadata filter" for `searchRecipes`'s
 * `fields`/`where` digest with ONE call to cooklang-find's native
 * `searchRecipesFiltered` — query, `where`/`titleContains` filtering, ranking
 * and frontmatter reading all happen server-side in Rust. No per-file reads
 * happen in this package for selection purposes any more.
 *
 * `packages/cooklang-ai`'s `updateRecipeMetadata` keeps a full TypeScript
 * implementation of the same `where`/`titleContains` grammar (see that
 * package's `recipe-metadata-source.ts` and `metadata-matcher.ts`): it has no
 * access to the language-server RPC this class uses, since it has no
 * `CooklangLanguageService` binding.
 */
@injectable()
export class RecipeMetadataSource {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    /**
     * `query` and `filter` are sent together in one native call, so ranking
     * and matching both happen server-side and `total` (the length of the
     * result) is exact. `filter` is sent as `''` ("no filter") when it has
     * neither a non-empty `where` nor a `titleContains` — cooklang-find
     * treats a blank string specially rather than parsing `'{}'`.
     *
     * Rejects (does not catch) when the native call rejects, e.g. a
     * malformed `where` — callers decide how to surface that as a tool result.
     */
    async list(root: URI, query: string | undefined, filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        const filterJson = this.isEmptyFilter(filter) ? '' : JSON.stringify(filter);
        const raw = await this.languageService.searchRecipesFiltered(root.path.fsPath(), query ?? '', filterJson);
        const entries = JSON.parse(raw) as NativeFilteredEntry[];
        return entries.map(entry => ({ ...entry, path: this.relativePath(root, entry.path) }));
    }

    protected isEmptyFilter(filter: RecipeMetadataFilter): boolean {
        const hasWhere = filter.where !== undefined && Object.keys(filter.where).length > 0;
        return !hasWhere && filter.titleContains === undefined;
    }

    /**
     * Workspace-relative path when the file is under the root, else the absolute path.
     * `withPath` sets the path verbatim (keeping the root's scheme/authority) —
     * `new URI(fsPath)` would *parse* it and truncate names containing `#` or `?`.
     */
    protected relativePath(root: URI, fsPath: string): string {
        return root.relative(root.withPath(fsPath))?.toString() ?? fsPath;
    }
}
