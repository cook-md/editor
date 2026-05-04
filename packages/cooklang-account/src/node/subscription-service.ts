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

import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { AuthState } from '../common/auth-protocol';
import { AuthServiceBackend } from './auth-service';
import { SubscriptionService, SubscriptionState, UpgradeCallbackResult } from '../common/subscription-protocol';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Start at a different port than auth's callback (19285) so both servers can
// coexist if auth somehow leaves its socket bound.
const UPGRADE_CALLBACK_PORT_START = 19295;
const UPGRADE_CALLBACK_PORT_RETRIES = 10;
const UPGRADE_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — Stripe checkout can take a while

@injectable()
export class SubscriptionServiceImpl implements SubscriptionService {

    @inject(AuthServiceBackend)
    protected readonly authService: AuthServiceBackend;

    private cachedState: SubscriptionState | undefined;
    private cacheTimestamp = 0;

    private upgradeFlow: {
        expectedState: string;
        server: http.Server;
        timeout: ReturnType<typeof setTimeout>;
        resolve: (result: UpgradeCallbackResult) => void;
        reject: (err: Error) => void;
        callbackPromise: Promise<UpgradeCallbackResult>;
    } | undefined;

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

    async refresh(): Promise<SubscriptionState | undefined> {
        await this.fetchSubscription();
        return this.cachedState;
    }

    async startUpgradeFlow(): Promise<string> {
        this.cleanupUpgradeFlow(new Error('Upgrade flow superseded'));

        const expectedState = crypto.randomUUID();
        const server = http.createServer((req, res) => this.handleUpgradeCallback(req, res));
        const port = await this.listenOnAvailablePort(server);

        let resolve!: (result: UpgradeCallbackResult) => void;
        let reject!: (err: Error) => void;
        const callbackPromise = new Promise<UpgradeCallbackResult>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        // Swallow unhandled-rejection warnings if no one ends up awaiting.
        callbackPromise.catch(() => { /* awaited via awaitUpgradeCallback */ });

        const timeout = setTimeout(() => {
            this.cleanupUpgradeFlow(new Error('Upgrade flow timed out'));
        }, UPGRADE_CALLBACK_TIMEOUT_MS);

        this.upgradeFlow = { expectedState, server, timeout, resolve, reject, callbackPromise };

        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const url = new URL('/pricing', webBaseUrl);
        url.searchParams.set('callback', `http://localhost:${port}/upgrade-done`);
        url.searchParams.set('state', expectedState);
        return url.toString();
    }

    async awaitUpgradeCallback(): Promise<UpgradeCallbackResult> {
        if (!this.upgradeFlow) {
            throw new Error('No upgrade flow in progress');
        }
        return this.upgradeFlow.callbackPromise;
    }

    private handleUpgradeCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
        const flow = this.upgradeFlow;
        const url = new URL(req.url || '/', 'http://localhost');

        if (url.pathname !== '/upgrade-done' || !flow) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const receivedState = url.searchParams.get('state');
        if (receivedState !== flow.expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(this.upgradeResultHtml('Error', 'State mismatch. Please try again from the editor.'));
            this.cleanupUpgradeFlow(new Error('State mismatch on upgrade callback'));
            return;
        }

        const status = url.searchParams.get('status');
        const result: UpgradeCallbackResult | undefined =
            status === 'ok' ? { status: 'ok' } :
            status === 'cancelled' ? { status: 'cancelled' } :
            undefined;

        if (!result) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(this.upgradeResultHtml('Error', 'Unexpected status returned. You can close this tab.'));
            this.cleanupUpgradeFlow(new Error(`Unexpected upgrade status: ${status}`));
            return;
        }

        const resolve = flow.resolve;

        // Refresh the backend cache before resolving so the frontend can read
        // the fresh state immediately after awaitUpgradeCallback returns.
        const finish = (): void => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            const heading = result.status === 'ok' ? 'Upgrade complete!' : 'Checkout cancelled';
            const body = result.status === 'ok'
                ? 'You can close this tab and return to the editor.'
                : 'No changes were made. You can close this tab and return to the editor.';
            res.end(this.upgradeResultHtml(heading, body));
            this.teardownUpgradeFlow();
            resolve(result);
        };

        if (result.status === 'ok') {
            this.fetchSubscription().finally(finish);
        } else {
            finish();
        }
    }

    private upgradeResultHtml(heading: string, body: string): string {
        const style = `body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    background: #f5f0eb;
    color: #333;
}
.container { text-align: center; }
h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
p { color: #666; }`;
        return `<html><head><style>${style}</style></head>`
            + `<body><div class="container"><h1>${heading}</h1><p>${body}</p></div></body></html>`;
    }

    private listenOnAvailablePort(server: http.Server): Promise<number> {
        return new Promise((resolve, reject) => {
            let attempt = 0;

            const tryPort = (port: number): void => {
                const onError = (err: NodeJS.ErrnoException): void => {
                    server.removeListener('error', onError);
                    if (err.code === 'EADDRINUSE' && attempt < UPGRADE_CALLBACK_PORT_RETRIES) {
                        attempt++;
                        tryPort(port + 1);
                    } else {
                        reject(new Error(`Failed to start upgrade callback server: ${err.message}`));
                    }
                };

                server.once('error', onError);
                server.listen(port, '127.0.0.1', () => {
                    server.removeListener('error', onError);
                    resolve(port);
                });
            };

            tryPort(UPGRADE_CALLBACK_PORT_START);
        });
    }

    private teardownUpgradeFlow(): void {
        if (!this.upgradeFlow) {
            return;
        }
        clearTimeout(this.upgradeFlow.timeout);
        this.upgradeFlow.server.close();
        this.upgradeFlow = undefined;
    }

    private cleanupUpgradeFlow(error: Error): void {
        const flow = this.upgradeFlow;
        if (!flow) {
            return;
        }
        this.teardownUpgradeFlow();
        flow.reject(error);
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-in') {
            await this.fetchSubscription();
        } else {
            this.cachedState = undefined;
            this.cacheTimestamp = 0;
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
                planName: data.plan_name ?? undefined,
                aiCreditsRemaining: typeof data.ai_credits_remaining === 'number' ? data.ai_credits_remaining : 0,
                billingPeriodEnd: data.billing_period_end ?? undefined,
            };
            this.cacheTimestamp = Date.now();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('status 401') || message.includes('status 403')) {
                console.warn('Subscription fetch returned auth error, clearing session');
                await this.authService.logout();
            } else {
                console.warn('Failed to fetch subscription:', message);
            }
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
