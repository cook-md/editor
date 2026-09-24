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
import { RecipeReferenceResolver, flattenReferences, parseNumberAndUnit } from './recipe-reference-resolver';

class FakeLanguageService {
    recipes = new Map<string, string>();
    async parseMenu(content: string, _scale: number): Promise<string> {
        // Content lines like "@./Pancakes{2}" or "@Cake{4%servings}"; metadata line "servings: 4".
        const lines: Array<Array<{ type: string; name?: string; scale?: number; unit?: string }>> = [];
        for (const line of content.split('\n')) {
            const m = line.match(/^@([^{]+)\{(\d+(?:\.\d+)?)(?:%([a-z]+))?\}$/);
            if (m) {
                lines.push([{ type: 'recipeReference', name: m[1], scale: parseFloat(m[2]), unit: m[3] }]);
            }
        }
        const servings = content.match(/servings:\s*(\S+)/)?.[1];
        const yieldValue = content.match(/yield:\s*(.+)/)?.[1];
        return JSON.stringify({ sections: [{ lines }], metadata: { servings, yield: yieldValue } });
    }
    async findRecipe(_baseDir: string, name: string): Promise<string | undefined> {
        return this.recipes.get(name);
    }
}

function createResolver(): { resolver: RecipeReferenceResolver; ls: FakeLanguageService } {
    const resolver = new RecipeReferenceResolver();
    const ls = new FakeLanguageService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resolver as any).languageService = ls;
    return { resolver, ls };
}

describe('RecipeReferenceResolver', () => {

    it('returns plain multipliers as-is and strips ./', async () => {
        const { resolver } = createResolver();
        const refs = await resolver.resolve('@./Pancakes{2}\n@Soup{1}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
    });

    it('resolves %servings against the referenced recipe metadata', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Cake', 'servings: 4');
        const refs = await resolver.resolve('@Cake{8%servings}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Cake', scale: 2 }]);
    });

    it('accepts %serves as an alias for %servings', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Cake', 'servings: 4');
        expect(await resolver.resolve('@Cake{8%serves}', '/ws')).to.deep.equal([{ path: 'Cake', scale: 2 }]);
    });

    it('resolves a yield unit only when the units match', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Stock', 'yield: 500%ml');
        ls.recipes.set('Dough', 'yield: 2%kg');
        const refs = await resolver.resolve('@Stock{1000%ml}\n@Dough{500%g}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Stock', scale: 2 }, { path: 'Dough', scale: 500 }]);
    });

    it('falls back to the raw number when the recipe cannot be found', async () => {
        const { resolver } = createResolver();
        const refs = await resolver.resolve('@Missing{3%servings}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Missing', scale: 3 }]);
    });

    it('expands references at every depth, not just the first level (cookcli#509)', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('B', '@./C{1}');
        ls.recipes.set('C', '@./D{1}');
        ls.recipes.set('D', 'plain');
        const refs = await resolver.resolve('@./B{1}', '/ws');
        expect(refs).to.deep.equal([
            { path: 'B', scale: 1, children: [
                { path: 'C', scale: 1, children: [
                    { path: 'D', scale: 1 },
                ] },
            ] },
        ]);
    });

    it('resolves a nested %servings against the nested recipe, relative to its parent', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Dinner', 'servings: 2\n@./Sauce{4%servings}');
        ls.recipes.set('Sauce', 'servings: 8');
        const refs = await resolver.resolve('@./Dinner{4%servings}', '/ws');
        expect(refs).to.deep.equal([
            { path: 'Dinner', scale: 2, children: [{ path: 'Sauce', scale: 0.5 }] },
        ]);
    });

    it('stops at a reference cycle instead of recursing forever', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('A', '@./B{1}');
        ls.recipes.set('B', '@./A{1}');
        const refs = await resolver.resolve('@./A{1}', '/ws');
        expect(refs).to.deep.equal([
            { path: 'A', scale: 1, children: [{ path: 'B', scale: 1 }] },
        ]);
    });

    it('returns [] when parsing fails', async () => {
        const { resolver, ls } = createResolver();
        ls.parseMenu = async () => { throw new Error('boom'); };
        expect(await resolver.resolve('anything', '/ws')).to.deep.equal([]);
    });
});

describe('flattenReferences', () => {

    it('lists every reference depth-first with scales multiplied down', () => {
        const flat = flattenReferences([
            { path: 'Dinner', scale: 2, children: [
                { path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 3 }] },
            ] },
            { path: 'Salad', scale: 1 },
        ], 2);
        expect(flat).to.deep.equal([
            { path: 'Dinner', scale: 4 },
            { path: 'Sauce', scale: 2 },
            { path: 'Prep', scale: 6 },
            { path: 'Salad', scale: 2 },
        ]);
    });
});

describe('parseNumberAndUnit', () => {

    it('parses a space-separated unit', () => {
        expect(parseNumberAndUnit('2 cups')).to.deep.equal({ amount: 2, unit: 'cups' });
    });

    it('parses a bare number without a unit', () => {
        expect(parseNumberAndUnit('2')).to.deep.equal({ amount: 2, unit: undefined });
    });

    it('returns undefined for non-numeric input', () => {
        expect(parseNumberAndUnit('a few')).to.equal(undefined);
    });
});
