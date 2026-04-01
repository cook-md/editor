// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

export const SubscriptionServicePath = '/services/cookmd-subscription';
export const SubscriptionService = Symbol('SubscriptionService');

export interface SubscriptionState {
    status: 'trial' | 'active' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    plan: 'monthly' | 'annual' | undefined;
    expiresAt: string | undefined;
    trialDaysRemaining: number | undefined;
}

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts for why).
 */
export interface SubscriptionService {
    getSubscription(): Promise<SubscriptionState | undefined>;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<void>;
}
