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
import { LanguageModelMessage, LanguageModelStreamResponse, LanguageModelStreamResponsePart, UserRequest } from '@theia/ai-core/lib/common';
import { CookbotChatChunk, CookbotInitResult, CookbotMessageParam } from '../common/cookbot-protocol';
import { CookbotLanguageModel } from './cookbot-language-model';
import { CookbotSessionInitializer } from './cookbot-session-initializer';

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

/**
 * What the cookbot server sends once the account's token allowance for the
 * billing cycle is spent: `Status::resource_exhausted("quota_exhausted")`.
 */
function quotaExhaustedError(): Error {
    return Object.assign(new Error('8 RESOURCE_EXHAUSTED: quota_exhausted'), { code: 8 });
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

class FakeErrorReporter {
    reported: unknown[] = [];
    reportUnexpected(error: unknown): void {
        this.reported.push(error);
    }
}

function createModel(grpcClient: FakeGrpcClient, errorReporter?: FakeErrorReporter): CookbotLanguageModel {
    const initializer = new CookbotSessionInitializer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).workspaceServer = { getMostRecentlyUsedWorkspace: async () => undefined };
    const model = new CookbotLanguageModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).sessionInitializer = initializer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).errorReporter = errorReporter;
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

describe('CookbotLanguageModel quota exhaustion', () => {

    // End to end through the language model: the server's reason has to
    // survive the retry logic and come out of `request()` as the text the
    // chat UI renders. Classifying it correctly in isolation is not enough.
    it('surfaces the quota explanation to the caller', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => failingStream(quotaExhaustedError())];
        const model = createModel(grpcClient);

        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).to.contain('credits');
        expect(thrown?.message).to.contain('billing cycle');
        // Retrying cannot help, so the message must not ask for it.
        expect(thrown?.message).to.not.match(/try again|wait a moment/i);
        expect(thrown?.message).to.not.contain('RESOURCE_EXHAUSTED');
        expect(thrown?.message).to.not.contain('quota_exhausted');
    });

    it('does not retry a quota failure', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => failingStream(quotaExhaustedError())];
        const model = createModel(grpcClient);

        await collect(model).catch(() => undefined);

        expect(grpcClient.sendMessageCalls).to.equal(1);
        expect(grpcClient.reconnectCalls).to.equal(0);
        expect(grpcClient.initializeCalls).to.equal(1);
    });
});

// Sentry only captures unhandled errors on its own. Everything here is caught
// and turned into a chat message, so it has to be handed over explicitly - but
// only the failures that indicate a defect, or the signal drowns in noise.
describe('CookbotLanguageModel error reporting', () => {

    async function collectWithReporter(streams: Array<() => AsyncIterable<CookbotChatChunk>>): Promise<FakeErrorReporter> {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = streams;
        const reporter = new FakeErrorReporter();
        await collect(createModel(grpcClient, reporter)).catch(() => undefined);
        return reporter;
    }

    it('reports an unexpected server failure', async () => {
        const reporter = await collectWithReporter([
            () => failingStream(Object.assign(new Error('13 INTERNAL: snapshot failed'), { code: 13 }))
        ]);
        expect(reporter.reported).to.have.lengthOf(1);
    });

    it('reports a plain programming error', async () => {
        const reporter = await collectWithReporter([
            () => failingStream(new TypeError("Cannot read properties of undefined (reading 'map')"))
        ]);
        expect(reporter.reported).to.have.lengthOf(1);
    });

    it('does not report an exhausted quota', async () => {
        const reporter = await collectWithReporter([() => failingStream(quotaExhaustedError())]);
        expect(reporter.reported).to.be.empty;
    });

    it('does not report a dropped connection, even after the retry fails', async () => {
        const reporter = await collectWithReporter([
            () => failingStream(connectionResetError()),
            () => failingStream(connectionResetError())
        ]);
        expect(reporter.reported).to.be.empty;
    });

    it('does not report an expired session', async () => {
        const reporter = await collectWithReporter([
            () => failingStream(sessionExpiredError()),
            () => failingStream(sessionExpiredError())
        ]);
        expect(reporter.reported).to.be.empty;
    });

    it('does not report a conversation that outgrew the context window', async () => {
        const reporter = await collectWithReporter([
            () => failingStream(new Error('prompt is too long: 210000 tokens > 200000 maximum'))
        ]);
        expect(reporter.reported).to.be.empty;
    });

    it('works when no reporter is bound', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => failingStream(new Error('13 INTERNAL: boom'))];
        const model = createModel(grpcClient);
        let thrown: Error | undefined;
        try {
            await collect(model);
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown).to.not.be.undefined;
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

describe('CookbotLanguageModel thinking blocks', () => {

    function transform(messages: LanguageModelMessage[]): CookbotMessageParam[] {
        const model = createModel(new FakeGrpcClient());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (model as any).transformMessages(messages);
    }

    const thinking = (thought: string, signature: string): LanguageModelMessage =>
        ({ actor: 'ai', type: 'thinking', thinking: thought, signature }) as LanguageModelMessage;

    const text = (content: string): LanguageModelMessage =>
        ({ actor: 'user', type: 'text', text: content }) as LanguageModelMessage;

    it('keeps a signed thinking block', () => {
        const raw = transform([thinking('weighing options', 'sig-abc')]);

        expect(raw).to.have.length(1);
        expect(raw[0].content[0]).to.deep.include({
            type: 'thinking',
            thinking: 'weighing options',
            signature: 'sig-abc'
        });
    });

    it('drops an unsigned thinking block rather than sending an empty signature', () => {
        // Anthropic answers a blank signature with
        // `messages.N.content.0: Invalid \`signature\` in \`thinking\` block`,
        // and since the history is re-sent every turn that 400 is permanent.
        const raw = transform([thinking('interrupted before the signature arrived', '')]);

        expect(raw).to.be.empty;
    });

    it('drops a thinking block whose signature is missing entirely', () => {
        const raw = transform([
            { actor: 'ai', type: 'thinking', thinking: 'no signature field' } as LanguageModelMessage
        ]);

        expect(raw).to.be.empty;
    });

    it('keeps the rest of the turn when an unsigned thinking block is dropped', () => {
        const raw = transform([thinking('unsigned', ''), text('what next?')]);

        expect(raw).to.have.length(1);
        expect(raw[0].role).to.equal('user');
        expect(raw[0].content[0]).to.deep.include({ type: 'text', text: 'what next?' });
    });

});
