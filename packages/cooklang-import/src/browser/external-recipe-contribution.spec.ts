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

// The contribution injects `FileService`, `WorkspaceService` and `EditorManager`,
// whose modules evaluate browser globals at require time. jsdom stays up for the
// whole run: tearing it down would break specs loaded alongside this one.
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
import { ExternalRecipeContribution } from './external-recipe-contribution';
import { DraftSaver } from './draft-saver';

const ROOT = new URI('file:///Users/alex/Recipes');
const SAVE = 'Save to Drafts';

interface ContributionFixture {
    contribution: ExternalRecipeContribution;
    /** Messages shown to the user. */
    prompts: string[];
    /** `[content, suggestedTitle]` pairs handed to `DraftSaver.saveRaw`. */
    saved: [string, string][];
    offer(uri: URI): Promise<void>;
}

function contributionWith(answer: string | undefined, roots: URI[] = [ROOT]): ContributionFixture {
    const prompts: string[] = [];
    const saved: [string, string][] = [];
    const contribution = new ExternalRecipeContribution();
    Object.assign(contribution, {
        workspaceService: { roots: Promise.resolve(roots.map(resource => ({ resource }))) },
        fileService: {
            read: async (uri: URI) => ({ value: `content of ${uri.path.base}` })
        },
        messageService: {
            info: async (message: string) => {
                prompts.push(message);
                return answer;
            }
        },
        draftSaver: {
            saveRaw: async (content: string, title: string) => {
                saved.push([content, title]);
                return ROOT.resolve(`Drafts/${title}.cook`);
            }
        }
    });
    const offer = (uri: URI): Promise<void> =>
        (contribution as unknown as { offerIfExternal(uri: URI): Promise<void> }).offerIfExternal(uri);
    return { contribution, prompts, saved, offer };
}

describe('ExternalRecipeContribution', () => {

    it('offers to save a .cook file opened from outside the collection', async () => {
        const fixture = contributionWith(undefined);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Pancakes.cook'));
        expect(fixture.prompts).to.deep.equal(['Pancakes.cook is not in your collection.']);
    });

    it('offers for an upper-case .COOK file outside the collection', async () => {
        const fixture = contributionWith(undefined);
        await fixture.offer(new URI('file:///Users/alex/Downloads/PANCAKES.COOK'));
        expect(fixture.prompts).to.have.length(1);
    });

    it('does not offer for a recipe inside the collection', async () => {
        const fixture = contributionWith(SAVE);
        await fixture.offer(ROOT.resolve('Breakfast/Pancakes.cook'));
        await fixture.offer(ROOT.resolve('Breakfast/PANCAKES.COOK'));
        expect(fixture.prompts).to.be.empty;
        expect(fixture.saved).to.be.empty;
    });

    it('does not offer for a non-recipe file outside the collection', async () => {
        const fixture = contributionWith(SAVE);
        await fixture.offer(new URI('file:///Users/alex/Downloads/notes.md'));
        expect(fixture.prompts).to.be.empty;
    });

    it('does not offer for a non-file scheme', async () => {
        const fixture = contributionWith(SAVE);
        await fixture.offer(new URI('untitled:/Untitled-1.cook'));
        expect(fixture.prompts).to.be.empty;
    });

    it('does not offer when no folder is open', async () => {
        const fixture = contributionWith(SAVE, []);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Pancakes.cook'));
        expect(fixture.prompts).to.be.empty;
        expect(fixture.saved).to.be.empty;
    });

    it('offers only once per file', async () => {
        const fixture = contributionWith(undefined);
        const uri = new URI('file:///Users/alex/Downloads/Pancakes.cook');
        await fixture.offer(uri);
        await fixture.offer(uri);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Waffles.cook'));
        expect(fixture.prompts).to.deep.equal([
            'Pancakes.cook is not in your collection.',
            'Waffles.cook is not in your collection.'
        ]);
    });

    it('saves the file content to Drafts, named after the file, when accepted', async () => {
        const fixture = contributionWith(SAVE);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Pancakes.cook'));
        expect(fixture.saved).to.deep.equal([['content of Pancakes.cook', 'Pancakes']]);
    });

    it('does not save when dismissed', async () => {
        const fixture = contributionWith(undefined);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Pancakes.cook'));
        expect(fixture.saved).to.be.empty;
    });
});

describe('DraftSaver.saveRaw', () => {

    function saverWith(existing: string[]): { saver: DraftSaver, created: Map<string, string>, opened: string[] } {
        const created = new Map<string, string>();
        const opened: string[] = [];
        const saver = new DraftSaver();
        Object.assign(saver, {
            workspaceService: { roots: Promise.resolve([{ resource: ROOT }]) },
            fileService: {
                exists: async (uri: URI) => existing.includes(uri.toString()) || created.has(uri.toString()),
                createFolder: async (uri: URI) => { created.set(uri.toString(), ''); },
                create: async (uri: URI, content: string) => { created.set(uri.toString(), content); }
            },
            openerService: {
                getOpener: async (uri: URI) => ({
                    canHandle: () => 1,
                    open: async () => { opened.push(uri.toString()); }
                })
            }
        });
        return { saver, created, opened };
    }

    it('adds a YAML frontmatter title, de-duplicates the name and opens the draft', async () => {
        const drafts = ROOT.resolve('Drafts');
        const { saver, created, opened } = saverWith([drafts.toString(), drafts.resolve('Pancakes.cook').toString()]);
        const uri = await saver.saveRaw('Mix @eggs{2}.', 'Pancakes');
        expect(uri.toString()).to.equal(drafts.resolve('Pancakes-2.cook').toString());
        expect(created.get(uri.toString())).to.equal('---\ntitle: Pancakes\n---\n\nMix @eggs{2}.');
        expect(opened).to.deep.equal([uri.toString()]);
    });

    it('keeps an existing frontmatter title in the content', async () => {
        const { saver, created } = saverWith([]);
        const cooklang = '---\ntitle: Grandma\'s Pancakes\n---\nMix @eggs{2}.';
        const uri = await saver.saveRaw(cooklang, 'pancakes');
        expect(created.get(uri.toString())).to.equal(cooklang);
        expect(created.has(ROOT.resolve('Drafts').toString())).to.equal(true);
    });
});
