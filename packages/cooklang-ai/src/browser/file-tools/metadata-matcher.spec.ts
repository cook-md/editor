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

// Pure module, no Theia imports — no jsdom preamble needed.

import { expect } from 'chai';
import {
    baseNameWithoutExt, matchesTitleContains, matchesWhere, readFrontmatter, splitFrontmatterBlock, WhereClause,
} from './metadata-matcher';

describe('metadata-matcher', () => {

    describe('splitFrontmatterBlock', () => {
        it('splits a simple frontmatter block', () => {
            const result = splitFrontmatterBlock('---\ntitle: Salmon\ntags: [fish]\n---\n\nCook @salmon{200%g}.\n');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.yamlText).to.equal('title: Salmon\ntags: [fish]');
                expect(result.bodyText).to.equal('\nCook @salmon{200%g}.\n');
                expect(result.bom).to.equal('');
                expect(result.eol).to.equal('\n');
            }
        });

        it('detects a BOM', () => {
            const result = splitFrontmatterBlock('﻿---\ntitle: X\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.bom).to.equal('﻿');
            }
        });

        it('detects CRLF line endings', () => {
            const result = splitFrontmatterBlock('---\r\ntitle: X\r\n---\r\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.eol).to.equal('\r\n');
                expect(result.yamlText).to.equal('title: X');
                expect(result.bodyText).to.equal('Body');
            }
        });

        it('reports deprecated >> metadata when there is no frontmatter block', () => {
            const result = splitFrontmatterBlock('>> title: Salmon\n>> servings: 2\n\nCook @salmon{200%g}.\n');
            expect(result.kind).to.equal('deprecated');
        });

        it('does not treat a lone leading --- with no close as frontmatter data', () => {
            const result = splitFrontmatterBlock('---\ntitle: X\nno closing delimiter\n');
            expect(result.kind).to.equal('unterminated');
        });

        it('reports none when there is neither frontmatter nor >> metadata', () => {
            const result = splitFrontmatterBlock('Just a recipe body.\nCook @eggs{2}.\n');
            expect(result.kind).to.equal('none');
        });

        it('does not misdetect >> deep inside a step as deprecated metadata', () => {
            const result = splitFrontmatterBlock('Mix well >> whisk vigorously.\n');
            expect(result.kind).to.equal('none');
        });
    });

    describe('readFrontmatter', () => {
        it('parses a flow tag list', () => {
            const result = readFrontmatter('---\ntags: [Korean, quick]\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.data.tags).to.deep.equal(['Korean', 'quick']);
            }
        });

        it('parses a block tag list', () => {
            const result = readFrontmatter('---\ntags:\n  - Korean\n  - quick\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.data.tags).to.deep.equal(['Korean', 'quick']);
            }
        });

        it('parses a comma-separated tags string as-is (not split)', () => {
            const result = readFrontmatter('---\ntags: Korean, quick\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.data.tags).to.equal('Korean, quick');
            }
        });

        it('parses a nested source map', () => {
            const result = readFrontmatter('---\nsource:\n  url: https://koreanbapsang.com/x\n  author: Sue\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.data.source).to.deep.equal({ url: 'https://koreanbapsang.com/x', author: 'Sue' });
            }
        });

        it('reports invalid for unparseable YAML', () => {
            const result = readFrontmatter('---\ntags: [Korean\n---\nBody');
            expect(result.kind).to.equal('invalid');
        });

        it('reports invalid when the frontmatter is not a mapping', () => {
            const result = readFrontmatter('---\n- one\n- two\n---\nBody');
            expect(result.kind).to.equal('invalid');
        });

        it('reports none for a file with no frontmatter and no >> metadata', () => {
            expect(readFrontmatter('Just a recipe.\n').kind).to.equal('none');
        });

        it('reports deprecated for a file using >> metadata', () => {
            expect(readFrontmatter('>> title: Salmon\n\nCook @salmon{200%g}.\n').kind).to.equal('deprecated');
        });

        it('treats an empty frontmatter block as an empty object', () => {
            const result = readFrontmatter('---\n---\nBody');
            expect(result.kind).to.equal('yaml');
            if (result.kind === 'yaml') {
                expect(result.data).to.deep.equal({});
            }
        });
    });

    describe('matchesWhere', () => {
        it('ANDs multiple conditions', () => {
            const where: WhereClause = { cuisine: { equals: 'Korean' }, difficulty: { exists: true } };
            expect(matchesWhere({ cuisine: 'Korean', difficulty: 'easy' }, where)).to.equal(true);
            expect(matchesWhere({ cuisine: 'Korean' }, where)).to.equal(false);
        });

        it('is true with an undefined where clause', () => {
            expect(matchesWhere({}, undefined)).to.equal(true);
        });

        it('contains matches case-insensitively against a plain string field', () => {
            const where: WhereClause = { source: { contains: 'koreanbapsang' } };
            expect(matchesWhere({ source: 'https://KoreanBapsang.com/recipe' }, where)).to.equal(true);
            expect(matchesWhere({ source: 'https://other.com' }, where)).to.equal(false);
        });

        it('contains accepts an array of needles, matching ANY', () => {
            const where: WhereClause = { source: { contains: ['koreanbapsang', 'sarasparkypark'] } };
            expect(matchesWhere({ source: 'https://sarasparkypark.com/x' }, where)).to.equal(true);
            expect(matchesWhere({ source: 'https://elsewhere.com/x' }, where)).to.equal(false);
        });

        it('contains matches against nested source.url / source.name / source.author leaves', () => {
            const where: WhereClause = { source: { contains: 'koreanbapsang' } };
            expect(matchesWhere({ source: { url: 'https://koreanbapsang.com/recipe' } }, where)).to.equal(true);
            expect(matchesWhere({ source: { name: 'KoreanBapsang', author: 'Sue' } }, where)).to.equal(true);
            expect(matchesWhere({ source: { author: 'Someone Else' } }, where)).to.equal(false);
        });

        it('contains matches any element of an array field', () => {
            const where: WhereClause = { tags: { contains: 'korean' } };
            expect(matchesWhere({ tags: ['Fish', 'Korean'] }, where)).to.equal(true);
            expect(matchesWhere({ tags: ['Fish'] }, where)).to.equal(false);
        });

        it('equals is case-insensitive', () => {
            const where: WhereClause = { cuisine: { equals: 'korean' } };
            expect(matchesWhere({ cuisine: 'Korean' }, where)).to.equal(true);
            expect(matchesWhere({ cuisine: 'Thai' }, where)).to.equal(false);
        });

        it('has / missing are inverses over an array field, case-insensitively', () => {
            const has: WhereClause = { tags: { has: 'korean' } };
            const missing: WhereClause = { tags: { missing: 'korean' } };
            expect(matchesWhere({ tags: ['Korean'] }, has)).to.equal(true);
            expect(matchesWhere({ tags: ['Korean'] }, missing)).to.equal(false);
            expect(matchesWhere({ tags: ['Fish'] }, has)).to.equal(false);
            expect(matchesWhere({ tags: ['Fish'] }, missing)).to.equal(true);
            expect(matchesWhere({}, missing)).to.equal(true);
        });

        it('exists checks key presence regardless of value', () => {
            expect(matchesWhere({ difficulty: 'easy' }, { difficulty: { exists: true } })).to.equal(true);
            expect(matchesWhere({}, { difficulty: { exists: true } })).to.equal(false);
            expect(matchesWhere({}, { difficulty: { exists: false } })).to.equal(true);
            expect(matchesWhere({ difficulty: 'easy' }, { difficulty: { exists: false } })).to.equal(false);
        });
    });

    describe('matchesTitleContains', () => {
        it('is true with no titleContains filter', () => {
            expect(matchesTitleContains('Miso Cookies', undefined, undefined)).to.equal(true);
        });

        it('matches against the file base name', () => {
            expect(matchesTitleContains('Japanese Curry', undefined, 'Japanese')).to.equal(true);
            expect(matchesTitleContains('Miso Cookies', undefined, 'Japanese')).to.equal(false);
        });

        it('matches against the frontmatter title', () => {
            expect(matchesTitleContains('recipe-42', 'Japanese Curry Bowl', 'Japanese')).to.equal(true);
        });

        it('accepts an array of needles, matching ANY', () => {
            expect(matchesTitleContains('Miso Cookies', undefined, ['Japanese', 'Miso'])).to.equal(true);
        });

        it('is case-insensitive', () => {
            expect(matchesTitleContains('JAPANESE CURRY', undefined, 'japanese')).to.equal(true);
        });
    });

    describe('baseNameWithoutExt', () => {
        it('strips the extension and directory', () => {
            expect(baseNameWithoutExt('Dessert/Miso Cookies.cook')).to.equal('Miso Cookies');
        });

        it('leaves a name with no extension alone', () => {
            expect(baseNameWithoutExt('README')).to.equal('README');
        });

        it('does not treat a leading dot as an extension', () => {
            expect(baseNameWithoutExt('.cook')).to.equal('.cook');
        });
    });
});
