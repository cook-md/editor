// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

export const SubscriptionServicePath = '/services/cooked-subscription';
export const SubscriptionService = Symbol('SubscriptionService');

export interface SubscriptionState {
    status: 'trial' | 'active' | 'past_due' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    planSlug: string | undefined;
    planName: string | undefined;
    tokensRemaining: number;
    expiresAt: string | undefined;
    trialDaysRemaining: number | undefined;
    trialAvailable: boolean;
    billingPeriodStart: string | undefined;
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
