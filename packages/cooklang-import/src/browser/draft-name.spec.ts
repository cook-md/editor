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
        it('does not read a title after a lone mid-body ---', () => {
            expect(DraftName.resolveTitle('Do this first.\n---\ntitle: Should Not Count\nBake now.', undefined))
                .to.equal(undefined);
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
        it('treats a lone mid-body --- as no frontmatter and prepends a fresh one', () => {
            expect(DraftName.ensureTitleFrontmatter('Mix everything.\n\n---\n\nBake for 10 min.', 'My Recipe'))
                .to.equal('---\ntitle: My Recipe\n---\n\nMix everything.\n\n---\n\nBake for 10 min.');
        });
    });

    describe('isFrontmatterKey', () => {
        it('accepts plain YAML keys', () => {
            expect(DraftName.isFrontmatterKey('source')).to.equal(true);
            expect(DraftName.isFrontmatterKey('prep_time')).to.equal(true);
            expect(DraftName.isFrontmatterKey('source.url')).to.equal(true);
            expect(DraftName.isFrontmatterKey('_private-key2')).to.equal(true);
        });
        it('rejects keys that would need quoting or break the line', () => {
            expect(DraftName.isFrontmatterKey('')).to.equal(false);
            expect(DraftName.isFrontmatterKey('bad key')).to.equal(false);
            expect(DraftName.isFrontmatterKey('a\nb')).to.equal(false);
            expect(DraftName.isFrontmatterKey('a:b')).to.equal(false);
            expect(DraftName.isFrontmatterKey('2nd')).to.equal(false);
            expect(DraftName.isFrontmatterKey('>>')).to.equal(false);
        });
    });

    describe('mergeFrontmatter', () => {
        it('adds a key to an existing frontmatter before the closing fence', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: Pancakes\n---\nMix.', { source: 'https://example.com/p' }))
                .to.equal('---\ntitle: Pancakes\nsource: https://example.com/p\n---\nMix.');
        });
        it('never overwrites a key the recipe already has', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: P\nsource: mine\n---\nMix.', { source: 'https://x.example', servings: '2' }))
                .to.equal('---\ntitle: P\nsource: mine\nservings: 2\n---\nMix.');
        });
        it('creates a YAML frontmatter when there is none', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { source: 'https://example.com/p' }))
                .to.equal('---\nsource: https://example.com/p\n---\n\nMix.');
        });
        it('never writes the deprecated >> metadata syntax', () => {
            const merged = DraftName.mergeFrontmatter('Mix @eggs{2}.', { source: 'https://example.com/p', author: 'Ann' });
            expect(merged).to.not.contain('>>');
            expect(merged.startsWith('---\n')).to.equal(true);
        });
        it('normalizes CRLF content to LF when it adds keys', () => {
            expect(DraftName.mergeFrontmatter('---\r\ntitle: P\r\n---\r\nMix.', { author: 'Ann' }))
                .to.equal('---\ntitle: P\nauthor: Ann\n---\nMix.');
        });
        it('quotes values YAML would misread', () => {
            expect(DraftName.mergeFrontmatter('Mix.', {
                a: 'Pancakes: the best',
                b: 'yes',
                c: '#1 pick',
                d: 'https://example.com/p#top',
                e: '',
            })).to.equal('---\na: "Pancakes: the best"\nb: "yes"\nc: "#1 pick"\nd: "https://example.com/p#top"\ne: ""\n---\n\nMix.');
        });
        it('collapses newlines in values so they cannot inject frontmatter lines', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { note: 'line one\nservings: 99' }))
                .to.equal('---\nnote: "line one servings: 99"\n---\n\nMix.');
        });
        it('skips keys that are not plain YAML keys', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { 'bad key': 'x', 'a\nb': 'y', '': 'z' })).to.equal('Mix.');
        });
        it('treats only top-level lines as existing keys', () => {
            expect(DraftName.mergeFrontmatter('---\ntags:\n  - source: x\n---\nMix.', { source: 'https://e.example' }))
                .to.equal('---\ntags:\n  - source: x\nsource: https://e.example\n---\nMix.');
        });
        it('treats an unterminated frontmatter as no frontmatter, matching cooklang-rs', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: P\nMix.', { source: 'x' }))
                .to.equal('---\nsource: x\n---\n\n---\ntitle: P\nMix.');
        });
        it('treats a lone mid-body --- as no frontmatter and prepends a fresh block', () => {
            expect(DraftName.mergeFrontmatter('Mix everything.\n\n---\n\nBake for 10 min.', { source: 'https://e.example' }))
                .to.equal('---\nsource: https://e.example\n---\n\nMix everything.\n\n---\n\nBake for 10 min.');
        });
        it('returns the content unchanged when there is nothing to add', () => {
            const src = '---\r\ntitle: P\r\nsource: s\r\n---\r\nMix.';
            expect(DraftName.mergeFrontmatter(src, {})).to.equal(src);
            expect(DraftName.mergeFrontmatter(src, { source: 'other' })).to.equal(src);
        });
        it('does not let an indented line inside a literal block close the frontmatter early', () => {
            expect(DraftName.mergeFrontmatter('---\nnotes: |\n  text\n  ---\n---\nMix.', { source: 'https://e.example' }))
                .to.equal('---\nnotes: |\n  text\n  ---\nsource: https://e.example\n---\nMix.');
        });
        it('recognizes an existing frontmatter after leading blank lines', () => {
            expect(DraftName.mergeFrontmatter('\n---\ntitle: P\n---\nMix.', { source: 'https://e.example' }))
                .to.equal('\n---\ntitle: P\nsource: https://e.example\n---\nMix.');
        });
        it('quotes values that look like numbers, hex, exponents, dates or times', () => {
            expect(DraftName.mergeFrontmatter('Mix.', {
                a: '007',
                b: '0x1F',
                c: '1e3',
                d: '2024-01-01',
                e: '1:30',
                servings: '2',
            })).to.equal('---\na: "007"\nb: "0x1F"\nc: "1e3"\nd: "2024-01-01"\ne: "1:30"\nservings: 2\n---\n\nMix.');
        });
        it('recognizes an existing key written with quotes', () => {
            expect(DraftName.mergeFrontmatter('---\n"source": mine\n---\nMix.', { source: 'https://e.example' }))
                .to.equal('---\n"source": mine\n---\nMix.');
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
