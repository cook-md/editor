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
