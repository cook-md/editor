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
import { ReportWidgetOptions } from './report-widget-types';
import { ReportExportResult } from '../common/report-export-protocol';
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
    parsePantryJson: string = JSON.stringify({
        sections: [{
            name: 'fridge',
            items: [{
                name: 'milk', quantity: '1%L', bought: null, expire: '10.05.2026', low: null, // eslint-disable-line no-null/no-null
                isLow: false, isOutOfStock: false, expireDate: '2026-05-10', boughtDate: null, // eslint-disable-line no-null/no-null
            }],
        }],
        lowStock: [],
    });
    editPantryError: Error | undefined = undefined;
    features = new Set<string>(['nutrition_api']);
    reportCalls: Array<{ uri: string; template: string; scale: number }> = [];
    refreshes = 0;
    shown: ReportWidgetOptions[] = [];
    exportCalls: Array<{ html: string; name: string; options: unknown }> = [];
    exportResult: ReportExportResult = { saved: true, filePath: '/out/Family Book.pdf' };
    exportError: Error | undefined = undefined;
    nativeImages: { title?: string; steps: Record<string, Record<string, string>> } = { steps: {} };
    contentImages: { title?: string; steps: Record<string, Record<string, string>> } = { steps: {} };
    imageLookups: string[] = [];
    contentLookups: string[] = [];
    fileReads: string[] = [];

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
            parsePantry: async () => this.parsePantryJson,
            editPantry: async (text: string, json: string) => {
                if (this.editPantryError) {
                    throw this.editPantryError;
                }
                this.pantryEdits.push({ text, json });
                return 'edited';
            },
            recipeImages: async (path: string) => {
                this.imageLookups.push(path);
                return JSON.stringify(this.nativeImages);
            },
            recipeImagesFromContent: async (content: string) => {
                this.contentLookups.push(content);
                return JSON.stringify(this.contentImages);
            },
        };
        (contribution as any).reportConfigService = {
            resolveWorkspaceUri: (arg: string) => {
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) { return new URI(arg).normalizePath(); }
                return this.root ? this.root.resolve(arg).normalizePath() : undefined;
            },
            buildConfigJson: async (scale: number, uri?: URI) => JSON.stringify({ scale, uri: uri?.toString() }),
        };
        (contribution as any).reportPresenter = {
            show: async (options: ReportWidgetOptions) => { this.shown.push(options); },
        };
        (contribution as any).contextKeys = { createKey: (key: string, value: unknown) => { this.keys.push({ key, value }); } };
        (contribution as any).recipePreview = { open: async (uri: URI) => { this.opened.push(uri.toString()); } };
        (contribution as any).fileService = {
            hasProvider: (scheme: string) => this.hasProvider(scheme),
            read: async (uri: URI) => {
                this.fileReads.push(uri.toString());
                return { value: 'remote recipe text' };
            },
        };
        (contribution as any).subscriptions = { hasFeature: async (name: string) => this.features.has(name) };
        (contribution as any).pluginReports = {
            render: async (uri: URI, template: string, scale: number) => {
                this.reportCalls.push({ uri: uri.toString(), template, scale });
                return { ok: true, output: 'rendered' };
            },
        };
        (contribution as any).outlets = { refresh: () => { this.refreshes += 1; } };
        (contribution as any).reportExport = {
            exportPdf: async (html: string, name: string, options?: unknown) => {
                this.exportCalls.push({ html, name, options });
                if (this.exportError) {
                    throw this.exportError;
                }
                return this.exportResult;
            },
        };
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

    it('rejects a native parsePantry result that is not the expected shape', async () => {
        const fixture = new Fixture();
        fixture.parsePantryJson = '{}';
        fixture.create();
        expect(await fixture.error(CooklangPluginApi.Commands.PARSE_PANTRY, { text: '[fridge]' }))
            .to.equal('parsePantry: unexpected result from the native parser');
    });

    it('edits the pantry with a validated, normalised edit', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.run(id, { text: 'T', edit: { op: 'add', section: ' fridge ', name: 'milk', quantity: '1%L' } }))
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
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b' } }))
            .to.equal('Invalid arguments: `edit.fields` must be a JSON object.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b\nc' } })).to.match(/control characters/);
        expect(await fixture.error(id, { edit: { op: 'remove', section: 'a', name: 'b' } })).to.match(/^Invalid arguments: `text`/);
        expect(fixture.pantryEdits).to.deep.equal([]);
    });

    it('rejects unknown keys on a pantry edit instead of silently dropping them', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b', quantity: '1%L', extra: 1 } }))
            .to.equal('Invalid arguments: `edit` has unknown keys: extra.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b', fields: { quantity: '1%L' } } }))
            .to.equal('Invalid arguments: `edit` has unknown keys: fields.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b', quantity: '1%L', fields: {} } }))
            .to.equal('Invalid arguments: `edit` has unknown keys: quantity.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b', fields: { expiry: '2026-01-01' } } }))
            .to.equal('Invalid arguments: `edit.fields` has unknown keys: expiry.');
        expect(fixture.pantryEdits).to.deep.equal([]);
    });

    it('rejects a whitespace-only attribute value, but keeps an empty string as "clear"', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b', fields: { quantity: '   ' } } }))
            .to.equal('Invalid arguments: `edit.fields`.quantity must not be only whitespace.');
        await fixture.run(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b', fields: { quantity: '' } } });
        expect(fixture.pantryEdits).to.deep.equal([
            { text: 'T', json: '{"op":"update","section":"a","name":"b","fields":{"quantity":""}}' },
        ]);
    });

    it('rejects an edit that is not a JSON object, a non-string field value and a whitespace-only section', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: null })).to.equal('Invalid arguments: `edit` must be a JSON object.'); // eslint-disable-line no-null/no-null
        expect(await fixture.error(id, { text: 'T', edit: [] })).to.equal('Invalid arguments: `edit` must be a JSON object.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b', fields: { quantity: 5 } } }))
            .to.equal('Invalid arguments: `edit.fields`.quantity must be a string.');
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: '   ', name: 'b' } }))
            .to.match(/^Invalid arguments: `edit\.section`/);
        expect(fixture.pantryEdits).to.deep.equal([]);
    });

    it('propagates a native editPantry rejection unchanged', async () => {
        const fixture = new Fixture();
        fixture.editPantryError = new Error("editPantry: item 'x' not found in section 'y'");
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: { op: 'remove', section: 'y', name: 'x' } }))
            .to.equal("editPantry: item 'x' not found in section 'y'");
    });
});

describe('CooklangPluginApiContribution — hasFeature and renderReport', () => {
    const { HAS_FEATURE, RENDER_REPORT } = CooklangPluginApi.Commands;

    it('reports plan features', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(HAS_FEATURE, { name: 'nutrition_api' })).to.equal(true);
        expect(await fixture.run(HAS_FEATURE, { name: 'sync' })).to.equal(false);
    });

    it('treats a failing subscription lookup as no feature', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (contribution as any).subscriptions = { hasFeature: async () => { throw new Error('offline'); } };
        expect(await fixture.run(HAS_FEATURE, { name: 'nutrition_api' })).to.equal(false);
    });

    it('rejects a missing feature name', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.error(HAS_FEATURE, {})).to.match(/^Invalid arguments/);
    });

    it('renders a template for a recipe or menu URI of any scheme, scale 1 by default', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(RENDER_REPORT, { uri: 'cooklang-hub:/x/Soup.cook', template: '{{ 1 }}' }))
            .to.deep.equal({ ok: true, output: 'rendered' });
        await fixture.run(RENDER_REPORT, { uri: 'file:///ws/week.menu', template: '{{ 2 }}', scale: 3 });
        expect(fixture.reportCalls).to.deep.equal([
            { uri: 'cooklang-hub:/x/Soup.cook', template: '{{ 1 }}', scale: 1 },
            { uri: 'file:///ws/week.menu', template: '{{ 2 }}', scale: 3 },
        ]);
    });

    it('rejects bad URIs, scales and templates', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            { uri: 'file:///ws/notes.md', template: '{{ 1 }}' },
            { uri: 'a.cook', template: '{{ 1 }}' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', scale: 0 },
            { uri: 'file:///ws/a.cook', template: '' },
            { uri: 'file:///ws/a.cook', template: 'x'.repeat(64 * 1024 + 1) },
        ]) {
            expect(await fixture.error(RENDER_REPORT, args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.reportCalls).to.deep.equal([]);
    });

    it('rejects a URI whose scheme has no file system provider', async () => {
        const fixture = new Fixture();
        fixture.create();
        fixture.hasProvider = scheme => scheme === 'file';
        expect(await fixture.error(RENDER_REPORT, { uri: 'foo:/x.cook', template: '{{ 1 }}' })).to.match(/^Invalid arguments/);
        expect(fixture.reportCalls).to.deep.equal([]);
    });
});

describe('CooklangPluginApiContribution — refreshBadges', () => {
    const { REFRESH_BADGES } = CooklangPluginApi.Commands;

    it('asks the outlet service to re-query badges', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(REFRESH_BADGES)).to.equal(undefined);
        expect(fixture.refreshes).to.equal(1);
    });
});

describe('CooklangPluginApiContribution — openReport', () => {
    const { OPEN_REPORT } = CooklangPluginApi.Commands;

    it('opens a report tab with the inline template, defaulting to markdown at scale 1', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(OPEN_REPORT, { uri: 'file:///ws/week.menu', template: '{{ 1 }}', label: 'Core Vitals' })).to.equal(undefined);
        expect(fixture.shown).to.deep.equal([{
            uri: 'file:///ws/week.menu',
            templateId: 'inline:plugin:Core Vitals',
            templateLabel: 'Core Vitals',
            inlineTemplateContent: '{{ 1 }}',
            outputFormat: 'markdown',
            scale: 1,
        }]);
    });

    it('passes outputFormat and scale through, for any recipe or menu scheme', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(OPEN_REPORT, { uri: 'cooklang-hub:/x/Soup.cook', template: '<b>x</b>', label: 'Vitals', outputFormat: 'html', scale: 2 });
        expect(fixture.shown[0].outputFormat).to.equal('html');
        expect(fixture.shown[0].scale).to.equal(2);
    });

    it('rejects bad URIs, templates, labels, formats and scales', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            { uri: 'file:///ws/notes.md', template: '{{ 1 }}', label: 'x' },
            { uri: 'a.cook', template: '{{ 1 }}', label: 'x' },
            { uri: 'file:///ws/a.cook', template: '', label: 'x' },
            { uri: 'file:///ws/a.cook', template: 'x'.repeat(64 * 1024 + 1), label: 'x' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: '  ' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x'.repeat(61) },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'a\u0000b' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x', outputFormat: 'pdf' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x', scale: 0 },
        ]) {
            expect(await fixture.error(OPEN_REPORT, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.shown).to.deep.equal([]);
    });

    it('rejects a URI whose scheme has no file system provider', async () => {
        const fixture = new Fixture();
        fixture.create();
        fixture.hasProvider = scheme => scheme === 'file';
        expect(await fixture.error(OPEN_REPORT, { uri: 'foo:/x.cook', template: '{{ 1 }}', label: 'x' })).to.match(/^Invalid arguments/);
        expect(fixture.shown).to.deep.equal([]);
    });
});

describe('CooklangPluginApiContribution — exportPdf', () => {
    const { EXPORT_PDF } = CooklangPluginApi.Commands;
    const HTML = '<!doctype html><html><body><h1>Family Book</h1></body></html>';

    it('delegates to the report export service and maps filePath to path', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Family Book' }))
            .to.deep.equal({ saved: true, path: '/out/Family Book.pdf' });
        expect(fixture.exportCalls).to.deep.equal([{ html: HTML, name: 'Family Book', options: undefined }]);
    });

    it('drops a trailing .pdf, because the service adds the extension', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Family Book.pdf' });
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: ' Soups.PDF ' });
        expect(fixture.exportCalls.map(call => call.name)).to.deep.equal(['Family Book', 'Soups']);
    });

    it('passes pageSize through', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book', pageSize: 'A4' });
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book', pageSize: 'Letter' });
        expect(fixture.exportCalls.map(call => call.options)).to.deep.equal([{ pageSize: 'A4' }, { pageSize: 'Letter' }]);
    });

    it('reports a cancelled dialog as not saved, without an error', async () => {
        const fixture = new Fixture();
        fixture.exportResult = { saved: false };
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' })).to.deep.equal({ saved: false });
    });

    it("passes the service's error message through", async () => {
        const fixture = new Fixture();
        fixture.exportResult = { saved: false, error: 'EACCES: permission denied' };
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' }))
            .to.deep.equal({ saved: false, error: 'EACCES: permission denied' });
    });

    it('turns a rejected service call into an error result instead of throwing', async () => {
        const fixture = new Fixture();
        fixture.exportError = new Error('connection closed');
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' }))
            .to.deep.equal({ saved: false, error: 'connection closed' });
    });

    it('rejects bad html, file names and page sizes before exporting', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            undefined,
            { defaultFileName: 'Book' },
            { html: '', defaultFileName: 'Book' },
            { html: ' \n\t ', defaultFileName: 'Book' },
            { html: 42, defaultFileName: 'Book' },
            { html: HTML },
            { html: HTML, defaultFileName: '   ' },
            { html: HTML, defaultFileName: 'Books/Family' },
            { html: HTML, defaultFileName: 'Books\\Family' },
            { html: HTML, defaultFileName: 'Family\nBook' },
            { html: HTML, defaultFileName: 'x'.repeat(201) },
            { html: HTML, defaultFileName: '.pdf' },
            { html: HTML, defaultFileName: 'Book', pageSize: 'A3' },
            { html: HTML, defaultFileName: 'Book', pageSize: 4 },
        ]) {
            expect(await fixture.error(EXPORT_PDF, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.exportCalls).to.deep.equal([]);
    });

    it('accepts html up to the limit and rejects one character more', async () => {
        const fixture = new Fixture();
        fixture.create();
        const limit = CooklangPluginApi.MAX_EXPORT_HTML_LENGTH;
        expect(limit).to.equal(100 * 1024 * 1024);
        expect(await fixture.error(EXPORT_PDF, { html: 'x'.repeat(limit + 1), defaultFileName: 'Book' }))
            .to.match(/^Invalid arguments: `html`/);
        await fixture.run(EXPORT_PDF, { html: 'x'.repeat(limit), defaultFileName: 'Book' });
        expect(fixture.exportCalls).to.have.length(1);
    });

    it('accepts a 200-character file name', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'x'.repeat(200) });
        expect(fixture.exportCalls[0].name).to.equal('x'.repeat(200));
    });
});

describe('CooklangPluginApiContribution — recipeImages', () => {
    const { RECIPE_IMAGES } = CooklangPluginApi.Commands;

    it('returns a local recipe\'s images as absolute file URIs, looked up on disk', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = {
            title: 'photos/hero.jpg',
            steps: {
                '0': { '0': '/ws/Dinner/Soup.1.jpg', '2': '/ws/Dinner/My Soup.3.webp' },
                '1': { '3': '/ws/Dinner/Soup.2.4.PNG' },
            },
        };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Dinner/Soup.cook' })).to.deep.equal({
            title: 'file:///ws/Dinner/photos/hero.jpg',
            steps: {
                '0': { '0': 'file:///ws/Dinner/Soup.1.jpg', '2': 'file:///ws/Dinner/My%20Soup.3.webp' },
                '1': { '3': 'file:///ws/Dinner/Soup.2.4.PNG' },
            },
        });
        expect(fixture.imageLookups).to.deep.equal(['/ws/Dinner/Soup.cook']);
        expect(fixture.contentLookups).to.deep.equal([]);
        expect(fixture.fileReads).to.deep.equal([]);
    });

    it('returns http(s) metadata URLs of a local recipe verbatim', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = { title: 'http://cdn.example/soup.jpg', steps: {} };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' }))
            .to.deep.equal({ title: 'http://cdn.example/soup.jpg', steps: {} });
    });

    it('leaves out files the preview cannot show and recipes with no images', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = { title: 'hero.gif', steps: { '0': { '0': '/ws/Soup.1.tiff' } } };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' })).to.deep.equal({ steps: {} });
        fixture.nativeImages = { steps: {} };
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' })).to.deep.equal({ steps: {} });
    });

    it('reads a recipe on another file system through FileService and keeps only https images', async () => {
        const fixture = new Fixture();
        fixture.contentImages = { title: 'https://cdn.example/p.jpg', steps: {} };
        fixture.create();
        const uri = 'cooklang-hub:/recipes/12/Pancakes.cook';
        expect(await fixture.run(RECIPE_IMAGES, { uri })).to.deep.equal({ title: 'https://cdn.example/p.jpg', steps: {} });
        expect(fixture.fileReads).to.deep.equal([uri]);
        expect(fixture.contentLookups).to.deep.equal(['remote recipe text']);
        expect(fixture.imageLookups).to.deep.equal([]);
        for (const title of ['http://cdn.example/p.jpg', 'Pancakes.jpg', '/etc/passwd']) {
            fixture.contentImages = { title, steps: {} };
            expect(await fixture.run(RECIPE_IMAGES, { uri }), title).to.deep.equal({ steps: {} });
        }
    });

    it('rejects anything but an absolute .cook URI', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            undefined,
            {},
            { uri: '' },
            { uri: 'Soup.cook' },
            { uri: 'file:///ws/week.menu' },
            { uri: 'file:///ws/notes.md' },
            { uri: 'file:///ws/So\nup.cook' },
        ]) {
            expect(await fixture.error(RECIPE_IMAGES, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.imageLookups).to.deep.equal([]);
    });

    it('rejects a URI whose scheme has no file system provider', async () => {
        const fixture = new Fixture();
        fixture.hasProvider = scheme => scheme === 'file';
        fixture.create();
        expect(await fixture.error(RECIPE_IMAGES, { uri: 'foo:/x/Soup.cook' }))
            .to.equal('Invalid arguments: no file system for scheme "foo".');
        expect(fixture.fileReads).to.deep.equal([]);
    });

    it('propagates a native lookup failure', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (contribution as any).languageService.recipeImages = async () => { throw new Error('recipeImages: not found'); };
        expect(await fixture.error(RECIPE_IMAGES, { uri: 'file:///ws/Gone.cook' })).to.equal('recipeImages: not found');
    });
});
