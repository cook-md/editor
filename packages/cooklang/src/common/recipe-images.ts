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

/** Image file extensions `cooklang-find` discovers, lower-case, in its own order. */
export const RECIPE_IMAGE_EXTENSIONS: ReadonlyArray<string> = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Turn a raw image value from the `recipeImages` RPC into something loadable.
 *
 * - `http(s)` URLs are passed through.
 * - An absolute path names a sibling of the recipe, so only its basename is
 *   used and it is resolved against the recipe's folder. This keeps browser
 *   code free of raw OS paths and works for both POSIX and Windows separators.
 * - A relative path from metadata with no separator resolves against the
 *   recipe's folder; one with a separator resolves against the workspace root
 *   (matching cookcli, which serves relative metadata paths from the root),
 *   falling back to the recipe's folder when no workspace is open.
 */
export function resolveImageUri(
    raw: string,
    recipeUri: URI,
    workspaceRootUri: URI | undefined
): ImageLocation | undefined {
    const value = raw.trim();
    if (value.length === 0) {
        return undefined;
    }
    if (/^https?:\/\//i.test(value)) {
        return { kind: 'remote', url: value };
    }
    const folder = recipeUri.parent;
    const normalized = value.replace(/\\/g, '/');
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
    if (isAbsolute) {
        const base = normalized.substring(normalized.lastIndexOf('/') + 1);
        return base.length === 0 ? undefined : { kind: 'file', uri: folder.resolve(base) };
    }
    if (normalized.includes('/') && workspaceRootUri) {
        return { kind: 'file', uri: workspaceRootUri.resolve(normalized) };
    }
    return { kind: 'file', uri: folder.resolve(normalized) };
}
