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
import { CookbotUsageStats } from '@theia/cooklang-ai/lib/common';
import { computeQuotaBannerState } from './cookbot-quota-banner-state';

function usage(overrides: Partial<CookbotUsageStats> = {}): CookbotUsageStats {
    return {
        inputTokensUsed: 0,
        outputTokensUsed: 0,
        tokenLimit: 1_000_000,
        billingPeriodEnd: '2026-09-01T00:00:00Z',
        ...overrides,
    };
}

describe('computeQuotaBannerState', () => {

    it('is hidden when usage is unavailable', () => {
        expect(computeQuotaBannerState(undefined)).to.equal(undefined);
    });

    it('is hidden when the limit is missing or zero', () => {
        expect(computeQuotaBannerState(usage({ tokenLimit: 0, inputTokensUsed: 999 }))).to.equal(undefined);
    });

    it('is hidden below the warning threshold', () => {
        expect(computeQuotaBannerState(usage({ inputTokensUsed: 700_000, outputTokensUsed: 99_999 }))).to.equal(undefined);
    });

    it('warns from exactly 80%, counting input and output tokens together', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 700_000, outputTokensUsed: 100_000 }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 80, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('reports whole percent, rounded down, and passes the reset date through', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 876_543 }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 87, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('is exhausted at exactly 100%', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 1_000_000 }));
        expect(state?.level).to.equal('exhausted');
        expect(state?.percentUsed).to.equal(100);
    });

    it('caps the reported percent at 100 when over the limit', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 1_500_000 }));
        expect(state).to.deep.equal({ level: 'exhausted', percentUsed: 100, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('omits the reset date when the server did not send one', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 900_000, billingPeriodEnd: undefined }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 90, resetsOn: undefined });
    });
});
