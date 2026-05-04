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
 * TypeScript types matching the JSON output of cooklang-native's parse_menu().
 */

export interface MenuMetadata {
    servings?: string;
    yield?: string;
    time?: string;
    author?: string;
    description?: string;
    source?: string;
    sourceUrl?: string;
    custom: [string, string][];
}

export interface MenuTextItem {
    type: 'text';
    value: string;
}

export interface MenuRecipeReferenceItem {
    type: 'recipeReference';
    name: string;
    scale?: number;
    unit?: string;
}

export interface MenuIngredientItem {
    type: 'ingredient';
    name: string;
    quantity?: string;
    unit?: string;
}

export type MenuSectionItem = MenuTextItem | MenuRecipeReferenceItem | MenuIngredientItem;

export interface MenuSection {
    name: string | null;
    lines: MenuSectionItem[][];
}

export interface MenuParseResult {
    metadata: MenuMetadata | null;
    sections: MenuSection[];
    errors: Array<{ message: string; severity: string }>;
    warnings: Array<{ message: string; severity: string }>;
}
