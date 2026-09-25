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

import { formatQuantity, Ingredient } from './recipe-types';
import { ReportOutputFormat } from './report-templates';

/*
 * Contexts passed as the single argument to commands contributed to the
 * Cooklang outlets (see `CooklangOutlets`). Plain JSON so they cross the
 * plugin-host boundary unchanged. Version 1; later versions only add optional
 * fields. Paths are workspace-relative; URIs are `file://` strings.
 */

/** Context for the `cooklang/recipePreview/toolbar` and `cooklang/menuPreview/toolbar` outlets. */
export interface PreviewOutletContext {
    version: 1;
    /** `file://` URI string of the recipe or menu. */
    uri: string;
    /** Workspace-relative path of the recipe or menu. */
    path: string;
    /** The scale the preview shows — the recipe scale, or the menu scale on the menu toolbar. */
    scale: number;
}

export namespace PreviewOutletContext {
    export function is(arg: unknown): arg is PreviewOutletContext {
        return typeof arg === 'object' && arg !== undefined && arg !== null // eslint-disable-line no-null/no-null
            && typeof (arg as PreviewOutletContext).version === 'number'
            && typeof (arg as PreviewOutletContext).uri === 'string'
            && typeof (arg as PreviewOutletContext).path === 'string'
            && typeof (arg as PreviewOutletContext).scale === 'number';
    }
}

/** An ingredient as shown in the recipe preview (already scaled). */
export interface IngredientOutletInfo {
    name: string;
    /** Formatted quantity as displayed, e.g. `"2 cups"`. */
    quantity?: string;
    /** Numeric amount when the quantity is a number or fraction. */
    amount?: number;
    unit?: string;
}

export namespace IngredientOutletInfo {
    export function fromIngredient(ingredient: Ingredient): IngredientOutletInfo {
        const info: IngredientOutletInfo = { name: ingredient.name };
        const quantity = ingredient.quantity;
        if (!quantity) {
            return info;
        }
        const text = formatQuantity(quantity);
        if (text) {
            info.quantity = text;
        }
        if (quantity.value.type === 'number') {
            const number = quantity.value.value;
            info.amount = number.type === 'regular'
                ? number.value
                : number.value.whole + number.value.num / number.value.den;
        }
        if (quantity.unit) {
            info.unit = quantity.unit;
        }
        return info;
    }
}

/** Context for the `cooklang/recipePreview/ingredient/context` outlet (right-click on an ingredient in the recipe preview). */
export interface IngredientOutletContext extends PreviewOutletContext {
    ingredient: IngredientOutletInfo;
}

/** A `@recipe` reference as written in a menu. */
export interface MenuRecipeOutletInfo {
    /** Reference without a leading `./`. */
    name: string;
    /** Scale shown in the menu, already multiplied by the menu scale. */
    scale?: number;
    /** When set, `scale` is a target in this unit (e.g. `servings`), not a multiplier. */
    unit?: string;
}

/** Context for the `cooklang/menuPreview/recipe/context` outlet (right-click on a recipe reference in the menu preview). */
export interface MenuRecipeOutletContext {
    version: 1;
    menuUri: string;
    menuPath: string;
    menuScale: number;
    recipe: MenuRecipeOutletInfo;
}

/** Context for the `cooklang/report/toolbar` outlet (toolbar above a rendered report). */
export interface ReportOutletContext {
    version: 1;
    /** Recipe or menu the report was rendered for. */
    uri: string;
    path: string;
    templateId: string;
    templateLabel: string;
    templateUri?: string;
    outputFormat: ReportOutputFormat;
    /** Rendered output, once rendering succeeded. */
    output?: string;
}
