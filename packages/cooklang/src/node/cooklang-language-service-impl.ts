// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    CooklangLanguageService,
    CooklangInitializeResult,
    CooklangCompletionList,
    CooklangHover,
    CooklangDocumentSymbol,
    CooklangSemanticTokens
} from '../common/cooklang-language-service';
import { createNativeLspConnection } from './cooklang-language-server-connection';
import { MessageConnection } from 'vscode-languageserver-protocol/node';

@injectable()
export class CooklangLanguageServiceImpl implements CooklangLanguageService {

    private connection: MessageConnection | undefined;
    private nativeLsp: any;

    @postConstruct()
    protected init(): void {
        try {
            const native = require('@theia/cooklang-native');
            if (native && native.LspServer) {
                this.nativeLsp = new native.LspServer();
                this.connection = createNativeLspConnection(
                    (msg: string) => this.nativeLsp.sendMessage(msg),
                    () => this.nativeLsp.receiveMessage()
                );
                // Capture server-to-client notifications
                this.connection.onNotification('window/logMessage', (params: { type: number; message: string }) => {
                    console.info('[cooklang-lsp-rust]', params.message);
                });
                this.connection.listen();
                console.info('Cooklang LSP server started in-process');
            }
        } catch (error) {
            console.warn('Cooklang native addon not available, LSP features disabled:', error);
        }
    }

    // --- Lifecycle ---

    async initialize(rootUri: string | null): Promise<CooklangInitializeResult> {
        if (!this.connection) {
            console.warn('[cooklang-lsp] No connection available, skipping initialize');
            return { capabilities: {} };
        }
        console.info('[cooklang-lsp] Backend sending initialize with rootUri:', rootUri);
        const result = await this.connection.sendRequest('initialize', {
            processId: process.pid,
            capabilities: {},
            rootUri,
            workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
        });
        console.info('[cooklang-lsp] Initialize response received, sending initialized notification');
        await this.connection.sendNotification('initialized', {});
        console.info('[cooklang-lsp] Initialized notification sent');
        return result as CooklangInitializeResult;
    }

    async shutdown(): Promise<void> {
        if (!this.connection) {
            return;
        }
        await this.connection.sendRequest('shutdown');
        this.connection.sendNotification('exit');
        this.connection.dispose();
    }

    // --- Document sync ---

    didOpenTextDocument(uri: string, languageId: string, version: number, text: string): void {
        this.connection?.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version, text }
        });
    }

    didChangeTextDocument(uri: string, version: number, text: string): void {
        this.connection?.sendNotification('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text }]
        });
    }

    didCloseTextDocument(uri: string): void {
        this.connection?.sendNotification('textDocument/didClose', {
            textDocument: { uri }
        });
    }

    didSaveTextDocument(uri: string): void {
        this.connection?.sendNotification('textDocument/didSave', {
            textDocument: { uri }
        });
    }

    // --- Language features ---

    async completion(uri: string, line: number, character: number): Promise<CooklangCompletionList | null> {
        if (!this.connection) {
            return null;
        }
        const result = await this.connection.sendRequest('textDocument/completion', {
            textDocument: { uri },
            position: { line, character }
        });
        if (!result) {
            console.info('[cooklang-lsp] Completion returned null');
            return null;
        }
        // LSP returns CompletionList | CompletionItem[] — normalize to list
        if (Array.isArray(result)) {
            console.info('[cooklang-lsp] Completion returned', result.length, 'items (array)');
            return { isIncomplete: false, items: result };
        }
        const list = result as CooklangCompletionList;
        console.info('[cooklang-lsp] Completion returned', list.items?.length, 'items');
        return list;
    }

    async hover(uri: string, line: number, character: number): Promise<CooklangHover | null> {
        if (!this.connection) {
            return null;
        }
        return await this.connection.sendRequest('textDocument/hover', {
            textDocument: { uri },
            position: { line, character }
        }) as CooklangHover | null;
    }

    async documentSymbol(uri: string): Promise<CooklangDocumentSymbol[] | null> {
        if (!this.connection) {
            return null;
        }
        return await this.connection.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri }
        }) as CooklangDocumentSymbol[] | null;
    }

    async semanticTokensFull(uri: string): Promise<CooklangSemanticTokens | null> {
        if (!this.connection) {
            return null;
        }
        return await this.connection.sendRequest('textDocument/semanticTokens/full', {
            textDocument: { uri }
        }) as CooklangSemanticTokens | null;
    }

    async parse(content: string): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.parse(content);
        } catch (error) {
            console.error('[cooklang] Failed to parse recipe:', error);
            return JSON.stringify({ recipe: null, errors: [{ message: String(error), severity: 'error' }], warnings: [] });
        }
    }

    async parseMenu(content: string, scale: number): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.parseMenu(content, scale);
        } catch (error) {
            console.error('[cooklang] Failed to parse menu:', error);
            return JSON.stringify({ metadata: null, sections: [], errors: [{ message: String(error), severity: 'error' }], warnings: [] });
        }
    }

    async generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.generateShoppingList(
                recipesJson,
                aisleConf ?? undefined,
                pantryConf ?? undefined
            );
        } catch (error) {
            console.error('[cooklang] Failed to generate shopping list:', error);
            return JSON.stringify({ categories: [], other: { name: 'other', items: [] }, pantryItems: [] });
        }
    }

    async parseShoppingList(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parseShoppingList(text);
    }

    async writeShoppingList(json: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.writeShoppingList(json);
    }

    async parseChecked(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parseChecked(text);
    }

    async writeCheckEntry(entryJson: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.writeCheckEntry(entryJson);
    }

    async checkedSet(entriesJson: string): Promise<string[]> {
        const native = require('@theia/cooklang-native');
        return native.checkedSet(entriesJson);
    }

    async compactChecked(entriesJson: string, currentIngredients: string[]): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.compactChecked(entriesJson, currentIngredients);
    }
}
