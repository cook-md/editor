// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

/**
 * Result of initializing a session with the cookbot server.
 */
export interface CookbotInitResult {
    success: boolean;
    sessionId: string;
    serverVersion: string;
}

/**
 * A single chunk in a streaming chat response from the cookbot server.
 * Each chunk carries exactly one payload type identified by the `type` discriminator.
 */
export interface CookbotChatChunk {
    type:
        | 'text_delta'
        | 'thinking_delta'
        | 'tool_call'
        | 'tool_result'
        | 'tool_execution'
        | 'usage_info'
        | 'error'
        | 'stream_end'
        | 'context_status'
        | 'compaction_info';
    textDelta?: string;
    thinkingDelta?: { thinkingText: string; isSignature: boolean; signature: string };
    toolCall?: { toolId: string; toolName: string; toolInput: string };
    toolResult?: { toolId: string; toolName: string; success: boolean; result: string; error: string };
    toolExecution?: { toolName: string; status: string };
    usageInfo?: { tokensUsed: number; tokenLimit: number; warning: boolean; limitExceeded: boolean };
    contextStatus?: { tokensUsed: number; tokenLimit: number; percentageUsed: number; compactionInProgress: boolean };
    compactionInfo?: {
        compactedHistory: Array<{ role: string; content: string }>;
        summary: string;
        tokensBefore: number;
        tokensAfter: number;
        fallbackUsed: boolean;
    };
    error?: string;
    streamEnd?: boolean;
}

/**
 * A tool execution request dispatched from the cookbot server to the client.
 */
export interface CookbotToolRequest {
    executionId: string;
    toolName: string;
    parameters: Record<string, string>;
    internal: boolean;
}
