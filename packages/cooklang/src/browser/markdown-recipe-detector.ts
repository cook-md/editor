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

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { COOKLANG_LANGUAGE_ID, CooklangUri, RecipeFrontmatter } from '../common';

/**
 * Recognizes Obsidian-style Markdown recipes (`.md` + `recipe: true`).
 *
 * Prefer the sync {@link isKnownRecipe} path when a Monaco model may already
 * have been language-switched to Cooklang. Use {@link isRecipe} when opening a
 * file that is not yet in an editor (preview open handler).
 */
@injectable()
export class MarkdownRecipeDetector {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    /**
     * Whether `uri` is a `.cook` recipe, or a `.md` model already assigned the
     * Cooklang language id (after frontmatter detection).
     */
    isKnownRecipe(uri: URI | undefined): boolean {
        if (CooklangUri.isRecipe(uri)) {
            return true;
        }
        if (!uri || !CooklangUri.isMarkdown(uri)) {
            return false;
        }
        const model = this.monacoWorkspace.getTextDocument(uri.toString());
        return model?.languageId === COOKLANG_LANGUAGE_ID;
    }

    /**
     * Whether `uri` is a recipe: native `.cook`, a known Markdown recipe model,
     * or an on-disk `.md` file whose frontmatter has `recipe: true`.
     *
     * Never rejects: unreadable files are reported as non-recipes so open
     * handlers stand down rather than claiming a broken file.
     */
    async isRecipe(uri: URI): Promise<boolean> {
        if (CooklangUri.isRecipe(uri)) {
            return true;
        }
        if (!CooklangUri.isMarkdown(uri)) {
            return false;
        }
        if (this.isKnownRecipe(uri)) {
            return true;
        }
        try {
            const content = (await this.fileService.read(uri)).value;
            return RecipeFrontmatter.hasRecipeFlag(content);
        } catch (e) {
            console.warn(`[cooklang] could not read ${uri.toString()} for recipe frontmatter:`, e);
            return false;
        }
    }
}
