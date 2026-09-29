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
import { computeCookbotGate } from './cookbot-gate-state';

describe('computeCookbotGate', () => {
    it('asks a signed-out user to sign in', () => {
        expect(computeCookbotGate({ loggedIn: false, hasAi: false, trialEligible: true })).to.equal('signed_out');
    });
    it('offers the trial to a signed-in, eligible free user', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: false, trialEligible: true })).to.equal('trial');
    });
    it('offers an upgrade once the trial is used', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: false, trialEligible: false })).to.equal('upgrade');
    });
    it('opens for Cook Pro', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: true, trialEligible: false })).to.equal('open');
    });
});
