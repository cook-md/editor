// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

/* eslint-disable no-null/no-null */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { ShoppingListResult } from '../common/shopping-list-types';

/**
 * Headless shopping-list aggregation over the first workspace root: resolves
 * each `{ path, scale }` through cooklang-find, reads `config/aisle.conf` and
 * `config/pantry.conf`, and runs the native `generateShoppingList`. Used by the
 * `cooklang.api.generateShoppingList` command and the Cookbot tool.
 */
@injectable()
export class ShoppingListGenerator {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    /**
     * Missing recipes are skipped with a warning. Throws when no workspace is
     * open or the native call fails.
     */
    async computeResult(items: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open.');
        }
        const baseDir = root.path.fsPath();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of items) {
            try {
                // cooklang-find auto-resolves `.cook`/`.menu` for extension-less menu references.
                const content = await this.languageService.findRecipe(baseDir, path);
                if (content === undefined) {
                    console.warn(`[shopping-list] Recipe not found: ${path}`);
                    continue;
                }
                recipeInputs.push({ content, scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${path}:`, e);
            }
        }

        const aisleConf = await this.readConfigFile(root, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(root, 'config/pantry.conf');

        const json = await this.languageService.generateShoppingList(
            JSON.stringify(recipeInputs),
            aisleConf,
            pantryConf,
        );
        return JSON.parse(json);
    }

    protected async readConfigFile(root: URI, relativePath: string): Promise<string | null> {
        try {
            const content = await this.fileService.read(root.resolve(relativePath));
            return content.value;
        } catch {
            return null;
        }
    }
}
