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

// Fixtures mirror the native `parsePantry`/`checkPantry` JSON, where absent
// attributes and misses are null.
/* eslint-disable no-null/no-null */

// The tools import `WorkspaceService`/`FileService`, which need browser
// globals at require time. Same jsdom preamble as the sibling tool specs.
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
import { GetPantryTool, CheckPantryTool, PANTRY_CONF_PATH } from './pantry-tools';

after(() => disableJSDOM());

class FakeFileService {
    files = new Map<string, string>();
    async read(uri: URI): Promise<{ value: string }> {
        const value = this.files.get(uri.toString());
        if (value === undefined) { throw new Error(`ENOENT ${uri}`); }
        return { value };
    }
}

class FakeLanguageService {
    parsed = {
        sections: [{ name: 'fridge', items: [{ name: 'milk', quantity: '1%L', bought: null, expire: null, low: null, isLow: false }] }],
        lowStock: [],
    };
    parseCalls: string[] = [];
    checkCalls: Array<{ text: string; names: string[] }> = [];
    failParse = false;
    async parsePantry(text: string): Promise<string> {
        this.parseCalls.push(text);
        if (this.failParse) { throw new Error('parsePantry: TOML parse error'); }
        return JSON.stringify(this.parsed);
    }
    async checkPantry(text: string, names: string[]): Promise<string> {
        this.checkCalls.push({ text, names });
        if (this.failParse) { throw new Error('checkPantry: TOML parse error'); }
        return JSON.stringify(names.map(name => ({
            name,
            inStock: name === 'milk',
            section: name === 'milk' ? 'fridge' : null,
            quantity: name === 'milk' ? '1%L' : null,
            isLow: false,
        })));
    }
}

class FakeWorkspaceService {
    roots: URI[] = [new URI('file:///ws')];
    tryGetRoots(): Array<{ resource: URI }> {
        return this.roots.map(resource => ({ resource }));
    }
}

function wire<T extends object>(tool: T): { tool: T; fs: FakeFileService; ls: FakeLanguageService; ws: FakeWorkspaceService } {
    const fs = new FakeFileService();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).fileService = fs;
    (tool as any).languageService = ls;
    (tool as any).workspaceService = ws;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, fs, ls, ws };
}

const PANTRY_URI = 'file:///ws/config/pantry.conf';
const PANTRY_TEXT = '[fridge]\nmilk = "1%L"\n';

async function invokeRaw(tool: GetPantryTool | CheckPantryTool, raw: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return JSON.parse(await tool.getTool().handler(raw) as string);
}

async function invoke(tool: GetPantryTool | CheckPantryTool, args: object): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return invokeRaw(tool, JSON.stringify(args));
}

describe('GetPantryTool', () => {

    it('exposes getPantry with no parameters', () => {
        const def = new GetPantryTool().getTool();
        expect(def.id).to.equal('getPantry');
        expect(def.name).to.equal('getPantry');
        expect(Object.keys(def.parameters.properties)).to.deep.equal([]);
        expect(def.parameters.required ?? []).to.deep.equal([]);
    });

    it('reads config/pantry.conf and returns the parsed pantry with its path', async () => {
        const { tool, fs, ls } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        const result = await invoke(tool, {});
        expect(ls.parseCalls).to.deep.equal([PANTRY_TEXT]);
        expect(result).to.deep.equal({ path: PANTRY_CONF_PATH, ...ls.parsed });
    });

    it('accepts an empty argument string', async () => {
        const { tool, fs } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        const result = await invokeRaw(tool, '');
        expect(result.path).to.equal(PANTRY_CONF_PATH);
    });

    it('answers pantry: null with a message when the file is missing', async () => {
        const { tool, ls } = wire(new GetPantryTool());
        const result = await invoke(tool, {});
        expect(result.pantry).to.equal(null);
        expect(result.message).to.match(/config\/pantry\.conf/);
        expect(result.error).to.equal(undefined);
        expect(ls.parseCalls).to.deep.equal([]);
    });

    it('returns an error when parsing fails', async () => {
        const { tool, fs, ls } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, 'garbage');
        ls.failParse = true;
        const result = await invoke(tool, {});
        expect(result.error).to.match(/TOML/);
    });

    it('errors when the native result is not an object', async () => {
        const { tool, fs, ls } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        for (const raw of ['null', '[]', '"pantry"']) {
            ls.parsePantry = async () => raw;
            expect((await invoke(tool, {})).error, raw).to.match(/unexpected result shape/);
        }
    });

    it('errors without a workspace', async () => {
        const { tool, ws, ls } = wire(new GetPantryTool());
        ws.roots = [];
        const result = await invoke(tool, {});
        expect(result.error).to.match(/workspace/i);
        expect(ls.parseCalls).to.deep.equal([]);
    });
});

describe('CheckPantryTool', () => {

    it('requires ingredients', () => {
        const def = new CheckPantryTool().getTool();
        expect(def.id).to.equal('checkPantry');
        expect(def.name).to.equal('checkPantry');
        expect(def.parameters.required).to.deep.equal(['ingredients']);
        expect(def.parameters.properties.ingredients.type).to.equal('array');
    });

    it('checks the given names against the pantry file', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        const result = await invoke(tool, { ingredients: ['milk', 'eggs'] });
        expect(ls.checkCalls).to.deep.equal([{ text: PANTRY_TEXT, names: ['milk', 'eggs'] }]);
        expect(result.results).to.deep.equal([
            { name: 'milk', inStock: true, section: 'fridge', quantity: '1%L', isLow: false },
            { name: 'eggs', inStock: false, section: null, quantity: null, isLow: false },
        ]);
        expect(result.message).to.equal(undefined);
    });

    it('trims names and drops blank or non-string entries before checking', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        await invoke(tool, { ingredients: ['  milk ', '', '   ', 42, null, 'eggs'] });
        expect(ls.checkCalls[0].names).to.deep.equal(['milk', 'eggs']);
    });

    it('reports every ingredient as out of stock when the pantry file is missing', async () => {
        const { tool, ls } = wire(new CheckPantryTool());
        const result = await invoke(tool, { ingredients: ['milk'] });
        expect(ls.checkCalls).to.deep.equal([]);
        expect(result.results).to.deep.equal([{ name: 'milk', inStock: false, section: null, quantity: null, isLow: false }]);
        expect(result.message).to.match(/config\/pantry\.conf/);
        expect(result.error).to.equal(undefined);
    });

    it('rejects an empty or non-array ingredients argument', async () => {
        const { tool, ls } = wire(new CheckPantryTool());
        expect((await invoke(tool, { ingredients: [] })).error).to.match(/ingredients/);
        expect((await invoke(tool, { ingredients: 'milk' })).error).to.match(/ingredients/);
        expect((await invoke(tool, { ingredients: ['', '  '] })).error).to.match(/ingredients/);
        expect((await invoke(tool, {})).error).to.match(/ingredients/);
        expect(ls.checkCalls).to.deep.equal([]);
    });

    it('caps at 100 ingredients', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        const many = Array.from({ length: 101 }, (_, i) => `i${i}`);
        expect((await invoke(tool, { ingredients: many })).error).to.match(/100/);
        expect(ls.checkCalls).to.deep.equal([]);
        expect((await invoke(tool, { ingredients: many.slice(0, 100) })).results).to.have.length(100);
    });

    it('errors on invalid JSON arguments', async () => {
        const { tool } = wire(new CheckPantryTool());
        const result = await invokeRaw(tool, 'not json');
        expect(result.error).to.match(/JSON/);
    });

    it('errors on JSON arguments that are not an object', async () => {
        const { tool, ls } = wire(new CheckPantryTool());
        for (const raw of ['null', '[]', '"milk"', '42']) {
            const result = await invokeRaw(tool, raw);
            expect(result.error, raw).to.match(/JSON object/);
        }
        expect(ls.checkCalls).to.deep.equal([]);
    });

    it('errors without a workspace', async () => {
        const { tool, ws, ls } = wire(new CheckPantryTool());
        ws.roots = [];
        const result = await invoke(tool, { ingredients: ['milk'] });
        expect(result.error).to.match(/workspace/i);
        expect(ls.checkCalls).to.deep.equal([]);
    });

    it('errors when the native result is not an array', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, PANTRY_TEXT);
        ls.checkPantry = async () => JSON.stringify({ oops: true });
        expect((await invoke(tool, { ingredients: ['milk'] })).error).to.match(/unexpected result shape/);
    });

    it('returns an error when the pantry file cannot be parsed', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, 'garbage');
        ls.failParse = true;
        const result = await invoke(tool, { ingredients: ['milk'] });
        expect(result.error).to.match(/TOML/);
    });
});
