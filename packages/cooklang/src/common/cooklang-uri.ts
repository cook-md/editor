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

import URI from '@theia/core/lib/common/uri';

/**
 * Helpers for recognizing Cooklang files by their URI.
 *
 * The Cooklang language is associated with editors purely by file extension
 * (`.cook` / `.menu`, registered in {@link cooklang-grammar-contribution}).
 * Monaco matches those extensions case-insensitively, so a file named
 * `Recipe.COOK` is highlighted and served by the language server just like
 * `recipe.cook`. Feature gates (preview toolbar buttons, open handlers,
 * shopping-list/report commands) must therefore match case-insensitively too —
 * a case-sensitive `uri.path.ext === '.cook'` check silently hides the preview
 * affordance for such files even though they are fully recognized as Cooklang.
 */
export namespace CooklangUri {

    /** File extension for Cooklang recipe files. */
    export const RECIPE_EXTENSION = '.cook';

    /** File extension for Cooklang menu files. */
    export const MENU_EXTENSION = '.menu';

    function hasExtension(uri: URI | undefined, extension: string): boolean {
        return uri !== undefined && uri.path.ext.toLowerCase() === extension;
    }

    /** Whether `uri` denotes a Cooklang recipe file (`.cook`, any case). */
    export function isRecipe(uri: URI | undefined): boolean {
        return hasExtension(uri, RECIPE_EXTENSION);
    }

    /** Whether `uri` denotes a Cooklang menu file (`.menu`, any case). */
    export function isMenu(uri: URI | undefined): boolean {
        return hasExtension(uri, MENU_EXTENSION);
    }

    /**
     * A URI for an absolute filesystem path returned by the native addon.
     *
     * `cooklang-find` reports OS paths, so Windows results arrive with `\`
     * separators that `URI.fromFilePath` does not translate.
     */
    export function fromNativePath(path: string): URI {
        return URI.fromFilePath(path.replace(/\\/g, '/'));
    }

    /** Whether `uri` denotes any Cooklang file (recipe or menu). */
    export function isCooklang(uri: URI | undefined): boolean {
        return isRecipe(uri) || isMenu(uri);
    }
}
