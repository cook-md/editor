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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { CookbotSearchRecipeCatalogTool } from './catalog-recipe-tools';
import { CookbotCatalogRecipe } from '../common/cookbot-server-tools-protocol';

after(() => disableJSDOM());

class FakeServerTools {
    searchCalls: object[] = [];
    searchResponse: unknown = { recipes: [], hint: undefined };
    searchError: Error | undefined;
    recipes = new Map<string, CookbotCatalogRecipe>();
    async searchRecipeCatalog(criteria: object): Promise<unknown> {
        this.searchCalls.push(criteria);
        if (this.searchError) { throw this.searchError; }
        return this.searchResponse;
    }
    async getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe> {
        const recipe = this.recipes.get(id);
        if (!recipe) { throw new Error('5 NOT_FOUND: recipe not found'); }
        return recipe;
    }
}

describe('CookbotSearchRecipeCatalogTool', () => {

    function createTool(): { tool: CookbotSearchRecipeCatalogTool; server: FakeServerTools } {
        const tool = new CookbotSearchRecipeCatalogTool();
        const server = new FakeServerTools();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).serverTools = server;
        return { tool, server };
    }

    it('exposes searchRecipeCatalog with no required parameters and enum vocabularies', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('searchRecipeCatalog');
        expect(def.name).to.equal('searchRecipeCatalog');
        expect(def.parameters.required ?? []).to.deep.equal([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = def.parameters.properties as any;
        expect(props.course.enum).to.deep.equal(['main', 'side', 'drink', 'sauce', 'accompaniment', 'any']);
        expect(props.dietary.items.enum).to.include('vegetarian');
        expect(props.dietary.items.enum).to.include('gluten-free');
        expect(props.meal_types.items.enum).to.deep.equal(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']);
        // Rails drops `gluten` as an allergen (use dietary gluten-free instead).
        expect(props.exclude_allergens.items.enum).to.deep.equal(['tree-nuts', 'peanuts', 'shellfish', 'fish', 'eggs', 'soy', 'sesame']);
        // Matches the recipe-discovery skill and UserPreference::CUISINE_OPTIONS (underscore form is what Rails keeps).
        expect(props.cuisines.items.enum).to.include('eastern_european');
        expect(props.cuisines.items.enum).to.include('middle-eastern');
        // Also in the recipe-discovery skill and honoured by Rails.
        expect(props.dish_categories.items.enum).to.include('smoothie_drink');
        expect(props.dish_categories.items.enum).to.include('sauce_dip');
        expect(props.nutritional_focus.items.enum).to.include('low-carb');
        // Free-form lists have no enum.
        expect(props.dislikes.items.enum).to.equal(undefined);
        expect(props.exclude_ids.items.enum).to.equal(undefined);
        expect(props.limit).to.include({ type: 'integer', minimum: 1, maximum: 20 });
        expect(props.max_skill_level).to.include({ type: 'integer', minimum: 1, maximum: 4 });
        expect(props.max_cook_time_minutes).to.include({ type: 'integer', minimum: 1 });
    });

    it('forwards the parsed arguments as criteria and returns the server JSON verbatim', async () => {
        const { tool, server } = createTool();
        // eslint-disable-next-line no-null/no-null
        server.searchResponse = { recipes: [{ id: 'x', title: 'X' }], hint: null };
        const raw = await tool.getTool().handler(JSON.stringify({ dietary: ['vegetarian'], meal_types: ['dinner'], limit: 3 }));
        expect(server.searchCalls).to.deep.equal([{ dietary: ['vegetarian'], meal_types: ['dinner'], limit: 3 }]);
        // eslint-disable-next-line no-null/no-null
        expect(JSON.parse(raw as string)).to.deep.equal({ recipes: [{ id: 'x', title: 'X' }], hint: null });
    });

    it('sends {} for empty or blank arguments', async () => {
        const { tool, server } = createTool();
        await tool.getTool().handler('');
        await tool.getTool().handler('   ');
        expect(server.searchCalls).to.deep.equal([{}, {}]);
    });

    it('returns { error } when the server call fails', async () => {
        const { tool, server } = createTool();
        server.searchError = new Error('7 PERMISSION_DENIED: ai feature not available');
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(result.error).to.match(/PERMISSION_DENIED/);
        expect(server.searchCalls).to.deep.equal([{}]);
    });

    it('returns { error } on invalid JSON arguments without calling the server', async () => {
        const { tool, server } = createTool();
        const result = JSON.parse(await tool.getTool().handler('nope') as string);
        expect(result.error).to.match(/JSON/);
        expect(server.searchCalls).to.deep.equal([]);
    });

    it('returns { error } when the arguments are not a JSON object', async () => {
        const { tool, server } = createTool();
        for (const bad of ['null', '[1]', '"str"', '42']) {
            const result = JSON.parse(await tool.getTool().handler(bad) as string);
            expect(result.error, bad).to.match(/JSON object/);
        }
        expect(server.searchCalls).to.deep.equal([]);
    });
});
