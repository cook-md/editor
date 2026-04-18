/* eslint-disable no-null/no-null */

// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID } from '../common';
import {
    CooklangLanguageService,
    CooklangCompletionItem,
    CooklangHover,
    CooklangDocumentSymbol,
    CooklangInitializeResult
} from '../common/cooklang-language-service';

@injectable()
export class CooklangLanguageClientContribution implements FrontendApplicationContribution {

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();
    protected semanticTokensLegend: monaco.languages.SemanticTokensLegend | undefined;
    protected documentVersions = new Map<string, number>();

    async onStart(): Promise<void> {
        await this.workspaceService.roots;
        const roots = this.workspaceService.tryGetRoots();
        const rootUri = roots.length > 0 ? roots[0].resource.toString() : null;
        console.info('[cooklang-lsp] Frontend sending rootUri:', rootUri);

        try {
            const result = await this.service.initialize(rootUri);
            console.info('[cooklang-lsp] Initialize result capabilities:', JSON.stringify(result.capabilities));
            this.extractSemanticTokensLegend(result);
        } catch (error) {
            console.warn('Failed to initialize Cooklang LSP server:', error);
            return;
        }

        this.registerDocumentListeners();
        this.registerCompletionProvider();
        this.registerHoverProvider();
        this.registerDocumentSymbolProvider();
        this.registerSemanticTokensProvider();
        this.syncAlreadyOpenDocuments();
        // Documents may be restored after onStart; retry sync after a delay
        setTimeout(() => this.syncAlreadyOpenDocuments(), 3000);
    }

    onStop(): void {
        this.toDispose.dispose();
        this.service.shutdown().catch(err =>
            console.warn('Failed to shutdown Cooklang LSP:', err)
        );
    }

    // --- Initialization helpers ---

    protected extractSemanticTokensLegend(result: CooklangInitializeResult): void {
        const semTokens = result.capabilities?.semanticTokensProvider;
        if (semTokens?.legend) {
            this.semanticTokensLegend = {
                tokenTypes: semTokens.legend.tokenTypes,
                tokenModifiers: semTokens.legend.tokenModifiers
            };
        }
    }

    // --- Sync documents already open before listeners were registered ---

    protected syncAlreadyOpenDocuments(): void {
        const models = monaco.editor.getModels();
        console.info('[cooklang-lsp] syncAlreadyOpenDocuments: found', models.length, 'models');
        for (const model of models) {
            const langId = model.getLanguageId();
            const uri = model.uri.toString();
            console.info('[cooklang-lsp]   model:', uri, 'lang:', langId);
            if (langId === COOKLANG_LANGUAGE_ID && !this.documentVersions.has(uri)) {
                const version = 1;
                this.documentVersions.set(uri, version);
                console.info('[cooklang-lsp] Syncing already-open document:', uri);
                this.service.didOpenTextDocument(uri, langId, version, model.getValue());
            }
        }
    }

    // --- Monaco provider registration ---

    protected registerCompletionProvider(): void {
        console.info('[cooklang-lsp] Registering completion provider for language:', COOKLANG_LANGUAGE_ID);
        this.toDispose.push(monaco.languages.registerCompletionItemProvider(COOKLANG_LANGUAGE_ID, {
            triggerCharacters: ['@', '#', '~', '%', '{', '.', '/'],
            provideCompletionItems: async (model, position) => {
                console.info('[cooklang-lsp] Completion requested:', model.uri.toString(),
                    'pos:', position.lineNumber, position.column, 'lang:', model.getLanguageId());
                try {
                    const result = await this.service.completion(
                        model.uri.toString(),
                        position.lineNumber - 1,
                        position.column - 1
                    );
                    console.info('[cooklang-lsp] Completion result:', result ? result.items.length + ' items' : 'null');
                    if (!result) {
                        return { suggestions: [] };
                    }
                    return {
                        incomplete: result.isIncomplete,
                        suggestions: result.items.map(item => this.toMonacoCompletionItem(item, model.uri))
                    };
                } catch (error) {
                    console.error('[cooklang-lsp] Completion error:', error);
                    return { suggestions: [] };
                }
            }
        }));
    }

    protected registerHoverProvider(): void {
        this.toDispose.push(monaco.languages.registerHoverProvider(COOKLANG_LANGUAGE_ID, {
            provideHover: async (model, position) => {
                const result = await this.service.hover(
                    model.uri.toString(),
                    position.lineNumber - 1,
                    position.column - 1
                );
                if (!result) {
                    return undefined;
                }
                return this.toMonacoHover(result);
            }
        }));
    }

    protected registerDocumentSymbolProvider(): void {
        this.toDispose.push(monaco.languages.registerDocumentSymbolProvider(COOKLANG_LANGUAGE_ID, {
            provideDocumentSymbols: async model => {
                const result = await this.service.documentSymbol(model.uri.toString());
                if (!result) {
                    return [];
                }
                return result.map(sym => this.toMonacoDocumentSymbol(sym));
            }
        }));
    }

    protected registerSemanticTokensProvider(): void {
        if (!this.semanticTokensLegend) {
            return;
        }
        this.toDispose.push(monaco.languages.registerDocumentSemanticTokensProvider(COOKLANG_LANGUAGE_ID, {
            getLegend: () => this.semanticTokensLegend!,
            provideDocumentSemanticTokens: async model => {
                const result = await this.service.semanticTokensFull(model.uri.toString());
                if (!result) {
                    return { resultId: undefined, data: new Uint32Array(0) };
                }
                return {
                    resultId: result.resultId,
                    data: new Uint32Array(result.data)
                };
            },
            releaseDocumentSemanticTokens: () => { }
        }));
    }

    // --- Document lifecycle ---

    protected registerDocumentListeners(): void {
        this.toDispose.push(this.monacoWorkspace.onDidOpenTextDocument(model => {
            console.info('[cooklang-lsp] onDidOpenTextDocument:', model.uri, 'lang:', model.languageId);
            if (model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            const version = 1;
            this.documentVersions.set(model.uri, version);
            console.info('[cooklang-lsp] Sending didOpen to LSP for:', model.uri);
            this.service.didOpenTextDocument(model.uri, model.languageId, version, model.getText());
        }));

        this.toDispose.push(this.monacoWorkspace.onDidChangeTextDocument(event => {
            if (event.model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            const uri = event.model.uri;
            const version = (this.documentVersions.get(uri) ?? 0) + 1;
            this.documentVersions.set(uri, version);
            this.service.didChangeTextDocument(uri, version, event.model.getText());
        }));

        this.toDispose.push(this.monacoWorkspace.onDidCloseTextDocument(model => {
            if (model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            this.documentVersions.delete(model.uri);
            this.service.didCloseTextDocument(model.uri);
        }));

        this.toDispose.push(this.monacoWorkspace.onDidSaveTextDocument(model => {
            if (model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            this.service.didSaveTextDocument(model.uri);
        }));
    }

    // --- Type conversions: LSP -> Monaco ---

    protected toMonacoCompletionItem(
        item: CooklangCompletionItem,
        modelUri: monaco.Uri
    ): monaco.languages.CompletionItem {
        const isSnippet = item.insertTextFormat === 2;
        // When the server provides a textEdit, honour its range — recipe
        // reference paths contain '.' and '/' which break Monaco's default
        // word boundary detection, so we must replace the exact span the
        // server intends (e.g. from after '@' to the cursor).
        const insertText = item.textEdit?.newText ?? item.insertText ?? item.label;
        const range = item.textEdit ? this.toMonacoRange(item.textEdit.range) : undefined!;
        return {
            label: item.label,
            kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
            detail: item.detail,
            documentation: item.documentation,
            filterText: item.filterText,
            insertText,
            insertTextRules: isSnippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range
        };
    }

    protected toMonacoHover(hover: CooklangHover): monaco.languages.Hover {
        const contents: monaco.IMarkdownString[] = [{
            value: hover.contents.value
        }];
        return {
            contents,
            range: hover.range ? this.toMonacoRange(hover.range) : undefined
        };
    }

    protected toMonacoDocumentSymbol(sym: CooklangDocumentSymbol): monaco.languages.DocumentSymbol {
        return {
            name: sym.name,
            detail: '',
            kind: sym.kind,
            tags: [],
            range: this.toMonacoRange(sym.range),
            selectionRange: this.toMonacoRange(sym.selectionRange),
            children: sym.children?.map(c => this.toMonacoDocumentSymbol(c))
        };
    }

    protected toMonacoRange(
        range: { start: { line: number; character: number }; end: { line: number; character: number } }
    ): monaco.Range {
        return new monaco.Range(
            range.start.line + 1,
            range.start.character + 1,
            range.end.line + 1,
            range.end.character + 1
        );
    }
}
