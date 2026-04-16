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

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts for why).
 */
export interface SubscriptionService {
    getSubscription(): Promise<SubscriptionState | undefined>;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<void>;
}
