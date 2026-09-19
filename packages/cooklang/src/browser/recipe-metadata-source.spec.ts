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

// The tool imports `FileService`, which needs browser globals at require
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
import { URI } from '@theia/core';
import { RecipeMetadataSource } from './recipe-metadata-source';

after(() => disableJSDOM());

class FakeLanguageService {
    entries: Array<{ path: string; title: string | null }> = [];
    calls: Array<{ baseDir: string; query: string }> = [];
    async searchRecipes(baseDir: string, query: string): Promise<string> {
        this.calls.push({ baseDir, query });
        return JSON.stringify(this.entries);
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

const ROOT = new URI('file:///ws');

function createSource(): { source: RecipeMetadataSource; languageService: FakeLanguageService; fileService: FakeFileService } {
    const source = new RecipeMetadataSource();
    const languageService = new FakeLanguageService();
    const fileService = new FakeFileService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (source as any).languageService = languageService;
    (source as any).fileService = fileService;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { source, languageService, fileService };
}

describe('RecipeMetadataSource', () => {

    describe('filterByMetadata', () => {
        it('reads and parses frontmatter for every given path', async () => {
            const { source, fileService } = createSource();
            fileService.contents.set('file:///ws/Napoleon.cook', '---\ntags: [French]\n---\nBody');
            const entries = await source.filterByMetadata(ROOT, ['Napoleon.cook'], {});
            expect(entries[0].status).to.equal('yaml');
            expect(entries[0].metadata?.tags).to.deep.equal(['French']);
            expect(entries[0].matched).to.equal(true);
        });

        it('applies a where filter, matching nested source.url', async () => {
            const { source, fileService } = createSource();
            fileService.contents.set('file:///ws/Kimchi.cook', '---\nsource:\n  url: https://koreanbapsang.com/x\n---\nBody');
            fileService.contents.set('file:///ws/Napoleon.cook', '---\ntags: [French]\n---\nBody');
            const entries = await source.filterByMetadata(ROOT, ['Kimchi.cook', 'Napoleon.cook'], {
                where: { source: { contains: 'koreanbapsang' } },
            });
            expect(entries.filter(e => e.matched).map(e => e.path)).to.deep.equal(['Kimchi.cook']);
        });

        it('reports a missing file rather than throwing', async () => {
            const { source } = createSource();
            const entries = await source.filterByMetadata(ROOT, ['Nope.cook'], {});
            expect(entries[0].status).to.equal('invalid');
            expect(entries[0].matched).to.equal(false);
        });

        it('reports deprecated >> metadata as not matched by a where condition', async () => {
            const { source, fileService } = createSource();
            fileService.contents.set('file:///ws/Legacy.cook', '>> title: Old\n\nBody');
            const entries = await source.filterByMetadata(ROOT, ['Legacy.cook'], { where: { title: { exists: true } } });
            expect(entries[0].status).to.equal('deprecated');
            expect(entries[0].matched).to.equal(false);
        });
    });

    describe('list', () => {
        it('runs the native search, reads content, and returns only matches', async () => {
            const { source, languageService, fileService } = createSource();
            languageService.entries = [{ path: '/ws/Kimchi.cook', title: 'Kimchi' }, { path: '/ws/Napoleon.cook', title: 'Napoleon' }];
            fileService.contents.set('file:///ws/Kimchi.cook', '---\ncuisine: Korean\n---\nBody');
            fileService.contents.set('file:///ws/Napoleon.cook', '---\ncuisine: French\n---\nBody');
            const entries = await source.list(ROOT, 'x', { where: { cuisine: { equals: 'Korean' } } });
            expect(entries.map(e => e.path)).to.deep.equal(['Kimchi.cook']);
            expect(languageService.calls).to.deep.equal([{ baseDir: '/ws', query: 'x' }]);
        });

        it('sends a blank query when none is given', async () => {
            const { source, languageService } = createSource();
            await source.list(ROOT, undefined, {});
            expect(languageService.calls[0].query).to.equal('');
        });
    });
});
