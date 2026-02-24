// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

/**
 * A recipe entry in the shopping list with its scale factor.
 */
export interface ShoppingListRecipe {
    /** Workspace-relative path to the .cook file */
    path: string;
    /** Display name (derived from metadata or filename) */
    name: string;
    /** Scale factor (1 = original, 2 = double, etc.) */
    scale: number;
}

/**
 * Result returned by the backend shopping list generator.
 */
export interface ShoppingListResult {
    /** Ingredient categories from aisle.conf, in aisle order */
    categories: ShoppingListCategory[];
    /** Uncategorized ingredients */
    other: ShoppingListCategory;
    /** Names of ingredients found in pantry (informational) */
    pantry_items: string[];
}

/**
 * A category of ingredients (e.g. "produce", "dairy").
 */
export interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

/**
 * A single ingredient in the shopping list.
 */
export interface ShoppingListItem {
    name: string;
    /** Pre-formatted quantity string, e.g. "500 g, 2 cups" */
    quantities: string;
}
