// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import {
    LanguageModel,
    LanguageModelResponse,
    LanguageModelStreamResponse,
    LanguageModelStreamResponsePart,
    UserRequest,
    LanguageModelMessage,
    ToolCallResult,
    ToolRequest,
    isToolCallContent,
    hasToolCallError,
} from '@theia/ai-core/lib/common';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotChatChunk } from '../common/cookbot-protocol';

@injectable()
export class CookbotLanguageModel implements LanguageModel {

    readonly id = 'cookbot/claude';
    readonly name = 'Cookbot Claude';
    readonly vendor = 'Cookbot';
    readonly version = '1.0';
    readonly family = 'claude';
    readonly maxInputTokens = 200000;
    readonly maxOutputTokens = 8192;
    readonly status = { status: 'ready' as const };

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    private initialized = false;

    protected async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.grpcClient.initialize('');
            this.grpcClient.connectToolStream();
            this.initialized = true;
        }
    }

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        await this.ensureInitialized();

        // Wrap tool handlers to forward results back to cookbot via the ToolExecutionService stream.
        // When Theia's delegate system calls a tool and gets a result, we also send it to cookbot
        // so it can continue its internal conversation with Claude.
        this.wrapToolHandlers(request.tools);

        const messages = request.messages.map(msg => {
            if (LanguageModelMessage.isTextMessage(msg)) {
                return { role: msg.actor === 'ai' ? 'assistant' : 'user', content: msg.text };
            }
            if (LanguageModelMessage.isToolResultMessage(msg)) {
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
                return { role: 'user', content };
            }
            if (LanguageModelMessage.isThinkingMessage(msg)) {
                return { role: 'assistant', content: msg.thinking };
            }
            return { role: 'user', content: '' };
        });

        // Last message is the current user input
        const lastMessage = messages.pop();
        const messageText = lastMessage?.content || '';

        const token = cancellationToken ?? request.cancellationToken;

        const { stream: grpcStream } = this.grpcClient.sendMessage(
            messageText,
            messages,
            token
        );

        const stream = this.mapStream(grpcStream);
        return { stream } as LanguageModelStreamResponse;
    }

    /**
     * Wraps each tool handler so that its result is also forwarded to cookbot
     * via `grpcClient.sendToolResult()`. The tool_call's `id` (from the stream chunk)
     * is used as the `executionId` correlation key.
     */
    protected wrapToolHandlers(tools: ToolRequest[] | undefined): void {
        if (!tools) {
            return;
        }
        for (const tool of tools) {
            const originalHandler = tool.handler;
            tool.handler = async (argString, ctx) => {
                const toolCallId = ctx?.toolCallId;
                try {
                    const result = await originalHandler(argString, ctx);
                    if (toolCallId) {
                        const resultString = this.toolCallResultToString(result);
                        const success = !hasToolCallError(result);
                        this.grpcClient.sendToolResult(
                            toolCallId,
                            success,
                            resultString,
                            success ? undefined : resultString
                        );
                    }
                    return result;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (toolCallId) {
                        this.grpcClient.sendToolResult(toolCallId, false, '', errorMessage);
                    }
                    throw error;
                }
            };
        }
    }

    /**
     * Converts a ToolCallResult into a string suitable for sending to cookbot.
     */
    protected toolCallResultToString(result: ToolCallResult): string {
        if (result === undefined) {
            return '';
        }
        if (typeof result === 'string') {
            return result;
        }
        if (isToolCallContent(result)) {
            const textParts = result.content
                .filter(part => part.type === 'text')
                .map(part => (part as { text: string }).text);
            if (textParts.length > 0) {
                return textParts.join('\n');
            }
            const errorParts = result.content
                .filter(part => part.type === 'error')
                .map(part => (part as { data: string }).data);
            if (errorParts.length > 0) {
                return errorParts.join('\n');
            }
        }
        return JSON.stringify(result);
    }

    private async *mapStream(
        grpcStream: AsyncIterable<CookbotChatChunk>
    ): AsyncIterable<LanguageModelStreamResponsePart> {
        for await (const chunk of grpcStream) {
            const part = this.mapChunkToPart(chunk);
            if (part) {
                yield part;
            }
        }
    }

    private mapChunkToPart(
        chunk: CookbotChatChunk
    ): LanguageModelStreamResponsePart | undefined {
        switch (chunk.type) {
            case 'text_delta':
                return { content: chunk.textDelta! };

            case 'thinking_delta':
                if (chunk.thinkingDelta && !chunk.thinkingDelta.isSignature) {
                    return {
                        thought: chunk.thinkingDelta.thinkingText,
                        signature: '',
                    };
                }
                if (chunk.thinkingDelta?.isSignature) {
                    return {
                        thought: '',
                        signature: chunk.thinkingDelta.signature,
                    };
                }
                return undefined;

            case 'tool_call':
                if (chunk.toolCall) {
                    return {
                        tool_calls: [{
                            id: chunk.toolCall.toolId,
                            function: {
                                name: chunk.toolCall.toolName,
                                arguments: chunk.toolCall.toolInput,
                            },
                            finished: true,
                        }],
                    };
                }
                return undefined;

            case 'tool_result':
                return undefined;

            case 'usage_info':
                if (chunk.usageInfo) {
                    return {
                        input_tokens: chunk.usageInfo.tokensUsed,
                        output_tokens: 0,
                    };
                }
                return undefined;

            case 'error':
                throw new Error(chunk.error || 'Unknown cookbot error');

            case 'stream_end':
                return undefined;

            default:
                return undefined;
        }
    }
}
