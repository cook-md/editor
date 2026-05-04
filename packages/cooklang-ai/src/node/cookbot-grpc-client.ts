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
} from '../common/cookbot-server-tools-protocol';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';

@injectable()
export class CookbotGrpcClient {

    @inject(AuthService)
    protected readonly authService: AuthService;

    private service: any;
    private sessionId: string | undefined;
    private authToken: string = '';

    @postConstruct()
    protected init(): void {
        try {
            this.connect();
        } catch (err) {
            console.warn('CookbotGrpcClient: failed to connect on startup, will retry on first use:', (err as Error).message);
        }
    }

    protected ensureConnected(): void {
        if (!this.service) {
            this.connect();
        }
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

        this.service = new proto.cookbot.CookbotService(cleanAddress, credentials);
    }

    async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
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

    sendMessage(
        messages: CookbotMessageParam[],
        tools: CookbotToolDefinition[],
        cancellationToken?: CancellationToken
    ): { stream: AsyncIterable<CookbotChatChunk> } {
        this.ensureConnected();

        // Convert messages to proto format
        const protoMessages = messages.map(msg => ({
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
