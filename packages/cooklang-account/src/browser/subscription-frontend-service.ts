// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { SubscriptionService, SubscriptionState, UpgradeCallbackResult } from '../common/subscription-protocol';
import { AuthContribution } from './auth-contribution';

export const SubscriptionFrontendService = Symbol('SubscriptionFrontendService');

export interface SubscriptionFrontendService {
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined>;
    readonly subscription: SubscriptionState | undefined;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<void>;
    startUpgradeFlow(): Promise<string>;
    awaitUpgradeCallback(): Promise<UpgradeCallbackResult>;
}

@injectable()
export class SubscriptionFrontendServiceImpl implements SubscriptionFrontendService {

    @inject(SubscriptionService)
    protected readonly subscriptionService: SubscriptionService;

    @inject(AuthContribution)
    protected readonly authContribution: AuthContribution;

    private cachedState: SubscriptionState | undefined;

    private readonly onDidChangeSubscriptionEmitter = new Emitter<SubscriptionState | undefined>();
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined> = this.onDidChangeSubscriptionEmitter.event;

    @postConstruct()
    protected init(): void {
        // NOTE: Do NOT subscribe to subscriptionService.onDidChangeSubscription.
        // Events don't work over the simple RpcConnectionHandler.
        // Instead, listen to local auth changes and re-fetch subscription.
        this.authContribution.onDidChangeAuth(async state => {
            if (state.status === 'logged-in') {
                const sub = await this.subscriptionService.getSubscription();
                this.cachedState = sub;
                this.onDidChangeSubscriptionEmitter.fire(sub);
            } else {
                this.cachedState = undefined;
                this.onDidChangeSubscriptionEmitter.fire(undefined);
            }
        });
        this.subscriptionService.getSubscription().then(state => {
            this.cachedState = state;
            this.onDidChangeSubscriptionEmitter.fire(state);
        });
    }

    get subscription(): SubscriptionState | undefined {
        return this.cachedState;
    }

    async hasFeature(name: string): Promise<boolean> {
        return this.subscriptionService.hasFeature(name);
    }

    async refresh(): Promise<void> {
        // Backend events don't cross RPC, so we must re-seed our own cache
        // from the refreshed backend state and fire the frontend emitter.
        const sub = await this.subscriptionService.refresh();
        this.cachedState = sub;
        this.onDidChangeSubscriptionEmitter.fire(sub);
    }

    startUpgradeFlow(): Promise<string> {
        return this.subscriptionService.startUpgradeFlow();
    }

    awaitUpgradeCallback(): Promise<UpgradeCallbackResult> {
        return this.subscriptionService.awaitUpgradeCallback();
    }
}
