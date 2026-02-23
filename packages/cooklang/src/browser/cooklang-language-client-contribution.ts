// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

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

        try {
            const result = await this.service.initialize(rootUri);
            this.extractSemanticTokensLegend(result);
        } catch (error) {
            console.warn('Failed to initialize Cooklang LSP server:', error);
            return;
        }

        this.registerCompletionProvider();
        this.registerHoverProvider();
        this.registerDocumentSymbolProvider();
        this.registerSemanticTokensProvider();
        this.registerDocumentListeners();
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

    // --- Monaco provider registration ---

    protected registerCompletionProvider(): void {
        this.toDispose.push(monaco.languages.registerCompletionItemProvider(COOKLANG_LANGUAGE_ID, {
            triggerCharacters: ['@', '#', '~', '%', '{'],
            provideCompletionItems: async (model, position) => {
                const result = await this.service.completion(
                    model.uri.toString(),
                    position.lineNumber - 1,
                    position.column - 1
                );
                if (!result) {
                    return { suggestions: [] };
                }
                return {
                    incomplete: result.isIncomplete,
                    suggestions: result.items.map(item => this.toMonacoCompletionItem(item, model.uri))
                };
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
            if (model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            const version = 1;
            this.documentVersions.set(model.uri, version);
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
        const insertText = item.insertText ?? item.label;
        const isSnippet = item.insertTextFormat === 2;
        return {
            label: item.label,
            kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
            detail: item.detail,
            documentation: item.documentation,
            insertText: insertText,
            insertTextRules: isSnippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range: undefined!  // Monaco fills a default range
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
