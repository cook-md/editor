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
import { parseSubscription } from './parse-subscription';

describe('parseSubscription', () => {
    it('maps the Rails keys', () => {
        const state = parseSubscription({
            status: 'active', has_access: true, features: ['ai', 'sync'], plan_name: 'Cook Pro',
            ai_credits_remaining: 12, billing_period_end: '2026-10-01', trial_eligible: false,
        });
        expect(state).to.deep.equal({
            status: 'active', hasAccess: true, features: ['ai', 'sync'], planName: 'Cook Pro',
            aiCreditsRemaining: 12, billingPeriodEnd: '2026-10-01', trialEligible: false,
        });
    });

    it('treats a missing trial_eligible as eligible (server not yet deployed)', () => {
        expect(parseSubscription({ status: 'none' }).trialEligible).to.equal(true);
    });

    it('defaults everything else safely', () => {
        expect(parseSubscription({})).to.deep.equal({
            status: 'none', hasAccess: false, features: [], planName: undefined,
            aiCreditsRemaining: 0, billingPeriodEnd: undefined, trialEligible: true,
        });
    });
});
