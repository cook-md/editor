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

// `any` and `null` are unavoidable here: gRPC service objects are loaded
// dynamically from a .proto file (no generated TypeScript types), and
// `grpc.ServiceError | null` is the upstream callback signature from @grpc/grpc-js.
/* eslint-disable @typescript-eslint/no-explicit-any, no-null/no-null */

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import {
    CookbotChatChunk,
    CookbotInitResult,
    CookbotMessageParam,
    CookbotToolDefinition,
} from '../common/cookbot-protocol';
import {
    CookbotSearchResult,
    CookbotFetchResult,
    CookbotConvertResult,
    CookbotCatalogRecipe,
    CookbotSavedPreferences,
} from '../common/cookbot-server-tools-protocol';
import { CookbotUsageStats } from '../common/cookbot-usage-protocol';
import { CookbotError } from '../common/cookbot-error';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';

@injectable()
export class CookbotGrpcClient {

    @inject(AuthService)
    protected readonly authService: AuthService;

    /** Ceiling for a single received gRPC message, in bytes (grpc-js defaults to 4 MB). */
    protected static readonly MAX_RECEIVE_MESSAGE_LENGTH = 64 * 1024 * 1024;

    /**
     * Budget for the conversation history we send, in bytes.
     *
     * A ChatRequest carries the whole history, so its size grows with the
     * conversation rather than with what the user just typed. If it exceeds
     * what the server will decode, the request fails at the transport - and
     * because the offending turn stays in the history, so does every request
     * after it, wedging the session with no way back but a new chat. Trimming
     * on the way out keeps that failure impossible, and costs the user only
     * the tail of an oversized tool result.
     *
     * Set well under the server's own decode limit so ordinary growth is
     * handled by compaction, which can actually shrink the history, rather
     * than by this last-resort trim.
     */
    protected static readonly MAX_REQUEST_BYTES = 8 * 1024 * 1024;

    /** What one tool result is allowed to contribute once trimming kicks in. */
    protected static readonly TRIMMED_TOOL_RESULT_CHARS = 20_000;

    private service: any;
    private sessionId: string | undefined;
    private authToken: string = '';

    @postConstruct()
    protected init(): void {
        this.connect();
    }

    protected ensureConnected(): void {
        if (!this.service) {
            this.connect();
        }
    }

    /**
     * Drop the current channel and open a fresh one. Used after a transient
     * connection failure: an idle connection that was closed upstream stays
     * broken for the next call unless the channel is recreated.
     */
    reconnect(): void {
        try {
            this.service?.close?.();
        } catch (error) {
            console.warn('[Cookbot] Failed to close the gRPC channel, opening a new one anyway:', error);
        }
        this.service = undefined;
        this.connect();
    }

    protected connect(): void {
        const protoPath = path.resolve(__dirname, '../../proto/cookbot.proto');
        const packageDefinition = protoLoader.loadSync(protoPath, {
            keepCase: false,
            longs: Number,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const proto = grpc.loadPackageDefinition(packageDefinition) as any;
        const isPackaged = !!(process as any).resourcesPath && !(process as any).defaultApp;
        const defaultAddress = isPackaged ? 'cookbot.cook.md:443' : '127.0.0.1:50052';
        const address = process.env.COOKBOT_ADDRESS || defaultAddress;
        const useSecure = address.includes('cook.md') || address.startsWith('https://');
        const cleanAddress = address.replace(/^https?:\/\//, '');
        const credentials = useSecure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();

        // grpc-js defaults `max_receive_message_length` to 4 MB and rejects
        // anything larger with RESOURCE_EXHAUSTED - the same status used for
        // usage limits, which makes it read as "Cookbot is busy". Give
        // responses room rather than fail them at the transport.
        // `max_send_message_length` is deliberately left alone: it defaults to
        // -1 (unlimited), so setting it here would impose a new cap.
        this.service = new proto.cookbot.CookbotService(cleanAddress, credentials, {
            'grpc.max_receive_message_length': CookbotGrpcClient.MAX_RECEIVE_MESSAGE_LENGTH,
        });
    }

    /**
     * Run a unary call, retrying it once on a fresh channel when the
     * connection turns out to have been dropped upstream while idle.
     */
    protected async withReconnectRetry<T>(name: string, call: () => Promise<T>): Promise<T> {
        try {
            return await call();
        } catch (error) {
            if (!CookbotError.isTransientConnection(error)) {
                throw error;
            }
            console.info(`[Cookbot] ${name} lost the connection, reconnecting and retrying once`);
            this.reconnect();
            return call();
        }
    }

    async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
        return this.withReconnectRetry('Initialize', () => this.doInitialize(recipesDir, customInstructions));
    }

    protected async doInitialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
        this.ensureConnected();
        const token = await this.authService.getToken();
        return new Promise((resolve, reject) => {
            this.service.Initialize({
                customInstructions: customInstructions || '',
                clientVersion: '0.1.0',
                recipesDir,
                authToken: token || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.sessionId = response.sessionId;
                this.authToken = token || '';
                resolve({
                    success: response.success,
                    sessionId: response.sessionId,
                    serverVersion: response.serverVersion,
                });
            });
        });
    }

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    async getUsage(): Promise<CookbotUsageStats> {
        return this.withReconnectRetry('GetUsage', () => this.doGetUsage());
    }

    protected async doGetUsage(): Promise<CookbotUsageStats> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.GetUsage({
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    inputTokensUsed: response.inputTokensUsed ?? 0,
                    outputTokensUsed: response.outputTokensUsed ?? 0,
                    tokenLimit: response.tokenLimit ?? 0,
                    billingPeriodStart: response.billingPeriodStart || undefined,
                    billingPeriodEnd: response.billingPeriodEnd || undefined,
                    subscriptionTier: response.subscriptionTier || undefined,
                });
            });
        });
    }

    /**
     * Keep the outgoing history inside {@link MAX_REQUEST_BYTES} by shortening
     * tool results, oldest first.
     *
     * Only tool results are touched: they are the only part of a conversation
     * that can be arbitrarily large without the user having typed it, and the
     * only part whose tail is routinely disposable. User and assistant text is
     * never trimmed - losing what someone actually said would be worse than
     * the failure this avoids.
     *
     * Returns the input untouched in the common case, so a normal conversation
     * pays only one size calculation.
     */
    protected trimOversizedHistory(messages: CookbotMessageParam[]): CookbotMessageParam[] {
        if (this.historyByteLength(messages) <= CookbotGrpcClient.MAX_REQUEST_BYTES) {
            return messages;
        }

        // Copy before mutating: `messages` belongs to the caller's session and
        // is reused for the next turn.
        const trimmed = messages.map(msg => ({ ...msg, content: msg.content.map(part => ({ ...part })) }));
        let dropped = 0;

        // Oldest first: recent tool results are the ones the model is still
        // reasoning about.
        for (const msg of trimmed) {
            for (const part of msg.content) {
                const content = part.toolResultContent;
                if (!content || content.length <= CookbotGrpcClient.TRIMMED_TOOL_RESULT_CHARS) {
                    continue;
                }
                dropped += content.length - CookbotGrpcClient.TRIMMED_TOOL_RESULT_CHARS;
                const kept = content.slice(0, CookbotGrpcClient.TRIMMED_TOOL_RESULT_CHARS);
                part.toolResultContent = `${kept}\n\n...(truncated: this tool result was ${content.length} characters`
                    + ' and has been shortened to keep the conversation within limits)';
                if (this.historyByteLength(trimmed) <= CookbotGrpcClient.MAX_REQUEST_BYTES) {
                    console.warn(`[Cookbot] Trimmed ${dropped} characters of tool results to keep the request within limits`);
                    return trimmed;
                }
            }
        }

        // Still over budget with every tool result trimmed: the history is
        // genuinely large. Send it and let the server's limit and compaction
        // decide - failing here would be a worse outcome than trying.
        console.warn(`[Cookbot] History is ${this.historyByteLength(trimmed)} bytes after trimming every tool result`);
        return trimmed;
    }

    /** Approximate encoded size of the history: the bytes its strings occupy. */
    protected historyByteLength(messages: CookbotMessageParam[]): number {
        let total = 0;
        for (const msg of messages) {
            for (const part of msg.content) {
                total += Buffer.byteLength(part.text || '', 'utf8')
                    + Buffer.byteLength(part.input || '', 'utf8')
                    + Buffer.byteLength(part.toolResultContent || '', 'utf8')
                    + Buffer.byteLength(part.thinking || '', 'utf8')
                    + Buffer.byteLength(part.signature || '', 'utf8');
            }
        }
        return total;
    }

    sendMessage(
        messages: CookbotMessageParam[],
        tools: CookbotToolDefinition[],
        cancellationToken?: CancellationToken
    ): { stream: AsyncIterable<CookbotChatChunk> } {
        this.ensureConnected();

        // Convert messages to proto format
        const protoMessages = this.trimOversizedHistory(messages).map(msg => ({
            role: msg.role,
            content: msg.content.map(part => ({
                type: part.type,
                text: part.text || '',
                toolUseId: part.toolUseId || '',
                name: part.name || '',
                input: part.input || '',
                toolResultContent: part.toolResultContent || '',
                isError: part.isError || false,
                thinking: part.thinking || '',
                signature: part.signature || '',
            })),
        }));

        const protoTools = tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));

        const call = this.service.SendMessage({
            messages: protoMessages,
            sessionId: this.sessionId || '',
            authToken: this.authToken,
            tools: protoTools,
        });

        if (cancellationToken) {
            cancellationToken.onCancellationRequested(() => {
                call.cancel();
            });
        }

        const stream = this.grpcStreamToAsync(call);
        return { stream };
    }

    // ── Server-side tools ────────────────────────────────────────────────

    async searchWeb(query: string, maxResults?: number): Promise<CookbotSearchResult[]> {
        return this.withReconnectRetry('SearchWeb', () => this.doSearchWeb(query, maxResults));
    }

    protected async doSearchWeb(query: string, maxResults?: number): Promise<CookbotSearchResult[]> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.SearchWeb({
                query,
                maxResults: maxResults || 5,
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve((response.results || []).map((r: any) => ({
                    title: r.title,
                    url: r.url,
                    snippet: r.snippet,
                })));
            });
        });
    }

    async fetchUrl(url: string): Promise<CookbotFetchResult> {
        return this.withReconnectRetry('FetchUrl', () => this.doFetchUrl(url));
    }

    protected async doFetchUrl(url: string): Promise<CookbotFetchResult> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.FetchUrl({
                url,
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    content: response.content,
                    title: response.title,
                });
            });
        });
    }

    async convertUrlToCooklang(url: string): Promise<CookbotConvertResult> {
        return this.withReconnectRetry('ConvertUrlToCooklang', () => this.doConvertUrlToCooklang(url));
    }

    protected async doConvertUrlToCooklang(url: string): Promise<CookbotConvertResult> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.ConvertUrlToCooklang({
                url,
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    cooklangContent: response.cooklangContent,
                    recipeName: response.recipeName,
                });
            });
        });
    }

    async convertTextToCooklang(name: string, text: string): Promise<CookbotConvertResult> {
        return this.withReconnectRetry('ConvertTextToCooklang', () => this.doConvertTextToCooklang(name, text));
    }

    protected async doConvertTextToCooklang(name: string, text: string): Promise<CookbotConvertResult> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.ConvertTextToCooklang({
                name,
                text,
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    cooklangContent: response.cooklangContent,
                    recipeName: response.recipeName,
                });
            });
        });
    }

    async searchRecipeCatalog(criteriaJson: string): Promise<string> {
        return this.withReconnectRetry('SearchRecipeCatalog', () => this.doSearchRecipeCatalog(criteriaJson));
    }

    protected async doSearchRecipeCatalog(criteriaJson: string): Promise<string> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.SearchRecipeCatalog({
                sessionId: this.sessionId || '',
                criteriaJson,
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(response.resultsJson ?? '');
            });
        });
    }

    async getCatalogRecipe(recipeId: string): Promise<CookbotCatalogRecipe> {
        return this.withReconnectRetry('GetCatalogRecipe', () => this.doGetCatalogRecipe(recipeId));
    }

    protected async doGetCatalogRecipe(recipeId: string): Promise<CookbotCatalogRecipe> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.GetCatalogRecipe({
                sessionId: this.sessionId || '',
                recipeId,
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    id: response.id,
                    title: response.title,
                    mealType: response.mealType,
                    course: response.course,
                    content: response.content,
                    suggestedPath: response.suggestedPath,
                });
            });
        });
    }

    async getUserPreferences(): Promise<CookbotSavedPreferences> {
        return this.withReconnectRetry('GetUserPreferences', () => this.doGetUserPreferences());
    }

    protected async doGetUserPreferences(): Promise<CookbotSavedPreferences> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.GetUserPreferences({
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                let preferences: Record<string, unknown> = {};
                try {
                    preferences = JSON.parse(response.preferencesJson || '{}');
                } catch {
                    // The server sends a JSON object; anything else means the
                    // user simply has nothing saved rather than a hard failure.
                    console.warn('[Cookbot] GetUserPreferences returned unparseable JSON, treating as empty');
                }
                resolve({
                    hasPreferences: !!response.hasPreferences,
                    sources: response.sources || [],
                    preferences,
                });
            });
        });
    }

    // ── Stream helpers ───────────────────────────────────────────────────

    private async *grpcStreamToAsync(call: grpc.ClientReadableStream<any>): AsyncIterable<CookbotChatChunk> {
        const queue: Array<CookbotChatChunk | Error | null> = [];
        let resolve: (() => void) | undefined;

        call.on('data', (chunk: any) => {
            const parsed = this.parseChatChunk(chunk);
            if (parsed) {
                queue.push(parsed);
                resolve?.();
            }
        });
        call.on('error', (err: Error) => {
            queue.push(err);
            resolve?.();
        });
        call.on('end', () => {
            queue.push(null);
            resolve?.();
        });

        while (true) {
            if (queue.length === 0) {
                await new Promise<void>(r => { resolve = r; });
            }
            const item = queue.shift();
            if (item === null || item === undefined) {
                return;
            }
            if (item instanceof Error) {
                throw item;
            }
            yield item;
        }
    }

    private parseChatChunk(chunk: any): CookbotChatChunk | undefined {
        // The proto uses oneof "event" — proto-loader populates the active field
        if (chunk.contentBlockStart) {
            const cbs = chunk.contentBlockStart;
            return {
                type: 'content_block_start',
                index: cbs.index,
                blockType: cbs.type,
                text: cbs.text || undefined,
                thinking: cbs.thinking || undefined,
                id: cbs.id || undefined,
                name: cbs.name || undefined,
            };
        }
        if (chunk.contentBlockDelta) {
            const cbd = chunk.contentBlockDelta;
            return {
                type: 'content_block_delta',
                index: cbd.index,
                deltaType: cbd.type,
                text: cbd.text || undefined,
                partialJson: cbd.partialJson || undefined,
                signature: cbd.signature || undefined,
            };
        }
        if (chunk.contentBlockStop) {
            return {
                type: 'content_block_stop',
                index: chunk.contentBlockStop.index,
            };
        }
        if (chunk.messageStart) {
            const ms = chunk.messageStart;
            return {
                type: 'message_start',
                id: ms.id,
                model: ms.model,
                inputTokens: ms.inputTokens,
            };
        }
        if (chunk.messageDelta) {
            const md = chunk.messageDelta;
            return {
                type: 'message_delta',
                stopReason: md.stopReason,
                outputTokens: md.outputTokens,
            };
        }
        if (chunk.messageStop !== undefined && chunk.messageStop !== null) {
            return { type: 'message_stop' };
        }
        if (chunk.error) {
            return { type: 'error', error: chunk.error };
        }
        if (chunk.contextStatus) {
            const cs = chunk.contextStatus;
            return {
                type: 'context_status',
                tokensUsed: cs.tokensUsed,
                tokenLimit: cs.tokenLimit,
                percentageUsed: cs.percentageUsed,
                compactionInProgress: cs.compactionInProgress,
            };
        }
        if (chunk.compactionInfo) {
            const ci = chunk.compactionInfo;
            return {
                type: 'compaction_info',
                compactedHistory: (ci.compactedHistory || []).map((m: any) => ({
                    role: m.role,
                    content: (m.content || []).map((p: any) => ({
                        type: p.type,
                        text: p.text || undefined,
                        toolUseId: p.toolUseId || undefined,
                        name: p.name || undefined,
                        input: p.input || undefined,
                        toolResultContent: p.toolResultContent || undefined,
                        isError: p.isError || undefined,
                        thinking: p.thinking || undefined,
                        signature: p.signature || undefined,
                    })),
                })),
                summary: ci.summary,
                tokensBefore: ci.tokensBefore,
                tokensAfter: ci.tokensAfter,
                fallbackUsed: ci.fallbackUsed,
            };
        }
        console.warn('Unknown cookbot chunk type, skipping:', Object.keys(chunk));
        return undefined;
    }
}
