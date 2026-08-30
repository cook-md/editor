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

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common';
import { SyncServiceImpl } from './sync-service';
import { SyncStatus } from '../common/sync-protocol';
import { AuthState } from '../common/auth-protocol';

/** Stands in for the `@theia/cooklang-native` addon without requiring a build. */
class FakeNativeModule {
    callback: ((json: string) => void) | undefined;
    startCalls: Array<{ recipesDir: string; dbPath: string; endpoint: string; token: string; namespaceId: number }> = [];
    stopCalls = 0;
    failNextStart = false;
    onSyncStatusChanged(cb: (json: string) => void): void {
        this.callback = cb;
    }
    startSync(recipesDir: string, dbPath: string, endpoint: string, token: string, namespaceId: number): void {
        if (this.failNextStart) {
            this.failNextStart = false;
            throw new Error('native boom');
        }
        this.startCalls.push({ recipesDir, dbPath, endpoint, token, namespaceId });
    }
    stopSync(): void {
        this.stopCalls++;
    }
}

class FakeAuthService {
    logoutCalls = 0;
    token: string | undefined = undefined;

    private readonly onDidChangeAuthEmitter = new Emitter<AuthState>();
    readonly onDidChangeAuth = this.onDidChangeAuthEmitter.event;

    private readonly onDidRenewTokenEmitter = new Emitter<string>();
    readonly onDidRenewToken = this.onDidRenewTokenEmitter.event;

    async logout(): Promise<void> {
        this.logoutCalls++;
    }
    async getToken(): Promise<string | undefined> {
        return this.token;
    }
    fireRenewal(token: string): void {
        this.token = token;
        this.onDidRenewTokenEmitter.fire(token);
    }
}

class FakeWorkspaceServer {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private pendingLookup: { promise: Promise<string | undefined>; resolve: (v: string | undefined) => void } | undefined;

    async getMostRecentlyUsedWorkspace(): Promise<string | undefined> {
        if (this.pendingLookup) {
            return this.pendingLookup.promise;
        }
        return 'file:///workspace';
    }

    /** Makes the NEXT (or currently in-flight) lookup hang until `unblockLookup()` is called. */
    blockNextLookup(): void {
        let resolve!: (v: string | undefined) => void;
        const promise = new Promise<string | undefined>(res => { resolve = res; });
        this.pendingLookup = { promise, resolve };
    }

    unblockLookup(): void {
        this.pendingLookup?.resolve('file:///workspace');
        this.pendingLookup = undefined;
    }
}

/** Builds a fake JWT carrying `{ uid }` in its payload — enough for `extractUserId`. */
function fakeToken(uid: number, salt: string): string {
    const payload = Buffer.from(JSON.stringify({ uid })).toString('base64url');
    return `header.${payload}.${salt}`;
}

function createService(): { service: SyncServiceImpl; native: FakeNativeModule; auth: FakeAuthService } {
    const service = new SyncServiceImpl();
    const native = new FakeNativeModule();
    const auth = new FakeAuthService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).nativeModule = native;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).authService = auth;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).workspaceServer = new FakeWorkspaceServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).syncEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).registerNativeCallback();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).registerAuthListeners();
    return { service, native, auth };
}

describe('SyncServiceImpl native status passthrough', () => {

    it('passes a payment_required status straight through to onDidChangeSyncStatus', () => {
        const { service, native } = createService();
        const events: SyncStatus[] = [];
        service.onDidChangeSyncStatus(status => events.push(status));

        // eslint-disable-next-line no-null/no-null
        native.callback!(JSON.stringify({ status: 'payment_required', lastError: null, lastSynced: null }));

        expect(events).to.have.length(1);
        expect(events[0]).to.deep.equal({ status: 'payment_required', lastSyncedAt: undefined, error: undefined });
    });

    it('never logs out in response to any sync status, including payment_required and error', async () => {
        const { native, auth } = createService();
        for (const status of ['error', 'payment_required', 'idle', 'syncing']) {
            // eslint-disable-next-line no-null/no-null
            native.callback!(JSON.stringify({ status, lastError: 'boom', lastSynced: null }));
        }
        expect(auth.logoutCalls).to.equal(0);
    });
});

describe('SyncServiceImpl token renewal', () => {

    it('restarts the running native sync task with the fresh token on renewal', async () => {
        const { service, native, auth } = createService();
        const tokenA = fakeToken(1, 'a');
        auth.token = tokenA;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).startSyncIfReady();
        expect(native.startCalls).to.have.length(1);
        expect(native.startCalls[0].token).to.equal(tokenA);

        const tokenB = fakeToken(1, 'b');
        auth.fireRenewal(tokenB);
        // handleTokenRenewed is fire-and-forget from the Emitter — let its promise settle.
        await new Promise(resolve => setImmediate(resolve));

        expect(native.stopCalls).to.equal(1);
        expect(native.startCalls).to.have.length(2);
        expect(native.startCalls[1].token).to.equal(tokenB);
        // Everything else about the restarted task matches the original.
        expect(native.startCalls[1].recipesDir).to.equal(native.startCalls[0].recipesDir);
        expect(native.startCalls[1].namespaceId).to.equal(native.startCalls[0].namespaceId);
        expect(native.startCalls[1].endpoint).to.equal(native.startCalls[0].endpoint);
        expect(native.startCalls[1].dbPath).to.equal(native.startCalls[0].dbPath);
    });

    it('no-ops when the renewed token is unchanged', async () => {
        const { service, native, auth } = createService();
        const token = fakeToken(1, 'a');
        auth.token = token;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).startSyncIfReady();
        expect(native.startCalls).to.have.length(1);

        auth.fireRenewal(token);
        await new Promise(resolve => setImmediate(resolve));

        expect(native.stopCalls).to.equal(0);
        expect(native.startCalls).to.have.length(1);
    });

    it('no-ops when sync is not currently running', async () => {
        const { native, auth } = createService();
        // Sync was never started — no startSyncIfReady call happened.
        auth.fireRenewal(fakeToken(1, 'a'));
        await new Promise(resolve => setImmediate(resolve));

        expect(native.stopCalls).to.equal(0);
        expect(native.startCalls).to.have.length(0);
    });

    it('no-ops when the sync toggle is off, even if a task happens to be tracked as running', async () => {
        const { service, native, auth } = createService();
        const tokenA = fakeToken(1, 'a');
        auth.token = tokenA;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).startSyncIfReady();
        expect(native.startCalls).to.have.length(1);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).syncEnabled = false;
        auth.fireRenewal(fakeToken(1, 'b'));
        await new Promise(resolve => setImmediate(resolve));

        expect(native.stopCalls).to.equal(0);
        expect(native.startCalls).to.have.length(1);
    });

    it('reconciles a renewal that fires while the initial (boot) start is still in flight', async () => {
        const { service, native, auth } = createService();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const workspaceServer: FakeWorkspaceServer = (service as any).workspaceServer;
        const tokenA = fakeToken(1, 'a');
        const tokenB = fakeToken(1, 'b');
        auth.token = tokenA;

        workspaceServer.blockNextLookup();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bootStart: Promise<void> = (service as any).startSyncIfReady();

        // The renewal fires while the boot start is still awaiting the workspace
        // lookup, i.e. before `syncStartedWithToken` has been set — the naive
        // `handleTokenRenewed` guard would (pre-fix) treat this as "not running yet"
        // and silently drop it.
        auth.fireRenewal(tokenB);
        await new Promise(resolve => setImmediate(resolve));
        expect(native.startCalls, 'boot start should still be blocked on the workspace lookup').to.have.length(0);

        workspaceServer.unblockLookup();
        await bootStart;
        // Let the end-of-start reconcile (and any restart it triggers) settle.
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        const lastStart = native.startCalls[native.startCalls.length - 1];
        expect(lastStart.token, 'task must end up on the renewed token, not the pre-renewal one').to.equal(tokenB);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((service as any).syncStartedWithToken).to.equal(tokenB);
    });

    it('surfaces an error status when reconciling to the fresh token fails to (re)start, instead of leaving it silently stopped', async () => {
        const { service, native, auth } = createService();
        const tokenA = fakeToken(1, 'a');
        auth.token = tokenA;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).startSyncIfReady();
        expect(native.startCalls).to.have.length(1);

        const statuses: SyncStatus[] = [];
        service.onDidChangeSyncStatus(status => statuses.push(status));

        native.failNextStart = true;
        auth.fireRenewal(fakeToken(1, 'b'));
        await new Promise(resolve => setImmediate(resolve));

        expect(native.stopCalls).to.equal(1);
        expect(statuses.length).to.be.greaterThan(0);
        const finalStatus = statuses[statuses.length - 1];
        expect(finalStatus.status).to.equal('error');
        expect(finalStatus.error).to.be.a('string').and.not.empty;
    });
});
