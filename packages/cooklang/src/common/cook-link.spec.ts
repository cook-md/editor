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
import * as fs from 'fs';
import * as path from 'path';
import { parseCookLink, CookLink } from './cook-link';

interface CorpusCase {
    url: string;
    note?: string;
    expect: Record<string, string | null>;
}

/** `__dirname` is `lib/common` once compiled, so the corpus sits two levels up. */
const corpusPath = path.join(__dirname, '..', '..', 'deeplinks.json');
const corpus: { cases: CorpusCase[] } = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

function expected(e: Record<string, string | null>): CookLink {
    switch (e.route) {
        case 'my':
            return { route: 'my', path: e.path ?? '', mode: (e.mode as 'cooking' | null) ?? undefined, timer: e.timer ?? undefined };
        case 'timer':
            return { route: 'timer', id: e.id ?? undefined };
        case 'clip':
            return { route: 'clip', url: e.url ?? undefined, batch: e.batch ?? undefined };
        case 'share':
            return { route: 'share', token: e.token ?? '' };
        case 'unsupported':
            return { route: 'unsupported', namespace: e.namespace ?? '' };
        case 'invalid':
            return { route: 'invalid', reason: e.reason ?? 'unparseable' };
        default:
            throw new Error(`Unknown corpus route: ${e.route}`);
    }
}

describe('parseCookLink (golden corpus)', () => {
    it('has a non-empty corpus', () => {
        expect(corpus.cases.length).to.be.greaterThan(0);
    });

    for (const testCase of corpus.cases) {
        it(`${testCase.url}${testCase.note ? ` — ${testCase.note}` : ''}`, () => {
            expect(parseCookLink(testCase.url)).to.deep.equal(expected(testCase.expect));
        });
    }
});
