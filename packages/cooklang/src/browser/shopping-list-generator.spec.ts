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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListGenerator } from './shopping-list-generator';

class Fakes {
    files = new Map<string, string>();
    recipes = new Map<string, string>();
    generateCalls: Array<{ recipes: unknown; aisle: string | null; pantry: string | null }> = []; // eslint-disable-line no-null/no-null
    roots: URI[] = [new URI('file:///ws')];

    create(): ShoppingListGenerator {
        const generator = new ShoppingListGenerator();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (generator as any).workspaceService = { tryGetRoots: () => this.roots.map(resource => ({ resource })) };
        (generator as any).fileService = {
            read: async (uri: URI) => {
                const value = this.files.get(uri.toString());
                if (value === undefined) { throw new Error('ENOENT'); }
                return { value };
            },
        };
        (generator as any).languageService = {
            findRecipe: async (_baseDir: string, name: string) => this.recipes.get(name),
            generateShoppingList: async (recipes: string, aisle: string | null, pantry: string | null) => { // eslint-disable-line no-null/no-null
                this.generateCalls.push({ recipes: JSON.parse(recipes), aisle, pantry });
                return JSON.stringify({ categories: [], other: { name: 'other', items: [] }, pantryItems: [] });
            },
        };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return generator;
    }
}

describe('ShoppingListGenerator', () => {
    it('reads each recipe through cooklang-find and passes the aisle and pantry config', async () => {
        const fakes = new Fakes();
        fakes.recipes.set('Soup.cook', 'soup');
        fakes.recipes.set('Bread', 'bread');
        fakes.files.set('file:///ws/config/aisle.conf', '[produce]');
        const result = await fakes.create().computeResult([{ path: 'Soup.cook', scale: 2 }, { path: 'Bread', scale: 1 }]);
        expect(result.other.name).to.equal('other');
        expect(fakes.generateCalls).to.deep.equal([{
            recipes: [{ content: 'soup', scale: 2 }, { content: 'bread', scale: 1 }],
            aisle: '[produce]',
            pantry: null, // eslint-disable-line no-null/no-null
        }]);
    });

    it('skips recipes it cannot find', async () => {
        const fakes = new Fakes();
        fakes.recipes.set('Soup.cook', 'soup');
        await fakes.create().computeResult([{ path: 'Missing.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
        expect(fakes.generateCalls[0].recipes).to.deep.equal([{ content: 'soup', scale: 1 }]);
    });

    it('throws without a workspace', async () => {
        const fakes = new Fakes();
        fakes.roots = [];
        let error: unknown;
        try { await fakes.create().computeResult([]); } catch (e) { error = e; }
        expect((error as Error).message).to.match(/workspace/i);
    });
});
