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
    ToolInvocationContext,
    createToolCallError,
    isToolCallContent,
} from '@theia/ai-core/lib/common';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import * as fs from 'fs';
import * as path from 'path';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import {
    CookbotChatChunk,
    CookbotMessageParam,
    CookbotContentPart,
    CookbotToolDefinition,
} from '../common/cookbot-protocol';

interface ToolCallback {
    readonly name: string;
    readonly id: string;
    readonly index: number;
    args: string;
}

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

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private initPromise: Promise<void> | undefined;

    protected async ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.doInitialize();
        }
        await this.initPromise;
    }

    private async doInitialize(): Promise<void> {
        let recipesDir = '';
        let customInstructions = '';
        try {
            const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
            if (workspaceUri) {
                recipesDir = FileUri.fsPath(workspaceUri);
                const cookMdPath = path.join(recipesDir, 'COOK.md');
                try {
                    customInstructions = await fs.promises.readFile(cookMdPath, 'utf-8');
                } catch {
                    // COOK.md not present, that's fine
                }
            }
        } catch {
            // Workspace may not be set yet
        }
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        await this.ensureInitialized();
        return this.handleStreamingRequest(request, cancellationToken);
    }

    /**
     * Handles a streaming request with recursive tool loop, following the
     * ai-anthropic pattern. When Claude returns tool_use blocks, executes
     * them via Theia's tool system and re-calls self with results.
     */
    protected async handleStreamingRequest(
        request: UserRequest,
        cancellationToken?: CancellationToken,
        toolMessages?: CookbotMessageParam[]
    ): Promise<LanguageModelStreamResponse> {
        const messages = this.transformMessages(request.messages);
        const allMessages = [...messages, ...(toolMessages ?? [])];
        const tools = this.createToolDefinitions(request);
        console.info(`[CookbotLM] Sending request with ${request.tools?.length ?? 0} tool requests, ${tools.length} tool definitions, ${allMessages.length} messages`);
        if (tools.length > 0) {
            console.info(`[CookbotLM] Tools: ${tools.map(t => t.name).join(', ')}`);
        }
        const token = cancellationToken ?? request.cancellationToken;

        const { stream: grpcStream } = this.grpcClient.sendMessage(allMessages, tools, token);

        const that = this;
        const asyncIterator = {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<LanguageModelStreamResponsePart> {
                const toolCalls: ToolCallback[] = [];
                let toolCall: ToolCallback | undefined;
                const currentMessages: CookbotMessageParam[] = [];
                let currentInputTokens = 0;
                let currentOutputTokens = 0;

                try {
                    for await (const chunk of grpcStream) {
                        const parts = that.processChunk(chunk, toolCalls, toolCall, currentMessages);
                        for (const part of parts.yields) {
                            yield part;
                        }
                        toolCall = parts.toolCall;
                        if (parts.inputTokens !== undefined) {
                            currentInputTokens = parts.inputTokens;
                        }
                        if (parts.outputTokens !== undefined) {
                            currentOutputTokens = parts.outputTokens;
                        }
                    }
                } catch (error: unknown) {
                    if (error instanceof Error && 'code' in error && (error as any).code === 16) {
                        that.initPromise = undefined;
                    }
                    throw error;
                }

                // Yield usage info
                if (currentInputTokens || currentOutputTokens) {
                    yield { input_tokens: currentInputTokens, output_tokens: currentOutputTokens };
                }

                // Tool loop: execute tools and recurse
                if (toolCalls.length > 0) {
                    const toolResults = await Promise.all(toolCalls.map(async tc => {
                        const tool = request.tools?.find(t => t.name === tc.name);
                        const argsObject = tc.args.length === 0 ? '{}' : tc.args;
                        const handlerResult: ToolCallResult = tool
                            ? await tool.handler(argsObject, ToolInvocationContext.create(tc.id))
                            : createToolCallError(`Tool '${tc.name}' not found in the available tools for this request.`, 'tool-not-available');
                        return { name: tc.name, result: handlerResult, id: tc.id, arguments: argsObject };
                    }));

                    // Yield finished tool calls with results
                    const calls = toolResults.map(tr => ({
                        finished: true as const,
                        id: tr.id,
                        result: tr.result,
                        function: { name: tr.name, arguments: tr.arguments },
                    }));
                    yield { tool_calls: calls };

                    // Build tool result message for next turn
                    const toolResponseMessage: CookbotMessageParam = {
                        role: 'user',
                        content: toolResults.map(call => ({
                            type: 'tool_result',
                            toolUseId: call.id,
                            toolResultContent: that.formatToolCallResult(call.result),
                            isError: that.hasError(call.result),
                        })),
                    };

                    // Build assistant message from accumulated content blocks
                    const assistantContent: CookbotContentPart[] = [];
                    for (const msg of currentMessages) {
                        assistantContent.push(...msg.content);
                    }
                    // Also add tool_use content parts for each tool call
                    for (const tc of toolCalls) {
                        assistantContent.push({
                            type: 'tool_use',
                            toolUseId: tc.id,
                            name: tc.name,
                            input: tc.args || '{}',
                        });
                    }
                    const assistantMessage: CookbotMessageParam = {
                        role: 'assistant',
                        content: assistantContent,
                    };

                    // Recurse with accumulated messages
                    const result = await that.handleStreamingRequest(
                        request,
                        cancellationToken,
                        [
                            ...(toolMessages ?? []),
                            assistantMessage,
                            toolResponseMessage,
                        ]
                    );

                    for await (const nestedEvent of result.stream) {
                        yield nestedEvent;
                    }
                }
            },
        };

        return { stream: asyncIterator };
    }

    /**
     * Process a single chunk from the gRPC stream, returning yield values
     * and updated state.
     */
    private processChunk(
        chunk: CookbotChatChunk,
        toolCalls: ToolCallback[],
        toolCall: ToolCallback | undefined,
        currentMessages: CookbotMessageParam[],
    ): {
        yields: LanguageModelStreamResponsePart[];
        toolCall: ToolCallback | undefined;
        inputTokens?: number;
        outputTokens?: number;
    } {
        const yields: LanguageModelStreamResponsePart[] = [];

        switch (chunk.type) {
            case 'content_block_start': {
                if (chunk.blockType === 'thinking' && chunk.thinking) {
                    yields.push({ thought: chunk.thinking, signature: '' });
                }
                if (chunk.blockType === 'text' && chunk.text) {
                    yields.push({ content: chunk.text });
                    currentMessages.push({
                        role: 'assistant',
                        content: [{ type: 'text', text: chunk.text }],
                    });
                }
                if (chunk.blockType === 'tool_use') {
                    toolCall = {
                        name: chunk.name!,
                        args: '',
                        id: chunk.id!,
                        index: chunk.index,
                    };
                    yields.push({
                        tool_calls: [{
                            finished: false,
                            id: toolCall.id,
                            function: { name: toolCall.name, arguments: toolCall.args },
                        }],
                    });
                }
                return { yields, toolCall };
            }

            case 'content_block_delta': {
                if (chunk.deltaType === 'thinking_delta') {
                    yields.push({ thought: chunk.text || '', signature: '' });
                }
                if (chunk.deltaType === 'signature_delta') {
                    yields.push({ thought: '', signature: chunk.signature || '' });
                }
                if (chunk.deltaType === 'text_delta') {
                    yields.push({ content: chunk.text || '' });
                    // Append to last text message
                    if (currentMessages.length > 0) {
                        const lastMsg = currentMessages[currentMessages.length - 1];
                        const lastPart = lastMsg.content[lastMsg.content.length - 1];
                        if (lastPart && lastPart.type === 'text') {
                            lastPart.text = (lastPart.text || '') + (chunk.text || '');
                        }
                    }
                }
                if (toolCall && chunk.deltaType === 'input_json_delta') {
                    toolCall.args += chunk.partialJson || '';
                    yields.push({
                        tool_calls: [{ function: { arguments: chunk.partialJson || '' } }],
                    });
                }
                return { yields, toolCall };
            }

            case 'content_block_stop': {
                if (toolCall && toolCall.index === chunk.index) {
                    toolCalls.push(toolCall);
                    toolCall = undefined;
                }
                return { yields, toolCall };
            }

            case 'message_start': {
                return {
                    yields,
                    toolCall,
                    inputTokens: chunk.inputTokens,
                };
            }

            case 'message_delta': {
                if (chunk.stopReason === 'max_tokens') {
                    if (toolCall) {
                        yields.push({ tool_calls: [{ finished: true, id: toolCall.id }] });
                    }
                    throw new Error(`The response was stopped because it exceeded the max token limit of ${chunk.outputTokens}.`);
                }
                return {
                    yields,
                    toolCall,
                    outputTokens: chunk.outputTokens,
                };
            }

            case 'message_stop': {
                return { yields, toolCall };
            }

            case 'error': {
                throw new Error(chunk.error || 'Unknown cookbot error');
            }

            case 'context_status':
            case 'compaction_info': {
                // Context management handled transparently
                return { yields, toolCall };
            }

            default:
                return { yields, toolCall };
        }
    }

    /**
     * Transform Theia LanguageModelMessages into CookbotMessageParams,
     * merging consecutive same-role messages into one (required by Anthropic API).
     */
    private transformMessages(messages: readonly LanguageModelMessage[]): CookbotMessageParam[] {
        const raw: CookbotMessageParam[] = [];

        for (const msg of messages) {
            if (LanguageModelMessage.isTextMessage(msg)) {
                if (msg.actor === 'system') {
                    // System messages are handled server-side via custom instructions
                    continue;
                }
                if (!msg.text) {
                    // Skip empty text messages — Anthropic rejects them
                    continue;
                }
                raw.push({
                    role: msg.actor === 'ai' ? 'assistant' : 'user',
                    content: [{ type: 'text', text: msg.text }],
                });
                continue;
            }

            if (LanguageModelMessage.isToolUseMessage(msg)) {
                raw.push({
                    role: 'assistant',
                    content: [{
                        type: 'tool_use',
                        toolUseId: msg.id,
                        name: msg.name,
                        input: typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input ?? {}),
                    }],
                });
                continue;
            }

            if (LanguageModelMessage.isToolResultMessage(msg)) {
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
                raw.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        toolUseId: msg.tool_use_id || '',
                        toolResultContent: content,
                        isError: msg.is_error,
                    }],
                });
                continue;
            }

            if (LanguageModelMessage.isThinkingMessage(msg)) {
                raw.push({
                    role: 'assistant',
                    content: [{
                        type: 'thinking',
                        thinking: msg.thinking,
                        signature: msg.signature || '',
                    }],
                });
                continue;
            }

            // Skip unknown message types (e.g. ImageMessage) rather than
            // creating empty text blocks that Anthropic would reject.
        }

        // Merge consecutive same-role messages into one
        const merged: CookbotMessageParam[] = [];
        for (const msg of raw) {
            const last = merged[merged.length - 1];
            if (last && last.role === msg.role) {
                last.content.push(...msg.content);
            } else {
                merged.push({ role: msg.role, content: [...msg.content] });
            }
        }

        return merged;
    }

    /**
     * Create tool definitions from the request's tools.
     */
    private createToolDefinitions(request: UserRequest): CookbotToolDefinition[] {
        if (!request.tools || request.tools.length === 0) {
            return [];
        }
        return request.tools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: JSON.stringify(tool.parameters || {}),
        }));
    }

    /**
     * Format a tool call result into a string suitable for the tool_result content.
     */
    private formatToolCallResult(result: ToolCallResult): string {
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

    /**
     * Check if a tool call result contains an error.
     */
    private hasError(result: ToolCallResult): boolean {
        return isToolCallContent(result) && result.content.some(part => part.type === 'error');
    }
}
