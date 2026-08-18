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
    scale: number;
}

/**
 * Resolves `@recipe` sub-references in a `.cook`/`.menu` to `{ path, scale }`
 * pairs, since the `.shopping-list` format only stores a numeric multiplier.
 * Shared by the shopping-list commands and the `generateShoppingList` AI tool.
 *
 * Per spec/conventions.md:
 *   {2}            → plain multiplier
 *   {4%servings}   → target / recipe.servings
 *   {150%ml}       → target / recipe.yield (when units match)
 *
 * Unresolvable units fall back to treating the raw number as a multiplier —
 * same as when no metadata is present on the target.
 */
@injectable()
export class RecipeReferenceResolver {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    async resolve(content: string, baseDir: string): Promise<ResolvedRecipeReference[]> {
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
            let scale = r.scale;
            if (r.unit && r.scale > 0) {
                const resolved = await this.resolveReferenceScale(baseDir, r.path, r.scale, r.unit);
                if (resolved !== undefined) {
                    scale = resolved;
                }
            }
            out.push({ path: r.path, scale });
        }
        return out;
    }

    /**
     * Compute the multiplier that, when applied to the referenced recipe,
     * yields the requested target.
     *
     * - `%servings` / `%serves` → reads the recipe's `servings` metadata.
     * - any other unit          → reads the recipe's `yield` metadata and
     *                             only resolves when the units match.
     *
     * Returns `undefined` when the recipe can't be found, the relevant
     * metadata is missing/unparseable, or the unit doesn't match.
     */
    protected async resolveReferenceScale(
        baseDir: string,
        recipePath: string,
        target: number,
        unit: string,
    ): Promise<number | undefined> {
        let content: string | undefined;
        try {
            content = await this.languageService.findRecipe(baseDir, recipePath);
        } catch (e) {
            console.warn(`[shopping-list] findRecipe failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!content) { return undefined; }

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
