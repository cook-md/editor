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

import { SubscriptionState } from './subscription-protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSubscription(data: any): SubscriptionState {
    return {
        status: data.status ?? 'none',
        hasAccess: data.has_access ?? false,
        features: data.features ?? [],
        planName: data.plan_name ?? undefined,
        aiCreditsRemaining: typeof data.ai_credits_remaining === 'number' ? data.ai_credits_remaining : 0,
        billingPeriodEnd: data.billing_period_end ?? undefined,
        trialEligible: data.trial_eligible !== false,
    };
}
