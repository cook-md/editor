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
import * as os from 'os';
import * as path from 'path';
import { loadOrCreateVisitorToken } from './usage-events-service';

describe('loadOrCreateVisitorToken', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-usage-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('creates a UUID once and returns the same one afterwards', () => {
        const file = path.join(dir, 'nested', 'cook-usage.json');
        const first = loadOrCreateVisitorToken(file);
        expect(first).to.match(/^[0-9a-f-]{36}$/);
        expect(loadOrCreateVisitorToken(file)).to.equal(first);
    });

    it('replaces an unreadable file with a fresh token', () => {
        const file = path.join(dir, 'cook-usage.json');
        fs.writeFileSync(file, 'not json');
        expect(loadOrCreateVisitorToken(file)).to.match(/^[0-9a-f-]{36}$/);
    });
});

describe('loadOrCreateVisitorToken with an unwritable location', () => {
    it('returns an in-memory UUID instead of throwing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-usage-'));
        try {
            const blocker = path.join(dir, 'file');
            fs.writeFileSync(blocker, 'x');
            const token = loadOrCreateVisitorToken(path.join(blocker, 'sub', 'cook-usage.json'));
            expect(token).to.match(/^[0-9a-f-]{36}$/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
