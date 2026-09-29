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
import { buildAuthUrl, buildUpgradeUrl } from './url-builders';

describe('buildAuthUrl', () => {
    it('keeps the exact format cook.md matches on (unencoded callback, app=editor)', () => {
        expect(buildAuthUrl('https://cook.md', 19285, 'abc'))
            .to.equal('https://cook.md/auth/desktops?callback=http://localhost:19285/callback&state=abc&app=editor');
    });

    it('appends an encoded from= when given', () => {
        expect(buildAuthUrl('https://cook.md', 19285, 'abc', 'cookbot_trial'))
            .to.equal('https://cook.md/auth/desktops?callback=http://localhost:19285/callback&state=abc&app=editor&from=cookbot_trial');
    });
});

describe('buildUpgradeUrl', () => {
    it('points at /pricing with callback and state', () => {
        const url = new URL(buildUpgradeUrl('https://cook.md', 19295, 'st'));
        expect(url.pathname).to.equal('/pricing');
        expect(url.searchParams.get('callback')).to.equal('http://localhost:19295/upgrade-done');
        expect(url.searchParams.get('state')).to.equal('st');
        expect(url.searchParams.has('from')).to.equal(false);
    });

    it('adds from= when given', () => {
        const url = new URL(buildUpgradeUrl('https://staging.cook.md', 19296, 'st', 'editor_cookbot'));
        expect(url.host).to.equal('staging.cook.md');
        expect(url.searchParams.get('from')).to.equal('editor_cookbot');
    });
});
