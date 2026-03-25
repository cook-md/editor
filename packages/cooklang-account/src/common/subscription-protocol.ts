import { Event } from '@theia/core/lib/common';

export const SubscriptionServicePath = '/services/cookmd-subscription';
export const SubscriptionService = Symbol('SubscriptionService');

export interface SubscriptionState {
    status: 'trial' | 'active' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    plan: 'monthly' | 'annual' | null;
    expiresAt: string | null;
    trialDaysRemaining: number | null;
}

export interface SubscriptionService {
    getSubscription(): Promise<SubscriptionState | undefined>;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<void>;
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined>;
}
