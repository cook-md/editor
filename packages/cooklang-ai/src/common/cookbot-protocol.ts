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
 * A streaming chunk from the cookbot server, mirroring Anthropic SSE event types.
 */
export type CookbotChatChunk =
    | { type: 'content_block_start'; index: number; blockType: string; text?: string; thinking?: string; id?: string; name?: string }
    | { type: 'content_block_delta'; index: number; deltaType: string; text?: string; partialJson?: string; signature?: string }
    | { type: 'content_block_stop'; index: number }
    | { type: 'message_start'; id: string; model: string; inputTokens: number }
    | { type: 'message_delta'; stopReason: string; outputTokens: number }
    | { type: 'message_stop' }
    | { type: 'error'; error: string }
    | { type: 'context_status'; tokensUsed: number; tokenLimit: number; percentageUsed: number; compactionInProgress: boolean }
    | { type: 'compaction_info'; compactedHistory: CookbotMessageParam[]; summary: string; tokensBefore: number; tokensAfter: number; fallbackUsed: boolean };

/**
 * A message parameter for the chat request (supports multi-part content).
 */
export interface CookbotMessageParam {
    role: string;
    content: CookbotContentPart[];
}

/**
 * A single part of a message's content.
 */
export interface CookbotContentPart {
    type: string;
    text?: string;
    toolUseId?: string;
    name?: string;
    input?: string;
    toolResultContent?: string;
    isError?: boolean;
    thinking?: string;
    signature?: string;
}

/**
 * Tool definition sent to the server for Claude.
 */
export interface CookbotToolDefinition {
    name: string;
    description: string;
    inputSchema: string;
}
