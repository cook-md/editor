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
import { CookbotUsageStats } from '../common/cookbot-usage-protocol';
import { CookbotUsageServiceImpl } from './cookbot-usage-service';

const SAMPLE_USAGE: CookbotUsageStats = {
    inputTokensUsed: 700_000,
    outputTokensUsed: 150_000,
    tokenLimit: 1_000_000,
    billingPeriodStart: '2026-08-01T00:00:00Z',
    billingPeriodEnd: '2026-09-01T00:00:00Z',
    subscriptionTier: 'pro',
};

/** gRPC UNAUTHENTICATED error as @grpc/grpc-js surfaces it. */
function sessionExpiredError(): Error {
    return Object.assign(
        new Error('16 UNAUTHENTICATED: Invalid or expired session. Please call Initialize to start a new session.'),
        { code: 16 }
    );
}

class FakeGrpcClient {
    getUsageCalls = 0;
    errors: Error[] = [];
    usage: CookbotUsageStats = SAMPLE_USAGE;

    async getUsage(): Promise<CookbotUsageStats> {
        this.getUsageCalls++;
        const error = this.errors.shift();
        if (error) {
            throw error;
        }
        return this.usage;
    }
}

class FakeInitializer {
    ensureCalls = 0;
    resetCalls = 0;
    error: Error | undefined;

    async ensureInitialized(): Promise<void> {
        this.ensureCalls++;
        if (this.error) {
            throw this.error;
        }
    }

    reset(): void {
        this.resetCalls++;
    }
}

function createService(grpcClient: FakeGrpcClient, initializer: FakeInitializer): CookbotUsageServiceImpl {
    const service = new CookbotUsageServiceImpl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).sessionInitializer = initializer;
    return service;
}

describe('CookbotUsageServiceImpl', () => {

    it('bootstraps the session before querying usage', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(initializer.ensureCalls).to.equal(1);
        expect(usage).to.deep.equal(SAMPLE_USAGE);
    });

    it('returns undefined when session initialization fails', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = new FakeInitializer();
        initializer.error = new Error('not logged in');
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
        expect(grpcClient.getUsageCalls).to.equal(0);
    });

    it('returns undefined when the usage query fails', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [new Error('boom')];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
    });

    it('re-initializes and retries once when the session has expired', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [sessionExpiredError()];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(initializer.resetCalls).to.equal(1);
        expect(grpcClient.getUsageCalls).to.equal(2);
        expect(usage).to.deep.equal(SAMPLE_USAGE);
    });

    it('returns undefined when the retry also fails with an expired session', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [sessionExpiredError(), sessionExpiredError()];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
        expect(grpcClient.getUsageCalls).to.equal(2);
    });
});
