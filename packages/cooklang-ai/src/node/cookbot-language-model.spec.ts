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
import { LanguageModelStreamResponse, LanguageModelStreamResponsePart, UserRequest } from '@theia/ai-core/lib/common';
import { CookbotChatChunk, CookbotInitResult } from '../common/cookbot-protocol';
import { CookbotLanguageModel } from './cookbot-language-model';

// ── Test fakes ──────────────────────────────────────────────────────────

/** gRPC UNAUTHENTICATED error as @grpc/grpc-js surfaces it on the stream. */
function sessionExpiredError(): Error {
    return Object.assign(
        new Error('16 UNAUTHENTICATED: Invalid or expired session. Please call Initialize to start a new session.'),
        { code: 16 }
    );
}

async function* failingStream(error: Error, ...before: CookbotChatChunk[]): AsyncIterable<CookbotChatChunk> {
    for (const chunk of before) {
        yield chunk;
    }
    throw error;
}

async function* textStream(text: string): AsyncIterable<CookbotChatChunk> {
    yield { type: 'content_block_start', index: 0, blockType: 'text', text };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_stop' };
}

class FakeGrpcClient {
    initializeCalls = 0;
    sendMessageCalls = 0;
    streams: Array<() => AsyncIterable<CookbotChatChunk>> = [];

    async initialize(): Promise<CookbotInitResult> {
        this.initializeCalls++;
        return { success: true, sessionId: `session-${this.initializeCalls}`, serverVersion: 'test' };
    }

    sendMessage(): { stream: AsyncIterable<CookbotChatChunk> } {
        const factory = this.streams[this.sendMessageCalls++];
        if (!factory) {
            throw new Error('Unexpected sendMessage call');
        }
        return { stream: factory() };
    }
}

function createModel(grpcClient: FakeGrpcClient): CookbotLanguageModel {
    const model = new CookbotLanguageModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).workspaceServer = { getMostRecentlyUsedWorkspace: async () => undefined };
    return model;
}

function userRequest(): UserRequest {
    return {
        messages: [{ actor: 'user', type: 'text', text: 'hi' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

async function collect(model: CookbotLanguageModel): Promise<LanguageModelStreamResponsePart[]> {
    const response = await model.request(userRequest()) as LanguageModelStreamResponse;
    const parts: LanguageModelStreamResponsePart[] = [];
    for await (const part of response.stream) {
        parts.push(part);
    }
    return parts;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('CookbotLanguageModel session expiry', () => {

    it('re-initializes and retries once when the session has expired', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(sessionExpiredError()),
            () => textStream('Hello'),
        ];
        const model = createModel(grpcClient);

        const parts = await collect(model);

        const texts = parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
        expect(texts).to.deep.equal(['Hello']);
        expect(grpcClient.sendMessageCalls).to.equal(2);
        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('surfaces the error when the retry also fails with an expired session', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(sessionExpiredError()),
            () => failingStream(sessionExpiredError()),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('UNAUTHENTICATED');
        expect(grpcClient.sendMessageCalls).to.equal(2);
    });

    it('does not retry when content was already streamed', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(
                sessionExpiredError(),
                { type: 'content_block_start', index: 0, blockType: 'text', text: 'partial' }
            ),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('UNAUTHENTICATED');
        expect(grpcClient.sendMessageCalls).to.equal(1);
    });

    it('surfaces non-session errors without retrying', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(Object.assign(new Error('14 UNAVAILABLE: connection refused'), { code: 14 })),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('UNAVAILABLE');
        expect(grpcClient.sendMessageCalls).to.equal(1);
        expect(grpcClient.initializeCalls).to.equal(1);
    });
});
