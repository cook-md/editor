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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CooklangLanguageService } from '../common/cooklang-language-service';

/** A `@recipe{…}` reference resolved to a concrete multiplier. */
export interface ResolvedRecipeReference {
    path: string;
    /** Multiplier relative to the recipe that holds the reference. */
    scale: number;
    /** The referenced recipe's own references; omitted when there are none. */
    children?: ResolvedRecipeReference[];
}

/**
 * Deepest reference chain followed, matching CookCLI's `MAX_REFERENCE_DEPTH`.
 * Cycles are caught separately; this only bounds absurdly deep collections.
 */
const MAX_REFERENCE_DEPTH = 100;

/**
 * Flattens a reference tree depth-first into `{ path, scale }` pairs with
 * multipliers applied down the chain (a sauce at ×0.5 under a dinner at ×2
 * is ×1 overall) — the shape `ShoppingListGenerator.computeResult` expects.
 */
export function flattenReferences(
    refs: ReadonlyArray<ResolvedRecipeReference>,
    parentScale = 1,
): Array<{ path: string; scale: number }> {
    const out: Array<{ path: string; scale: number }> = [];
    for (const ref of refs) {
        const scale = ref.scale * parentScale;
        out.push({ path: ref.path, scale });
        out.push(...flattenReferences(ref.children ?? [], scale));
    }
    return out;
}

/**
 * Resolves `@recipe` sub-references in a `.cook`/`.menu` to `{ path, scale }`
 * pairs, since the `.shopping-list` format only stores a numeric multiplier.
 * Shared by the `cooklang.api.resolveRecipeReferences` command and the `generateShoppingList` AI tool.
 *
 * Per spec/conventions.md:
 *   {2}            → plain multiplier
 *   {4%servings}   → target / recipe.servings
 *   {150%ml}       → target / recipe.yield (when units match)
 *
 * Unresolvable units fall back to treating the raw number as a multiplier —
 * same as when no metadata is present on the target.
 *
 * References are followed recursively (a menu → dinner → sauce → prep chain
 * lists the prep's ingredients too). Nested paths resolve against the same
 * workspace root, as in CookCLI; a reference back to a recipe already being
 * expanded is skipped (with a warning) so a cycle can't count twice.
 */
@injectable()
export class RecipeReferenceResolver {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    async resolve(content: string, baseDir: string): Promise<ResolvedRecipeReference[]> {
        return this.resolveNested(content, baseDir, []);
    }

    protected async resolveNested(
        content: string,
        baseDir: string,
        ancestors: string[],
    ): Promise<ResolvedRecipeReference[]> {
        let parsed: {
            sections?: Array<{
                lines?: Array<Array<{ type?: string; name?: string; scale?: number; unit?: string }>>;
            }>;
        };
        try {
            parsed = JSON.parse(await this.languageService.parseMenu(content, 1));
        } catch (e) {
            console.error('[shopping-list] Failed to parse content for refs:', e);
            return [];
        }

        const refs: Array<{ path: string; scale: number; unit?: string }> = [];
        for (const section of parsed.sections ?? []) {
            for (const line of section.lines ?? []) {
                for (const item of line) {
                    if (item.type !== 'recipeReference') { continue; }
                    if (!item.name) { continue; }
                    refs.push({
                        path: item.name.replace(/^\.\//, ''),
                        scale: typeof item.scale === 'number' && item.scale > 0 ? item.scale : 1,
                        unit: item.unit,
                    });
                }
            }
        }

        const out: ResolvedRecipeReference[] = [];
        for (const r of refs) {
            if (ancestors.includes(r.path)) {
                // Listing it again would count its ingredients twice.
                console.warn(`[shopping-list] Reference cycle at ${r.path}; skipping it`);
                continue;
            }
            const recipe = await this.findRecipe(baseDir, r.path);
            let scale = r.scale;
            if (recipe && r.unit && r.scale > 0) {
                const resolved = await this.resolveReferenceScale(recipe, r.path, r.scale, r.unit);
                if (resolved !== undefined) {
                    scale = resolved;
                }
            }
            const ref: ResolvedRecipeReference = { path: r.path, scale };
            if (recipe) {
                if (ancestors.length + 1 >= MAX_REFERENCE_DEPTH) {
                    console.warn(`[shopping-list] Stopped at ${r.path}: references nested more than ${MAX_REFERENCE_DEPTH} deep`);
                } else {
                    const children = await this.resolveNested(recipe, baseDir, [...ancestors, r.path]);
                    if (children.length > 0) {
                        ref.children = children;
                    }
                }
            }
            out.push(ref);
        }
        return out;
    }

    protected async findRecipe(baseDir: string, recipePath: string): Promise<string | undefined> {
        try {
            return await this.languageService.findRecipe(baseDir, recipePath);
        } catch (e) {
            console.warn(`[shopping-list] findRecipe failed for ${recipePath}:`, e);
            return undefined;
        }
    }

    /**
     * Compute the multiplier that, when applied to the referenced recipe,
     * yields the requested target.
     *
     * - `%servings` / `%serves` → reads the recipe's `servings` metadata.
     * - any other unit          → reads the recipe's `yield` metadata and
     *                             only resolves when the units match.
     *
     * Returns `undefined` when the relevant metadata is missing/unparseable
     * or the unit doesn't match.
     */
    protected async resolveReferenceScale(
        content: string,
        recipePath: string,
        target: number,
        unit: string,
    ): Promise<number | undefined> {
        let metadata: { servings?: string; yield?: string } | undefined;
        try {
            const menu = JSON.parse(await this.languageService.parseMenu(content, 1));
            metadata = menu?.metadata;
        } catch (e) {
            console.warn(`[shopping-list] parseMenu failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!metadata) { return undefined; }

        const normalisedUnit = unit.toLowerCase();
        const isServings = normalisedUnit === 'servings' || normalisedUnit === 'serves';
        const raw = isServings ? metadata.servings : metadata.yield;
        if (!raw) { return undefined; }

        const parsed = parseNumberAndUnit(raw);
        if (!parsed || parsed.amount <= 0) { return undefined; }

        // For yield, the reference unit must match the recipe's yield unit.
        // For servings, the `%servings`/`%serves` label is the unit — any
        // trailing text in the metadata value (`"15 cups worth"`) is ignored.
        if (!isServings) {
            if (!parsed.unit || parsed.unit.toLowerCase() !== normalisedUnit) {
                return undefined;
            }
        }

        return target / parsed.amount;
    }
}

/**
 * Extract a leading positive number and optional unit from a metadata string.
 * Handles cooklang quantity syntax (`500%ml`), space-separated (`2 cups`), and
 * bare numbers (`2`).
 */
export function parseNumberAndUnit(value: string): { amount: number; unit?: string } | undefined {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*%?\s*([^\s]*)/);
    if (!match) { return undefined; }
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount)) { return undefined; }
    const unit = match[2] ? match[2] : undefined;
    return { amount, unit };
}
