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
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import { baseNameWithoutExt, matchesTitleContains, matchesWhere, readFrontmatter, WhereClause } from './metadata-matcher';

/** Never walk more than this many `.cook` files when enumerating a workspace. */
const MAX_ENUMERATED_FILES = 5000;

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

/**
 * SEAM: the one place that resolves "which recipes match a metadata filter"
 * for both `updateRecipeMetadata`'s `select` and (this package's sibling
 * copy in `packages/cooklang`) `searchRecipes`'s `fields`/`where`. Nothing
 * else in either tool reads frontmatter for selection purposes.
 *
 * A follow-up will move this filtering into the Rust `cooklang-find` crate
 * (and `cooklang-native`) and swap `list`'s body for a native call without
 * touching the tools — the `where`/`titleContains` JSON grammar it accepts
 * (see `metadata-matcher.ts`) is mirrored there, so it must not change shape
 * here without updating that crate too.
 *
 * This package has no native full-text search (unlike `@theia/cooklang`'s
 * copy, which delegates to `cooklang-find`'s `searchRecipes`), so `list`'s
 * `query` parameter is accepted for interface parity but unused: candidates
 * always come from a workspace walk.
 */
@injectable()
export class RecipeMetadataSource {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    /** Every `.cook` file under `root`, workspace-relative, respecting gitignore/exclude preferences. */
    async listCookPaths(root: URI): Promise<string[]> {
        const results: string[] = [];
        await this.walk(root, root, results);
        return results;
    }

    protected async walk(currentUri: URI, root: URI, results: string[]): Promise<void> {
        if (results.length >= MAX_ENUMERATED_FILES) {
            return;
        }
        let stat;
        try {
            stat = await this.fileService.resolve(currentUri);
        } catch {
            return;
        }
        if (!stat?.isDirectory || !stat.children) {
            return;
        }
        for (const child of stat.children) {
            if (results.length >= MAX_ENUMERATED_FILES) {
                return;
            }
            if (await this.workspaceScope.shouldExclude(child)) {
                continue;
            }
            if (child.isDirectory) {
                await this.walk(child.resource, root, results);
            } else if (child.resource.path.ext === '.cook') {
                const relative = root.relative(child.resource)?.toString();
                if (relative) {
                    results.push(relative);
                }
            }
        }
    }

    /**
     * Reads and parses each of `paths`' frontmatter, reporting whether it
     * satisfies `filter`. Always returns one entry per input path (even non-
     * matches), so callers that need metadata for reasons other than
     * filtering (e.g. building a digest) can reuse the read.
     */
    async filterByMetadata(root: URI, paths: string[], filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        const entries: RecipeMetadataEntry[] = [];
        for (const path of paths) {
            const content = await this.readContent(root, path);
            if (content === undefined) {
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
    async list(root: URI, _query: string | undefined, filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        const allPaths = await this.listCookPaths(root);
        const entries = await this.filterByMetadata(root, allPaths, filter);
        return entries.filter(e => e.matched);
    }

    /** Open-editor content when the document is open with unsaved changes, else the file on disk (`undefined` if missing). */
    async readContent(root: URI, path: string): Promise<string | undefined> {
        const uri = root.resolve(path);
        const openEditorValue = this.monacoWorkspace.getTextDocument(uri.toString())?.getText();
        if (openEditorValue !== undefined) {
            return openEditorValue;
        }
        try {
            return (await this.fileService.read(uri)).value.toString();
        } catch {
            return undefined;
        }
    }
}
