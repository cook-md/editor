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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import * as React from 'react';
import { AccountWidget } from './account-widget';
import { SubscriptionState } from '../common/subscription-protocol';
import { SyncStatus } from '../common/sync-protocol';

after(() => disableJSDOM());

/** Recursively collects every React element in `node` matching `predicate`. */
function collect(node: React.ReactNode, predicate: (el: React.ReactElement) => boolean, out: React.ReactElement[] = []): React.ReactElement[] {
    // eslint-disable-next-line no-null/no-null
    if (node === null || node === undefined || typeof node !== 'object') {
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach(child => collect(child, predicate, out));
        return out;
    }
    if (React.isValidElement(node)) {
        if (predicate(node)) {
            out.push(node);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const children = (node.props as any)?.children;
        if (children !== undefined) {
            collect(children, predicate, out);
        }
    }
    return out;
}

/** Flattens all text content under `node` (mirrors what a viewer would read). */
function textContent(node: React.ReactNode): string {
    // eslint-disable-next-line no-null/no-null
    if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
    }
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(textContent).join('');
    }
    if (React.isValidElement(node)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return textContent((node.props as any)?.children);
    }
    return '';
}

function makeSubscription(features: string[]): SubscriptionState {
    return {
        status: 'active',
        hasAccess: true,
        features,
        planName: 'Cook Pro',
        aiCreditsRemaining: 100,
        billingPeriodEnd: undefined,
    };
}

function createWidget(syncStatus: SyncStatus): AccountWidget {
    const widget = new AccountWidget();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (widget as any).syncStatus = syncStatus;
    return widget;
}

function renderSyncSection(widget: AccountWidget, subscription: SubscriptionState): React.ReactNode {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (widget as any).renderSyncSection(subscription, 'Idle');
}

const IDLE_STATUS: SyncStatus = { status: 'idle', lastSyncedAt: undefined, error: undefined };

describe('AccountWidget sync section gating', () => {

    it('renders the live toggle unchanged when the plan includes sync', () => {
        const widget = createWidget(IDLE_STATUS);
        const tree = renderSyncSection(widget, makeSubscription(['sync', 'ai']));

        expect(collect(tree, el => el.props.className === 'theia-account-sync-toggle')).to.have.length(1);
        expect(textContent(tree)).to.not.include('Cook Basic');
        expect(textContent(tree)).to.not.include('Sync needs a plan');
    });

    it('locks the section behind an Upgrade button when the plan lacks sync', () => {
        const widget = createWidget(IDLE_STATUS);
        const tree = renderSyncSection(widget, makeSubscription([]));

        expect(collect(tree, el => el.props.className === 'theia-account-sync-toggle')).to.have.length(0);
        expect(textContent(tree)).to.include('Sync runs on our servers');
        expect(textContent(tree)).to.include('Cook Basic');

        const buttons = collect(tree, el => el.type === 'button');
        expect(buttons).to.have.length(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(buttons[0].props.onClick).to.equal((widget as any).handleUpgrade);
    });

    it('shows "Sync needs a plan" (not the generic error row) when the native status is payment_required, even though the plan lists sync', () => {
        const widget = createWidget({ status: 'payment_required', lastSyncedAt: undefined, error: 'raw sync error text' });
        const tree = renderSyncSection(widget, makeSubscription(['sync']));

        expect(collect(tree, el => el.props.className === 'theia-account-sync-toggle')).to.have.length(0);
        expect(textContent(tree)).to.include('Sync needs a plan');
        expect(textContent(tree)).to.not.include('raw sync error text');

        const buttons = collect(tree, el => el.type === 'button');
        expect(buttons).to.have.length(2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(buttons[0].props.onClick).to.equal((widget as any).handleUpgrade);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(buttons[1].props.onClick).to.equal((widget as any).restartSync);
    });

    it('prefers the locked-plan view over payment_required when both apply', () => {
        // features lacks 'sync' AND the runtime status is payment_required —
        // the plan gate should win since there is nothing to "need a plan"
        // for beyond what upgrading already offers.
        const widget = createWidget({ status: 'payment_required', lastSyncedAt: undefined, error: undefined });
        const tree = renderSyncSection(widget, makeSubscription([]));

        expect(textContent(tree)).to.include('Cook Basic');
    });
});

describe('AccountWidget upgrade flow reuse', () => {

    class FakeSubscriptionFrontendService {
        startUpgradeFlowCalls = 0;
        refreshCalls = 0;
        awaitResult: { status: 'ok' | 'cancelled' } = { status: 'ok' };
        async startUpgradeFlow(): Promise<string> {
            this.startUpgradeFlowCalls++;
            return 'https://cook.md/pricing?callback=...';
        }
        async awaitUpgradeCallback(): Promise<{ status: 'ok' | 'cancelled' }> {
            return this.awaitResult;
        }
        async refresh(): Promise<void> {
            this.refreshCalls++;
        }
    }

    class FakeWindowService {
        openedUrls: string[] = [];
        openNewWindow(url: string): void {
            this.openedUrls.push(url);
        }
    }

    class FakeSyncService {
        enableSyncCalls = 0;
        status: SyncStatus = { status: 'idle', lastSyncedAt: undefined, error: undefined };
        async enableSync(): Promise<void> {
            this.enableSyncCalls++;
            this.status = { status: 'idle', lastSyncedAt: undefined, error: undefined };
        }
        async disableSync(): Promise<void> { /* unused in these tests */ }
        async isSyncEnabled(): Promise<boolean> {
            return true;
        }
        async getSyncStatus(): Promise<SyncStatus> {
            return this.status;
        }
    }

    it('the locked sync section\'s Upgrade button drives the same startUpgradeFlow/refresh cycle as the AI upgrade CTA', async () => {
        const widget = createWidget(IDLE_STATUS);
        const subscriptionFrontendService = new FakeSubscriptionFrontendService();
        const windowService = new FakeWindowService();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).subscriptionFrontendService = subscriptionFrontendService;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).windowService = windowService;

        const tree = renderSyncSection(widget, makeSubscription([]));
        const [button] = collect(tree, el => el.type === 'button');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (button.props as any).onClick();

        expect(subscriptionFrontendService.startUpgradeFlowCalls).to.equal(1);
        expect(windowService.openedUrls).to.have.length(1);
        expect(subscriptionFrontendService.refreshCalls).to.equal(1);
    });

    it('restarts native sync after an upgrade resolves a payment_required state (post-payment dead-end fix)', async () => {
        const widget = createWidget({ status: 'payment_required', lastSyncedAt: undefined, error: undefined });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).syncEnabled = true;
        const subscriptionFrontendService = new FakeSubscriptionFrontendService();
        const windowService = new FakeWindowService();
        const syncService = new FakeSyncService();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).subscriptionFrontendService = subscriptionFrontendService;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).windowService = windowService;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).syncService = syncService;

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (widget as any).handleUpgrade();

            expect(subscriptionFrontendService.refreshCalls).to.equal(1);
            expect(syncService.enableSyncCalls).to.equal(
                1,
                'resolving payment_required must restart the native sync task, not just refresh subscription features'
            );
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (widget as any).stopSyncPolling();
        }
    });

    it('does not restart sync on a plain upgrade that was never payment_required', async () => {
        const widget = createWidget(IDLE_STATUS);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).syncEnabled = true;
        const subscriptionFrontendService = new FakeSubscriptionFrontendService();
        const windowService = new FakeWindowService();
        const syncService = new FakeSyncService();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).subscriptionFrontendService = subscriptionFrontendService;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).windowService = windowService;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).syncService = syncService;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (widget as any).handleUpgrade();

        expect(subscriptionFrontendService.refreshCalls).to.equal(1);
        expect(syncService.enableSyncCalls).to.equal(0);
    });

    it('the "Retry sync" button in the needs-plan view restarts sync directly, for a payment made outside the in-app flow', async () => {
        const widget = createWidget({ status: 'payment_required', lastSyncedAt: undefined, error: undefined });
        const syncService = new FakeSyncService();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (widget as any).syncService = syncService;

        const tree = renderSyncSection(widget, makeSubscription(['sync']));
        const buttons = collect(tree, el => el.type === 'button');
        expect(buttons).to.have.length(2);
        const retryButton = buttons[1];

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (retryButton.props as any).onClick();

            expect(syncService.enableSyncCalls).to.equal(1);
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (widget as any).stopSyncPolling();
        }
    });
});
