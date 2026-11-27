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

import { expect } from 'chai';
import { fromWireShoppingList, toWireShoppingList } from './shopping-list-types';
import { FREE_HAND_WIRE_JSON } from './test/shopping-list-fixtures';

describe('shopping-list-types', () => {

    it('keeps free-hand ingredient lines, top-level and nested, in file order', () => {
        expect(fromWireShoppingList(FREE_HAND_WIRE_JSON)).to.deep.equal({
            items: [
                { type: 'recipe', path: 'Dinner/Pasta', multiplier: 2, children: [] },
                { type: 'ingredient', name: 'milk', quantity: '2%l' },
                { type: 'ingredient', name: 'lemons', quantity: '3' },
                { type: 'ingredient', name: 'bread' },
                {
                    type: 'recipe', path: 'Plans/Week.menu', multiplier: undefined, children: [
                        { type: 'ingredient', name: 'salt', quantity: 'a pinch', optional: true },
                        { type: 'recipe', path: 'Sides/Bread', multiplier: 0.5, children: [], optional: true },
                        { type: 'recipe', path: 'Dinner/Soup', multiplier: undefined, children: [] },
                        { type: 'ingredient', name: 'olive oil', quantity: '200%ml' },
                    ]
                },
            ]
        });
    });

    it('writes back the same wire JSON it read', () => {
        const written = toWireShoppingList(fromWireShoppingList(FREE_HAND_WIRE_JSON));
        expect(JSON.parse(written)).to.deep.equal(JSON.parse(FREE_HAND_WIRE_JSON));
    });

    it('reads wire JSON without the `optional` field (serde default)', () => {
        const file = fromWireShoppingList('{"items":[{"Ingredient":{"name":"milk","quantity":null}},'
            + '{"Recipe":{"path":"a","multiplier":null,"children":[]}}]}');
        expect(file.items).to.deep.equal([
            { type: 'ingredient', name: 'milk' },
            { type: 'recipe', path: 'a', multiplier: undefined, children: [] },
        ]);
    });
});
