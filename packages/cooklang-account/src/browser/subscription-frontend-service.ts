// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { SubscriptionService, SubscriptionState } from '../common/subscription-protocol';

export const SubscriptionFrontendService = Symbol('SubscriptionFrontendService');

@injectable()
export class SubscriptionFrontendServiceImpl {

    @inject(SubscriptionService)
    protected readonly subscriptionService: SubscriptionService;

    private cachedState: SubscriptionState | undefined;

    private readonly onDidChangeSubscriptionEmitter = new Emitter<SubscriptionState | undefined>();
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined> = this.onDidChangeSubscriptionEmitter.event;

    @postConstruct()
    protected init(): void {
        this.subscriptionService.onDidChangeSubscription(state => {
            this.cachedState = state;
            this.onDidChangeSubscriptionEmitter.fire(state);
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
        return this.subscriptionService.refresh();
    }
}
