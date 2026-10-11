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

import { expect } from 'chai';
import { fillPageRefs, hasPageRefs, pdfDestinationPages } from './pdf-page-refs';

/** Shaped like Chromium's output: a two-level page tree, a content stream and a `/Dests` object. */
export function skiaLikePdf(dests: Record<string, number>): Buffer {
    const pageIds = [2, 10, 27, 30, 40];
    const pages = pageIds.map(id =>
        `${id} 0 obj\n<</Type /Page\n/Resources <</ProcSet [/PDF /Text]\n/Font <</F4 4 0 R>>>>\n/MediaBox [0 0 595 842]\n/Parent 84 0 R>>\nendobj\n`
    ).join('');
    const destEntries = Object.entries(dests).map(([name, page]) => `/${name} [${pageIds[page - 1]} 0 R /XYZ 0 809.13 0]`).join('\n');
    return Buffer.concat([
        Buffer.from('%PDF-1.4\n%\xd3\xeb\xe9\xe1\n1 0 obj\n<</Creator (Chromium)>>\nendobj\n', 'latin1'),
        Buffer.from(pages, 'latin1'),
        // A binary stream that happens to contain "endobj" and an object header.
        Buffer.from('3 0 obj\n<</Filter /FlateDecode\n/Length 30>> stream\n\x9c\x00endobj\n9 0 obj <</Type /Page>>\nendstream\nendobj\n', 'latin1'),
        Buffer.from(
            '84 0 obj\n<</Type /Pages\n/Count 3\n/Kids [2 0 R 10 0 R 27 0 R]\n/Parent 86 0 R>>\nendobj\n' +
            '85 0 obj\n<</Type /Pages\n/Count 2\n/Kids [30 0 R 40 0 R]\n/Parent 86 0 R>>\nendobj\n' +
            '86 0 obj\n<</Type /Pages\n/Count 5\n/Kids [84 0 R 85 0 R]>>\nendobj\n' +
            `87 0 obj\n<<${destEntries}>>\nendobj\n` +
            '88 0 obj\n<</Type /Catalog\n/Pages 86 0 R\n/Dests 87 0 R\n/ViewerPreferences <</Type /ViewerPreferences\n/DisplayDocTitle true>>>>\nendobj\n' +
            'trailer\n<</Root 88 0 R>>\n%%EOF',
            'latin1'
        ),
    ]);
}

describe('pdf-page-refs', () => {

    describe('pdfDestinationPages', () => {
        it('maps each named destination to its page, in page-tree order', () => {
            const pages = pdfDestinationPages(skiaLikePdf({ 'c-1': 3, 'r-1': 4, 'r-2': 5, index: 5 }));
            expect([...pages]).to.deep.equal([['c-1', 3], ['r-1', 4], ['r-2', 5], ['index', 5]]);
        });

        it('decodes #xx escapes in names', () => {
            expect(pdfDestinationPages(skiaLikePdf({ 'caf#C3#A9': 2 })).get('caf\xc3\xa9')).to.equal(2);
        });

        it('returns an empty map for a PDF without destinations or a catalog', () => {
            expect(pdfDestinationPages(Buffer.from('%PDF-1.7')).size).to.equal(0);
            expect(pdfDestinationPages(Buffer.from('1 0 obj\n<</Type /Catalog\n/Pages 2 0 R>>\nendobj\n')).size).to.equal(0);
        });

        it('ignores destinations on pages it cannot find', () => {
            const pdf = Buffer.from(
                '1 0 obj\n<</Type /Catalog\n/Pages 2 0 R\n/Dests <</a [3 0 R /XYZ 0 0 0]\n/b [99 0 R /XYZ 0 0 0]>>>>\nendobj\n' +
                '2 0 obj\n<</Type /Pages\n/Kids [3 0 R]>>\nendobj\n3 0 obj\n<</Type /Page\n/Parent 2 0 R>>\nendobj\n'
            );
            expect([...pdfDestinationPages(pdf)]).to.deep.equal([['a', 1]]);
        });

        it('survives a page tree that refers to itself', () => {
            const pdf = Buffer.from(
                '1 0 obj\n<</Type /Catalog\n/Pages 2 0 R\n/Dests 4 0 R>>\nendobj\n' +
                '2 0 obj\n<</Type /Pages\n/Kids [2 0 R 3 0 R]>>\nendobj\n3 0 obj\n<</Type /Page>>\nendobj\n4 0 obj\n<</a [3 0 R /Fit]>>\nendobj\n'
            );
            expect([...pdfDestinationPages(pdf)]).to.deep.equal([['a', 1]]);
        });
    });

    describe('fillPageRefs', () => {
        it('fills empty references that have a page and leaves the rest', () => {
            const html = '<a href="#r-1">Soup <span data-page-ref="r-1"></span></a><span data-page-ref="r-9"></span>';
            expect(fillPageRefs(html, new Map([['r-1', 7]])))
                .to.equal('<a href="#r-1">Soup <span data-page-ref="r-1">7</span></a><span data-page-ref="r-9"></span>');
        });

        it('only touches the exact empty placeholder form', () => {
            const html = '<span data-page-ref="r-1">x</span><span data-page-ref="r 1"></span><span class="a" data-page-ref="r-1"></span>';
            expect(fillPageRefs(html, new Map([['r-1', 2]]))).to.equal(html);
        });
    });

    describe('hasPageRefs', () => {
        it('detects a placeholder', () => {
            expect(hasPageRefs('<span data-page-ref="toc"></span>')).to.equal(true);
            expect(hasPageRefs('<p>no refs</p>')).to.equal(false);
        });
    });
});
