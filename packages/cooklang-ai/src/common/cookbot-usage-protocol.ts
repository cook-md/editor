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

export const CookbotUsagePath = '/services/cookbot-usage';
export const CookbotUsageService = Symbol('CookbotUsageService');

/**
 * Cookbot AI usage for the current billing cycle, as reported by the
 * cookbot server's GetUsage RPC.
 */
export interface CookbotUsageStats {
    inputTokensUsed: number;
    outputTokensUsed: number;
    tokenLimit: number;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    subscriptionTier?: string;
}

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts in
 * cooklang-account for why). Remote service: interface + symbol on purpose.
 *
 * `getUsage` resolves to `undefined` on ANY failure (not logged in, session
 * init failed, gRPC error): a quota warning must never itself become a
 * source of user-visible errors.
 */
export interface CookbotUsageService {
    getUsage(): Promise<CookbotUsageStats | undefined>;
}
