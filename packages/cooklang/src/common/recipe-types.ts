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

/**
 * TypeScript types matching the JSON output of the cooklang-native parser.
 *
 * The Rust `cooklang` crate (v0.17) serializes its AST via serde_json.
 * These interfaces mirror that JSON shape so we can safely type the
 * result of `JSON.parse(await languageService.parse(text))`.
 */

// ---------------------------------------------------------------------------
// Numeric values
// ---------------------------------------------------------------------------

export interface RegularNumber {
    type: 'regular';
    value: number;
}

export interface FractionNumber {
    type: 'fraction';
    value: {
        whole: number;
        num: number;
        den: number;
        err: number;
    };
}

export type NumberValue = RegularNumber | FractionNumber;

// ---------------------------------------------------------------------------
// Quantity values
// ---------------------------------------------------------------------------

export interface NumberQuantityValue {
    type: 'number';
    value: NumberValue;
}

export interface RangeQuantityValue {
    type: 'range';
    value: {
        start: NumberValue;
        end: NumberValue;
    };
}

export interface TextQuantityValue {
    type: 'text';
    value: string;
}

export type QuantityValue = NumberQuantityValue | RangeQuantityValue | TextQuantityValue;

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

export interface Quantity {
    value: QuantityValue;
    unit: string | null;
    scalable: boolean;
}

// ---------------------------------------------------------------------------
// Recipe components
// ---------------------------------------------------------------------------

export interface RecipeReference {
    name: string;
    components: string[];
}

export interface Ingredient {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
    reference: RecipeReference | null;
}

export interface Cookware {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
}

export interface Timer {
    name: string | null;
    quantity: Quantity | null;
}

export interface InlineQuantity {
    value: QuantityValue;
    unit: string | null;
    scalable: boolean;
}

// ---------------------------------------------------------------------------
// Step items (tagged union)
// ---------------------------------------------------------------------------

export interface TextItem {
    type: 'text';
    value: string;
}

export interface IngredientItem {
    type: 'ingredient';
    index: number;
}

export interface CookwareItem {
    type: 'cookware';
    index: number;
}

export interface TimerItem {
    type: 'timer';
    index: number;
}

export interface InlineQuantityItem {
    type: 'inlineQuantity';
    index: number;
}

export type StepItem = TextItem | IngredientItem | CookwareItem | TimerItem | InlineQuantityItem;

// ---------------------------------------------------------------------------
// Steps and sections
// ---------------------------------------------------------------------------

export interface Step {
    items: StepItem[];
    number: number;
}

export interface StepContent {
    type: 'step';
    value: Step;
}

export interface TextContent {
    type: 'text';
    value: string;
}

export type SectionContent = StepContent | TextContent;

export interface Section {
    name: string | null;
    content: SectionContent[];
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface Metadata {
    map: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export interface Recipe {
    metadata: Metadata;
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inline_quantities: InlineQuantity[];
}

// ---------------------------------------------------------------------------
// Top-level parse result
// ---------------------------------------------------------------------------

export interface DiagnosticInfo {
    message: string;
    severity: 'error' | 'warning';
}

export interface ParseResult {
    recipe: Recipe | null;
    errors: DiagnosticInfo[];
    warnings: DiagnosticInfo[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a single {@link NumberValue} as a human-readable string.
 *
 * - Regular numbers render as plain decimals (trailing `.0` stripped).
 * - Fractions render as `whole num/den` or just `num/den` when whole is 0.
 */
function formatNumberValue(nv: NumberValue): string {
    switch (nv.type) {
        case 'regular': {
            const n = nv.value;
            return Number.isInteger(n) ? String(n) : String(n);
        }
        case 'fraction': {
            const { whole, num, den } = nv.value;
            if (whole !== 0) {
                return `${whole} ${num}/${den}`;
            }
            return `${num}/${den}`;
        }
    }
}

/**
 * Format a {@link QuantityValue} as a human-readable string.
 */
function formatQuantityValue(qv: QuantityValue): string {
    switch (qv.type) {
        case 'number':
            return formatNumberValue(qv.value);
        case 'range':
            return `${formatNumberValue(qv.value.start)}-${formatNumberValue(qv.value.end)}`;
        case 'text':
            return qv.value;
    }
}

/**
 * Format a {@link Quantity} (or null) as a human-readable string.
 *
 * Examples:
 * - `null` -> `''`
 * - `{ value: { type: 'number', value: { type: 'regular', value: 2 } }, unit: 'cups', scalable: true }` -> `'2 cups'`
 * - `{ value: { type: 'range', ... }, unit: null, scalable: true }` -> `'1-2'`
 * - `{ value: { type: 'text', value: 'some' }, unit: null, scalable: false }` -> `'some'`
 */
export function formatQuantity(qty: Quantity | null): string {
    if (qty === null) {
        return '';
    }
    const valStr = formatQuantityValue(qty.value);
    if (qty.unit) {
        return `${valStr} ${qty.unit}`;
    }
    return valStr;
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

function scaleNumberValue(nv: NumberValue, factor: number): NumberValue {
    switch (nv.type) {
        case 'regular':
            return { type: 'regular', value: nv.value * factor };
        case 'fraction': {
            const decimal = nv.value.whole + nv.value.num / nv.value.den;
            return { type: 'regular', value: decimal * factor };
        }
    }
}

function scaleQuantityValue(qv: QuantityValue, factor: number): QuantityValue {
    switch (qv.type) {
        case 'number':
            return { type: 'number', value: scaleNumberValue(qv.value, factor) };
        case 'range':
            return {
                type: 'range',
                value: {
                    start: scaleNumberValue(qv.value.start, factor),
                    end: scaleNumberValue(qv.value.end, factor),
                },
            };
        case 'text':
            return qv;
    }
}

function scaleQuantity(qty: Quantity | null, factor: number): Quantity | null {
    if (qty === null || !qty.scalable) {
        return qty;
    }
    return { ...qty, value: scaleQuantityValue(qty.value, factor) };
}

/**
 * Return a shallow copy of `recipe` with all scalable quantities multiplied
 * by `factor`. Non-scalable quantities and text values are left unchanged.
 */
export function scaleRecipe(recipe: Recipe, factor: number): Recipe {
    if (factor === 1) {
        return recipe;
    }
    return {
        ...recipe,
        ingredients: recipe.ingredients.map(ing => ({
            ...ing,
            quantity: scaleQuantity(ing.quantity, factor),
        })),
        cookware: recipe.cookware.map(cw => ({
            ...cw,
            quantity: scaleQuantity(cw.quantity, factor),
        })),
        timers: recipe.timers.map(t => ({
            ...t,
            quantity: scaleQuantity(t.quantity, factor),
        })),
        inline_quantities: recipe.inline_quantities.map(iq => ({
            ...iq,
            value: iq.scalable ? scaleQuantityValue(iq.value, factor) : iq.value,
        })),
    };
}
