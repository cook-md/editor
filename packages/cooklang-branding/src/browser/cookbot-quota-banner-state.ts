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

import { CookbotUsageStats } from '@theia/cooklang-ai/lib/common';

/**
 * Mirrors USAGE_WARNING_THRESHOLD_PERCENT in the cookbot server's
 * chat_service.rs, so client warning and server logging stay consistent.
 */
export const QUOTA_WARNING_THRESHOLD = 0.8;

/**
 * What the chat quota banner should show. `undefined` means: show nothing.
 * Kept free of widget and localization concerns so it stays unit-testable
 * in a monaco-free spec.
 */
export interface CookbotQuotaBannerState {
    level: 'warning' | 'exhausted';
    /** Whole percent of the allowance used, rounded down, capped at 100. */
    percentUsed: number;
    /** ISO date the cycle resets (billing_period_end), when the server sent one. */
    resetsOn: string | undefined;
}

export function computeQuotaBannerState(usage: CookbotUsageStats | undefined): CookbotQuotaBannerState | undefined {
    if (!usage || usage.tokenLimit <= 0) {
        return undefined;
    }
    const fraction = (usage.inputTokensUsed + usage.outputTokensUsed) / usage.tokenLimit;
    if (fraction < QUOTA_WARNING_THRESHOLD) {
        return undefined;
    }
    return {
        level: fraction >= 1 ? 'exhausted' : 'warning',
        percentUsed: Math.min(100, Math.floor(fraction * 100)),
        resetsOn: usage.billingPeriodEnd,
    };
}

/**
 * Share of the cycle one exchange has to use before it is worth a line in the
 * chat. 3% is roughly one ordinary CookBot conversation: below that the note
 * would appear after every message and stop being read.
 */
export const EXCHANGE_COST_NOTICE_THRESHOLD = 0.03;

/** What one chat exchange cost, in whole percent of the cycle's allowance. */
export interface CookbotExchangeCost {
    percentOfCycle: number;
    /** Rounded down, never negative. */
    percentLeft: number;
}

/**
 * The cost of the exchange between two usage readings, or `undefined` when it
 * is not worth mentioning or cannot be known.
 *
 * The 80% banner only speaks up once most of the allowance is gone. A single
 * bulk request can use a fifth of a month, and nothing said so until it was
 * too late to stop.
 */
export function computeExchangeCost(
    before: CookbotUsageStats | undefined,
    after: CookbotUsageStats | undefined,
): CookbotExchangeCost | undefined {
    if (!before || !after || after.tokenLimit <= 0) {
        return undefined;
    }
    // A new cycle restarts the counter; the difference means nothing.
    if (before.billingPeriodStart !== after.billingPeriodStart) {
        return undefined;
    }
    const usedBefore = before.inputTokensUsed + before.outputTokensUsed;
    const usedAfter = after.inputTokensUsed + after.outputTokensUsed;
    const fraction = (usedAfter - usedBefore) / after.tokenLimit;
    if (fraction < EXCHANGE_COST_NOTICE_THRESHOLD) {
        return undefined;
    }
    return {
        percentOfCycle: Math.round(fraction * 100),
        percentLeft: Math.max(0, Math.floor((1 - usedAfter / after.tokenLimit) * 100)),
    };
}
