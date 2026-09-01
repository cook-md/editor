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
import { linkify } from './recipe-links';

describe('linkify', () => {

    it('returns a single text token when there is no link', () => {
        expect(linkify('Simmer for a while.')).to.deep.equal([
            { type: 'text', value: 'Simmer for a while.' },
        ]);
    });

    it('returns an empty array for empty text', () => {
        expect(linkify('')).to.deep.equal([]);
    });

    it('splits text around an http url', () => {
        expect(linkify('See https://cooklang.org/spec now')).to.deep.equal([
            { type: 'text', value: 'See ' },
            { type: 'link', value: 'https://cooklang.org/spec', href: 'https://cooklang.org/spec' },
            { type: 'text', value: ' now' },
        ]);
    });

    it('upgrades a bare www host to https', () => {
        expect(linkify('www.cook.md')).to.deep.equal([
            { type: 'link', value: 'www.cook.md', href: 'https://www.cook.md' },
        ]);
    });

    it('links a bare email address through mailto', () => {
        expect(linkify('ask chef@cook.md')).to.deep.equal([
            { type: 'text', value: 'ask ' },
            { type: 'link', value: 'chef@cook.md', href: 'mailto:chef@cook.md' },
        ]);
    });

    it('keeps an explicit mailto scheme', () => {
        expect(linkify('mailto:chef@cook.md')).to.deep.equal([
            { type: 'link', value: 'mailto:chef@cook.md', href: 'mailto:chef@cook.md' },
        ]);
    });

    it('leaves trailing sentence punctuation outside the link', () => {
        expect(linkify('Source: https://cook.md/x.')).to.deep.equal([
            { type: 'text', value: 'Source: ' },
            { type: 'link', value: 'https://cook.md/x', href: 'https://cook.md/x' },
            { type: 'text', value: '.' },
        ]);
    });

    it('leaves an unbalanced closing paren outside the link', () => {
        expect(linkify('(see https://cook.md/x)')).to.deep.equal([
            { type: 'text', value: '(see ' },
            { type: 'link', value: 'https://cook.md/x', href: 'https://cook.md/x' },
            { type: 'text', value: ')' },
        ]);
    });

    it('keeps a balanced paren inside the link', () => {
        expect(linkify('https://en.wikipedia.org/wiki/Roux_(cooking)')).to.deep.equal([
            {
                type: 'link',
                value: 'https://en.wikipedia.org/wiki/Roux_(cooking)',
                href: 'https://en.wikipedia.org/wiki/Roux_(cooking)',
            },
        ]);
    });

    it('finds several links in one run of text', () => {
        const tokens = linkify('a https://one.example b https://two.example c');
        expect(tokens.filter(t => t.type === 'link').map(t => t.value)).to.deep.equal([
            'https://one.example',
            'https://two.example',
        ]);
        expect(tokens).to.have.length(5);
    });

    it('does not mistake a plain colon or a decimal for a link', () => {
        expect(linkify('Cook: 1.5 hours')).to.deep.equal([
            { type: 'text', value: 'Cook: 1.5 hours' },
        ]);
    });
});
