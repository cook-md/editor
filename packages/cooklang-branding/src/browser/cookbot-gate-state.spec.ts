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
import { computeCookbotGate, decideTrialContinuation } from './cookbot-gate-state';

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

describe('decideTrialContinuation', () => {
    const base = { pending: true, loggedIn: true, subscriptionKnown: true, hasAi: false };
    it('does nothing when the user did not choose the trial', () => {
        expect(decideTrialContinuation({ ...base, pending: false })).to.equal('none');
    });
    it('waits while still signed out', () => {
        expect(decideTrialContinuation({ ...base, loggedIn: false })).to.equal('wait');
    });
    it('waits until the subscription has loaded after login', () => {
        expect(decideTrialContinuation({ ...base, subscriptionKnown: false })).to.equal('wait');
    });
    it('starts checkout for a signed-in user without Cook Pro', () => {
        expect(decideTrialContinuation(base)).to.equal('start');
    });
    it('drops the request when the account already has Cook Pro', () => {
        expect(decideTrialContinuation({ ...base, hasAi: true })).to.equal('drop');
    });
});
