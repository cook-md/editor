# Cooklang LSP Client Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the in-process Cooklang LSP server to Monaco via Theia RPC so that completions (including aisle.conf ingredients), hover, document symbols, and semantic tokens work in the editor.

**Architecture:** Expand `CooklangLanguageService` with typed LSP methods. Backend forwards calls to the NAPI-RS `MessageConnection`. Frontend `CooklangLanguageClientContribution` registers Monaco providers and document lifecycle listeners that delegate to the backend via RPC proxy.

**Tech Stack:** TypeScript, InversifyJS DI, `vscode-languageserver-protocol` types, `@theia/monaco-editor-core` Monaco API, Theia `ServiceConnectionProvider` RPC.

**Design doc:** `docs/plans/2026-02-23-cooklang-lsp-client-bridge-design.md`

---

### Task 1: Add `@theia/workspace` dependency

The frontend contribution needs `WorkspaceService` to get the workspace root URI. This package must be added as a dependency and tsconfig reference.

**Files:**
- Modify: `packages/cooklang/package.json`
- Modify: `packages/cooklang/tsconfig.json`

**Step 1: Add dependency to package.json**

In `packages/cooklang/package.json`, add to `"dependencies"`:
```json
"@theia/workspace": "1.68.0"
```

**Step 2: Add tsconfig reference**

In `packages/cooklang/tsconfig.json`, add to `"references"`:
```json
{ "path": "../workspace" }
```

**Step 3: Install**

Run: `npm install`
Expected: Clean install, workspace symlink created.

**Step 4: Commit**

```bash
git add packages/cooklang/package.json packages/cooklang/tsconfig.json
git commit -m "feat(cooklang): add @theia/workspace dependency for LSP client"
```

---

### Task 2: Expand the service interface

Add typed LSP methods to the common interface shared between frontend and backend.

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`

**Step 1: Expand the interface**

Replace the full contents of `packages/cooklang/src/common/cooklang-language-service.ts` with:

```typescript
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
```

**Step 2: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compilation failure in `cooklang-language-service-impl.ts` because it doesn't implement the new methods yet. This is expected — we fix it in Task 3.

**Step 3: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts
git commit -m "feat(cooklang): expand CooklangLanguageService interface with LSP methods"
```

---

### Task 3: Implement backend forwarding methods

Add the new methods to `CooklangLanguageServiceImpl`. Each method reconstructs LSP params from primitives and forwards to the `MessageConnection`.

**Files:**
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

**Step 1: Implement all methods**

Replace the full contents of `packages/cooklang/src/node/cooklang-language-service-impl.ts` with:

```typescript
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
            return { capabilities: {} };
        }
        const result = await this.connection.sendRequest('initialize', {
            processId: process.pid,
            capabilities: {},
            rootUri,
            workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
        });
        await this.connection.sendNotification('initialized');
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
            return null;
        }
        // LSP returns CompletionList | CompletionItem[] — normalize to list
        if (Array.isArray(result)) {
            return { isIncomplete: false, items: result };
        }
        return result as CooklangCompletionList;
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
}
```

**Step 2: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles successfully. The backend now implements all interface methods.

**Step 3: Commit**

```bash
git add packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): implement LSP forwarding methods in backend service"
```

---

### Task 4: Create the frontend language client contribution

This is the main bridge. Registers Monaco providers and document lifecycle listeners.

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-language-client-contribution.ts`

**Step 1: Create the contribution**

Create `packages/cooklang/src/browser/cooklang-language-client-contribution.ts` with:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID } from '../common';
import {
    CooklangLanguageService,
    CooklangCompletionList,
    CooklangCompletionItem,
    CooklangHover,
    CooklangDocumentSymbol,
    CooklangSemanticTokens,
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

    // --- Type conversions: LSP → Monaco ---

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
```

**Step 2: Verify compilation (will fail — frontend module not updated yet)**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: May fail because `CooklangLanguageService` is not bound in the frontend DI container yet. We fix this in Task 5.

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-language-client-contribution.ts
git commit -m "feat(cooklang): add frontend language client contribution with Monaco providers"
```

---

### Task 5: Wire up the frontend module

Add DI bindings for the RPC proxy and the contribution.

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Update the frontend module**

Replace the full contents of `packages/cooklang/src/browser/cooklang-frontend-module.ts` with:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';
import { CooklangLanguageClientContribution } from './cooklang-language-client-contribution';
import { CooklangLanguageService, CooklangLanguageServicePath } from '../common/cooklang-language-service';

export default new ContainerModule(bind => {
    // TextMate grammar
    bind(CooklangGrammarContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(CooklangGrammarContribution);

    // RPC proxy to the backend LSP bridge service
    bind(CooklangLanguageService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<CooklangLanguageService>(ctx.container, CooklangLanguageServicePath)
    ).inSingletonScope();

    // Language client contribution (registers Monaco providers + document listeners)
    bind(CooklangLanguageClientContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CooklangLanguageClientContribution);
});
```

**Step 2: Verify full compilation**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): wire frontend module with RPC proxy and language client contribution"
```

---

### Task 6: Build, bundle, and smoke test

**Step 1: Build the full Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Bundles successfully, `src-gen/` regenerated with cooklang contributions.

**Step 2: Start the app**

Run: `npm run start:electron` (from `examples/electron`)
Expected: Electron window opens.

**Step 3: Smoke test — completions**

1. Open a folder that contains `config/aisle.conf` (or `aisle.conf` at root)
2. Create or open a `.cook` file
3. Type `@` — should see ingredient suggestions from aisle.conf
4. Type `#` — should see cookware suggestions
5. Type `~` — should see timer unit suggestions

**Step 4: Smoke test — hover and symbols**

1. In a `.cook` file with ingredients (e.g. `Add @salt{1%tsp}`)
2. Hover over `salt` — should see hover info
3. Open outline panel — should see document symbols

**Step 5: Commit (if any adjustments needed)**

```bash
git add -A
git commit -m "fix(cooklang): adjustments from smoke testing LSP client bridge"
```
