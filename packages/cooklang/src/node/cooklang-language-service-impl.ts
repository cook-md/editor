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

/* eslint-disable no-null/no-null */

// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

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
// eslint-disable-next-line import/no-extraneous-dependencies
import { MessageConnection } from 'vscode-languageserver-protocol/node';

@injectable()
export class CooklangLanguageServiceImpl implements CooklangLanguageService {

    private connection: MessageConnection | undefined;
    private nativeLsp: { sendMessage(msg: string): void; receiveMessage(): Promise<string | null> } | undefined;
    private initializePromise: Promise<CooklangInitializeResult> | undefined;
    private currentWorkspaceRoot: string | null | undefined;

    @postConstruct()
    protected init(): void {
        try {
            const native = require('@theia/cooklang-native');
            if (native && native.LspServer) {
                this.nativeLsp = new native.LspServer();
                this.connection = createNativeLspConnection(
                    (msg: string) => this.nativeLsp!.sendMessage(msg),
                    () => this.nativeLsp!.receiveMessage()
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
        // tower-lsp rejects a second `initialize` as "Invalid request". Since this service
        // is singleton-scoped on the backend, multiple frontend connects (e.g. window
        // reloads) must reuse the first init. Cache the promise and return it.
        if (this.initializePromise) {
            if (rootUri !== this.currentWorkspaceRoot) {
                console.info('[cooklang-lsp] Workspace root changed from',
                    this.currentWorkspaceRoot, 'to', rootUri,
                    '— notifying server via workspace/didChangeWorkspaceFolders');
                const added = rootUri ? [{ uri: rootUri, name: 'workspace' }] : [];
                const removed = this.currentWorkspaceRoot
                    ? [{ uri: this.currentWorkspaceRoot, name: 'workspace' }]
                    : [];
                // Wait for initialize to settle so the notification isn't delivered before
                // the server is ready to process it.
                await this.initializePromise.catch(() => undefined);
                this.connection.sendNotification('workspace/didChangeWorkspaceFolders', {
                    event: { added, removed }
                });
                this.currentWorkspaceRoot = rootUri;
            }
            return this.initializePromise;
        }
        this.currentWorkspaceRoot = rootUri;
        this.initializePromise = (async () => {
            const connection = this.connection!;
            console.info('[cooklang-lsp] Backend sending initialize with rootUri:', rootUri);
            const result = await connection.sendRequest('initialize', {
                processId: process.pid,
                capabilities: {},
                rootUri,
                workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
            });
            console.info('[cooklang-lsp] Initialize response received, sending initialized notification');
            await connection.sendNotification('initialized', {});
            console.info('[cooklang-lsp] Initialized notification sent');
            return result as CooklangInitializeResult;
        })();
        try {
            return await this.initializePromise;
        } catch (err) {
            this.initializePromise = undefined;
            this.currentWorkspaceRoot = undefined;
            throw err;
        }
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

    async findRecipe(baseDir: string, name: string): Promise<string | undefined> {
        const native = require('@theia/cooklang-native');
        const result = native.findRecipe(baseDir, name);
        return result ?? undefined;
    }
}
