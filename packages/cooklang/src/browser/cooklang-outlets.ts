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

import { MenuPath } from '@theia/core/lib/common/menu';

/**
 * Public menu paths plugins contribute to with `contributes.menus`, e.g.
 * `"cooklang/recipePreview/toolbar": [{ "command": "x", "group": "navigation@10" }]`.
 * Theia maps any non-VS Code menu id to the menu path `[id]`, so plugins need
 * nothing beyond the id. Each outlet passes one JSON context argument — see
 * `cooklang-outlet-context.ts`. Renaming a path breaks plugins.
 */
export namespace CooklangOutlets {
    /** Outlet contract version; equals the `version` field of every context passed to outlet commands. */
    export const VERSION = 1;
    /**
     * Context key set on the recipe preview element to the scheme of the
     * recipe's URI: `file`, or e.g. `cooklang-hub` for a recipe served by a
     * plugin's file system. Outlet `when` clauses can target or exclude remote
     * previews, e.g. `"when": "cooklangPreviewScheme == file"`. Only the recipe
     * preview sets it; elsewhere it is undefined.
     */
    export const PREVIEW_SCHEME_CONTEXT_KEY = 'cooklangPreviewScheme';
    /** Icon buttons in the recipe preview header. Context: `PreviewOutletContext`. */
    export const RECIPE_PREVIEW_TOOLBAR: MenuPath = ['cooklang/recipePreview/toolbar'];
    /**
     * Badges in the recipe preview header. The editor executes each contributed
     * command with a `PreviewOutletContext` and draws the `PreviewBadge` it
     * returns (or nothing for `undefined`). A provider that does not answer
     * within 10 s is treated as returning nothing. Providers run only for
     * visible previews, and re-run when the recipe text, the scale, the
     * user's subscription, or the contributed commands/menus change.
     */
    export const RECIPE_PREVIEW_BADGE: MenuPath = ['cooklang/recipePreview/badge'];
    /** Icon buttons in the menu preview header. Context: `PreviewOutletContext`. */
    export const MENU_PREVIEW_TOOLBAR: MenuPath = ['cooklang/menuPreview/toolbar'];
    /** Right-click on an ingredient in the recipe preview. Context: `IngredientOutletContext`. */
    export const RECIPE_INGREDIENT_CONTEXT: MenuPath = ['cooklang/recipePreview/ingredient/context'];
    /** Right-click on a recipe reference in the menu preview. Context: `MenuRecipeOutletContext`. */
    export const MENU_RECIPE_CONTEXT: MenuPath = ['cooklang/menuPreview/recipe/context'];
    /** Icon buttons above a rendered report. Context: `ReportOutletContext`. */
    export const REPORT_TOOLBAR: MenuPath = ['cooklang/report/toolbar'];
}
