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

// The tool imports `ShoppingListContribution` (widget-heavy) and
// `ReportConfigService` (ApplicationShell etc.), which evaluate browser-only
// modules at require time. Same jsdom preamble as the sibling tool specs.
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

interface PathScale { path: string; scale: number }

class FakeShoppingListService {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: PathScale[][] = [];
    /** When set, `computeResult` throws this. */
    computeError: Error | undefined;
    addRecipeCalls: Array<{ path: string; scale: number; refs?: PathScale[] }> = [];
    addMenuCalls: Array<{ path: string; scale: number; recipes: PathScale[] }> = [];
    current: ShoppingListResult | undefined = LIVE_RESULT;
    getWorkspaceRootUri(): URI | undefined { return this.root; }
    async computeResult(items: PathScale[]): Promise<ShoppingListResult> {
        if (this.computeError) { throw this.computeError; }
        this.computeCalls.push(items);
        return RESULT;
    }
    async addRecipe(path: string, scale: number, refs?: PathScale[]): Promise<void> {
        this.addRecipeCalls.push({ path, scale, refs });
    }
    async addMenu(path: string, scale: number, recipes: PathScale[]): Promise<void> {
        this.addMenuCalls.push({ path, scale, recipes });
    }
    getResult(): ShoppingListResult | undefined { return this.current; }
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

class FakeContribution {
    opened: Array<{ activate?: boolean }> = [];
    async openView(options: { activate?: boolean }): Promise<void> { this.opened.push(options); }
}

function createTool(): {
    tool: GenerateShoppingListTool;
    svc: FakeShoppingListService;
    fs: FakeFileService;
    resolver: FakeResolver;
    view: FakeContribution;
} {
    const tool = new GenerateShoppingListTool();
    const svc = new FakeShoppingListService();
    const fs = new FakeFileService();
    const resolver = new FakeResolver();
    const view = new FakeContribution();
    const config = new FakeConfigService(() => svc.root);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).shoppingListService = svc;
    (tool as any).fileService = fs;
    (tool as any).referenceResolver = resolver;
    (tool as any).shoppingListContribution = view;
    (tool as any).reportConfigService = config;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, svc, fs, resolver, view };
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
        const { tool, svc } = createTool();
        expect((await invoke(tool, 'null')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect((await invoke(tool, '[]')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect((await invoke(tool, '{not json')).error).to.equal('Invalid arguments: expected a JSON object.');
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('computes a headless list for recipes (default scale 1) and returns it with the inputs', async () => {
        const { tool, svc, fs, view } = createTool();
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'x');
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook' }] });
        expect(svc.computeCalls).to.deep.equal([[{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }]]);
        expect(result).to.deep.equal({ ...RESULT, recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }] });
        expect(svc.addRecipeCalls).to.deep.equal([]);
        expect(view.opened).to.deep.equal([]);
    });

    it('includes sub-recipe references (scaled by the parent) in the headless computation', async () => {
        const { tool, svc, fs, resolver } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        resolver.refs.set('pie', [{ path: 'Dough', scale: 0.5 }]);
        await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }] });
        expect(svc.computeCalls[0]).to.deep.equal([{ path: 'Pie.cook', scale: 2 }, { path: 'Dough', scale: 1 }]);
        expect(resolver.calls).to.deep.equal([{ content: 'pie', baseDir: '/ws' }]);
    });

    it('accepts absolute and file:// paths under the workspace and reports them workspace-relative', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'x');
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'file:///ws/Dinner/Carbonara.cook' }, { path: '/ws/./Soup.cook' }] });
        expect(result.recipes).to.deep.equal([{ path: 'Dinner/Carbonara.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
        expect(svc.computeCalls[0]).to.deep.equal([{ path: 'Dinner/Carbonara.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
    });

    it('expands a menu into its recipes', async () => {
        const { tool, svc, fs, resolver } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu' });
        expect(svc.computeCalls[0]).to.deep.equal([{ path: 'Plans/Week.menu', scale: 1 }, { path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        expect(result).to.deep.equal({ ...RESULT, recipes: [{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }] });
        expect(svc.addMenuCalls).to.deep.equal([]);
    });

    it('requires exactly one of recipes / menu', async () => {
        const { tool, svc } = createTool();
        expect((await invoke(tool, {})).error).to.match(/exactly one/i);
        expect((await invoke(tool, { recipes: [] })).error).to.match(/exactly one/i);
        expect((await invoke(tool, { menu: '   ' })).error).to.match(/exactly one/i);
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }], menu: 'm.menu' })).error).to.match(/exactly one/i);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('rejects recipes / menu of the wrong type instead of ignoring them', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        expect((await invoke(tool, { recipes: 'Soup.cook', menu: 'Plans/Week.menu' })).error).to.match(/`recipes` must be an array/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook' }], menu: ['Plans/Week.menu'] })).error).to.match(/`menu` must be/);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('rejects a recipe entry without a path or with a non-positive scale', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        expect((await invoke(tool, { recipes: [{ scale: 2 }] })).error).to.match(/path/);
        expect((await invoke(tool, { recipes: ['Soup.cook'] })).error).to.match(/path/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook', scale: 0 }] })).error).to.match(/scale/);
        expect((await invoke(tool, { recipes: [{ path: 'Soup.cook', scale: '2' }] })).error).to.match(/scale/);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('errors before adding anything when a recipe is missing', async () => {
        const { tool, svc, fs, view } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }, { path: 'Nope.cook' }], addToList: true });
        expect(result.error).to.equal('Recipe not found: Nope.cook');
        expect(svc.addRecipeCalls).to.deep.equal([]);
        expect(svc.computeCalls).to.deep.equal([]);
        expect(view.opened).to.deep.equal([]);
    });

    it('errors when the menu is missing or has no recipe references', async () => {
        const { tool, svc, fs } = createTool();
        expect((await invoke(tool, { menu: 'Plans/Nope.menu', addToList: true })).error).to.equal('Menu not found: Plans/Nope.menu');
        fs.files.set('file:///ws/Plans/Empty.menu', 'empty');
        expect((await invoke(tool, { menu: 'Plans/Empty.menu', addToList: true })).error).to.match(/no recipe references/);
        expect(svc.addMenuCalls).to.deep.equal([]);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('surfaces read errors other than file-not-found instead of reporting a missing recipe', async () => {
        const { tool, svc, fs } = createTool();
        fs.readError = PERMISSION_DENIED;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }] });
        expect(result.error).to.match(/Permission denied/);
        expect(result.error).to.not.match(/not found/);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('surfaces computation failures as an error', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        svc.computeError = new Error('native exploded');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }] });
        expect(result.error).to.match(/native exploded/);
    });

    it('addToList adds each recipe with its refs, opens the view and returns the live list', async () => {
        const { tool, svc, fs, resolver, view } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        resolver.refs.set('pie', [{ path: 'Dough', scale: 0.5 }]);
        const result = await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }], addToList: true });
        expect(svc.addRecipeCalls).to.deep.equal([{ path: 'Pie.cook', scale: 2, refs: [{ path: 'Dough', scale: 0.5 }] }]);
        expect(view.opened).to.deep.equal([{ activate: true }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pie.cook', scale: 2 }] });
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('addToList with a menu calls addMenu, opens the view and returns the live list', async () => {
        const { tool, svc, fs, resolver, view } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu', addToList: true });
        expect(svc.addMenuCalls).to.deep.equal([{ path: 'Plans/Week.menu', scale: 1, recipes: [{ path: 'Pancakes', scale: 2 }] }]);
        expect(view.opened).to.deep.equal([{ activate: true }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pancakes', scale: 2 }] });
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('addToList returns an empty list shape when the live list has not been computed yet', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        svc.current = undefined;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({
            categories: [], other: { name: 'other', items: [] }, pantryItems: [],
            added: true, recipes: [{ path: 'Soup.cook', scale: 1 }],
        });
    });

    it('errors without a workspace', async () => {
        const { tool, svc } = createTool();
        svc.root = undefined;
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }] })).error).to.match(/workspace/i);
        expect((await invoke(tool, { menu: 'a.menu' })).error).to.match(/workspace/i);
    });
});
