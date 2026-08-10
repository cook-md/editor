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

/** gRPC UNAVAILABLE error as raised when an idle connection was dropped upstream. */
function connectionResetError(): Error {
    return Object.assign(new Error('14 UNAVAILABLE: read ECONNRESET'), { code: 14 });
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

async function* emptyStream(): AsyncIterable<CookbotChatChunk> {
    yield { type: 'message_start', id: 'msg-1', model: 'claude', inputTokens: 7 };
    yield { type: 'message_delta', stopReason: 'end_turn', outputTokens: 0 };
    yield { type: 'message_stop' };
}

class FakeGrpcClient {
    initializeCalls = 0;
    reconnectCalls = 0;
    sendMessageCalls = 0;
    streams: Array<() => AsyncIterable<CookbotChatChunk>> = [];
    initializeError: Error | undefined;

    async initialize(): Promise<CookbotInitResult> {
        this.initializeCalls++;
        if (this.initializeError) {
            const error = this.initializeError;
            this.initializeError = undefined;
            throw error;
        }
        return { success: true, sessionId: `session-${this.initializeCalls}`, serverVersion: 'test' };
    }

    reconnect(): void {
        this.reconnectCalls++;
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

        expect(thrown?.message).to.not.contain('UNAUTHENTICATED');
        expect(thrown?.message).to.contain('session has expired');
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

        expect(thrown?.message).to.contain('session has expired');
        expect(grpcClient.sendMessageCalls).to.equal(1);
    });

    it('surfaces server errors without retrying', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(new Error('the recipe service exploded')),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.equal('the recipe service exploded');
        expect(grpcClient.sendMessageCalls).to.equal(1);
        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('does not cache a failed initialization', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.initializeError = new Error('backend down');
        grpcClient.streams = [() => textStream('Hello')];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).to.equal('backend down');

        // A later request must be able to initialize again instead of
        // re-awaiting the cached, rejected initialization promise.
        const parts = await collect(model);
        const texts = parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
        expect(texts).to.deep.equal(['Hello']);
        expect(grpcClient.initializeCalls).to.equal(2);
    });
});

describe('CookbotLanguageModel transient connection errors', () => {

    it('reconnects and retries once on UNAVAILABLE', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(connectionResetError()),
            () => textStream('Hello'),
        ];
        const model = createModel(grpcClient);

        const parts = await collect(model);

        const texts = parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
        expect(texts).to.deep.equal(['Hello']);
        expect(grpcClient.sendMessageCalls).to.equal(2);
        expect(grpcClient.reconnectCalls).to.equal(1);
    });

    it('shows a friendly message instead of the raw gRPC status when the retry also fails', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(connectionResetError()),
            () => failingStream(connectionResetError()),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.not.contain('UNAVAILABLE');
        expect(thrown?.message).to.not.contain('ECONNRESET');
        expect(thrown?.message).to.contain('connection');
        expect(grpcClient.sendMessageCalls).to.equal(2);
    });

    it('does not retry once content was streamed', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(
                connectionResetError(),
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

        expect(thrown?.message).to.contain('connection');
        expect(grpcClient.sendMessageCalls).to.equal(1);
    });

    it('recovers when the reconnected channel reports an expired session', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(connectionResetError()),
            () => failingStream(sessionExpiredError()),
            () => textStream('Hello'),
        ];
        const model = createModel(grpcClient);

        const parts = await collect(model);

        const texts = parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
        expect(texts).to.deep.equal(['Hello']);
        expect(grpcClient.sendMessageCalls).to.equal(3);
        expect(grpcClient.reconnectCalls).to.equal(1);
        expect(grpcClient.initializeCalls).to.equal(2);
    });
});

describe('CookbotLanguageModel empty responses', () => {

    it('reports an error when the stream produces no content', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => emptyStream()];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('empty response');
        expect(thrown?.message).to.contain('new chat');
    });

    it('does not report an error when the stream produced content', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => textStream('Hello')];
        const model = createModel(grpcClient);

        const parts = await collect(model);
        const texts = parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
        expect(texts).to.deep.equal(['Hello']);
    });

    it('suggests starting a new chat when the conversation no longer fits', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => failingStream(new Error('prompt is too long: 210000 tokens > 200000 maximum')),
        ];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('too long');
        expect(thrown?.message).to.contain('new chat');
    });
});
