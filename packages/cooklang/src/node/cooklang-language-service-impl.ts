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

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ErrorReporter } from '@theia/cooklang-telemetry/lib/common/error-reporter';
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

/** The in-process language server exported by the native addon. */
export interface CooklangNativeLspServer {
    sendMessage(msg: string): void;
    receiveMessage(): Promise<Buffer | null>;
}

interface CooklangOpenDocument {
    languageId: string;
    version: number;
    text: string;
}

/** Restarts allowed within {@link RESTART_WINDOW_MS} before the server is left down for a while. */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

@injectable()
export class CooklangLanguageServiceImpl implements CooklangLanguageService {

    // Optional: error reporting is a separate extension, and language support
    // must keep working when it is absent.
    @inject(ErrorReporter) @optional()
    protected readonly errorReporter?: ErrorReporter;

    /** The connection requests go to. Undefined while the server is down or still restarting. */
    private connection: MessageConnection | undefined;
    /** Whether the native addon provides a language server at all. */
    private nativeAvailable = false;
    private initializePromise: Promise<CooklangInitializeResult> | undefined;
    private currentWorkspaceRoot: string | null | undefined;
    /** The restart in flight, shared by every caller that finds the server down. */
    private recovery: Promise<MessageConnection | undefined> | undefined;
    /** What the frontend has open, so a restarted server can be brought back in sync. */
    private readonly openDocuments = new Map<string, CooklangOpenDocument>();
    private restartTimes: number[] = [];

    @postConstruct()
    protected init(): void {
        this.connection = this.startServer();
        this.nativeAvailable = this.connection !== undefined;
        if (this.connection) {
            console.info('Cooklang LSP server started in-process');
        }
    }

    protected createNativeLspServer(): CooklangNativeLspServer | undefined {
        const native = require('@theia/cooklang-native');
        return native && native.LspServer ? new native.LspServer() : undefined;
    }

    /** Start a server and connect to it. The caller decides when it becomes `this.connection`. */
    protected startServer(): MessageConnection | undefined {
        try {
            const nativeLsp = this.createNativeLspServer();
            if (!nativeLsp) {
                return undefined;
            }
            const connection = createNativeLspConnection(
                (msg: string) => nativeLsp.sendMessage(msg),
                () => nativeLsp.receiveMessage()
            );
            // Capture server-to-client notifications
            connection.onNotification('window/logMessage', (params: { type: number; message: string }) => {
                console.info('[cooklang-lsp-rust]', params.message);
            });
            let lastError: Error | undefined;
            connection.onError(([error]) => {
                lastError = error;
                console.error('[cooklang-lsp] Connection error:', error);
            });
            connection.onClose(() => this.handleConnectionClosed(connection, lastError));
            connection.listen();
            return connection;
        } catch (error) {
            console.warn('Cooklang native addon not available, LSP features disabled:', error);
            return undefined;
        }
    }

    /**
     * A closed connection never reopens: the server task has ended or its
     * output could not be read. Drop it so the next call starts a fresh server.
     */
    protected handleConnectionClosed(connection: MessageConnection, cause: Error | undefined): void {
        // Closing alone leaves in-flight requests pending forever; disposing rejects them.
        connection.dispose();
        if (this.connection !== connection) {
            // Shut down on purpose, or closed mid-restart (recover() reports that).
            return;
        }
        this.connection = undefined;
        this.reportServerDown('Cooklang language server stopped unexpectedly', cause);
    }

    protected reportServerDown(message: string, cause: unknown): void {
        const detail = cause instanceof Error ? cause.message : cause !== undefined ? String(cause) : undefined;
        const error = new Error(detail ? `${message}: ${detail}` : message);
        console.error('[cooklang-lsp]', error.message);
        this.errorReporter?.reportUnexpected(error, { area: 'cooklang-lsp' });
    }

    /** The live connection, restarting the server first if it went down. Never rejects. */
    protected async ensureConnection(): Promise<MessageConnection | undefined> {
        if (this.connection) {
            return this.connection;
        }
        if (!this.nativeAvailable) {
            return undefined;
        }
        if (!this.recovery) {
            this.recovery = this.recover().finally(() => this.recovery = undefined);
        }
        return this.recovery;
    }

    protected async recover(): Promise<MessageConnection | undefined> {
        if (!this.canRestart()) {
            return undefined;
        }
        const connection = this.startServer();
        if (!connection) {
            return undefined;
        }
        try {
            const initialized = this.sendInitialize(connection, this.currentWorkspaceRoot ?? null);
            await initialized;
            this.initializePromise = initialized;
            // Documents are replayed and the connection published in the same
            // tick, so a change arriving during the restart is never lost: it
            // either updated `openDocuments` before the replay or is sent after.
            for (const [uri, document] of this.openDocuments) {
                this.notify(connection, 'textDocument/didOpen', {
                    textDocument: { uri, languageId: document.languageId, version: document.version, text: document.text }
                });
            }
            this.connection = connection;
            console.info('[cooklang-lsp] Language server restarted,', this.openDocuments.size, 'document(s) reopened');
            return connection;
        } catch (error) {
            connection.dispose();
            this.reportServerDown('Cooklang language server failed to restart', error);
            return undefined;
        }
    }

    /** A server that keeps dying (say, on one of the open documents) must not be restarted on every keystroke. */
    protected canRestart(): boolean {
        const now = Date.now();
        this.restartTimes = this.restartTimes.filter(time => now - time < RESTART_WINDOW_MS);
        if (this.restartTimes.length >= MAX_RESTARTS) {
            return false;
        }
        this.restartTimes.push(now);
        if (this.restartTimes.length === MAX_RESTARTS) {
            console.warn('[cooklang-lsp] Restart', MAX_RESTARTS, 'of', MAX_RESTARTS, '- language features stay off for a while if it stops again');
        }
        return true;
    }

    protected async sendInitialize(connection: MessageConnection, rootUri: string | null): Promise<CooklangInitializeResult> {
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
    }

    protected notify(connection: MessageConnection, method: string, params: unknown): void {
        const failed = (error: unknown) => console.warn('[cooklang-lsp] Could not send', method, '-', error);
        try {
            connection.sendNotification(method, params).catch(failed);
        } catch (error) {
            failed(error);
        }
    }

    /** Send a request, or resolve to null when the server is down: language features degrade, they do not throw. */
    protected async request<T>(method: string, params: unknown): Promise<T | null> {
        const connection = await this.ensureConnection();
        if (!connection) {
            return null;
        }
        try {
            return await connection.sendRequest(method, params) as T | null;
        } catch (error) {
            if (this.connection !== connection) {
                // The server went down mid-request; that was reported once when it closed.
                return null;
            }
            throw error;
        }
    }

    // --- Lifecycle ---

    async initialize(rootUri: string | null): Promise<CooklangInitializeResult> {
        if (!this.connection) {
            if (!this.nativeAvailable) {
                console.warn('[cooklang-lsp] No connection available, skipping initialize');
                return { capabilities: {} };
            }
            // The server is down (crashed, or shut down by a closing window): bring it back for this root.
            if (!this.recovery) {
                this.currentWorkspaceRoot = rootUri;
            }
            await this.ensureConnection();
            if (!this.connection || !this.initializePromise) {
                return { capabilities: {} };
            }
        }
        const connection = this.connection;
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
                this.notify(connection, 'workspace/didChangeWorkspaceFolders', {
                    event: { added, removed }
                });
                this.currentWorkspaceRoot = rootUri;
            }
            return this.initializePromise;
        }
        this.currentWorkspaceRoot = rootUri;
        this.initializePromise = this.sendInitialize(connection, rootUri);
        try {
            return await this.initializePromise;
        } catch (err) {
            this.initializePromise = undefined;
            this.currentWorkspaceRoot = undefined;
            throw err;
        }
    }

    async shutdown(): Promise<void> {
        const connection = this.connection;
        if (!connection) {
            return;
        }
        // Cleared first so the close that follows `exit` is not taken for a crash.
        // A later call (a reloaded window, another window) starts a fresh server.
        this.connection = undefined;
        try {
            await connection.sendRequest('shutdown');
            await connection.sendNotification('exit');
        } finally {
            connection.dispose();
        }
    }

    // --- Document sync ---

    didOpenTextDocument(uri: string, languageId: string, version: number, text: string): void {
        this.openDocuments.set(uri, { languageId, version, text });
        this.notifyDocument('textDocument/didOpen', {
            textDocument: { uri, languageId, version, text }
        });
    }

    didChangeTextDocument(uri: string, version: number, text: string): void {
        const document = this.openDocuments.get(uri);
        if (document) {
            document.version = version;
            document.text = text;
        }
        this.notifyDocument('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text }]
        });
    }

    didCloseTextDocument(uri: string): void {
        this.openDocuments.delete(uri);
        this.notifyDocument('textDocument/didClose', {
            textDocument: { uri }
        });
    }

    didSaveTextDocument(uri: string): void {
        this.notifyDocument('textDocument/didSave', {
            textDocument: { uri }
        });
    }

    protected notifyDocument(method: string, params: unknown): void {
        if (this.connection) {
            this.notify(this.connection, method, params);
            return;
        }
        // Down: nothing to send. The restart reopens every document in its
        // current state, which covers whatever this notification said.
        this.ensureConnection();
    }

    // --- Language features ---

    async completion(uri: string, line: number, character: number): Promise<CooklangCompletionList | null> {
        const result = await this.request<CooklangCompletionList | unknown[]>('textDocument/completion', {
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
            return { isIncomplete: false, items: result as CooklangCompletionList['items'] };
        }
        const list = result as CooklangCompletionList;
        console.info('[cooklang-lsp] Completion returned', list.items?.length, 'items');
        return list;
    }

    hover(uri: string, line: number, character: number): Promise<CooklangHover | null> {
        return this.request<CooklangHover>('textDocument/hover', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    documentSymbol(uri: string): Promise<CooklangDocumentSymbol[] | null> {
        return this.request<CooklangDocumentSymbol[]>('textDocument/documentSymbol', {
            textDocument: { uri }
        });
    }

    semanticTokensFull(uri: string): Promise<CooklangSemanticTokens | null> {
        return this.request<CooklangSemanticTokens>('textDocument/semanticTokens/full', {
            textDocument: { uri }
        });
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

    async generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null, freeHandJson?: string): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.generateShoppingList(
                recipesJson,
                aisleConf ?? undefined,
                pantryConf ?? undefined,
                freeHandJson
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

    async findRecipePath(baseDir: string, name: string): Promise<string | undefined> {
        const native = require('@theia/cooklang-native');
        const result = native.findRecipePath(baseDir, name);
        return result ?? undefined;
    }

    async recipeImages(recipePath: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.recipeImages(recipePath);
    }

    async recipeImagesFromContent(content: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.recipeImagesFromContent(content);
    }

    async searchRecipes(baseDir: string, query: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.searchRecipes(baseDir, query);
    }

    async searchRecipesFiltered(baseDir: string, query: string, filterJson: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.searchRecipesFiltered(baseDir, query, filterJson);
    }

    async parsePantry(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parsePantry(text);
    }

    async checkPantry(text: string, names: string[]): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.checkPantry(text, names);
    }

    async editPantry(text: string, editJson: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.editPantry(text, editJson);
    }

    async renderReport(recipeContent: string, templateContent: string, configJson: string): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            // Async: rendering (and any nutrition HTTP calls a template makes)
            // runs on the libuv threadpool, keeping the backend event loop free.
            return await native.renderReportAsync(recipeContent, templateContent, this.convertReportConfigPaths(configJson));
        } catch (error) {
            console.error('[cooklang] Failed to render report:', error);
            return JSON.stringify({ error: String(error) });
        }
    }

    /**
     * The frontend sends path-like config entries as URI strings (URIs cross
     * the wire, never raw paths); the native addon needs OS filesystem paths.
     */
    protected convertReportConfigPaths(configJson: string): string {
        const config = JSON.parse(configJson) as Record<string, unknown>;
        for (const key of ['basePath', 'aislePath', 'pantryPath', 'datastorePath']) {
            const value = config[key];
            if (typeof value === 'string') {
                config[key] = FileUri.fsPath(value);
            }
        }
        const staged = config.stagedRecipes;
        if (staged && typeof staged === 'object') {
            config.stagedRecipes = Object.fromEntries(
                Object.entries(staged as Record<string, unknown>).map(([uri, content]) => [FileUri.fsPath(uri), content]));
        }
        return JSON.stringify(config);
    }
}
