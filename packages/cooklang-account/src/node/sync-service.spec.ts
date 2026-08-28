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
import { SyncServiceImpl } from './sync-service';
import { SyncStatus } from '../common/sync-protocol';

/** Stands in for the `@theia/cooklang-native` addon without requiring a build. */
class FakeNativeModule {
    callback: ((json: string) => void) | undefined;
    onSyncStatusChanged(cb: (json: string) => void): void {
        this.callback = cb;
    }
}

class FakeAuthService {
    logoutCalls = 0;
    async logout(): Promise<void> {
        this.logoutCalls++;
    }
    async getToken(): Promise<string | undefined> {
        return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDidChangeAuth(): any {
        return { dispose: () => { /* no-op */ } };
    }
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
    (service as any).syncEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).registerNativeCallback();
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
