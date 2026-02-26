// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

export const CooklangLanguageServicePath = '/services/cooklang-language';
export const CooklangLanguageService = Symbol('CooklangLanguageService');

/**
 * LSP bridge service. The frontend calls these methods via RPC;
 * the backend forwards them to the in-process NAPI-RS LSP server.
 *
 * Parameters use primitives (not nested LSP param objects) to keep
 * the Theia RPC serialization straightforward.
 */
export interface CooklangLanguageService {
    // Lifecycle
    initialize(rootUri: string | null): Promise<CooklangInitializeResult>;
    shutdown(): Promise<void>;

    // Document sync (fire-and-forget notifications)
    didOpenTextDocument(uri: string, languageId: string, version: number, text: string): void;
    didChangeTextDocument(uri: string, version: number, text: string): void;
    didCloseTextDocument(uri: string): void;
    didSaveTextDocument(uri: string): void;

    // Language features (request/response)
    completion(uri: string, line: number, character: number): Promise<CooklangCompletionList | null>;
    hover(uri: string, line: number, character: number): Promise<CooklangHover | null>;
    documentSymbol(uri: string): Promise<CooklangDocumentSymbol[] | null>;
    semanticTokensFull(uri: string): Promise<CooklangSemanticTokens | null>;

    // Recipe parsing (returns JSON-serialized ParseResult)
    parse(content: string): Promise<string>;

    // Shopping list generation
    generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null): Promise<string>;
}

// Plain JSON DTOs — subsets of vscode-languageserver-protocol types
// kept as simple interfaces so they serialize cleanly over Theia RPC.

export interface CooklangInitializeResult {
    capabilities: {
        semanticTokensProvider?: {
            legend: {
                tokenTypes: string[];
                tokenModifiers: string[];
            };
            full: boolean;
        };
    };
}

export interface CooklangCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string;
    insertText?: string;
    insertTextFormat?: number;
}

export interface CooklangCompletionList {
    isIncomplete: boolean;
    items: CooklangCompletionItem[];
}

export interface CooklangHover {
    contents: CooklangMarkupContent;
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface CooklangMarkupContent {
    kind: string;
    value: string;
}

export interface CooklangDocumentSymbol {
    name: string;
    kind: number;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
    children?: CooklangDocumentSymbol[];
}

export interface CooklangSemanticTokens {
    resultId?: string;
    data: number[];
}
