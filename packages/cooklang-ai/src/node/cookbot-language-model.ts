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

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import {
    LanguageModel,
    LanguageModelResponse,
    LanguageModelStreamResponse,
    LanguageModelStreamResponsePart,
    UserRequest,
    LanguageModelMessage,
    ToolCallResult,
    ToolInvocationContext,
    ToolRequest,
    createToolCallError,
    isToolCallContent,
    isTextResponsePart,
    isThinkingResponsePart,
    isToolCallResponsePart,
} from '@theia/ai-core/lib/common';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotSessionInitializer } from './cookbot-session-initializer';
import {
    CookbotChatChunk,
    CookbotMessageParam,
    CookbotContentPart,
    CookbotToolDefinition,
} from '../common/cookbot-protocol';
import { CookbotError } from '../common/cookbot-error';
import { RECIPE_FOLDER_RELOADING } from '../common/tool-markers';
import { ErrorReporter } from '@theia/cooklang-telemetry/lib/common/error-reporter';

interface ToolCallback {
    readonly name: string;
    readonly id: string;
    readonly index: number;
    args: string;
}

/** Sent with the last tool round a single user message may use. */
const ROUND_LIMIT_NOTE =
    'Tool-round limit reached for this request. Do not call more tools. Reply to the user now: '
    + 'what is done, what is staged for review, and what is left for them to ask next.';

/** Shown when the model still asks for tools after the round limit. */
const STEP_LIMIT_TEXT =
    'CookBot hit its step limit for one message. Anything it proposed is in the Changes panel — ask it to continue.';

/** Shown when tools ran but the model ended the turn without a reply. */
const NO_REPLY_TEXT =
    '_CookBot stopped without a reply. Anything it proposed is in the Changes panel._';

/** Tools that wait on the user (a native dialog) and must never be timed out. */
const UNTIMED_TOOLS = new Set(['openRecipeFolder']);

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

    @inject(CookbotSessionInitializer)
    protected readonly sessionInitializer: CookbotSessionInitializer;

    // Optional: error reporting is a separate extension, and the language model
    // must keep working when it is absent.
    @inject(ErrorReporter) @optional()
    protected readonly errorReporter?: ErrorReporter;

    /** A tool that has not answered by then is reported to the model as timed out. */
    protected toolTimeoutMs = 120_000;

    /**
     * Tool rounds one user message may use. The worst prompt in the 09-18
     * export used 16, before the bulk metadata tools existed.
     */
    protected maxToolRounds = 30;

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        await this.sessionInitializer.ensureInitialized();
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

        // Each tool round appends one assistant message and one tool-result
        // message, so the history tail length counts the rounds already run.
        const round = (toolMessages?.length ?? 0) / 2;
        const isTopLevel = toolMessages === undefined;

        const that = this;
        const asyncIterator = {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<LanguageModelStreamResponsePart> {
                let sessionRetryDone = false;
                let connectionRetryDone = false;
                let contentProduced = false;
                let toolCalls: ToolCallback[];
                let currentMessages: CookbotMessageParam[];
                let currentInputTokens = 0;
                let currentOutputTokens = 0;

                // Whether the turn ran tools and whether any text followed the
                // last of them — nested rounds are re-yielded through here.
                let toolsRan = false;
                let textAfterTools = false;
                const track = (part: LanguageModelStreamResponsePart): void => {
                    if (isToolCallResponsePart(part) && part.tool_calls.some(tc => tc.finished)) {
                        toolsRan = true;
                        textAfterTools = false;
                    } else if (isTextResponsePart(part) && part.content.length > 0) {
                        textAfterTools = true;
                    }
                };

                // Two failures are recoverable without bothering the user, as long as
                // nothing has been streamed to the UI yet:
                //  - UNAUTHENTICATED (16): the server invalidates idle sessions, so the
                //    first request after a long idle fails. Re-initialize and retry.
                //  - UNAVAILABLE (14): an idle connection was dropped upstream (usually
                //    `read ECONNRESET`). Reconnect and retry.
                attempt: while (true) {
                    toolCalls = [];
                    let toolCall: ToolCallback | undefined;
                    currentMessages = [];
                    currentInputTokens = 0;
                    currentOutputTokens = 0;
                    let partsYielded = false;

                    const { stream: grpcStream } = that.grpcClient.sendMessage(allMessages, tools, token);

                    try {
                        for await (const chunk of grpcStream) {
                            const parts = that.processChunk(chunk, toolCalls, toolCall, currentMessages);
                            for (const part of parts.yields) {
                                partsYielded = true;
                                contentProduced = contentProduced || CookbotLanguageModel.isVisibleContent(part);
                                track(part);
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
                        break;
                    } catch (error: unknown) {
                        if (CookbotError.isSessionExpired(error)) {
                            that.sessionInitializer.reset();
                            if (!sessionRetryDone && !partsYielded) {
                                sessionRetryDone = true;
                                console.info('[CookbotLM] Session expired, re-initializing and retrying');
                                await that.sessionInitializer.ensureInitialized();
                                continue attempt;
                            }
                        } else if (CookbotError.isTransientConnection(error) && !connectionRetryDone && !partsYielded) {
                            connectionRetryDone = true;
                            console.info('[CookbotLM] Connection lost, reconnecting and retrying');
                            that.grpcClient.reconnect();
                            continue attempt;
                        }
                        console.error('[CookbotLM] Request failed:', error);
                        that.reportIfUnexpected(error);
                        throw CookbotError.toUserFacing(error);
                    }
                }

                // Yield usage info
                if (currentInputTokens || currentOutputTokens) {
                    yield { input_tokens: currentInputTokens, output_tokens: currentOutputTokens };
                }

                // Tool loop: execute tools and recurse
                if (toolCalls.length > 0) {
                    if (round >= that.maxToolRounds) {
                        // Close the tool calls the UI already shows as pending,
                        // then stop: the model was told to wrap up and did not.
                        const notRun = {
                            tool_calls: toolCalls.map(tc => ({
                                finished: true as const,
                                id: tc.id,
                                result: createToolCallError('Not run: step limit reached.'),
                                function: { name: tc.name, arguments: tc.args || '{}' },
                            })),
                        };
                        yield notRun;
                        yield { content: STEP_LIMIT_TEXT };
                        return;
                    }

                    const toolResults = await Promise.all(toolCalls.map(async tc => {
                        const tool = request.tools?.find(t => t.name === tc.name);
                        const argsObject = tc.args.length === 0 ? '{}' : tc.args;
                        const handlerResult: ToolCallResult = tool
                            ? await that.runTool(tool, argsObject, tc.id, token)
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
                    const finishedCalls = { tool_calls: calls };
                    track(finishedCalls);
                    yield finishedCalls;

                    // openRecipeFolder already called workspaceService.open() and
                    // the window is on its way down for the reload: don't spend
                    // another paid model round talking to a chat that is about
                    // to disappear, and don't add a closing line to it either.
                    const reloading = toolResults.some(tr =>
                        UNTIMED_TOOLS.has(tr.name) && that.formatToolCallResult(tr.result).includes(RECIPE_FOLDER_RELOADING));
                    if (reloading) {
                        return;
                    }

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
                    if (round + 1 === that.maxToolRounds) {
                        toolResponseMessage.content.push({ type: 'text', text: ROUND_LIMIT_NOTE });
                    }

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

                    // The user pressed stop while a tool was running (or right
                    // after). Its result is already yielded above; don't spend
                    // another model call the user just tried to cancel.
                    if (token?.isCancellationRequested) {
                        return;
                    }

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
                        contentProduced = contentProduced || CookbotLanguageModel.isVisibleContent(nestedEvent);
                        track(nestedEvent);
                        yield nestedEvent;
                    }
                }

                // Only the outermost call judges the turn as a whole; a nested
                // round that adds nothing after its tools is not a failure.
                if (!isTopLevel || token?.isCancellationRequested) {
                    return;
                }
                if (toolsRan && !textAfterTools) {
                    yield { content: NO_REPLY_TEXT };
                    return;
                }
                // A stream that completes without a single content block is a
                // failure the user cannot see otherwise - it renders as a blank
                // assistant turn. Report it instead of yielding nothing.
                if (!contentProduced) {
                    console.error('[CookbotLM] Stream completed without producing any content');
                    throw CookbotError.emptyResponse();
                }
            },
        };

        return { stream: asyncIterator };
    }

    /**
     * Hand a caught failure to error tracking, unless it is a normal outcome.
     *
     * These errors are turned into a chat message rather than rethrown, so
     * nothing reports them automatically - Sentry only sees unhandled
     * exceptions. Expected outcomes are skipped so real defects stay visible.
     */
    protected reportIfUnexpected(error: unknown): void {
        if (!this.errorReporter || CookbotError.isExpected(error)) {
            return;
        }
        const code = CookbotError.statusCode(error);
        this.errorReporter.reportUnexpected(error, {
            component: 'cookbot-language-model',
            ...(code === undefined ? {} : { grpcCode: String(code) })
        });
    }

    /**
     * Runs one tool handler, giving up after `toolTimeoutMs` so a handler that
     * never resolves cannot stall the turn forever, and racing `token` so a
     * cancelled request does not wait for it either. The handler keeps
     * running in both cases - Theia's wrapper still calls `complete()` on it
     * when it eventually resolves, so it may still stage changes - only its
     * result is no longer awaited here. A handler that throws is turned into
     * a tool_result error instead of failing the whole turn.
     */
    protected async runTool(tool: ToolRequest, args: string, toolUseId: string, token?: CancellationToken): Promise<ToolCallResult> {
        const call = tool.handler(args, ToolInvocationContext.create(toolUseId))
            .catch((error: unknown) => createToolCallError(`${tool.name} failed: ${CookbotLanguageModel.errorMessage(error)}`));
        if (UNTIMED_TOOLS.has(tool.name)) {
            return call;
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<ToolCallResult>(resolve => {
            timer = setTimeout(() => resolve(createToolCallError(
                `${tool.name} did not answer within ${Math.max(1, Math.round(this.toolTimeoutMs / 1000))} s `
                + 'and may still finish in the background. Tell the user it is taking too long and to check '
                + 'the Changes panel; do not retry it automatically.'
            )), this.toolTimeoutMs);
        });

        let cancelListener: Disposable | undefined;
        const cancellation = new Promise<ToolCallResult>(resolve => {
            if (!token) {
                return;
            }
            if (token.isCancellationRequested) {
                resolve(createToolCallError(`${tool.name} was cancelled.`));
                return;
            }
            cancelListener = token.onCancellationRequested(() => resolve(createToolCallError(`${tool.name} was cancelled.`)));
        });

        try {
            return await Promise.race([call, timeout, cancellation]);
        } finally {
            clearTimeout(timer);
            cancelListener?.dispose();
        }
    }

    /** Renders a caught value as a message, whether or not it is an `Error`. */
    private static errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Whether a stream part carries something the user can see. Token usage
     * parts, empty text deltas and bare signature deltas do not count: a
     * response consisting only of those renders as a blank assistant turn.
     */
    protected static isVisibleContent(part: LanguageModelStreamResponsePart): boolean {
        if (isTextResponsePart(part)) {
            return part.content.length > 0;
        }
        if (isThinkingResponsePart(part)) {
            return part.thought.length > 0;
        }
        if (isToolCallResponsePart(part)) {
            return part.tool_calls.length > 0;
        }
        return false;
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
                // A thinking block is only replayable with the signature the
                // model issued for it. A stream cut short before its
                // `signature_delta` leaves one behind unsigned, and sending
                // that with a blank signature earns
                // `messages.N.content.0: Invalid \`signature\` in \`thinking\` block` -
                // permanently, because the history is re-sent every turn. Drop
                // it instead: losing the reasoning costs this turn's context,
                // sending it costs the whole session.
                if (msg.signature) {
                    raw.push({
                        role: 'assistant',
                        content: [{
                            type: 'thinking',
                            thinking: msg.thinking,
                            signature: msg.signature,
                        }],
                    });
                }
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
     *
     * A Theia `error` content part is the structured case, but none of the
     * cooklang or workspace tools produce one: their handlers return a plain
     * string, and a failure is `{"error": "..."}` inside it (see
     * `workspace-functions.ts`). Reading only the structured part reported
     * every one of those as a success — a run of six "File not found" replies
     * logged clean, and the server-side `tool_calls` table held zero errors
     * across every session it had ever recorded. Inspect the payload too.
     */
    private hasError(result: ToolCallResult): boolean {
        if (isToolCallContent(result) && result.content.some(part => part.type === 'error')) {
            return true;
        }
        return this.payloadReportsError(this.formatToolCallResult(result));
    }

    /**
     * Whether a formatted tool result is a `{"error": "..."}` failure report.
     *
     * Narrow on purpose: only a JSON object whose top-level `error` is a
     * non-empty string counts. A recipe that merely mentions the word, or a
     * success carrying `"error": null`, is not a failure. Mirrored in the
     * server's `payload_reports_error` (`crates/server/src/grpc/tool_log.rs`),
     * which is the backstop for clients that never set the flag at all.
     */
    private payloadReportsError(content: string): boolean {
        const trimmed = content.trimStart();
        if (!trimmed.startsWith('{')) {
            return false;
        }
        try {
            const message = JSON.parse(trimmed)?.error;
            return typeof message === 'string' && message.trim().length > 0;
        } catch {
            return false;
        }
    }
}
