// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import * as http from 'http';
import * as https from 'https';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { AuthState } from '../common/auth-protocol';
import { AuthServiceBackend } from './auth-service';
import { SubscriptionService, SubscriptionState } from '../common/subscription-protocol';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@injectable()
export class SubscriptionServiceImpl implements SubscriptionService {

    @inject(AuthServiceBackend)
    protected readonly authService: AuthServiceBackend;

    private cachedState: SubscriptionState | undefined;
    private cacheTimestamp = 0;

    private readonly onDidChangeSubscriptionEmitter = new Emitter<SubscriptionState | undefined>();
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined> = this.onDidChangeSubscriptionEmitter.event;

    @postConstruct()
    protected init(): void {
        this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
    }

    async getSubscription(): Promise<SubscriptionState | undefined> {
        if (this.cachedState && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
            return this.cachedState;
        }
        await this.fetchSubscription();
        return this.cachedState;
    }

    async hasFeature(name: string): Promise<boolean> {
        const sub = await this.getSubscription();
        return sub?.features.includes(name) ?? false;
    }

    async refresh(): Promise<void> {
        await this.fetchSubscription();
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-in') {
            await this.fetchSubscription();
        } else {
            this.cachedState = undefined;
            this.cacheTimestamp = 0;
            this.onDidChangeSubscriptionEmitter.fire(undefined);
        }
    }

    private async fetchSubscription(): Promise<void> {
        const token = await this.authService.getToken();
        if (!token) {
            this.cachedState = undefined;
            this.cacheTimestamp = 0;
            return;
        }
        try {
            const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
            const url = new URL('/api/subscription', webBaseUrl);
            const response = await this.httpGet(url, token);
            const data = JSON.parse(response);
            this.cachedState = {
                status: data.status ?? 'none',
                hasAccess: data.has_access ?? false,
                features: data.features ?? [],
                plan: data.plan ?? undefined,
                expiresAt: data.expires_at ?? undefined,
                trialDaysRemaining: data.trial_days_remaining ?? undefined,
            };
            this.cacheTimestamp = Date.now();
            this.onDidChangeSubscriptionEmitter.fire(this.cachedState);
        } catch (err) {
            console.warn('Failed to fetch subscription:', err);
        }
    }

    private httpGet(url: URL, bearerToken: string): Promise<string> {
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${bearerToken}`,
                    'Accept': 'application/json',
                },
            }, (res: http.IncomingMessage) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(body);
                    } else {
                        reject(new Error(`Subscription request failed with status ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }
}
