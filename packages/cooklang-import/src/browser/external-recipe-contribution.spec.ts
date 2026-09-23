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
import * as markdownit from '@theia/core/shared/markdown-it';
import URI from '@theia/core/lib/common/uri';
import { ExternalRecipeContribution } from './external-recipe-contribution';
import { DraftSaver } from './draft-saver';

const ROOT = new URI('file:///Users/alex/Recipes');
const SAVE = 'Save to Drafts';

/** Mirrors `NotificationContentRenderer.renderMessage` in `@theia/messages`. */
const notificationMarkdown = markdownit({ html: false });
function renderNotification(message: string): string {
    return notificationMarkdown.renderInline(message.replace(/((\r)?\n)+/gm, ' '));
}

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
        expect(fixture.prompts.map(renderNotification)).to.deep.equal(['Pancakes.cook is not in your collection.']);
    });

    it('never renders a link from the file name', async () => {
        const fixture = contributionWith(undefined);
        const uri = new URI('file:///Users/alex/Downloads/').resolve('[Save](command:x?%5B%5D).cook');
        await fixture.offer(uri);
        await fixture.offer(new URI('file:///Users/alex/Downloads/').resolve('<command:x>.cook'));
        expect(fixture.prompts).to.have.length(2);
        // Guard the guard: unescaped, the name really would render a link.
        expect(renderNotification(uri.path.base)).to.contain('<a');
        for (const prompt of fixture.prompts) {
            expect(renderNotification(prompt), prompt).not.to.contain('<a');
        }
        expect(renderNotification(fixture.prompts[0])).to.equal('[Save](command:x?%5B%5D).cook is not in your collection.');
    });

    it('keeps an ordinary name readable', async () => {
        const fixture = contributionWith(undefined);
        await fixture.offer(new URI('file:///Users/alex/Downloads/').resolve('Sides & Drinks.cook'));
        expect(fixture.prompts.map(renderNotification)).to.deep.equal(['Sides &amp; Drinks.cook is not in your collection.']);
    });

    it('asks once when the same file is reported twice at the same time', async () => {
        const fixture = contributionWith(undefined);
        const uri = new URI('file:///Users/alex/Downloads/Pancakes.cook');
        await Promise.all([fixture.offer(uri), fixture.offer(new URI(uri.toString()))]);
        expect(fixture.prompts).to.have.length(1);
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

    it('does not offer when no folder is open, but does once one is', async () => {
        const fixture = contributionWith(SAVE, []);
        const uri = new URI('file:///Users/alex/Downloads/Pancakes.cook');
        await fixture.offer(uri);
        expect(fixture.prompts).to.be.empty;
        expect(fixture.saved).to.be.empty;
        Object.assign(fixture.contribution, { workspaceService: { roots: Promise.resolve([{ resource: ROOT }]) } });
        await fixture.offer(uri);
        expect(fixture.prompts).to.have.length(1);
    });

    it('offers only once per file', async () => {
        const fixture = contributionWith(undefined);
        const uri = new URI('file:///Users/alex/Downloads/Pancakes.cook');
        await fixture.offer(uri);
        await fixture.offer(uri);
        await fixture.offer(new URI('file:///Users/alex/Downloads/Waffles.cook'));
        expect(fixture.prompts.map(renderNotification)).to.deep.equal([
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

    it('names the draft after an existing frontmatter title and keeps the content', async () => {
        const { saver, created } = saverWith([]);
        const cooklang = '---\ntitle: Grandma\'s Pancakes\n---\nMix @eggs{2}.';
        const uri = await saver.saveRaw(cooklang, 'pancakes');
        expect(uri.path.base).to.equal('Grandma\'s Pancakes.cook');
        expect(created.get(uri.toString())).to.equal(cooklang);
        expect(created.has(ROOT.resolve('Drafts').toString())).to.equal(true);
    });
});
