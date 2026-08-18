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

// Fixtures mirror the native `searchRecipes` JSON, where missing name/title/servings are null.
/* eslint-disable no-null/no-null */

// The tool imports `WorkspaceService`, which needs browser globals at require
// time. Same jsdom preamble as the sibling tool specs.
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
import { SearchRecipesTool } from './search-recipes-tool';

after(() => disableJSDOM());

interface NativeEntry { path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }

class FakeLanguageService {
    entries: NativeEntry[] = [];
    calls: Array<{ baseDir: string; query: string }> = [];
    async searchRecipes(baseDir: string, query: string): Promise<string> {
        this.calls.push({ baseDir, query });
        return JSON.stringify(this.entries);
    }
}

class FakeWorkspaceService {
    roots: URI[] = [new URI('file:///ws')];
    tryGetRoots(): Array<{ resource: URI }> {
        return this.roots.map(resource => ({ resource }));
    }
}

interface SearchResult {
    recipes?: Array<{ path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }>;
    total?: number;
    error?: string;
}

function createTool(): { tool: SearchRecipesTool; ls: FakeLanguageService; ws: FakeWorkspaceService } {
    const tool = new SearchRecipesTool();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).languageService = ls;
    (tool as any).workspaceService = ws;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, ls, ws };
}

async function invoke(tool: SearchRecipesTool, args: object): Promise<SearchResult> {
    return JSON.parse(await tool.getTool().handler(JSON.stringify(args)) as string);
}

const salmon: NativeEntry = { path: '/ws/Dinner/Salmon.cook', name: 'Salmon', title: 'Salmon Bowl', tags: ['Fish', 'quick'], isMenu: false, servings: 2 };
const pancakes: NativeEntry = { path: '/ws/Pancakes.cook', name: 'Pancakes', title: null, tags: ['breakfast'], isMenu: false, servings: null };
const menu: NativeEntry = { path: '/ws/Plans/Week.menu', name: 'Week', title: null, tags: [], isMenu: true, servings: null };

describe('SearchRecipesTool', () => {

    it('exposes searchRecipes with no required parameters', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('searchRecipes');
        expect(def.name).to.equal('searchRecipes');
        expect(def.parameters.required ?? []).to.deep.equal([]);
    });

    it('passes the workspace root path and query to the language service', async () => {
        const { tool, ls } = createTool();
        await invoke(tool, { query: 'salmon' });
        expect(ls.calls).to.deep.equal([{ baseDir: '/ws', query: 'salmon' }]);
    });

    it('sends a blank query when neither query nor tag is given', async () => {
        const { tool, ls } = createTool();
        await invoke(tool, {});
        expect(ls.calls[0].query).to.equal('');
    });

    it('returns workspace-relative paths and the recipe metadata', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, menu];
        const result = await invoke(tool, { query: 'x' });
        expect(result.recipes).to.deep.equal([
            { path: 'Dinner/Salmon.cook', name: 'Salmon', title: 'Salmon Bowl', tags: ['Fish', 'quick'], isMenu: false, servings: 2 },
            { path: 'Plans/Week.menu', name: 'Week', title: null, tags: [], isMenu: true, servings: null },
        ]);
        expect(result.total).to.equal(2);
    });

    it('falls back to the absolute path for files outside the workspace root', async () => {
        const { tool, ls } = createTool();
        ls.entries = [{ ...pancakes, path: '/elsewhere/Pancakes.cook' }];
        const result = await invoke(tool, { query: 'x' });
        expect(result.recipes?.[0].path).to.equal('/elsewhere/Pancakes.cook');
    });

    it('keeps # and ? in relative paths instead of parsing them as fragment/query', async () => {
        const { tool, ls } = createTool();
        ls.entries = [{ ...pancakes, path: '/ws/Sweet/Cake #2?.cook' }];
        const result = await invoke(tool, { query: 'x' });
        expect(result.recipes?.[0].path).to.equal('Sweet/Cake #2?.cook');
    });

    it('filters by tag case-insensitively', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, pancakes];
        const result = await invoke(tool, { tag: 'fish' });
        expect(result.recipes?.map(r => r.path)).to.deep.equal(['Dinner/Salmon.cook']);
        expect(result.total).to.equal(1);
    });

    it('applies limit but reports the total before truncation', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, pancakes, menu];
        const result = await invoke(tool, { limit: 2 });
        expect(result.recipes).to.have.length(2);
        expect(result.total).to.equal(3);
    });

    it('caps limit at 100 and falls back to 20 for invalid values', async () => {
        const { tool, ls } = createTool();
        ls.entries = Array.from({ length: 150 }, (_, i) => ({ ...pancakes, path: `/ws/r${i}.cook` }));
        expect((await invoke(tool, { limit: 500 })).recipes).to.have.length(100);
        expect((await invoke(tool, { limit: 'lots' })).recipes).to.have.length(20);
    });

    it('errors without a workspace', async () => {
        const { tool, ws } = createTool();
        ws.roots = [];
        const result = await invoke(tool, { query: 'x' });
        expect(result.error).to.match(/workspace/i);
    });

    it('errors on invalid JSON arguments', async () => {
        const { tool } = createTool();
        const result = JSON.parse(await tool.getTool().handler('not json') as string);
        expect(result.error).to.match(/JSON/);
    });

    it('reports a search failure as an error instead of throwing', async () => {
        const { tool, ls } = createTool();
        ls.searchRecipes = async () => { throw new Error('boom'); };
        const result = await invoke(tool, { query: 'x' });
        expect(result.error).to.match(/boom/);
    });
});
