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

import { expect } from 'chai';
import { URI } from '@theia/core';
import { RecipeMetadataSource } from './recipe-metadata-source';

interface NativeFilteredEntry {
    path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null;
    metadata: Record<string, unknown>;
}

class FakeLanguageService {
    entries: NativeFilteredEntry[] = [];
    error: Error | undefined;
    calls: Array<{ baseDir: string; query: string; filterJson: string }> = [];
    async searchRecipesFiltered(baseDir: string, query: string, filterJson: string): Promise<string> {
        this.calls.push({ baseDir, query, filterJson });
        if (this.error) { throw this.error; }
        return JSON.stringify(this.entries);
    }
}

const ROOT = new URI('file:///ws');

function createSource(): { source: RecipeMetadataSource; ls: FakeLanguageService } {
    const source = new RecipeMetadataSource();
    const ls = new FakeLanguageService();
    (source as unknown as { languageService: FakeLanguageService }).languageService = ls;
    return { source, ls };
}

const KIMCHI: NativeFilteredEntry = {
    path: '/ws/Banchan/Kimchi.cook', name: 'Kimchi', title: 'Kimchi', tags: ['Korean'], isMenu: false, servings: 4,
    metadata: { tags: ['Korean'], source: { url: 'https://koreanbapsang.com/x' } },
};

describe('RecipeMetadataSource', () => {

    it('makes exactly one native call, forwarding baseDir and query', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, 'kimchi', {});
        expect(ls.calls).to.have.length(1);
        expect(ls.calls[0].baseDir).to.equal('/ws');
        expect(ls.calls[0].query).to.equal('kimchi');
    });

    it('sends a blank query when none is given', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, undefined, {});
        expect(ls.calls[0].query).to.equal('');
    });

    it('sends a blank filter ("") when where and titleContains are both absent', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, 'x', {});
        expect(ls.calls[0].filterJson).to.equal('');
    });

    it('sends a blank filter for an empty where object', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, 'x', { where: {} });
        expect(ls.calls[0].filterJson).to.equal('');
    });

    it('sends the where clause as JSON, combined with the query in the same call', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, 'kimchi', { where: { cuisine: { equals: 'Korean' } } });
        expect(ls.calls[0].query).to.equal('kimchi');
        expect(JSON.parse(ls.calls[0].filterJson)).to.deep.equal({ where: { cuisine: { equals: 'Korean' } } });
    });

    it('sends titleContains in the filter JSON', async () => {
        const { source, ls } = createSource();
        await source.list(ROOT, undefined, { titleContains: 'kimchi' });
        expect(JSON.parse(ls.calls[0].filterJson)).to.deep.equal({ titleContains: 'kimchi' });
    });

    it('maps native entries to workspace-relative paths, keeping every native field and the metadata object', async () => {
        const { source, ls } = createSource();
        ls.entries = [KIMCHI];
        const entries = await source.list(ROOT, 'x', {});
        expect(entries).to.deep.equal([{
            path: 'Banchan/Kimchi.cook', name: 'Kimchi', title: 'Kimchi', tags: ['Korean'], isMenu: false, servings: 4,
            metadata: { tags: ['Korean'], source: { url: 'https://koreanbapsang.com/x' } },
        }]);
    });

    it('falls back to the absolute path for a file outside the workspace root', async () => {
        const { source, ls } = createSource();
        ls.entries = [{ ...KIMCHI, path: '/elsewhere/Kimchi.cook' }];
        const entries = await source.list(ROOT, 'x', {});
        expect(entries[0].path).to.equal('/elsewhere/Kimchi.cook');
    });

    it('propagates a native rejection (e.g. a malformed filter) rather than swallowing it', async () => {
        const { source, ls } = createSource();
        ls.error = new Error('searchRecipesFiltered: invalid filter: unknown operator "startsWith"');
        try {
            await source.list(ROOT, 'x', { where: { tags: { startsWith: 'x' } as never } });
            expect.fail('expected list() to reject');
        } catch (e) {
            expect((e as Error).message).to.match(/invalid filter/);
        }
    });
});
