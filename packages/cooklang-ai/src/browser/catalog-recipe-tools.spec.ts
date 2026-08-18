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
import { URI } from '@theia/core';
import { ToolInvocationContext } from '@theia/ai-core/lib/common';
import { CookbotAddCatalogRecipeTool, CookbotSearchRecipeCatalogTool } from './catalog-recipe-tools';
import { CookbotCatalogRecipe } from '../common/cookbot-server-tools-protocol';

after(() => disableJSDOM());

const CARBONARA: CookbotCatalogRecipe = {
    id: 'rec-carbonara',
    title: 'Spaghetti Carbonara',
    mealType: 'dinner',
    course: 'main',
    content: '---\ntitle: Spaghetti Carbonara\nservings: 2\n---\n\nBoil @spaghetti{200%g}.\n',
    suggestedPath: 'Dinner/Spaghetti Carbonara.cook',
};

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

describe('CookbotAddCatalogRecipeTool', () => {

    class FakeFileService {
        existing = new Set<string>();
        async exists(uri: URI): Promise<boolean> { return this.existing.has(uri.toString()); }
    }

    class FakeScope {
        root = new URI('file:///ws');
        async getWorkspaceRoot(): Promise<URI> { return this.root; }
        async resolveRelativePath(path: string): Promise<URI> { return this.root.resolve(path); }
        ensureWithinWorkspace(targetUri: URI, workspaceRootUri: URI): void {
            if (!targetUri.toString().startsWith(workspaceRootUri.toString())) {
                throw new Error('Access outside of the workspace is not allowed');
            }
        }
    }

    interface StagedElement { uri: URI; type: string; state: string; targetState: string; requestId: string; chatSessionId: string }

    function createContext(): { ctx: object; staged: StagedElement[]; titles: string[] } {
        const staged: StagedElement[] = [];
        const titles: string[] = [];
        const ctx = {
            request: {
                id: 'req-1',
                session: {
                    id: 'session-1',
                    changeSet: {
                        addElements: (...elements: StagedElement[]) => { staged.push(...elements); },
                        setTitle: (title: string) => { titles.push(title); },
                    },
                },
            },
            response: {},
        };
        return { ctx, staged, titles };
    }

    function createTool(): { tool: CookbotAddCatalogRecipeTool; server: FakeServerTools; fs: FakeFileService; scope: FakeScope } {
        const tool = new CookbotAddCatalogRecipeTool();
        const server = new FakeServerTools();
        const fs = new FakeFileService();
        const scope = new FakeScope();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (tool as any).serverTools = server;
        (tool as any).fileService = fs;
        (tool as any).workspaceFunctionScope = scope;
        (tool as any).fileChangeFactory = (element: StagedElement) => element;
        (tool as any).fileChangeSetTitleProvider = { getChangeSetTitle: () => 'Changes proposed' };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        server.recipes.set(CARBONARA.id, CARBONARA);
        return { tool, server, fs, scope };
    }

    it('requires id and shows the path (or id) as short label', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('addCatalogRecipe');
        expect(def.name).to.equal('addCatalogRecipe');
        expect(def.parameters.required).to.deep.equal(['id']);
        expect(def.getArgumentsShortLabel!(JSON.stringify({ id: 'x', path: 'Dinner/X.cook' }))).to.deep.equal({ label: 'Dinner/X.cook', hasMore: true });
        expect(def.getArgumentsShortLabel!(JSON.stringify({ id: 'x' }))).to.deep.equal({ label: 'x', hasMore: true });
        expect(def.getArgumentsShortLabel!('nope')).to.equal(undefined);
    });

    it('stages the recipe at the suggested path as an add', async () => {
        const { tool } = createTool();
        const { ctx, staged, titles } = createContext();
        const raw = await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id }), ctx as ToolInvocationContext);
        expect(staged).to.have.length(1);
        expect(staged[0].uri.toString()).to.equal('file:///ws/Dinner/Spaghetti%20Carbonara.cook');
        expect(staged[0].type).to.equal('add');
        expect(staged[0].state).to.equal('pending');
        expect(staged[0].targetState).to.equal(CARBONARA.content);
        expect(staged[0].requestId).to.equal('req-1');
        expect(staged[0].chatSessionId).to.equal('session-1');
        expect(titles).to.deep.equal(['Changes proposed']);
        const result = JSON.parse(raw as string);
        expect(result.proposedPath).to.equal('Dinner/Spaghetti Carbonara.cook');
        expect(result.title).to.equal('Spaghetti Carbonara');
        expect(result.message).to.match(/review/);
        expect(result.message).to.not.match(/saved/);
    });

    it('honours an explicit path and marks existing files as modify', async () => {
        const { tool, fs } = createTool();
        fs.existing.add('file:///ws/Pasta/Carbonara.cook');
        const { ctx, staged } = createContext();
        const raw = await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id, path: 'Pasta/Carbonara.cook' }), ctx as ToolInvocationContext);
        expect(staged).to.have.length(1);
        expect(staged[0].uri.toString()).to.equal('file:///ws/Pasta/Carbonara.cook');
        expect(staged[0].type).to.equal('modify');
        expect(staged[0].targetState).to.equal(CARBONARA.content);
        expect(JSON.parse(raw as string).proposedPath).to.equal('Pasta/Carbonara.cook');
    });

    it('falls back to the suggested path when path is blank', async () => {
        const { tool } = createTool();
        const { ctx, staged } = createContext();
        const raw = await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id, path: '   ' }), ctx as ToolInvocationContext);
        expect(staged[0].uri.toString()).to.equal('file:///ws/Dinner/Spaghetti%20Carbonara.cook');
        expect(JSON.parse(raw as string).proposedPath).to.equal('Dinner/Spaghetti Carbonara.cook');
    });

    it('returns { error } for a path outside the workspace without staging', async () => {
        const { tool } = createTool();
        const { ctx, staged, titles } = createContext();
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id, path: '../outside.cook' }), ctx as ToolInvocationContext) as string);
        expect(result.error).to.match(/outside of the workspace/);
        expect(staged).to.deep.equal([]);
        expect(titles).to.deep.equal([]);
    });

    it('returns { error } for an unknown id without staging', async () => {
        const { tool } = createTool();
        const { ctx, staged, titles } = createContext();
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: 'nope' }), ctx as ToolInvocationContext) as string);
        expect(result.error).to.match(/NOT_FOUND/);
        expect(staged).to.deep.equal([]);
        expect(titles).to.deep.equal([]);
    });

    it('returns { error } when id is missing without calling the server', async () => {
        const { tool, server } = createTool();
        const { ctx, staged } = createContext();
        const fetched: string[] = [];
        const original = server.getCatalogRecipe.bind(server);
        server.getCatalogRecipe = async id => { fetched.push(id); return original(id); };
        for (const args of ['{}', JSON.stringify({ id: '   ' }), JSON.stringify({ id: 42 })]) {
            const result = JSON.parse(await tool.getTool().handler(args, ctx as ToolInvocationContext) as string);
            expect(result.error, args).to.match(/id/);
        }
        expect(fetched).to.deep.equal([]);
        expect(staged).to.deep.equal([]);
    });

    it('returns { error } on invalid or non-object arguments', async () => {
        const { tool } = createTool();
        const { ctx, staged } = createContext();
        for (const bad of ['nope', 'null', '[1]', '"str"', '42']) {
            const result = JSON.parse(await tool.getTool().handler(bad, ctx as ToolInvocationContext) as string);
            expect(result.error, bad).to.match(/JSON object/);
        }
        expect(staged).to.deep.equal([]);
    });

    it('returns { error } outside a chat context', async () => {
        const { tool } = createTool();
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id })) as string);
        expect(result.error).to.match(/chat/i);
    });

    it('returns { error } when the request was cancelled', async () => {
        const { tool } = createTool();
        const { ctx, staged } = createContext();
        const cancelled = { ...ctx, cancellationToken: { isCancellationRequested: true } };
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id }), cancelled as unknown as ToolInvocationContext) as string);
        expect(result.error).to.match(/cancelled/i);
        expect(staged).to.deep.equal([]);
    });
});
