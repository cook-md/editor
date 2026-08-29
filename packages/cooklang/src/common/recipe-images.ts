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
 * Image paths for one recipe, as returned by the `recipeImages` RPC.
 *
 * `steps` mirrors `cooklang-find`'s `StepImageCollection`: section index ->
 * step index -> path, both zero-indexed, with section 0 holding the linear
 * `Recipe.N.ext` form.
 */
export interface RecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

/** The same shape after every entry has been turned into an `<img>` src. */
export interface ResolvedRecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

/**
 * The image for one step, following the two naming conventions cookcli
 * supports (see `builders.rs`): the section-specific `Recipe.S.N.ext` wins,
 * and the continuous `Recipe.N.ext` is the fallback.
 *
 * @param sectionIndex zero-based index of the section the step is in
 * @param stepInSection zero-based index of the step within that section
 * @param globalStepIndex zero-based index of the step counted across all sections
 */
export function lookupStepImage(
    images: RecipeImages | ResolvedRecipeImages,
    sectionIndex: number,
    stepInSection: number,
    globalStepIndex: number
): string | undefined {
    return images.steps[String(sectionIndex)]?.[String(stepInSection)]
        ?? images.steps['0']?.[String(globalStepIndex)];
}

/** Where an image should be loaded from. */
export type ImageLocation =
    | { kind: 'remote'; url: string }
    | { kind: 'file'; uri: URI };

/**
 * MIME type per supported image file extension, lower-case and without the
 * leading dot. This is the single source of truth for which extensions the
 * preview understands; {@link RECIPE_IMAGE_EXTENSIONS} is derived from it.
 */
export const RECIPE_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/** Image file extensions `cooklang-find` discovers, lower-case, in its own order. */
export const RECIPE_IMAGE_EXTENSIONS: ReadonlyArray<string> = Object.keys(RECIPE_IMAGE_MIME_TYPES);

/**
 * Turn a raw image value from the `recipeImages` RPC into something loadable.
 *
 * `cooklang-find` returns absolute paths for everything it discovers on disk
 * and hands metadata values (`image:`, `images:`, `picture:`, `pictures:`)
 * back verbatim, so exactly three rules are needed:
 *
 * 1. `http://` or `https://` (case-insensitive) is passed through as a remote URL.
 * 2. An absolute path — POSIX `/…` or Windows `C:\…` / `C:/…` — is used as given.
 * 3. Anything else is relative and resolves against the recipe file's own folder.
 *
 * Blank or whitespace-only input yields `undefined`.
 */
export function resolveImageUri(raw: string, recipeUri: URI): ImageLocation | undefined {
    const value = raw.trim();
    if (value.length === 0) {
        return undefined;
    }
    if (/^https?:\/\//i.test(value)) {
        return { kind: 'remote', url: value };
    }
    // `URI.fromFilePath` does not translate Windows separators, so normalise them.
    const normalized = value.replace(/\\/g, '/');
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
    if (isAbsolute) {
        return { kind: 'file', uri: URI.fromFilePath(normalized) };
    }
    return { kind: 'file', uri: recipeUri.parent.resolve(normalized) };
}
