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
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { baseNameWithoutExt, matchesTitleContains, matchesWhere, readFrontmatter, WhereClause } from './metadata-matcher';

export interface RecipeMetadataFilter {
    where?: WhereClause;
    titleContains?: string | string[];
}

export interface RecipeMetadataEntry {
    path: string;
    metadata: Record<string, unknown> | undefined;
    status: 'yaml' | 'deprecated' | 'none' | 'invalid';
    error?: string;
    /** Whether this entry satisfies the `filter` it was read with. */
    matched: boolean;
}

interface NativeRecipeEntry { path: string; title: string | null }

/**
 * SEAM: the one place that resolves "which recipes match a metadata filter"
 * for both `searchRecipes`'s `fields`/`where` digest (this package) and
 * (this package's sibling copy in `packages/cooklang-ai`)
 * `updateRecipeMetadata`'s `select`. Nothing else in either tool reads
 * frontmatter for selection purposes.
 *
 * A follow-up will move this filtering into the Rust `cooklang-find` crate
 * (and `cooklang-native`) and swap `list`'s body for a native call without
 * touching the tools — the `where`/`titleContains` JSON grammar it accepts
 * (see `metadata-matcher.ts`) is mirrored there, so it must not change shape
 * here without updating that crate too.
 *
 * Candidates come from the native `searchRecipes` (cooklang-find) call, so
 * `query` here does real full-text search — unlike the `packages/cooklang-ai`
 * copy, which has no native search and always walks the workspace.
 */
@injectable()
export class RecipeMetadataSource {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    /**
     * Reads and parses each of `paths`' frontmatter, reporting whether it
     * satisfies `filter`. Always returns one entry per input path (even non-
     * matches), so callers that need metadata for reasons other than
     * filtering (e.g. building a `searchRecipes` digest row) can reuse the read.
     */
    async filterByMetadata(root: URI, paths: string[], filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        const entries: RecipeMetadataEntry[] = [];
        for (const path of paths) {
            let content: string;
            try {
                content = (await this.fileService.read(root.resolve(path))).value.toString();
            } catch {
                entries.push({ path, metadata: undefined, status: 'invalid', error: 'File not found', matched: false });
                continue;
            }
            const result = readFrontmatter(content);
            const metadata = result.kind === 'yaml' ? result.data : undefined;
            const matched = matchesWhere(metadata ?? {}, filter.where)
                && matchesTitleContains(baseNameWithoutExt(path), metadata?.title, filter.titleContains);
            entries.push({
                path,
                metadata,
                status: result.kind,
                error: result.kind === 'invalid' ? result.error : undefined,
                matched,
            });
        }
        return entries;
    }

    /** Seam contract: see the class doc comment. */
    async list(root: URI, query: string | undefined, filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        const raw = await this.languageService.searchRecipes(root.path.fsPath(), query ?? '');
        const nativeEntries = JSON.parse(raw) as NativeRecipeEntry[];
        const paths = nativeEntries.map(entry => this.relativePath(root, entry.path));
        const entries = await this.filterByMetadata(root, paths, filter);
        return entries.filter(e => e.matched);
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
