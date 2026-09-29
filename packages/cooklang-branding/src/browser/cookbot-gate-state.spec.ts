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
import { computeCookbotGate, decideTrialContinuation, isTrialRequestPending, TRIAL_CONTINUATION_TTL_MS } from './cookbot-gate-state';

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
    it('waits for the plan while the subscription is unknown after login', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: false, trialEligible: undefined })).to.equal('loading');
    });
    it('falls back to the trial offer once the plan could not be loaded', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: false, trialEligible: undefined, planUnavailable: true })).to.equal('plan_unknown');
    });
    it('uses the real plan as soon as it arrives, even after the fallback', () => {
        expect(computeCookbotGate({ loggedIn: true, hasAi: false, trialEligible: false, planUnavailable: true })).to.equal('upgrade');
        expect(computeCookbotGate({ loggedIn: true, hasAi: true, trialEligible: undefined, planUnavailable: true })).to.equal('open');
    });
    it('still asks a signed-out user to sign in when the subscription is unknown', () => {
        expect(computeCookbotGate({ loggedIn: false, hasAi: false, trialEligible: undefined })).to.equal('signed_out');
    });
});

describe('isTrialRequestPending', () => {
    const now = 1_000_000_000;
    it('is not pending without a request', () => {
        expect(isTrialRequestPending(undefined, now)).to.equal(false);
    });
    it('is pending within the time limit', () => {
        expect(isTrialRequestPending(now - TRIAL_CONTINUATION_TTL_MS + 1, now)).to.equal(true);
    });
    it('expires after the time limit', () => {
        expect(isTrialRequestPending(now - TRIAL_CONTINUATION_TTL_MS, now)).to.equal(false);
    });
});

describe('decideTrialContinuation', () => {
    const now = 1_000_000_000;
    const base = { requestedAt: now - 1000, now, loggedIn: true, hasAi: false, trialEligible: true as boolean | undefined };
    it('does nothing when the user did not choose the trial', () => {
        expect(decideTrialContinuation({ ...base, requestedAt: undefined })).to.equal('none');
    });
    it('does nothing once the request has expired', () => {
        expect(decideTrialContinuation({ ...base, requestedAt: now - TRIAL_CONTINUATION_TTL_MS - 1 })).to.equal('none');
    });
    it('waits while still signed out', () => {
        expect(decideTrialContinuation({ ...base, loggedIn: false })).to.equal('wait');
    });
    it('waits until the subscription has loaded after login', () => {
        expect(decideTrialContinuation({ ...base, trialEligible: undefined })).to.equal('wait');
    });
    it('starts checkout for a signed-in, trial-eligible user without Cook Pro', () => {
        expect(decideTrialContinuation(base)).to.equal('start');
    });
    it('drops the request when the account already has Cook Pro', () => {
        expect(decideTrialContinuation({ ...base, hasAi: true })).to.equal('drop');
    });
    it('drops the request when the trial was already used, leaving the upgrade gate', () => {
        expect(decideTrialContinuation({ ...base, trialEligible: false })).to.equal('drop');
    });
});
