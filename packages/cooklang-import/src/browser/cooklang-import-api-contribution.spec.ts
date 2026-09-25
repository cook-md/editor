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

// The contribution injects `DraftSaver`, which pulls in `FileService` and
// `WorkspaceService`; their modules need browser globals. jsdom stays up.
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
import { CooklangImportApi, CooklangImportApiContribution } from './cooklang-import-api-contribution';
import { DraftSaver } from './draft-saver';
import { DraftSaverFixture } from './test/draft-saver-fixture';

const ROOT = new URI('file:///Users/alex/Recipes');
const SAVE_DRAFT = CooklangImportApi.Commands.SAVE_DRAFT;

interface Handler { execute: (...args: unknown[]) => unknown }

class ApiFixture {
    readonly handlers = new Map<string, Handler>();
    readonly labels = new Map<string, string | undefined>();
    /** `[content, fallbackTitle, frontmatter]` handed to `saveContent`. */
    readonly calls: Array<[string, string | undefined, Record<string, string>]> = [];

    constructor(saver?: DraftSaver) {
        const contribution = new CooklangImportApiContribution();
        const calls = this.calls;
        Object.assign(contribution, {
            draftSaver: saver ?? {
                saveContent: async (content: string, title: string | undefined, frontmatter: Record<string, string>) => {
                    calls.push([content, title, frontmatter]);
                    return ROOT.resolve(`Drafts/${title ?? 'Imported Recipe'}.cook`);
                },
            },
        });
        contribution.registerCommands({
            registerCommand: (command: { id: string; label?: string }, handler: Handler) => {
                this.handlers.set(command.id, handler);
                this.labels.set(command.id, command.label);
            },
        } as never);
    }

    async run(args: unknown): Promise<unknown> {
        return this.handlers.get(SAVE_DRAFT)!.execute(args);
    }

    async error(args: unknown): Promise<string> {
        try {
            await this.run(args);
        } catch (e) {
            return (e as Error).message;
        }
        throw new Error('saveDraft did not reject');
    }
}

describe('CooklangImportApiContribution', () => {

    it('registers cooklang.api.saveDraft without a label, so it stays out of the palette', () => {
        const fixture = new ApiFixture();
        expect(SAVE_DRAFT).to.equal('cooklang.api.saveDraft');
        expect([...fixture.handlers.keys()]).to.deep.equal([SAVE_DRAFT]);
        expect(fixture.labels.get(SAVE_DRAFT)).to.equal(undefined);
    });

    it('saves the draft and returns its URI as a string', async () => {
        const fixture = new ApiFixture();
        const result = await fixture.run({ version: 1, content: 'Mix.', title: 'Pancakes', frontmatter: { source: 'https://example.com/p' } });
        expect(result).to.equal(ROOT.resolve('Drafts/Pancakes.cook').toString());
        expect(fixture.calls).to.deep.equal([['Mix.', 'Pancakes', { source: 'https://example.com/p' }]]);
    });

    it('treats title and frontmatter as optional', async () => {
        const fixture = new ApiFixture();
        await fixture.run({ version: 1, content: 'Mix.' });
        expect(fixture.calls).to.deep.equal([['Mix.', undefined, {}]]);
    });

    it('rejects arguments of the wrong shape without saving', async () => {
        const fixture = new ApiFixture();
        const bad: unknown[] = [
            undefined,
            'Mix.',
            [],
            { content: 'Mix.' },
            { version: 2, content: 'Mix.' },
            { version: 1 },
            { version: 1, content: '   ' },
            { version: 1, content: 42 },
            { version: 1, content: 'Mix.', title: 5 },
            { version: 1, content: 'Mix.', frontmatter: 'source: x' },
            { version: 1, content: 'Mix.', frontmatter: ['x'] },
            { version: 1, content: 'Mix.', frontmatter: { source: 5 } },
            { version: 1, content: 'Mix.', frontmatter: { 'bad key': 'x' } },
            { version: 1, content: 'Mix.', frontmatter: { 'a\nb': 'x' } },
        ];
        for (const args of bad) {
            expect(await fixture.error(args), JSON.stringify(args)).to.match(/^Invalid arguments: /);
        }
        expect(fixture.calls).to.deep.equal([]);
    });

    it('merges frontmatter into the saved draft without overwriting the recipe\'s own keys', async () => {
        const saverFixture = new DraftSaverFixture([ROOT]);
        const fixture = new ApiFixture(saverFixture.saver);
        const result = await fixture.run({
            version: 1,
            content: '---\ntitle: Soup\nsource: mine\n---\nBoil @water{1%l}.',
            title: 'Ignored',
            frontmatter: { source: 'https://example.com/soup', author: 'Ann' },
        });
        expect(result).to.equal(ROOT.resolve('Drafts/Soup.cook').toString());
        expect(saverFixture.created.get(result as string))
            .to.equal('---\ntitle: Soup\nsource: mine\nauthor: Ann\n---\nBoil @water{1%l}.');
        expect(saverFixture.opened).to.deep.equal([result]);
    });

    it('rejects with the no-workspace message when no folder is open', async () => {
        const saverFixture = new DraftSaverFixture([]);
        const fixture = new ApiFixture(saverFixture.saver);
        expect(await fixture.error({ version: 1, content: 'Mix.' })).to.equal('Open a folder before importing recipes.');
        expect(saverFixture.created.size).to.equal(0);
    });
});
