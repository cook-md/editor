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
import { RecipeMetadataSource } from './recipe-metadata-source';

after(() => disableJSDOM());

interface FakeStat { resource: URI; isDirectory: boolean; children?: FakeStat[] }
interface TreeSpec { [name: string]: TreeSpec | string }

function buildStats(rootUri: URI, spec: TreeSpec): { stats: Map<string, FakeStat>; contents: Map<string, string> } {
    const stats = new Map<string, FakeStat>();
    const contents = new Map<string, string>();
    const build = (uri: URI, node: TreeSpec): FakeStat => {
        const children: FakeStat[] = [];
        for (const [name, child] of Object.entries(node)) {
            const childUri = uri.resolve(name);
            if (typeof child === 'string') {
                const fileStat: FakeStat = { resource: childUri, isDirectory: false };
                stats.set(childUri.toString(), fileStat);
                contents.set(childUri.toString(), child);
                children.push(fileStat);
            } else {
                children.push(build(childUri, child));
            }
        }
        const stat: FakeStat = { resource: uri, isDirectory: true, children };
        stats.set(uri.toString(), stat);
        return stat;
    };
    return { stats: (() => { build(rootUri, spec); return stats; })(), contents };
}

class FakeFileService {
    constructor(private readonly stats: Map<string, FakeStat>, private readonly contents: Map<string, string>) { }
    async resolve(uri: URI): Promise<FakeStat> {
        const stat = this.stats.get(uri.toString());
        if (!stat) { throw new Error('ENOENT'); }
        return stat;
    }
    async read(uri: URI): Promise<{ value: { toString(): string } }> {
        const value = this.contents.get(uri.toString());
        if (value === undefined) { throw new Error('ENOENT'); }
        return { value: { toString: () => value } };
    }
}

class FakeWorkspaceScope {
    async shouldExclude(stat: FakeStat): Promise<boolean> {
        return stat.resource.path.base === 'node_modules';
    }
}

class FakeMonacoWorkspace {
    open = new Map<string, string>();
    getTextDocument(uri: string): { getText(): string } | undefined {
        const value = this.open.get(uri);
        return value === undefined ? undefined : { getText: () => value };
    }
}

const ROOT = new URI('file:///ws');

function createSource(spec: TreeSpec): { source: RecipeMetadataSource; monaco: FakeMonacoWorkspace } {
    const { stats, contents } = buildStats(ROOT, spec);
    const source = new RecipeMetadataSource();
    const monaco = new FakeMonacoWorkspace();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (source as any).fileService = new FakeFileService(stats, contents);
    (source as any).workspaceScope = new FakeWorkspaceScope();
    (source as any).monacoWorkspace = monaco;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { source, monaco };
}

const TREE: TreeSpec = {
    'Napoleon.cook': '---\ntags: [French]\n---\nBody',
    Banchan: {
        'Kimchi.cook': '---\ntags: [Korean]\nsource:\n  url: https://koreanbapsang.com/x\n---\nBody',
        'Japchae.cook': '---\ntags: [Korean, noodles]\n---\nBody',
    },
    Legacy: { 'OldFormat.cook': '>> title: Old\n\nBody' },
    NoFrontmatter: { 'Plain.cook': 'Just a recipe.\n' },
    Plans: { 'Week.menu': 'Day 1' },
    node_modules: { 'ignored.cook': 'nope' },
};

describe('RecipeMetadataSource', () => {

    describe('listCookPaths', () => {
        it('lists every .cook file, excluding non-.cook files and excluded directories', async () => {
            const { source } = createSource(TREE);
            const paths = (await source.listCookPaths(ROOT)).sort();
            expect(paths).to.deep.equal([
                'Banchan/Japchae.cook',
                'Banchan/Kimchi.cook',
                'Legacy/OldFormat.cook',
                'NoFrontmatter/Plain.cook',
                'Napoleon.cook',
            ].sort());
        });
    });

    describe('filterByMetadata', () => {
        it('reads and parses frontmatter for every given path', async () => {
            const { source } = createSource(TREE);
            const entries = await source.filterByMetadata(ROOT, ['Napoleon.cook', 'Banchan/Kimchi.cook'], {});
            expect(entries.map(e => e.status)).to.deep.equal(['yaml', 'yaml']);
            expect(entries[1].metadata?.tags).to.deep.equal(['Korean']);
            expect(entries.every(e => e.matched)).to.equal(true);
        });

        it('applies a where filter, matching nested source.url', async () => {
            const { source } = createSource(TREE);
            const entries = await source.filterByMetadata(ROOT, ['Napoleon.cook', 'Banchan/Kimchi.cook'], {
                where: { source: { contains: 'koreanbapsang' } },
            });
            expect(entries.filter(e => e.matched).map(e => e.path)).to.deep.equal(['Banchan/Kimchi.cook']);
        });

        it('applies a titleContains filter against the file base name', async () => {
            const { source } = createSource(TREE);
            const entries = await source.filterByMetadata(ROOT, ['Napoleon.cook', 'Banchan/Kimchi.cook'], {
                titleContains: 'kimchi',
            });
            expect(entries.filter(e => e.matched).map(e => e.path)).to.deep.equal(['Banchan/Kimchi.cook']);
        });

        it('reports deprecated >> metadata files as not matched by any where condition', async () => {
            const { source } = createSource(TREE);
            const entries = await source.filterByMetadata(ROOT, ['Legacy/OldFormat.cook'], { where: { title: { exists: true } } });
            expect(entries[0].status).to.equal('deprecated');
            expect(entries[0].matched).to.equal(false);
        });

        it('reads the open editor content instead of disk when a document is unsaved', async () => {
            const { source, monaco } = createSource(TREE);
            monaco.open.set('file:///ws/Napoleon.cook', '---\ntags: [French, Modern]\n---\nBody');
            const entries = await source.filterByMetadata(ROOT, ['Napoleon.cook'], {});
            expect(entries[0].metadata?.tags).to.deep.equal(['French', 'Modern']);
        });

        it('reports a missing file rather than throwing', async () => {
            const { source } = createSource(TREE);
            const entries = await source.filterByMetadata(ROOT, ['Nope.cook'], {});
            expect(entries[0].status).to.equal('invalid');
            expect(entries[0].matched).to.equal(false);
        });
    });

    describe('list', () => {
        it('composes listCookPaths + filterByMetadata, returning only matches', async () => {
            const { source } = createSource(TREE);
            const entries = await source.list(ROOT, undefined, { where: { tags: { has: 'korean' } } });
            expect(entries.map(e => e.path).sort()).to.deep.equal(['Banchan/Japchae.cook', 'Banchan/Kimchi.cook']);
        });
    });
});
