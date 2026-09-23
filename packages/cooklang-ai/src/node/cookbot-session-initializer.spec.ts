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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { CookbotSessionInitializer, pickCookMdName } from './cookbot-session-initializer';

class FakeGrpcClient {
    initializeCalls = 0;
    /** The (recipesDir, customInstructions) of every initialize call, in order. */
    calls: Array<{ recipesDir: string; instructions: string }> = [];
    failNext = false;
    /** When set, `initialize` awaits this before resolving/rejecting, letting a test control when a call settles. */
    nextInitializeBlocksOn: Promise<void> | undefined;

    async initialize(recipesDir = '', customInstructions = ''): Promise<unknown> {
        this.initializeCalls++;
        this.calls.push({ recipesDir, instructions: customInstructions });
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

describe('CookbotSessionInitializer COOK.md', () => {

    let dir: string;
    let workspaceServer: FakeWorkspaceServer;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookbot-init-'));
        workspaceServer = new FakeWorkspaceServer();
        workspaceServer.current = FileUri.create(dir).toString();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('picks up a COOK.md created after the session started', async () => {
        // uid 2647, 2026-09-18: added COOK.md mid-session, then got asked
        // "how many people?" because the prompt still said there was none.
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        expect(grpcClient.calls[0].instructions).to.equal('');

        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('We are 2 people.');
    });

    it('does not re-initialize while COOK.md is unchanged', async () => {
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        await initializer.ensureInitialized();
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('re-initializes with the new content when COOK.md is edited', async () => {
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 4 people.');
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('We are 4 people.');
    });

    it('reads a lowercase cook.md', async () => {
        fs.writeFileSync(path.join(dir, 'cook.md'), 'No dairy.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();

        expect(grpcClient.calls[0].instructions).to.equal('No dairy.');
    });

    it('initializes only once when two concurrent callers race with a real COOK.md on disk', async () => {
        // The race that made "initializes only once" fail while the folder
        // resolution and COOK.md read went through real fs I/O.
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await Promise.all([initializer.ensureInitialized(), initializer.ensureInitialized()]);

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('re-initializes with empty instructions when COOK.md is removed', async () => {
        const cookMdPath = path.join(dir, 'COOK.md');
        fs.writeFileSync(cookMdPath, 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        fs.unlinkSync(cookMdPath);
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('');
    });

    it('serializes a re-init behind a stale in-flight one, so the newer COOK.md wins', async () => {
        // The server keeps whichever Initialize response arrives last. Without
        // serialization, a slow first call could finish after this one and
        // silently leave the session on the old COOK.md.
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'old');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        let releaseFirst!: () => void;
        grpcClient.nextInitializeBlocksOn = new Promise<void>(resolve => { releaseFirst = resolve; });
        const first = initializer.ensureInitialized();

        // The first call goes through real fs I/O before it reaches
        // grpcClient.initialize(), so wait for it to actually be in flight
        // (and blocked) before mutating COOK.md.
        while (grpcClient.initializeCalls < 1) {
            await new Promise(resolve => setImmediate(resolve));
        }

        fs.writeFileSync(path.join(dir, 'COOK.md'), 'new');
        const second = initializer.ensureInitialized();

        // Give the re-init a chance to jump ahead if it were going to - it
        // must not call grpc initialize a second time until the first settles.
        await new Promise(resolve => setImmediate(resolve));
        expect(grpcClient.initializeCalls).to.equal(1);

        releaseFirst();
        await first;
        await second;

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('new');
    });

    it('does not queue a duplicate re-init for each caller that arrives while one is already pending', async () => {
        // Three callers racing in behind a held Initialize call, after COOK.md
        // changed, used to each detect the change and queue their own
        // re-init: calls ended up ["old", "new", "new", "new"].
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'old');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        let releaseFirst!: () => void;
        grpcClient.nextInitializeBlocksOn = new Promise<void>(resolve => { releaseFirst = resolve; });
        const first = initializer.ensureInitialized();

        // The first call goes through real fs I/O before it reaches
        // grpcClient.initialize(), so wait for it to actually be in flight
        // (and blocked) before mutating COOK.md.
        while (grpcClient.initializeCalls < 1) {
            await new Promise(resolve => setImmediate(resolve));
        }

        fs.writeFileSync(path.join(dir, 'COOK.md'), 'new');
        const second = initializer.ensureInitialized();
        const third = initializer.ensureInitialized();
        const fourth = initializer.ensureInitialized();

        releaseFirst();
        await Promise.all([first, second, third, fourth]);

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('new');
    });
});

describe('pickCookMdName', () => {

    it('prefers an exact COOK.md over other casings', () => {
        expect(pickCookMdName(['cook.md', 'COOK.md', 'Pasta.cook'])).to.equal('COOK.md');
    });

    it('accepts any casing when there is no exact COOK.md', () => {
        expect(pickCookMdName(['Pasta.cook', 'Cook.md'])).to.equal('Cook.md');
    });

    it('returns undefined when there is none', () => {
        expect(pickCookMdName(['Pasta.cook', 'cook.md.bak'])).to.be.undefined;
    });
});
