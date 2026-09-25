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

// The tool imports `ReportConfigService` (ApplicationShell etc.), which
// evaluates browser-only modules at require time. Same jsdom preamble as the sibling tool specs.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { FileOperationError, FileOperationResult } from '@theia/filesystem/lib/common/files';
import { GenerateShoppingListTool } from './generate-shopping-list-tool';
import { ShoppingListResult } from '../common/shopping-list-types';

after(() => disableJSDOM());

const RESULT: ShoppingListResult = {
    categories: [{ name: 'produce', items: [{ name: 'garlic', quantities: '3 cloves' }] }],
    other: { name: 'other', items: [] },
    pantryItems: ['salt'],
};

const LIVE_RESULT: ShoppingListResult = {
    categories: [{ name: 'dairy', items: [{ name: 'milk', quantities: '1 l' }] }],
    other: { name: 'other', items: [{ name: 'flour', quantities: '500 g' }] },
    pantryItems: [],
};

interface PathScale { path: string; scale: number; children?: PathScale[] }

class FakeGenerator {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: PathScale[][] = [];
    /** When set, `computeResult` throws this. */
    computeError: Error | undefined;
    getWorkspaceRootUri(): URI | undefined { return this.root; }
    async computeResult(items: PathScale[]): Promise<ShoppingListResult> {
        if (this.computeError) { throw this.computeError; }
        this.computeCalls.push(items);
        return RESULT;
    }
}

/** Stands in for the Shopping List plugin's `shoppingList.addRecipes` command. */
class FakeCommands {
    installed = true;
    calls: unknown[] = [];
    live: ShoppingListResult | undefined = LIVE_RESULT;
    /** When set, `executeCommand` rejects with this (the plugin rejects on bad input or failed generation). */
    executeError: Error | undefined;
    getCommand(id: string): { id: string } | undefined {
        return this.installed && id === 'shoppingList.addRecipes' ? { id } : undefined;
    }
    async executeCommand(id: string, args: unknown): Promise<unknown> {
        this.calls.push({ id, args });
        if (this.executeError) { throw this.executeError; }
        return this.live;
    }
}

class FakeFileService {
    files = new Map<string, string>();
    /** When set, every read throws this instead of consulting `files`. */
    readError: Error | undefined;
    async read(uri: URI): Promise<{ value: string }> {
        if (this.readError) { throw this.readError; }
        const value = this.files.get(uri.toString());
        if (value === undefined) {
            throw new FileOperationError(`File not found ${uri}`, FileOperationResult.FILE_NOT_FOUND);
        }
        return { value };
    }
}

const PERMISSION_DENIED = new FileOperationError('Permission denied', FileOperationResult.FILE_PERMISSION_DENIED);

/** Mirrors `ReportConfigService.resolveWorkspaceUri` against the fake service's root. */
class FakeConfigService {
    constructor(protected readonly rootOf: () => URI | undefined) { }
    resolveWorkspaceUri(arg: string): URI | undefined {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) {
            return new URI(arg).normalizePath();
        }
        const root = this.rootOf();
        return root ? root.resolve(arg).normalizePath() : undefined;
    }
}

class FakeResolver {
    refs = new Map<string, PathScale[]>();
    calls: Array<{ content: string; baseDir: string }> = [];
    async resolve(content: string, baseDir: string): Promise<PathScale[]> {
        this.calls.push({ content, baseDir });
        return this.refs.get(content) ?? [];
    }
}

function createTool(): { tool: GenerateShoppingListTool; gen: FakeGenerator; fs: FakeFileService; resolver: FakeResolver; commands: FakeCommands } {
    const tool = new GenerateShoppingListTool();
    const gen = new FakeGenerator();
    const fs = new FakeFileService();
    const resolver = new FakeResolver();
    const commands = new FakeCommands();
    const config = new FakeConfigService(() => gen.root);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).generator = gen;
    (tool as any).fileService = fs;
    (tool as any).referenceResolver = resolver;
    (tool as any).commandRegistry = commands;
    (tool as any).reportConfigService = config;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, gen, fs, resolver, commands };
}

/** Invokes the registered tool handler with a JSON argument string (or raw string). */
async function invoke(tool: GenerateShoppingListTool, args: object | string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const argString = typeof args === 'string' ? args : JSON.stringify(args);
    return JSON.parse(await tool.getTool().handler(argString) as string);
}

describe('GenerateShoppingListTool', () => {

    it('exposes generateShoppingList with no required parameters and no auto-execution', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('generateShoppingList');
        expect(def.name).to.equal('generateShoppingList');
        expect(def.parameters.required ?? []).to.deep.equal([]);
        expect(Object.keys(def.parameters.properties)).to.have.members(['recipes', 'menu', 'addToList']);
        expect(def.confirmAlwaysAllow).to.equal(undefined);
    });

    it('rejects arguments that are not a JSON object', async () => {
        const { tool, gen } = createTool();
        expect((await invoke(tool, 'null')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect((await invoke(tool, '[]')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect((await invoke(tool, '{not json')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('computes a headless list for recipes (default scale 1) and returns it with the inputs', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'x');
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook' }] });
        expect(gen.computeCalls).to.deep.equal([[{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }]]);
        expect(result).to.deep.equal({ ...RESULT, recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }] });
        expect(commands.calls).to.deep.equal([]);
    });

    it('includes sub-recipe references (scaled by the parent) in the headless computation', async () => {
        const { tool, gen, fs, resolver } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        resolver.refs.set('pie', [{ path: 'Dough', scale: 0.5 }]);
        await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }] });
        expect(gen.computeCalls[0]).to.deep.equal([{ path: 'Pie.cook', scale: 2 }, { path: 'Dough', scale: 1 }]);
        expect(resolver.calls).to.deep.equal([{ content: 'pie', baseDir: '/ws' }]);
    });

    it('accepts absolute and file:// paths under the workspace and reports them workspace-relative', async () => {
        const { tool, gen, fs } = createTool();
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'x');
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'file:///ws/Dinner/Carbonara.cook' }, { path: '/ws/./Soup.cook' }] });
        expect(result.recipes).to.deep.equal([{ path: 'Dinner/Carbonara.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
        expect(gen.computeCalls[0]).to.deep.equal([{ path: 'Dinner/Carbonara.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
    });

    it('expands a menu into its recipes', async () => {
        const { tool, gen, fs, resolver, commands } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu' });
        expect(gen.computeCalls[0]).to.deep.equal([{ path: 'Plans/Week.menu', scale: 1 }, { path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        expect(result).to.deep.equal({ ...RESULT, recipes: [{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }] });
        expect(commands.calls).to.deep.equal([]);
    });

    it('requires exactly one of recipes / menu', async () => {
        const { tool, gen } = createTool();
        expect((await invoke(tool, {})).error).to.match(/exactly one/i);
        expect((await invoke(tool, { recipes: [] })).error).to.match(/exactly one/i);
        expect((await invoke(tool, { menu: '   ' })).error).to.match(/exactly one/i);
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }], menu: 'm.menu' })).error).to.match(/exactly one/i);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('rejects recipes / menu of the wrong type instead of ignoring them', async () => {
        const { tool, gen, fs } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        expect((await invoke(tool, { recipes: 'Soup.cook', menu: 'Plans/Week.menu' })).error).to.match(/`recipes` must be an array/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook' }], menu: ['Plans/Week.menu'] })).error).to.match(/`menu` must be/);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('rejects a non-boolean addToList', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: 'yes' })).error).to.equal('`addToList` must be a boolean.');
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: 1 })).error).to.equal('`addToList` must be a boolean.');
        expect(gen.computeCalls).to.deep.equal([]);
        expect(commands.calls).to.deep.equal([]);
    });

    it('rejects recipe and menu paths outside the workspace before touching anything', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///elsewhere/Cake.cook', 'cake');
        fs.files.set('file:///elsewhere/Week.menu', 'menu');
        fs.files.set('file:///ws/Soup.cook', 'y');
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook' }, { path: 'file:///elsewhere/Cake.cook' }], addToList: true })).error)
            .to.equal('Path is outside the workspace: file:///elsewhere/Cake.cook');
        expect((await invoke(tool, { recipes: [{ path: '../Outside.cook' }] })).error)
            .to.equal('Path is outside the workspace: ../Outside.cook');
        expect((await invoke(tool, { menu: '/elsewhere/Week.menu', addToList: true })).error)
            .to.equal('Path is outside the workspace: /elsewhere/Week.menu');
        expect(gen.computeCalls).to.deep.equal([]);
        expect(commands.calls).to.deep.equal([]);
    });

    it('rejects a recipe entry without a path or with a non-positive scale', async () => {
        const { tool, gen, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        expect((await invoke(tool, { recipes: [{ scale: 2 }] })).error).to.match(/path/);
        expect((await invoke(tool, { recipes: ['Soup.cook'] })).error).to.match(/path/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook', scale: 0 }] })).error).to.match(/scale/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook', scale: '2' }] })).error).to.match(/scale/);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('errors before adding anything when a recipe is missing', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }, { path: 'Nope.cook' }], addToList: true });
        expect(result.error).to.equal('Recipe not found: Nope.cook');
        expect(commands.calls).to.deep.equal([]);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('errors when the menu is missing or has no recipe references', async () => {
        const { tool, gen, fs, commands } = createTool();
        expect((await invoke(tool, { menu: 'Plans/Nope.menu', addToList: true })).error).to.equal('Menu not found: Plans/Nope.menu');
        fs.files.set('file:///ws/Plans/Empty.menu', 'empty');
        expect((await invoke(tool, { menu: 'Plans/Empty.menu', addToList: true })).error).to.match(/no recipe references/);
        expect(commands.calls).to.deep.equal([]);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('surfaces read errors other than file-not-found instead of reporting a missing recipe', async () => {
        const { tool, gen, fs } = createTool();
        fs.readError = PERMISSION_DENIED;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }] });
        expect(result.error).to.match(/Permission denied/);
        expect(result.error).to.not.match(/not found/);
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('computes nested references at every depth with multipliers applied down (cookcli#509)', async () => {
        const { tool, gen, fs, resolver } = createTool();
        fs.files.set('file:///ws/Dinner.cook', 'dinner');
        resolver.refs.set('dinner', [
            { path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 3 }] },
        ]);
        await invoke(tool, { recipes: [{ path: 'Dinner.cook', scale: 2 }] });
        expect(gen.computeCalls).to.deep.equal([[
            { path: 'Dinner.cook', scale: 2 },
            { path: 'Sauce', scale: 1 },
            { path: 'Prep', scale: 3 },
        ]]);
    });

    it('computes a menu with the references nested under its recipes', async () => {
        const { tool, gen, fs, resolver } = createTool();
        fs.files.set('file:///ws/Week.menu', 'menu');
        resolver.refs.set('menu', [
            { path: 'Dinner', scale: 2, children: [{ path: 'Sauce', scale: 0.5 }] },
        ]);
        await invoke(tool, { menu: 'Week.menu' });
        expect(gen.computeCalls).to.deep.equal([[
            { path: 'Week.menu', scale: 1 },
            { path: 'Dinner', scale: 2 },
            { path: 'Sauce', scale: 1 },
        ]]);
    });

    it('surfaces computation failures as an error', async () => {
        const { tool, gen, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        gen.computeError = new Error('native exploded');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }] });
        expect(result.error).to.match(/native exploded/);
    });

    it('addToList hands the recipes to the Shopping List plugin and returns its live list', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'carbonara');
        const result = await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'file:///ws/Dinner/Carbonara.cook' }], addToList: true });
        expect(commands.calls).to.deep.equal([{
            id: 'shoppingList.addRecipes',
            args: { recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'Dinner/Carbonara.cook', scale: 1 }] },
        }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'Dinner/Carbonara.cook', scale: 1 }] });
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('addToList with a menu hands the menu path to the plugin', async () => {
        const { tool, gen, fs, resolver, commands } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu', addToList: true });
        expect(commands.calls).to.deep.equal([{ id: 'shoppingList.addRecipes', args: { menu: 'Plans/Week.menu' } }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pancakes', scale: 2 }] });
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('addToList returns an empty list shape when the plugin has not computed a list yet', async () => {
        const { tool, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        commands.live = undefined;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({
            categories: [], other: { name: 'other', items: [] }, pantryItems: [],
            added: true, recipes: [{ path: 'Soup.cook', scale: 1 }],
        });
    });

    it('addToList explains that the Shopping List plugin is missing', async () => {
        const { tool, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        commands.installed = false;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({ error: 'The Shopping List plugin is not installed or is disabled.' });
        expect(commands.calls).to.deep.equal([]);
    });

    it('addToList surfaces a rejection from the Shopping List plugin as an error', async () => {
        const { tool, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        commands.executeError = new Error('boom');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({ error: 'boom' });
    });

    it('errors without a workspace', async () => {
        const { tool, gen } = createTool();
        gen.root = undefined;
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }] })).error).to.match(/workspace/i);
        expect((await invoke(tool, { menu: 'a.menu' })).error).to.match(/workspace/i);
    });
});
