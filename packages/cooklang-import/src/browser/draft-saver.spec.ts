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

// `DraftSaver` injects `FileService` and `WorkspaceService`, whose modules
// evaluate browser globals at require time. jsdom stays up for the whole run.
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
import { DraftSaverFixture } from './test/draft-saver-fixture';

const ROOT = new URI('file:///Users/alex/Recipes');
const DRAFTS = ROOT.resolve('Drafts');

describe('DraftSaver.saveContent', () => {

    it('names the draft after the fallback title and adds the extra frontmatter', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const uri = await fixture.saver.saveContent('Mix @eggs{2}.', 'Pancakes', { source: 'https://example.com/p' });
        expect(uri.toString()).to.equal(DRAFTS.resolve('Pancakes.cook').toString());
        expect(fixture.created.get(uri.toString()))
            .to.equal('---\ntitle: Pancakes\nsource: https://example.com/p\n---\n\nMix @eggs{2}.');
        expect(fixture.opened).to.deep.equal([uri.toString()]);
    });

    it('keeps the recipe\'s own title and frontmatter values', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const cooklang = '---\ntitle: Grandma Pancakes\nsource: mine\n---\nMix.';
        const uri = await fixture.saver.saveContent(cooklang, 'Other', { source: 'https://x.example', servings: '2' });
        expect(uri.path.base).to.equal('Grandma Pancakes.cook');
        expect(fixture.created.get(uri.toString()))
            .to.equal('---\ntitle: Grandma Pancakes\nsource: mine\nservings: 2\n---\nMix.');
    });

    it('falls back to "Imported Recipe" when there is no title at all', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const uri = await fixture.saver.saveContent('Mix.', undefined);
        expect(uri.path.base).to.equal('Imported Recipe.cook');
        expect(fixture.created.get(uri.toString())).to.equal('---\ntitle: Imported Recipe\n---\n\nMix.');
    });

    it('de-duplicates the file name', async () => {
        const fixture = new DraftSaverFixture([ROOT], [DRAFTS.toString(), DRAFTS.resolve('Pancakes.cook').toString()]);
        const uri = await fixture.saver.saveContent('Mix.', 'Pancakes');
        expect(uri.path.base).to.equal('Pancakes-2.cook');
    });

    it('rejects with the no-workspace message when no folder is open', async () => {
        const fixture = new DraftSaverFixture([]);
        let message: string | undefined;
        try {
            await fixture.saver.saveContent('Mix.', 'Pancakes');
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).to.equal('Open a folder before importing recipes.');
        expect(fixture.created.size).to.equal(0);
    });
});
