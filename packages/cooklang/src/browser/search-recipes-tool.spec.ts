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
import { RecipeMetadataSource } from './recipe-metadata-source';

after(() => disableJSDOM());

interface NativeEntry { path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }

interface FakeIngredient { name: string }

class FakeLanguageService {
    entries: NativeEntry[] = [];
    calls: Array<{ baseDir: string; query: string }> = [];
    /** Keyed by recipe content, so `parse` can answer per-file in readIngredients tests. */
    ingredientsByContent = new Map<string, FakeIngredient[]>();
    async searchRecipes(baseDir: string, query: string): Promise<string> {
        this.calls.push({ baseDir, query });
        return JSON.stringify(this.entries);
    }
    async parse(content: string): Promise<string> {
        const ingredients = this.ingredientsByContent.get(content) ?? [];
        return JSON.stringify({ recipe: { ingredients }, errors: [], warnings: [] });
    }
}

class FakeWorkspaceService {
    roots: URI[] = [new URI('file:///ws')];
    tryGetRoots(): Array<{ resource: URI }> {
        return this.roots.map(resource => ({ resource }));
    }
}

class FakeFileService {
    contents = new Map<string, string>();
    async read(uri: URI): Promise<{ value: { toString(): string } }> {
        const value = this.contents.get(uri.toString());
        if (value === undefined) { throw new Error('ENOENT'); }
        return { value: { toString: () => value } };
    }
}

interface SearchResult {
    recipes?: Array<{ path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }>;
    total?: number;
    error?: string;
    columns?: string[];
    rows?: string[][];
}

function createTool(): { tool: SearchRecipesTool; ls: FakeLanguageService; ws: FakeWorkspaceService; fs: FakeFileService } {
    const tool = new SearchRecipesTool();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    const fs = new FakeFileService();
    const metadataSource = new RecipeMetadataSource();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).languageService = ls;
    (tool as any).workspaceService = ws;
    (tool as any).fileService = fs;
    (metadataSource as any).languageService = ls;
    (metadataSource as any).fileService = fs;
    (tool as any).metadataSource = metadataSource;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, ls, ws, fs };
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

    it('errors on JSON arguments that are not an object', async () => {
        const { tool, ls } = createTool();
        for (const raw of ['null', '[]', '"query"', '42']) {
            const result = JSON.parse(await tool.getTool().handler(raw) as string);
            expect(result.error, raw).to.match(/JSON object/);
        }
        expect(ls.calls).to.deep.equal([]);
    });

    it('errors when the native result is not an array', async () => {
        const { tool, ls } = createTool();
        ls.searchRecipes = async () => JSON.stringify({ oops: true });
        const result = await invoke(tool, { query: 'x' });
        expect(result.error).to.match(/unexpected result shape/);
    });

    it('accepts a numeric-string limit', async () => {
        const { tool, ls } = createTool();
        ls.entries = Array.from({ length: 10 }, (_, i) => ({ ...pancakes, path: `/ws/r${i}.cook` }));
        const result = await invoke(tool, { limit: '5' });
        expect(result.recipes).to.have.length(5);
        expect(result.total).to.equal(10);
    });

    it('trims whitespace around the tag filter', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, pancakes];
        const result = await invoke(tool, { tag: '  Breakfast ' });
        expect(result.recipes?.map(r => r.path)).to.deep.equal(['Pancakes.cook']);
    });

    it('reports a search failure as an error instead of throwing', async () => {
        const { tool, ls } = createTool();
        ls.searchRecipes = async () => { throw new Error('boom'); };
        const result = await invoke(tool, { query: 'x' });
        expect(result.error).to.match(/boom/);
    });

    describe('queries (batch)', () => {

        it('runs every query in one call and keeps the input order', async () => {
            const { tool, ls } = createTool();
            ls.entries = [salmon];
            const result = await invoke(tool, { queries: ['salmon', 'pancakes'] }) as unknown as {
                searches: Array<{ query: string; recipes?: Array<{ path: string }>; total?: number }>;
            };
            expect(result.searches.map(s => s.query)).to.deep.equal(['salmon', 'pancakes']);
            expect(ls.calls.map(c => c.query)).to.deep.equal(['salmon', 'pancakes']);
            expect(result.searches[0].recipes?.[0].path).to.equal('Dinner/Salmon.cook');
            expect(result.searches[0].total).to.equal(1);
        });

        it('applies tag and limit to every query', async () => {
            const { tool, ls } = createTool();
            ls.entries = [salmon, pancakes, menu];
            const result = await invoke(tool, { queries: ['a', 'b'], tag: 'breakfast' }) as unknown as {
                searches: Array<{ recipes?: Array<{ path: string }> }>;
            };
            expect(result.searches[0].recipes?.map(r => r.path)).to.deep.equal(['Pancakes.cook']);
            expect(result.searches[1].recipes?.map(r => r.path)).to.deep.equal(['Pancakes.cook']);
        });

        it('reports a failing query in its own entry and still runs the rest', async () => {
            const { tool, ls } = createTool();
            ls.entries = [salmon];
            ls.searchRecipes = async (_baseDir: string, query: string) => {
                if (query === 'bad') { throw new Error('native boom'); }
                return JSON.stringify([salmon]);
            };
            const result = await invoke(tool, { queries: ['bad', 'good'] }) as unknown as {
                searches: Array<{ query: string; error?: string; total?: number }>;
            };
            expect(result.searches[0].error).to.match(/native boom/);
            expect(result.searches[1].total).to.equal(1);
        });

        it('collapses duplicate queries', async () => {
            const { tool, ls } = createTool();
            const result = await invoke(tool, { queries: ['salmon', 'salmon'] }) as unknown as { searches: unknown[] };
            expect(result.searches).to.have.length(1);
            expect(ls.calls).to.have.length(1);
        });

        it('rejects query and queries together', async () => {
            const { tool } = createTool();
            const result = await invoke(tool, { query: 'a', queries: ['b'] });
            expect(result.error).to.match(/not both/);
        });

        it('rejects an empty array and a batch over the cap', async () => {
            const { tool } = createTool();
            expect((await invoke(tool, { queries: [] })).error).to.match(/must not be empty/);
            const many = Array.from({ length: 26 }, (_, i) => `q${i}`);
            expect((await invoke(tool, { queries: many })).error).to.match(/at most 25 items/);
        });

        it('leaves the single-query result shape untouched', async () => {
            const { tool, ls } = createTool();
            ls.entries = [salmon];
            const result = await invoke(tool, { query: 'salmon' });
            expect(result.recipes).to.have.length(1);
            expect(result.total).to.equal(1);
            expect((result as unknown as { searches?: unknown }).searches).to.equal(undefined);
        });
    });

    describe('fields / where digest', () => {

        const KIMCHI_CONTENT = '---\ntags: [Korean]\nsource:\n  url: https://koreanbapsang.com/x\ncuisine: Korean\n---\nBody';
        const NAPOLEON_CONTENT = '---\ntags: [French]\ncuisine: French\n---\nBody';

        function withContent(fs: FakeFileService, path: string, content: string): void {
            fs.contents.set(`file:///ws/${path}`, content);
        }

        it('leaves the plain { recipes, total } shape untouched with neither fields nor where', async () => {
            const { tool, ls } = createTool();
            ls.entries = [salmon];
            const result = await invoke(tool, { query: 'x' }) as unknown as { columns?: unknown; rows?: unknown };
            expect(result.columns).to.equal(undefined);
            expect(result.rows).to.equal(undefined);
        });

        it('switches to { columns, rows, total } when fields is given', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Banchan/Kimchi.cook', title: 'Kimchi', tags: ['Korean'] }];
            withContent(fs, 'Banchan/Kimchi.cook', KIMCHI_CONTENT);
            const result = await invoke(tool, { fields: ['tags', 'cuisine', 'source'] });
            expect(result.columns).to.deep.equal(['path', 'title', 'tags', 'cuisine', 'source']);
            expect(result.rows).to.deep.equal([['Banchan/Kimchi.cook', 'Kimchi', 'Korean', 'Korean', 'https://koreanbapsang.com/x']]);
            expect(result.total).to.equal(1);
        });

        it('switches to { columns, rows, total } when where is given, even without fields', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Napoleon.cook', title: 'Napoleon' }];
            withContent(fs, 'Napoleon.cook', NAPOLEON_CONTENT);
            const result = await invoke(tool, { where: { cuisine: { equals: 'French' } } });
            expect(result.columns).to.deep.equal(['path', 'title']);
            expect(result.rows).to.deep.equal([['Napoleon.cook', 'Napoleon']]);
        });

        it('filters by where, matching nested source.url, and reports total before the limit', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [
                { ...pancakes, path: '/ws/Banchan/Kimchi.cook', title: 'Kimchi' },
                { ...pancakes, path: '/ws/Napoleon.cook', title: 'Napoleon' },
            ];
            withContent(fs, 'Banchan/Kimchi.cook', KIMCHI_CONTENT);
            withContent(fs, 'Napoleon.cook', NAPOLEON_CONTENT);
            const result = await invoke(tool, { where: { source: { contains: 'koreanbapsang' } } });
            expect(result.rows?.map(r => r[0])).to.deep.equal(['Banchan/Kimchi.cook']);
            expect(result.total).to.equal(1);
        });

        it('renders the tags column from the native tags (works for >> metadata too)', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Legacy.cook', title: 'Legacy', tags: ['quick', 'easy'] }];
            withContent(fs, 'Legacy.cook', '>> title: Legacy\n\nBody');
            const result = await invoke(tool, { fields: ['tags'] });
            expect(result.rows?.[0][2]).to.equal('quick, easy');
        });

        it('renders ingredients as unique names from languageService.parse', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Napoleon.cook', title: 'Napoleon' }];
            withContent(fs, 'Napoleon.cook', NAPOLEON_CONTENT);
            ls.ingredientsByContent.set(NAPOLEON_CONTENT, [{ name: 'flour' }, { name: 'butter' }, { name: 'flour' }]);
            const result = await invoke(tool, { fields: ['ingredients'] });
            expect(result.rows?.[0][2]).to.equal('flour, butter');
        });

        it('truncates a cell to 200 chars', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Napoleon.cook', title: 'Napoleon' }];
            const longDescription = 'x'.repeat(250);
            withContent(fs, 'Napoleon.cook', `---\ndescription: ${longDescription}\n---\nBody`);
            const result = await invoke(tool, { fields: ['description'] });
            expect(result.rows?.[0][2]).to.have.length(200);
        });

        it('rejects an unknown field', async () => {
            const { tool } = createTool();
            const result = await invoke(tool, { fields: ['nope'] });
            expect(result.error).to.match(/Unknown field "nope"/);
        });

        it('rejects a non-object where', async () => {
            const { tool } = createTool();
            const result = await invoke(tool, { where: 'nope' as unknown as object });
            expect(result.error).to.match(/where must be an object/);
        });

        it('raises the limit cap to 500 with fields/where', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = Array.from({ length: 600 }, (_, i) => ({ ...pancakes, path: `/ws/r${i}.cook` }));
            for (let i = 0; i < 600; i++) { withContent(fs, `r${i}.cook`, NAPOLEON_CONTENT); }
            const result = await invoke(tool, { fields: ['cuisine'], limit: 1000 });
            expect(result.rows).to.have.length(500);
        });

        it('supports fields/where together with the queries batch', async () => {
            const { tool, ls, fs } = createTool();
            ls.entries = [{ ...pancakes, path: '/ws/Napoleon.cook', title: 'Napoleon' }];
            withContent(fs, 'Napoleon.cook', NAPOLEON_CONTENT);
            const raw = await tool.getTool().handler(JSON.stringify({ queries: ['a'], fields: ['cuisine'] }));
            const result = JSON.parse(raw as string) as { searches: SearchResult[] };
            expect(result.searches[0].columns).to.deep.equal(['path', 'title', 'cuisine']);
            expect(result.searches[0].rows?.[0]).to.deep.equal(['Napoleon.cook', 'Napoleon', 'French']);
        });
    });
});
