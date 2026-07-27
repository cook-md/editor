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
 * Chooses the payload sent to /api/cookify/text when clipping a page:
 * the schema.org Recipe from JSON-LD when present, otherwise the page text.
 */
export namespace RecipePayload {

    export function extract(jsonLdBlocks: string[], pageText: string): string {
        for (const block of jsonLdBlocks) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(block);
            } catch {
                continue;
            }
            const recipe = findRecipe(parsed);
            if (recipe) {
                return JSON.stringify(recipe);
            }
        }
        return pageText.trim();
    }

    function findRecipe(node: unknown): object | undefined {
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findRecipe(item);
                if (found) {
                    return found;
                }
            }
            return undefined;
        }
        if (node && typeof node === 'object') {
            const type = (node as { '@type'?: unknown })['@type'];
            if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
                return node;
            }
            const graph = (node as { '@graph'?: unknown })['@graph'];
            if (Array.isArray(graph)) {
                return findRecipe(graph);
            }
        }
        return undefined;
    }
}
