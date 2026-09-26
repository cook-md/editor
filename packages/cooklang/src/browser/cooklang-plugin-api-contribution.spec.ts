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
import { CooklangPluginApi, CooklangPluginApiContribution } from './cooklang-plugin-api-contribution';

interface Handler { execute: (...args: unknown[]) => unknown }

class Fixture {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: unknown[] = [];
    recipes = new Map<string, string>();
    resolveCalls: Array<{ content: string; baseDir: string }> = [];
    handlers = new Map<string, Handler>();
    labels = new Map<string, string | undefined>();
    keys: Array<{ key: string; value: unknown }> = [];
    opened: string[] = [];
    hasProvider: (scheme: string) => boolean = () => true;
    pantryEdits: Array<{ text: string; json: string }> = [];

    create(): CooklangPluginApiContribution {
        const contribution = new CooklangPluginApiContribution();
        const rootOf = (): URI | undefined => this.root;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (contribution as any).generator = {
            getWorkspaceRootUri: rootOf,
            computeResult: async (items: unknown) => {
                this.computeCalls.push(items);
                return { categories: [], other: { name: 'other', items: [] }, pantryItems: [] };
            },
        };
        (contribution as any).resolver = {
            resolve: async (content: string, baseDir: string) => {
                this.resolveCalls.push({ content, baseDir });
                return [{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }];
            },
        };
        (contribution as any).languageService = {
            findRecipe: async (_baseDir: string, name: string) => this.recipes.get(name),
            parseShoppingList: async () => JSON.stringify({ items: [{ Recipe: { path: 'a.cook', multiplier: 2, children: [] } }] }),
            writeShoppingList: async (json: string) => `wrote ${json}`,
            parseChecked: async () => JSON.stringify([{ Checked: 'flour' }, { Unchecked: 'milk' }]),
            writeCheckEntry: async (json: string) => `${json}\n`,
            compactChecked: async (_entries: string, names: string[]) => JSON.stringify(names.map(name => ({ Checked: name }))),
            /* eslint-disable no-null/no-null */
            parsePantry: async () => JSON.stringify({
                sections: [{
                    name: 'fridge',
                    items: [{
                        name: 'milk', quantity: '1%L', bought: null, expire: '10.05.2026', low: null,
                        isLow: false, isOutOfStock: false, expireDate: '2026-05-10', boughtDate: null,
                    }],
                }],
                lowStock: [],
            }),
            /* eslint-enable no-null/no-null */
            editPantry: async (text: string, json: string) => {
                this.pantryEdits.push({ text, json });
                return 'edited';
            },
        };
        (contribution as any).reportConfigService = {
            resolveWorkspaceUri: (arg: string) => {
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) { return new URI(arg).normalizePath(); }
                return this.root ? this.root.resolve(arg).normalizePath() : undefined;
            },
        };
        (contribution as any).contextKeys = { createKey: (key: string, value: unknown) => { this.keys.push({ key, value }); } };
        (contribution as any).recipePreview = { open: async (uri: URI) => { this.opened.push(uri.toString()); } };
        (contribution as any).fileService = { hasProvider: (scheme: string) => this.hasProvider(scheme) };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        contribution.registerCommands({
            registerCommand: (command: { id: string; label?: string }, handler: Handler) => {
                this.handlers.set(command.id, handler);
                this.labels.set(command.id, command.label);
            },
        } as never);
        return contribution;
    }

    async run(id: string, args?: unknown): Promise<unknown> {
        return this.handlers.get(id)!.execute(args);
    }

    async error(id: string, args?: unknown): Promise<string> {
        try {
            await this.run(id, args);
        } catch (e) {
            return (e as Error).message;
        }
        throw new Error(`${id} did not reject`);
    }
}

describe('CooklangPluginApiContribution', () => {
    it('registers every API command without a label, so none shows in the palette', () => {
        const fixture = new Fixture();
        fixture.create();
        expect([...fixture.handlers.keys()]).to.have.members(Object.values(CooklangPluginApi.Commands));
        expect([...fixture.labels.values()].every(label => label === undefined)).to.equal(true);
    });

    it('reports the API version and sets the cooklang.apiVersion context key on start', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        contribution.onStart();
        expect(await fixture.run(CooklangPluginApi.Commands.VERSION)).to.equal(1);
        expect(fixture.keys).to.deep.equal([{ key: 'cooklang.apiVersion', value: 1 }]);
    });

    it('generates a shopping list with workspace-relative paths and default scale 1', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST, {
            recipes: [{ path: 'file:///ws/Dinner/Soup.cook', scale: 2 }, { path: 'Bread' }],
        });
        expect(fixture.computeCalls).to.deep.equal([[{ path: 'Dinner/Soup.cook', scale: 2 }, { path: 'Bread', scale: 1 }]]);
    });

    it('rejects bad generate arguments, paths outside the workspace and a missing workspace', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST;
        expect(await fixture.error(id, undefined)).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: 'Soup.cook' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: [{ path: 'Soup.cook', scale: 0 }] })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: [{ path: '../Out.cook' }] })).to.equal('Path is outside the workspace: ../Out.cook');
        fixture.root = undefined;
        expect(await fixture.error(id, { recipes: [{ path: 'Soup.cook' }] })).to.equal('No workspace is open.');
        expect(fixture.computeCalls).to.deep.equal([]);
    });

    it('resolves recipe references as a tree', async () => {
        const fixture = new Fixture();
        fixture.create();
        fixture.recipes.set('Dinner.cook', 'dinner');
        const refs = await fixture.run(CooklangPluginApi.Commands.RESOLVE_RECIPE_REFERENCES, { path: 'Dinner.cook' });
        expect(refs).to.deep.equal([{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }]);
        expect(fixture.resolveCalls).to.deep.equal([{ content: 'dinner', baseDir: '/ws' }]);
        expect(await fixture.error(CooklangPluginApi.Commands.RESOLVE_RECIPE_REFERENCES, { path: 'Nope.cook' }))
            .to.equal('Recipe not found: Nope.cook');
    });

    it('parses and writes the shopping list in the editor shape, not the wire shape', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_SHOPPING_LIST, { text: 'x' }))
            .to.deep.equal({ items: [{ type: 'recipe', path: 'a.cook', multiplier: 2, children: [] }] });
        expect(await fixture.run(CooklangPluginApi.Commands.WRITE_SHOPPING_LIST, {
            list: { items: [{ type: 'recipe', path: 'a.cook', children: [] }] },
        })).to.equal('wrote {"items":[{"Recipe":{"path":"a.cook","multiplier":null,"children":[]}}]}');
    });

    it('parses, writes and compacts the checked log', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_SHOPPING_CHECKED, { text: 'x' }))
            .to.deep.equal([{ type: 'checked', name: 'flour' }, { type: 'unchecked', name: 'milk' }]);
        expect(await fixture.run(CooklangPluginApi.Commands.WRITE_SHOPPING_CHECKED, {
            entries: [{ type: 'checked', name: 'flour' }, { type: 'unchecked', name: 'milk' }],
        })).to.equal('{"Checked":"flour"}\n{"Unchecked":"milk"}\n');
        expect(await fixture.run(CooklangPluginApi.Commands.COMPACT_SHOPPING_CHECKED, {
            entries: [{ type: 'checked', name: 'flour' }], ingredients: ['flour'],
        })).to.deep.equal([{ type: 'checked', name: 'flour' }]);
        expect(await fixture.error(CooklangPluginApi.Commands.WRITE_SHOPPING_CHECKED, { entries: [{ type: 'maybe', name: 'x' }] }))
            .to.match(/^Invalid arguments/);
    });

    it('accepts backslash separators in relative paths', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST, { recipes: [{ path: 'Dinner\\Soup.cook' }] });
        expect(fixture.computeCalls).to.deep.equal([[{ path: 'Dinner/Soup.cook', scale: 1 }]]);
    });

    it('validates the shopping list deeply before writing it', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.WRITE_SHOPPING_LIST;
        expect(await fixture.run(id, { list: { items: [{ type: 'menu', path: 'a.cook', multiplier: 2 }] } }))
            .to.equal('wrote {"items":[{"Recipe":{"path":"a.cook","multiplier":2,"children":[]}}]}');
        expect(await fixture.error(id, { list: { items: [{ path: 'a.cook', multiplier: -1 }] } })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { list: { items: [{ path: 'a.cook', children: [null] }] } })).to.match(/^Invalid arguments/); // eslint-disable-line no-null/no-null
        expect(await fixture.error(id, { list: { items: [null] } })).to.match(/^Invalid arguments/); // eslint-disable-line no-null/no-null
    });

    it('rejects control characters in paths and checked entry names', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.error(CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST, { recipes: [{ path: 'Soup\n.cook' }] }))
            .to.match(/^Invalid arguments/);
        expect(await fixture.error(CooklangPluginApi.Commands.WRITE_SHOPPING_CHECKED, { entries: [{ type: 'checked', name: 'flour\nmilk' }] }))
            .to.match(/^Invalid arguments/);
    });

    it('opens the recipe preview for a .cook URI of any scheme', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(CooklangPluginApi.Commands.OPEN_PREVIEW, { uri: 'cooklang-hub:/recipes/12/Pancakes.cook' });
        await fixture.run(CooklangPluginApi.Commands.OPEN_PREVIEW, { uri: 'file:///ws/Dinner/SOUP.COOK' });
        expect(fixture.opened).to.deep.equal(['cooklang-hub:/recipes/12/Pancakes.cook', 'file:///ws/Dinner/SOUP.COOK']);
    });

    it('rejects anything but an absolute .cook URI', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.OPEN_PREVIEW;
        expect(await fixture.error(id, undefined)).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: '' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'Pancakes.cook' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'cooklang-hub:/recipes/12/notes.md' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'cooklang-hub:/recipes/12/Pan\ncakes.cook' })).to.match(/^Invalid arguments/);
        expect(fixture.opened).to.deep.equal([]);
    });

    it('rejects a URI whose scheme has no file system, instead of hanging on activateProvider', async () => {
        const fixture = new Fixture();
        fixture.hasProvider = scheme => scheme !== 'https';
        fixture.create();
        const id = CooklangPluginApi.Commands.OPEN_PREVIEW;
        expect(await fixture.error(id, { uri: 'https://example.com/recipes/12/Pancakes.cook' }))
            .to.match(/^Invalid arguments: no file system for scheme "https"\.$/);
        expect(fixture.opened).to.deep.equal([]);
    });

    it('parses the pantry into the plugin shape, dropping nulls and lowStock', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_PANTRY, { text: '[fridge]' })).to.deep.equal({
            sections: [{
                name: 'fridge',
                items: [{ name: 'milk', quantity: '1%L', expire: '10.05.2026', isLow: false, isOutOfStock: false, expireDate: '2026-05-10' }],
            }],
        });
        expect(await fixture.error(CooklangPluginApi.Commands.PARSE_PANTRY, {})).to.match(/^Invalid arguments/);
    });

    it('edits the pantry with a validated, normalised edit', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.run(id, { text: 'T', edit: { op: 'add', section: ' fridge ', name: 'milk', quantity: '1%L', extra: 1 } }))
            .to.equal('edited');
        await fixture.run(id, { text: 'T', edit: { op: 'update', section: 'fridge', name: 'milk', fields: { expire: '' } } });
        await fixture.run(id, { text: 'T', edit: { op: 'remove', section: 'fridge', name: 'milk' } });
        expect(fixture.pantryEdits).to.deep.equal([
            { text: 'T', json: '{"op":"add","section":"fridge","name":"milk","quantity":"1%L"}' },
            { text: 'T', json: '{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}' },
            { text: 'T', json: '{"op":"remove","section":"fridge","name":"milk"}' },
        ]);
    });

    it('rejects malformed pantry edits before reaching the native code', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: { op: 'rename', section: 'a', name: 'b' } })).to.match(/^Invalid arguments: `edit.op`/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'remove', section: 'a' } })).to.match(/^Invalid arguments: `edit.name`/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b', quantity: 3 } }))
            .to.match(/^Invalid arguments: `edit`.quantity must be a string/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b' } })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b\nc' } })).to.match(/control characters/);
        expect(await fixture.error(id, { edit: { op: 'remove', section: 'a', name: 'b' } })).to.match(/^Invalid arguments: `text`/);
        expect(fixture.pantryEdits).to.deep.equal([]);
    });
});
