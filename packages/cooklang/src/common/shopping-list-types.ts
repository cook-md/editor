// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

// ── Internal, ergonomic types used by ShoppingListService + UI ───────────────

/**
 * Persisted shopping list — internal representation.
 * Only recipe entries are modeled; ingredient entries in the wire JSON are
 * ignored on load (the editor never authors them).
 */
export interface ShoppingListFile {
    items: ShoppingListRecipeItem[];
}

/**
 * A recipe entry. A bare entry (empty `children`) represents a single recipe.
 * An entry with children represents either a menu (children are recipes) or a
 * recipe with selected sub-references.
 *
 * `multiplier` is `undefined` when the `.shopping-list` serializes without an
 * explicit multiplier (equivalent to 1).
 */
export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    multiplier?: number;
    children: ShoppingListRecipeItem[];
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
}

interface WireIngredient {
    name: string;
    quantity: string | null;
}

type WireCheckEntry =
    | { Checked: string }
    | { Unchecked: string };

// ── Marshalling helpers ──────────────────────────────────────────────────────

/** Parse the JSON produced by NAPI `parseShoppingList` into internal shape. */
export function fromWireShoppingList(json: string): ShoppingListFile {
    const wire = JSON.parse(json) as WireShoppingList;
    return {
        items: (wire.items ?? [])
            .map(fromWireItem)
            .filter((x): x is ShoppingListRecipeItem => x !== undefined)
    };
}

function fromWireItem(item: WireShoppingItem): ShoppingListRecipeItem | undefined {
    if ('Recipe' in item) {
        const r = item.Recipe;
        return {
            type: 'recipe',
            path: r.path,
            multiplier: r.multiplier ?? undefined,
            children: (r.children ?? [])
                .map(fromWireItem)
                .filter((x): x is ShoppingListRecipeItem => x !== undefined)
        };
    }
    // Ignore Ingredient entries — editor never authors them.
    return undefined;
}

/** Serialize internal shape to JSON for NAPI `writeShoppingList`. */
export function toWireShoppingList(file: ShoppingListFile): string {
    const wire: WireShoppingList = {
        items: file.items.map(toWireItem)
    };
    return JSON.stringify(wire);
}

function toWireItem(item: ShoppingListRecipeItem): WireShoppingItem {
    const r: WireRecipe = {
        path: item.path,
        multiplier: item.multiplier ?? null,
        children: item.children.map(toWireItem)
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
