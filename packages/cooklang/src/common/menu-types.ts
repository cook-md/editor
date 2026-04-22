// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
