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

/** Mutable stand-in for the workspace server: `current` is what is "open". */
class FakeWorkspaceServer {
    current: string | undefined;
    async getMostRecentlyUsedWorkspace(): Promise<string | undefined> {
        return this.current;
    }
}

function createInitializer(
    grpcClient: FakeGrpcClient,
    workspaceServer: FakeWorkspaceServer = new FakeWorkspaceServer()
): CookbotSessionInitializer {
    const initializer = new CookbotSessionInitializer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).workspaceServer = workspaceServer;
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

describe('CookbotSessionInitializer recipe folder changes', () => {

    it('re-initializes when a folder is opened after the session was created', async () => {
        // The session that wedged onboarding: created with no folder, then kept
        // reporting "no folder" long after the user opened one.
        const grpcClient = new FakeGrpcClient();
        const workspaceServer = new FakeWorkspaceServer();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        expect(grpcClient.initializeCalls).to.equal(1);

        workspaceServer.current = 'file:///Users/greg/Cook';
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('re-initializes when the user switches to a different folder', async () => {
        const grpcClient = new FakeGrpcClient();
        const workspaceServer = new FakeWorkspaceServer();
        workspaceServer.current = 'file:///Users/greg/Cook';
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        workspaceServer.current = 'file:///Users/greg/OtherRecipes';
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('does not re-initialize while the folder stays the same', async () => {
        const grpcClient = new FakeGrpcClient();
        const workspaceServer = new FakeWorkspaceServer();
        workspaceServer.current = 'file:///Users/greg/Cook';
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        await initializer.ensureInitialized();
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('re-initializes when the folder is closed', async () => {
        const grpcClient = new FakeGrpcClient();
        const workspaceServer = new FakeWorkspaceServer();
        workspaceServer.current = 'file:///Users/greg/Cook';
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        workspaceServer.current = undefined;
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
    });
});
