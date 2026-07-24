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
import { DraftName } from './draft-name';

describe('DraftName', () => {

    describe('resolveTitle', () => {
        it('prefers the API-provided name', () => {
            expect(DraftName.resolveTitle('---\ntitle: Other\n---\n', 'Pancakes')).to.equal('Pancakes');
        });
        it('ignores a blank API name and reads the frontmatter title', () => {
            expect(DraftName.resolveTitle('---\ntitle: Pancakes\n---\nMix @eggs{2}.', '  ')).to.equal('Pancakes');
        });
        it('returns undefined when neither source has a title', () => {
            expect(DraftName.resolveTitle('Mix @eggs{2}.', undefined)).to.equal(undefined);
            expect(DraftName.resolveTitle('---\nservings: 4\n---\nMix.', undefined)).to.equal(undefined);
        });
        it('reads the frontmatter title from CRLF content', () => {
            expect(DraftName.resolveTitle('---\r\ntitle: Pancakes\r\n---\r\nMix @eggs{2}.', undefined)).to.equal('Pancakes');
        });
        it('collapses newlines in the API-provided name', () => {
            expect(DraftName.resolveTitle('Mix.', 'Pan\ncakes')).to.equal('Pan cakes');
        });
        it('unquotes a double-quoted frontmatter title', () => {
            expect(DraftName.resolveTitle('---\ntitle: "Mom\'s Pancakes"\n---\nMix.', undefined)).to.equal("Mom's Pancakes");
        });
        it('unquotes a single-quoted frontmatter title', () => {
            expect(DraftName.resolveTitle("---\ntitle: 'Pancakes'\n---\nMix.", undefined)).to.equal('Pancakes');
        });
    });

    describe('ensureTitleFrontmatter', () => {
        it('leaves content with a titled frontmatter unchanged', () => {
            const src = '---\ntitle: Pancakes\n---\nMix @eggs{2}.';
            expect(DraftName.ensureTitleFrontmatter(src, 'Pancakes')).to.equal(src);
        });
        it('inserts title into an existing frontmatter without one', () => {
            expect(DraftName.ensureTitleFrontmatter('---\nservings: 4\n---\nMix.', 'Pancakes'))
                .to.equal('---\ntitle: Pancakes\nservings: 4\n---\nMix.');
        });
        it('prepends frontmatter when there is none', () => {
            expect(DraftName.ensureTitleFrontmatter('Mix @eggs{2}.', 'Pancakes'))
                .to.equal('---\ntitle: Pancakes\n---\n\nMix @eggs{2}.');
        });
        it('inserts title into a CRLF frontmatter and normalizes it to LF', () => {
            expect(DraftName.ensureTitleFrontmatter('---\r\nservings: 4\r\n---\r\nMix.', 'Pancakes'))
                .to.equal('---\ntitle: Pancakes\nservings: 4\n---\nMix.');
        });
        it('leaves CRLF content with a titled frontmatter unchanged', () => {
            const src = '---\r\ntitle: Pancakes\r\n---\r\nMix @eggs{2}.';
            expect(DraftName.ensureTitleFrontmatter(src, 'Pancakes')).to.equal(src);
        });
        it('collapses newlines in the title to prevent frontmatter injection', () => {
            expect(DraftName.ensureTitleFrontmatter('Mix.', 'Pancakes\nservings: 99'))
                .to.equal('---\ntitle: Pancakes servings: 99\n---\n\nMix.');
        });
    });

    describe('sanitizeFilename', () => {
        it('strips characters that are unsafe in filenames', () => {
            expect(DraftName.sanitizeFilename('Mom’s "Best" Soup: a/b\\c?')).to.equal('Mom’s Best Soup abc');
        });
        it('collapses whitespace and trims leading/trailing dots and spaces', () => {
            expect(DraftName.sanitizeFilename('  .Fancy   Bread.  ')).to.equal('Fancy Bread');
        });
        it('falls back for names that sanitize to nothing', () => {
            expect(DraftName.sanitizeFilename('::""//')).to.equal('Imported Recipe');
        });
        it('appends Recipe to Windows reserved device names', () => {
            expect(DraftName.sanitizeFilename('Nul')).to.equal('Nul Recipe');
            expect(DraftName.sanitizeFilename('COM1')).to.equal('COM1 Recipe');
        });
        it('truncates overly long names to 120 characters', () => {
            expect(DraftName.sanitizeFilename('A'.repeat(200))).to.equal('A'.repeat(120));
        });
        it('re-trims trailing dots and spaces after truncation', () => {
            const name = DraftName.sanitizeFilename(`${'A'.repeat(119)} B`);
            expect(name).to.equal('A'.repeat(119));
        });
    });

    describe('uniqueBaseName', () => {
        it('returns the base name when it is free', async () => {
            const name = await DraftName.uniqueBaseName('Pancakes', async () => false);
            expect(name).to.equal('Pancakes');
        });
        it('appends an incrementing counter until the name is free', async () => {
            const taken = new Set(['Pancakes', 'Pancakes-2']);
            const name = await DraftName.uniqueBaseName('Pancakes', async candidate => taken.has(candidate));
            expect(name).to.equal('Pancakes-3');
        });
        it('falls back to a timestamp suffix when every counter is taken', async () => {
            const name = await DraftName.uniqueBaseName('Pancakes', async () => true);
            expect(name.startsWith('Pancakes-')).to.equal(true);
            expect(name).to.not.equal('Pancakes-1000');
        });
    });
});
