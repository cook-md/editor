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
import { CooklangLanguageService } from './cooklang-language-service';

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
    // `//host/…` (a UNC path once separators are normalised) is absolute too.
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
    // `normalizePath()` folds `.` and `..`, so one file always has one URI
    // (the preview's watcher compares them as strings).
    const uri = (isAbsolute ? URI.fromFilePath(normalized) : recipeUri.parent.resolve(normalized)).normalizePath();
    // A UNC path is read over SMB, which can leak the user's NTLM hash to its
    // host. An image may name only the host the recipe is already read from:
    // none for a local recipe, the recipe's own share host for a shared one
    // (whose siblings `cooklang-find` reports as `\\host\share\…`).
    if (uri.authority.toLowerCase() !== recipeUri.authority.toLowerCase()) {
        return undefined;
    }
    return { kind: 'file', uri };
}

/**
 * Where a raw image value may be loaded from, under the recipe preview's rules
 * (also the rules of `cooklang.api.recipeImages`):
 *
 * - A local (`file:`) recipe may name any `http(s)` URL, or a file by absolute
 *   path or by a path relative to its own folder.
 * - A recipe on any other file system (a plugin's, such as `cooklang-hub:`) has
 *   third-party metadata and no folder: only `https:` URLs are kept, so its
 *   images never travel in the clear, and paths name nothing.
 *
 * Blank or missing values yield `undefined`.
 */
export function locateRecipeImage(raw: string | undefined, recipeUri: URI): ImageLocation | undefined {
    if (!raw) {
        return undefined;
    }
    const location = resolveImageUri(raw, recipeUri);
    if (!location) {
        return undefined;
    }
    const local = recipeUri.scheme === 'file';
    if (location.kind === 'remote') {
        return local || /^https:/i.test(location.url) ? location : undefined;
    }
    return local ? location : undefined;
}

/** One raw value from the `recipeImages` RPC; no `section`/`step` means the title image. */
export interface RecipeImageEntry {
    section?: string;
    step?: string;
    raw: string;
}

/**
 * Rebuild `images` with every value passed through `convert`, keeping the
 * section and step keys. Entries `convert` maps to `undefined` are left out,
 * and a section with no entries left is left out too. Every conversion starts
 * before any is awaited: they are usually file reads over RPC, and a 20-image
 * recipe should not pay for twenty sequential round-trips.
 */
export async function mapRecipeImages(
    images: RecipeImages | undefined,
    convert: (raw: string) => Promise<string | undefined>
): Promise<ResolvedRecipeImages> {
    const entries: RecipeImageEntry[] = [];
    if (images?.title) {
        entries.push({ raw: images.title });
    }
    for (const [section, steps] of Object.entries(images?.steps ?? {})) {
        for (const [step, raw] of Object.entries(steps)) {
            if (raw) {
                entries.push({ section, step, raw });
            }
        }
    }
    const resolved: ResolvedRecipeImages = { steps: {} };
    await Promise.all(entries.map(async entry => {
        const value = await convert(entry.raw);
        if (!value) {
            return;
        }
        if (entry.section === undefined || entry.step === undefined) {
            resolved.title = value;
        } else {
            (resolved.steps[entry.section] ??= {})[entry.step] = value;
        }
    }));
    return resolved;
}

/**
 * The recipe's images as `cooklang-find` reports them. A local (`file:`)
 * recipe is looked up on disk, where `cooklang-find` takes the metadata image
 * first and sibling files (`Recipe.jpg`, `Recipe.N.jpg`, `Recipe.S.N.jpg`)
 * after. Any other recipe has no folder, so only its metadata can name an
 * image, read from `content`; with no content yet there is nothing to report.
 */
export async function discoverRecipeImages(
    service: Pick<CooklangLanguageService, 'recipeImages' | 'recipeImagesFromContent'>,
    recipeUri: URI,
    content: string | undefined
): Promise<RecipeImages | undefined> {
    if (recipeUri.scheme === 'file') {
        return JSON.parse(await service.recipeImages(recipeUri.path.fsPath())) as RecipeImages;
    }
    if (content === undefined) {
        return undefined;
    }
    return JSON.parse(await service.recipeImagesFromContent(content)) as RecipeImages;
}
