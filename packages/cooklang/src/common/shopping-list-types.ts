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

/* eslint-disable no-null/no-null */

// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

// ── Internal, ergonomic types used by the plugin API ─────────────────────────

/**
 * Persisted shopping list — internal representation.
 * Holds recipe references and free-hand ingredient lines, in file order.
 */
export interface ShoppingListFile {
    items: ShoppingListEntry[];
}

/** One line of a `.shopping-list`: a recipe reference or a free-hand ingredient. */
export type ShoppingListEntry = ShoppingListRecipeItem | ShoppingListIngredientItem;

/**
 * A recipe entry. A bare entry (empty `children`) represents a single recipe.
 * An entry with children represents either a menu (children are recipes) or a
 * recipe with selected sub-references and ingredients.
 *
 * `multiplier` is `undefined` when the `.shopping-list` serializes without an
 * explicit multiplier (equivalent to 1).
 */
export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    multiplier?: number;
    children: ShoppingListEntry[];
    /** A nested `? ./path` selection line (an accepted optional reference). Only set when true. */
    optional?: boolean;
}

/**
 * A free-hand ingredient line (`milk{2%l}`, `bread`), at the top level or
 * nested under a recipe. Other Cooklang tools author these; the editor keeps
 * them as written.
 */
export interface ShoppingListIngredientItem {
    type: 'ingredient';
    name: string;
    /** Raw quantity text: `2%l`, `3`, `a pinch`. `undefined` when absent. */
    quantity?: string;
    /** A nested `? name{quantity}` selection line. Only set when true. */
    optional?: boolean;
}

/** Single entry in the `.shopping-checked` log — internal representation. */
export type CheckEntry =
    | { type: 'checked'; name: string }
    | { type: 'unchecked'; name: string };

/** Aggregated shopping-list result returned by `generateShoppingList`. Unchanged. */
export interface ShoppingListResult {
    /** Ingredient categories from aisle.conf, in aisle order */
    categories: ShoppingListCategory[];
    /** Uncategorized ingredients */
    other: ShoppingListCategory;
    /** Names of ingredients found in pantry (informational) */
    pantryItems: string[];
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

// ── Wire types — mirror serde default (externally-tagged) JSON from NAPI ─────
// Kept separate from the internal model so UI/service code stays readable.

interface WireShoppingList {
    items: WireShoppingItem[];
}

type WireShoppingItem =
    | { Recipe: WireRecipe }
    | { Ingredient: WireIngredient };

interface WireRecipe {
    path: string;
    multiplier: number | null;
    children: WireShoppingItem[];
    /** serde `default` — absent means false. */
    optional?: boolean;
}

interface WireIngredient {
    name: string;
    quantity: string | null;
    /** serde `default` — absent means false. */
    optional?: boolean;
}

type WireCheckEntry =
    | { Checked: string }
    | { Unchecked: string };

// ── Marshalling helpers ──────────────────────────────────────────────────────

/** Parse the JSON produced by NAPI `parseShoppingList` into internal shape. */
export function fromWireShoppingList(json: string): ShoppingListFile {
    const wire = JSON.parse(json) as WireShoppingList;
    return { items: (wire.items ?? []).map(fromWireItem) };
}

function fromWireItem(item: WireShoppingItem): ShoppingListEntry {
    if ('Recipe' in item) {
        const r = item.Recipe;
        const recipe: ShoppingListRecipeItem = {
            type: 'recipe',
            path: r.path,
            multiplier: r.multiplier ?? undefined,
            children: (r.children ?? []).map(fromWireItem)
        };
        if (r.optional) {
            recipe.optional = true;
        }
        return recipe;
    }
    const i = item.Ingredient;
    const ingredient: ShoppingListIngredientItem = { type: 'ingredient', name: i.name };
    if (i.quantity !== null && i.quantity !== undefined) {
        ingredient.quantity = i.quantity;
    }
    if (i.optional) {
        ingredient.optional = true;
    }
    return ingredient;
}

/** Serialize internal shape to JSON for NAPI `writeShoppingList`. */
export function toWireShoppingList(file: ShoppingListFile): string {
    const wire: WireShoppingList = {
        items: file.items.map(toWireItem)
    };
    return JSON.stringify(wire);
}

function toWireItem(item: ShoppingListEntry): WireShoppingItem {
    if (item.type === 'ingredient') {
        return { Ingredient: { name: item.name, quantity: item.quantity ?? null, optional: item.optional === true } };
    }
    const r: WireRecipe = {
        path: item.path,
        multiplier: item.multiplier ?? null,
        children: item.children.map(toWireItem),
        optional: item.optional === true
    };
    return { Recipe: r };
}

/** Parse the JSON produced by NAPI `parseChecked` into internal CheckEntry[]. */
export function fromWireCheckedLog(json: string): CheckEntry[] {
    const wire = JSON.parse(json) as WireCheckEntry[];
    return wire.map(fromWireCheckEntry);
}

function fromWireCheckEntry(entry: WireCheckEntry): CheckEntry {
    if ('Checked' in entry) {
        return { type: 'checked', name: entry.Checked };
    }
    return { type: 'unchecked', name: entry.Unchecked };
}

/** Serialize internal CheckEntry[] for NAPI (e.g. when passing to compactChecked). */
export function toWireCheckedLog(entries: CheckEntry[]): string {
    return JSON.stringify(entries.map(toWireCheckEntry));
}

/** Serialize a single internal CheckEntry for NAPI `writeCheckEntry`. */
export function toWireCheckEntryJson(entry: CheckEntry): string {
    return JSON.stringify(toWireCheckEntry(entry));
}

function toWireCheckEntry(entry: CheckEntry): WireCheckEntry {
    return entry.type === 'checked'
        ? { Checked: entry.name }
        : { Unchecked: entry.name };
}
