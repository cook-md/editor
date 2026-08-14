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
