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

// `MarkdownRecipeDetector` injects `FileService` / `MonacoWorkspace`, whose
// module graph reaches Lumino widgets and touches `document` while loading.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID } from '../common';
import { MarkdownRecipeDetector } from './markdown-recipe-detector';

function detectorFor(options: {
    files?: Map<string, string>;
    models?: Map<string, { languageId: string }>;
}): MarkdownRecipeDetector {
    const detector = new MarkdownRecipeDetector();
    const files = options.files ?? new Map<string, string>();
    const models = options.models ?? new Map<string, { languageId: string }>();
    (detector as unknown as { fileService: unknown }).fileService = {
        read: async (uri: URI) => {
            const value = files.get(uri.toString());
            if (value === undefined) {
                throw new Error(`ENOENT: ${uri}`);
            }
            return { value };
        }
    };
    (detector as unknown as { monacoWorkspace: unknown }).monacoWorkspace = {
        getTextDocument: (uri: string) => models.get(uri)
    };
    return detector;
}

describe('MarkdownRecipeDetector', () => {

    const cook = new URI('file:///ws/bread.cook');
    const mdRecipe = new URI('file:///ws/pancakes.md');
    const mdNotes = new URI('file:///ws/notes.md');

    describe('isKnownRecipe', () => {
        it('matches .cook by extension', () => {
            expect(detectorFor({}).isKnownRecipe(cook)).to.be.true;
        });

        it('matches .md only when Monaco language is cooklang', () => {
            const withLang = detectorFor({
                models: new Map([[mdRecipe.toString(), { languageId: COOKLANG_LANGUAGE_ID }]])
            });
            expect(withLang.isKnownRecipe(mdRecipe)).to.be.true;
            expect(detectorFor({}).isKnownRecipe(mdRecipe)).to.be.false;
            expect(detectorFor({
                models: new Map([[mdNotes.toString(), { languageId: 'markdown' }]])
            }).isKnownRecipe(mdNotes)).to.be.false;
        });

        it('rejects undefined and non-recipe extensions', () => {
            expect(detectorFor({}).isKnownRecipe(undefined)).to.be.false;
            expect(detectorFor({}).isKnownRecipe(new URI('file:///ws/dinner.menu'))).to.be.false;
        });
    });

    describe('isRecipe', () => {
        it('matches .cook without reading the file', async () => {
            expect(await detectorFor({}).isRecipe(cook)).to.be.true;
        });

        it('matches .md with recipe: true frontmatter on disk', async () => {
            const detector = detectorFor({
                files: new Map([[mdRecipe.toString(), '---\nrecipe: true\n---\nMix @eggs{2}.']])
            });
            expect(await detector.isRecipe(mdRecipe)).to.be.true;
        });

        it('rejects .md without the recipe flag', async () => {
            const detector = detectorFor({
                files: new Map([[mdNotes.toString(), '---\ntitle: Notes\n---\nHello.']])
            });
            expect(await detector.isRecipe(mdNotes)).to.be.false;
        });

        it('rejects unreadable .md files', async () => {
            expect(await detectorFor({}).isRecipe(mdRecipe)).to.be.false;
        });
    });
});
