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

// Fixtures mirror the native parser JSON, where a missing alias/quantity/note/reference is null.
/* eslint-disable no-null/no-null */

import { expect } from 'chai';
import { IngredientOutletInfo, PreviewBadge, PreviewOutletContext } from './cooklang-outlet-context';
import { Ingredient } from './recipe-types';

function ingredient(quantity: Ingredient['quantity']): Ingredient {
    return { name: 'flour', alias: null, quantity, note: null, reference: null } as unknown as Ingredient;
}

describe('IngredientOutletInfo.fromIngredient', () => {
    it('describes a regular number quantity with its unit', () => {
        const info = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'number', value: { type: 'regular', value: 2 } }, unit: 'cups', scalable: true,
        }));
        expect(info).to.deep.equal({ name: 'flour', quantity: '2 cups', amount: 2, unit: 'cups' });
    });

    it('turns a fraction into a decimal amount', () => {
        const info = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'number', value: { type: 'fraction', value: { whole: 1, num: 1, den: 2, err: 0 } } },
            unit: null, scalable: true,
        } as unknown as Ingredient['quantity']));
        expect(info.amount).to.equal(1.5);
        expect(info.unit).to.equal(undefined);
    });

    it('omits amount for text quantities and everything for a missing quantity', () => {
        const text = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'text', value: 'some' }, unit: null, scalable: false,
        } as unknown as Ingredient['quantity']));
        expect(text).to.deep.equal({ name: 'flour', quantity: 'some' });
        expect(IngredientOutletInfo.fromIngredient(ingredient(null))).to.deep.equal({ name: 'flour' });
    });
});

describe('PreviewOutletContext.is', () => {
    it('accepts a context object and rejects anything else', () => {
        expect(PreviewOutletContext.is({ version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 })).to.equal(true);
        expect(PreviewOutletContext.is(undefined)).to.equal(false);
        expect(PreviewOutletContext.is({ uri: 'file:///ws/a.cook' })).to.equal(false);
    });
});

describe('PreviewBadge', () => {
    it('accepts a Nutri-Score badge', () => {
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' }))
            .to.deep.equal({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' });
    });

    it('accepts a pill badge and trims its text', () => {
        expect(PreviewBadge.parse({ kind: 'pill', text: ' 540 kcal ', tone: 'neutral', tooltipMarkdown: 'per serving' }))
            .to.deep.equal({ kind: 'pill', text: '540 kcal', tone: 'neutral', tooltipMarkdown: 'per serving' });
    });

    it('rejects unknown kinds, grades, tones and bad text', () => {
        expect(PreviewBadge.parse({ kind: 'other', grade: 'B', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'F', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'A', tooltipMarkdown: 3 })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'x', tone: 'loud', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: '   ', tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'x'.repeat(PreviewBadge.MAX_TEXT_LENGTH + 1), tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'a\nb', tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse(undefined)).to.equal(undefined);
    });

    it('drops extra keys and truncates very long tooltips', () => {
        const parsed = PreviewBadge.parse({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(10000), extra: 1 });
        expect(parsed).to.deep.equal({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(PreviewBadge.MAX_TOOLTIP_LENGTH) });
    });

    it('compares badge lists by value', () => {
        const a: PreviewBadge = { kind: 'nutriscore', grade: 'A', tooltipMarkdown: 't' };
        const pill: PreviewBadge = { kind: 'pill', text: 'x', tone: 'bad', tooltipMarkdown: '' };
        expect(PreviewBadge.equals([a, pill], [{ ...a }, { ...pill }])).to.equal(true);
        expect(PreviewBadge.equals([a], [{ ...a, grade: 'B' }])).to.equal(false);
        expect(PreviewBadge.equals([a], [])).to.equal(false);
    });
});
