// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { Emitter, Event } from '@theia/core';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { CookbotChatChunk, CookbotInitResult, CookbotToolRequest } from '../common/cookbot-protocol';
import { CookbotAuthService } from '../common/cookbot-auth-protocol';

@injectable()
export class CookbotGrpcClient {

    @inject(CookbotAuthService)
    protected readonly authService: CookbotAuthService;

    private chatService: any;
    private connectionService: any;
    private toolExecutionService: any;
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
        if (!this.chatService) {
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

        this.chatService = new proto.cookbot.AIChatService(cleanAddress, credentials);
        this.connectionService = new proto.cookbot.Connection(cleanAddress, credentials);
        this.toolExecutionService = new proto.cookbot.ToolExecutionService(cleanAddress, credentials);
    }

    async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
        this.ensureConnected();
        const token = await this.authService.getToken();
        return new Promise((resolve, reject) => {
            this.connectionService.Initialize({
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
        message: string,
        conversationHistory: Array<{ role: string; content: string }>,
        cancellationToken?: CancellationToken
    ): { stream: AsyncIterable<CookbotChatChunk> } {
        this.ensureConnected();
        // Auth token is sent as a proto field rather than gRPC metadata because
        // the cookbot server expects it in the message body for simplicity.
        const call = this.chatService.SendMessage({
            message,
            conversationHistory,
            sessionId: this.sessionId || '',
            authToken: this.authToken,
        });

        if (cancellationToken) {
            cancellationToken.onCancellationRequested(() => {
                call.cancel();
            });
        }

        const stream = this.grpcStreamToAsync(call);
        return { stream };
    }

    sendToolResult(executionId: string, success: boolean, result: string, error?: string): void {
        if (!this.toolStream) {
            console.warn('Cannot send tool result: tool stream not connected');
            return;
        }
        this.toolStream.write({
            executionId,
            success,
            result,
            error: error || '',
        });
    }

    private toolStream: grpc.ClientDuplexStream<any, any> | undefined;

    private readonly onToolRequestEmitter = new Emitter<CookbotToolRequest>();
    readonly onToolRequest: Event<CookbotToolRequest> = this.onToolRequestEmitter.event;

    connectToolStream(): void {
        this.ensureConnected();
        this.setupToolStream();
    }

    private toolStreamReconnectTimer: ReturnType<typeof setTimeout> | undefined;

    private setupToolStream(): void {
        if (this.toolStreamReconnectTimer) {
            clearTimeout(this.toolStreamReconnectTimer);
            this.toolStreamReconnectTimer = undefined;
        }
        this.toolStream = this.toolExecutionService.ExecuteTools();
        this.toolStream!.on('data', (request: any) => {
            this.onToolRequestEmitter.fire({
                executionId: request.executionId,
                toolName: request.toolName,
                parameters: request.parameters || {},
                internal: request.internal || false,
            });
        });
        this.toolStream!.on('error', (err: Error) => {
            console.error('Tool execution stream error:', err.message);
            this.toolStream = undefined;
            this.scheduleToolStreamReconnect();
        });
        this.toolStream!.on('end', () => {
            this.toolStream = undefined;
            this.scheduleToolStreamReconnect();
        });
    }

    private scheduleToolStreamReconnect(): void {
        if (!this.toolStreamReconnectTimer) {
            this.toolStreamReconnectTimer = setTimeout(() => {
                console.info('Reconnecting tool execution stream...');
                this.setupToolStream();
            }, 3000);
        }
    }

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
        if (chunk.textDelta !== undefined && chunk.textDelta !== '') {
            return { type: 'text_delta', textDelta: chunk.textDelta };
        }
        if (chunk.thinkingDelta) {
            return {
                type: 'thinking_delta',
                thinkingDelta: {
                    thinkingText: chunk.thinkingDelta.thinkingText,
                    isSignature: chunk.thinkingDelta.isSignature,
                    signature: chunk.thinkingDelta.signature,
                },
            };
        }
        if (chunk.toolCall) {
            return {
                type: 'tool_call',
                toolCall: {
                    toolId: chunk.toolCall.toolId,
                    toolName: chunk.toolCall.toolName,
                    toolInput: chunk.toolCall.toolInput,
                },
            };
        }
        if (chunk.toolResult) {
            return {
                type: 'tool_result',
                toolResult: {
                    toolId: chunk.toolResult.toolId,
                    toolName: chunk.toolResult.toolName,
                    success: chunk.toolResult.success,
                    result: chunk.toolResult.result,
                    error: chunk.toolResult.error,
                },
            };
        }
        if (chunk.toolExecution) {
            return {
                type: 'tool_execution',
                toolExecution: {
                    toolName: chunk.toolExecution.toolName,
                    status: chunk.toolExecution.status,
                },
            };
        }
        if (chunk.usageInfo) {
            return {
                type: 'usage_info',
                usageInfo: {
                    tokensUsed: chunk.usageInfo.tokensUsed,
                    tokenLimit: chunk.usageInfo.tokenLimit,
                    warning: chunk.usageInfo.warning,
                    limitExceeded: chunk.usageInfo.limitExceeded,
                },
            };
        }
        if (chunk.contextStatus) {
            return {
                type: 'context_status',
                contextStatus: {
                    tokensUsed: chunk.contextStatus.tokensUsed,
                    tokenLimit: chunk.contextStatus.tokenLimit,
                    percentageUsed: chunk.contextStatus.percentageUsed,
                    compactionInProgress: chunk.contextStatus.compactionInProgress,
                },
            };
        }
        if (chunk.compactionInfo) {
            return {
                type: 'compaction_info',
                compactionInfo: {
                    compactedHistory: chunk.compactionInfo.compactedHistory || [],
                    summary: chunk.compactionInfo.summary,
                    tokensBefore: chunk.compactionInfo.tokensBefore,
                    tokensAfter: chunk.compactionInfo.tokensAfter,
                    fallbackUsed: chunk.compactionInfo.fallbackUsed,
                },
            };
        }
        if (chunk.error) {
            return { type: 'error', error: chunk.error };
        }
        if (chunk.streamEnd) {
            return { type: 'stream_end', streamEnd: true };
        }
        console.warn('Unknown cookbot chunk type, skipping:', Object.keys(chunk));
        return undefined;
    }
}
