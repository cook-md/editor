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

export const SubscriptionServicePath = '/services/cooked-subscription';
export const SubscriptionService = Symbol('SubscriptionService');

export interface SubscriptionState {
    status: 'active' | 'past_due' | 'expired' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    planName: string | undefined;
    aiCreditsRemaining: number;
    billingPeriodEnd: string | undefined;
}

export interface UpgradeCallbackResult {
    status: 'ok' | 'cancelled';
}

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts for why).
 */
export interface SubscriptionService {
    getSubscription(): Promise<SubscriptionState | undefined>;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<SubscriptionState | undefined>;

    /**
     * Start an upgrade (purchase) flow. Spins up a local HTTP callback server
     * and returns the URL the user should open in their browser. The URL
     * carries a `callback` and `state` param; when the user completes or
     * cancels checkout on the web, the web redirects to the callback with
     * `status=ok|cancelled` and matching `state`.
     *
     * Frontends should call `awaitUpgradeCallback()` after opening the URL.
     */
    startUpgradeFlow(): Promise<string>;

    /**
     * Resolves when the callback server receives a valid redirect (matching
     * state) from the web. On `ok`, the backend subscription cache is already
     * refreshed by the time the promise resolves. Rejects on timeout, state
     * mismatch, or if no flow is in progress.
     */
    awaitUpgradeCallback(): Promise<UpgradeCallbackResult>;
}
