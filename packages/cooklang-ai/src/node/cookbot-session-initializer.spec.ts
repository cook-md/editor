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
import { CookbotSessionInitializer } from './cookbot-session-initializer';

class FakeGrpcClient {
    initializeCalls = 0;
    failNext = false;
    /** When set, `initialize` awaits this before resolving/rejecting, letting a test control when a call settles. */
    nextInitializeBlocksOn: Promise<void> | undefined;

    async initialize(): Promise<unknown> {
        this.initializeCalls++;
        if (this.nextInitializeBlocksOn) {
            const blocker = this.nextInitializeBlocksOn;
            this.nextInitializeBlocksOn = undefined;
            await blocker;
        }
        if (this.failNext) {
            this.failNext = false;
            throw new Error('init failed');
        }
        return { success: true, sessionId: `session-${this.initializeCalls}`, serverVersion: 'test' };
    }
}

function createInitializer(grpcClient: FakeGrpcClient): CookbotSessionInitializer {
    const initializer = new CookbotSessionInitializer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).workspaceServer = { getMostRecentlyUsedWorkspace: async () => undefined };
    return initializer;
}

describe('CookbotSessionInitializer', () => {

    it('initializes only once across concurrent and repeated callers', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient);

        await Promise.all([initializer.ensureInitialized(), initializer.ensureInitialized()]);
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('retries on the next call after a failed initialization', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.failNext = true;
        const initializer = createInitializer(grpcClient);

        let thrown: Error | undefined;
        try {
            await initializer.ensureInitialized();
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).to.equal('init failed');

        await initializer.ensureInitialized();
        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('re-initializes after reset', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient);

        await initializer.ensureInitialized();
        initializer.reset();
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('a stale failed initialization does not clobber a newer in-flight one', async () => {
        const grpcClient = new FakeGrpcClient();
        let rejectFirst!: (error: Error) => void;
        grpcClient.nextInitializeBlocksOn = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        const initializer = createInitializer(grpcClient);

        const first = initializer.ensureInitialized();
        initializer.reset();
        const second = initializer.ensureInitialized();

        rejectFirst(new Error('stale failure'));
        let thrown: Error | undefined;
        try {
            await first;
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).to.equal('stale failure');

        await second;
        await initializer.ensureInitialized();
        expect(grpcClient.initializeCalls).to.equal(2);
    });
});
