// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { Emitter, Event } from '@theia/core';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { CookbotChatChunk, CookbotInitResult, CookbotToolRequest } from '../common/cookbot-protocol';

@injectable()
export class CookbotGrpcClient {

    private chatService: any;
    private connectionService: any;
    private toolExecutionService: any;
    private sessionId: string | undefined;

    @postConstruct()
    protected init(): void {
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
        const address = '127.0.0.1:50051';

        this.chatService = new proto.cookbot.AIChatService(
            address, grpc.credentials.createInsecure()
        );
        this.connectionService = new proto.cookbot.Connection(
            address, grpc.credentials.createInsecure()
        );
        this.toolExecutionService = new proto.cookbot.ToolExecutionService(
            address, grpc.credentials.createInsecure()
        );
    }

    async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
        return new Promise((resolve, reject) => {
            this.connectionService.Initialize({
                customInstructions: customInstructions || '',
                clientVersion: '0.1.0',
                recipesDir,
                authToken: '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.sessionId = response.sessionId;
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
        const call = this.chatService.SendMessage({
            message,
            conversationHistory,
            sessionId: this.sessionId || '',
            authToken: '',
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
        if (this.toolStream) {
            this.toolStream.write({
                executionId,
                success,
                result,
                error: error || '',
            });
        }
    }

    private toolStream: grpc.ClientDuplexStream<any, any> | undefined;

    private readonly onToolRequestEmitter = new Emitter<CookbotToolRequest>();
    readonly onToolRequest: Event<CookbotToolRequest> = this.onToolRequestEmitter.event;

    connectToolStream(): void {
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
        });
    }

    private async *grpcStreamToAsync(call: grpc.ClientReadableStream<any>): AsyncIterable<CookbotChatChunk> {
        const queue: Array<CookbotChatChunk | Error | null> = [];
        let resolve: (() => void) | undefined;

        call.on('data', (chunk: any) => {
            const parsed = this.parseChatChunk(chunk);
            queue.push(parsed);
            resolve?.();
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

    private parseChatChunk(chunk: any): CookbotChatChunk {
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
        return { type: 'stream_end', streamEnd: true };
    }
}
