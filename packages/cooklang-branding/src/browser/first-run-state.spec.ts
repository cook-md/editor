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
import { FirstRunFlags } from './first-run-state';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const m = new Map<string, string>();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; // eslint-disable-line no-null/no-null
}

describe('FirstRunFlags', () => {
    it('starts empty', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.cookbotUsed).to.equal(false);
        expect(flags.reportRendered).to.equal(false);
    });

    it('reports whether a mark was the first one', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.markCookbotUsed()).to.equal(true);
        expect(flags.markCookbotUsed()).to.equal(false);
        expect(flags.cookbotUsed).to.equal(true);
    });

    it('persists across instances', () => {
        const storage = memoryStorage();
        new FirstRunFlags(storage).markReportRendered();
        expect(new FirstRunFlags(storage).reportRendered).to.equal(true);
    });

    it('says first_run exactly once for the welcome page', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.takeFirstWelcome()).to.equal(true);
        expect(flags.takeFirstWelcome()).to.equal(false);
    });
});
