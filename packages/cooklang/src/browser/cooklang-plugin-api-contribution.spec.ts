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

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { CooklangPluginApi, CooklangPluginApiContribution } from './cooklang-plugin-api-contribution';

after(() => disableJSDOM());

interface Handler { execute: (...args: unknown[]) => unknown }

class Fixture {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: unknown[] = [];
    recipes = new Map<string, string>();
    resolveCalls: Array<{ content: string; baseDir: string }> = [];
    handlers = new Map<string, Handler>();
    labels = new Map<string, string | undefined>();
    keys: Array<{ key: string; value: unknown }> = [];

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
        };
        (contribution as any).reportConfigService = {
            resolveWorkspaceUri: (arg: string) => {
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) { return new URI(arg).normalizePath(); }
                return this.root ? this.root.resolve(arg).normalizePath() : undefined;
            },
        };
        (contribution as any).contextKeys = { createKey: (key: string, value: unknown) => { this.keys.push({ key, value }); } };
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
});
