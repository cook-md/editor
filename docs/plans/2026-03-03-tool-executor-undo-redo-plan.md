# Tool Executor Undo/Redo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route text editing operations (str_replace, insert) from the backend tool executor to the frontend via bidirectional RPC so edits to open files go through Monaco's undo/redo stack.

**Architecture:** `CookbotToolExecutor` (backend) implements `RpcServer<CookbotFileOperationsClient>`. For write operations on existing files, it calls the frontend client via RPC. The frontend `CookbotFileOperationsClientImpl` checks if the file is open in a Monaco editor — if so, it uses `model.pushEditOperations()` (undoable); if not, it falls back to `FileService` read/modify/write. Read-only and filesystem operations stay as direct `fs` on the backend.

**Tech Stack:** Theia RPC (`RpcConnectionHandler`, `ServiceConnectionProvider`), Monaco `ITextModel`, InversifyJS DI

---

### Task 1: Define the file operations protocol

**Files:**
- Create: `packages/cooklang-ai/src/common/cookbot-file-operations-protocol.ts`

**Step 1: Create the protocol file**

```typescript
// packages/cooklang-ai/src/common/cookbot-file-operations-protocol.ts

import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const CookbotFileOperationsPath = '/services/cookbot-file-operations';
export const CookbotFileOperationsServer = Symbol('CookbotFileOperationsServer');

/**
 * Backend-side server for file operations RPC.
 * The server itself has no methods — it only stores the client proxy
 * so the backend can call the frontend for write operations.
 */
export interface CookbotFileOperationsServer extends RpcServer<CookbotFileOperationsClient> {
    // Intentionally empty — frontend never calls backend via this service.
    // The RpcServer base provides setClient/getClient/dispose.
}

/**
 * Frontend-side client that handles file write operations.
 * Called by the backend tool executor when it needs to edit a file
 * with undo/redo support.
 */
export interface CookbotFileOperationsClient {
    /**
     * Replace `oldText` with `newText` in the file at `relativePath`.
     * If the file is open in an editor, the edit goes through Monaco's
     * undo stack. Otherwise falls back to FileService read/modify/write.
     */
    replaceText(relativePath: string, oldText: string, newText: string): Promise<string>;

    /**
     * Insert `text` after line number `line` in the file at `relativePath`.
     * Line 0 means insert at the beginning of the file.
     */
    insertText(relativePath: string, line: number, text: string): Promise<string>;
}
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/common/cookbot-file-operations-protocol.ts
git commit -m "feat(cooklang-ai): add file operations RPC protocol for undo/redo"
```

---

### Task 2: Implement the frontend client

**Files:**
- Create: `packages/cooklang-ai/src/browser/cookbot-file-operations-client.ts`

**Context:**
- `EditorManager` from `@theia/editor/lib/browser` — `getByUri(uri)` returns an `EditorWidget | undefined`
- `MonacoEditor` from `@theia/monaco/lib/browser/monaco-editor` — `editor.document.textEditorModel` gives the Monaco `ITextModel`
- `ITextModel.getPositionAt(offset)` converts a string offset to `{ lineNumber, column }`
- `ITextModel.pushStackElement()` + `pushEditOperations()` creates an undoable edit
- `FileService` from `@theia/filesystem/lib/browser/file-service` — `read(uri)` returns `{ value: string }`, `write(uri, content)` writes a string
- `WorkspaceService` from `@theia/workspace/lib/browser` — `tryGetRoots()` returns `FileStat[]`, use `root.resource.resolve(path)` to build URIs

**Step 1: Create the frontend client**

```typescript
// packages/cooklang-ai/src/browser/cookbot-file-operations-client.ts

import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { CookbotFileOperationsClient } from '../common/cookbot-file-operations-protocol';

@injectable()
export class CookbotFileOperationsClientImpl implements CookbotFileOperationsClient {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    async replaceText(relativePath: string, oldText: string, newText: string): Promise<string> {
        const uri = this.resolveUri(relativePath);
        const monacoEditor = await this.findMonacoEditor(uri);

        if (monacoEditor) {
            const model = monacoEditor.document.textEditorModel;
            const content = model.getValue();
            const offset = content.indexOf(oldText);
            if (offset === -1) {
                throw new Error('Pattern not found in file');
            }
            const startPos = model.getPositionAt(offset);
            const endPos = model.getPositionAt(offset + oldText.length);
            const range = {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
            };
            model.pushStackElement();
            model.pushEditOperations([], [{ range, text: newText }], () => []);
            model.pushStackElement();
            return `Successfully replaced text in ${relativePath}`;
        }

        // File not open — fall back to FileService
        const fileContent = await this.fileService.read(uri);
        const content = fileContent.value;
        const idx = content.indexOf(oldText);
        if (idx === -1) {
            throw new Error('Pattern not found in file');
        }
        const updated = content.substring(0, idx) + newText + content.substring(idx + oldText.length);
        await this.fileService.write(uri, updated);
        return `Successfully replaced text in ${relativePath}`;
    }

    async insertText(relativePath: string, line: number, text: string): Promise<string> {
        const uri = this.resolveUri(relativePath);
        const monacoEditor = await this.findMonacoEditor(uri);

        if (monacoEditor) {
            const model = monacoEditor.document.textEditorModel;
            const lineCount = model.getLineCount();
            if (line > lineCount) {
                throw new Error(`insert_line ${line} exceeds file length ${lineCount} lines`);
            }

            let range;
            let insertText: string;
            if (line === 0) {
                // Insert at beginning of file
                range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
                insertText = text + '\n';
            } else {
                // Insert after the given line
                const lineLength = model.getLineLength(line);
                range = {
                    startLineNumber: line,
                    startColumn: lineLength + 1,
                    endLineNumber: line,
                    endColumn: lineLength + 1,
                };
                insertText = '\n' + text;
            }
            model.pushStackElement();
            model.pushEditOperations([], [{ range, text: insertText }], () => []);
            model.pushStackElement();
            return `Text inserted at line ${line} in file: ${relativePath}`;
        }

        // File not open — fall back to FileService
        const fileContent = await this.fileService.read(uri);
        const content = fileContent.value;
        const lines = content.split('\n');
        if (line > lines.length) {
            throw new Error(`insert_line ${line} exceeds file length ${lines.length} lines`);
        }
        let newContent: string;
        if (line === 0) {
            newContent = text + '\n' + content;
        } else {
            lines.splice(line, 0, text);
            newContent = lines.join('\n');
        }
        await this.fileService.write(uri, newContent);
        return `Text inserted at line ${line} in file: ${relativePath}`;
    }

    private resolveUri(relativePath: string): URI {
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            throw new Error('No workspace open');
        }
        return roots[0].resource.resolve(relativePath);
    }

    private async findMonacoEditor(uri: URI): Promise<MonacoEditor | undefined> {
        const editorWidget = await this.editorManager.getByUri(uri);
        if (editorWidget) {
            const editor = editorWidget.editor;
            if (editor instanceof MonacoEditor) {
                return editor;
            }
        }
        return undefined;
    }
}
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/browser/cookbot-file-operations-client.ts
git commit -m "feat(cooklang-ai): implement frontend file operations client with undo/redo"
```

---

### Task 3: Update CookbotToolExecutor to use RPC for writes

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-tool-executor.ts`

**Context:**
- `CookbotToolExecutor` is already `@injectable()` with `@inject(CookbotGrpcClient)` and `@inject(WorkspaceServer)`
- It needs to implement `CookbotFileOperationsServer` (which extends `RpcServer<CookbotFileOperationsClient>`)
- For `str_replace` and `insert`, call `this.client.replaceText(...)` / `this.client.insertText(...)` instead of direct `fs` writes
- Fall back to direct `fs` if `this.client` is undefined (before frontend connects)
- Read operations (`view`, `list_files`, etc.) stay unchanged

**Step 1: Update the class to implement RpcServer and route writes through RPC**

Changes to `cookbot-tool-executor.ts`:

1. Add imports:
```typescript
import { Disposable } from '@theia/core';
import { CookbotFileOperationsServer, CookbotFileOperationsClient } from '../common/cookbot-file-operations-protocol';
```

2. Change class declaration:
```typescript
export class CookbotToolExecutor implements CookbotFileOperationsServer {
```

3. Add client proxy field and RpcServer methods:
```typescript
    private client: CookbotFileOperationsClient | undefined;

    setClient(client: CookbotFileOperationsClient | undefined): void {
        this.client = client;
    }

    getClient(): CookbotFileOperationsClient | undefined {
        return this.client;
    }

    dispose(): void {
        this.client = undefined;
    }
```

4. Update `strReplaceCommand` — try RPC first, fall back to `fs`:
```typescript
    private async strReplaceCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        const oldStr = params.old_str;
        const newStr = params.new_str;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        if (oldStr === undefined) {
            throw new Error("Missing 'old_str' parameter");
        }
        if (newStr === undefined) {
            throw new Error("Missing 'new_str' parameter");
        }

        // Route through frontend for undo/redo support when available
        if (this.client) {
            return this.client.replaceText(filePath, oldStr, newStr);
        }

        // Fallback: direct fs write (no undo/redo)
        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const idx = content.indexOf(oldStr);
        if (idx === -1) {
            throw new Error('Pattern not found in file');
        }
        const updated = content.substring(0, idx) + newStr + content.substring(idx + oldStr.length);
        await fs.promises.writeFile(fullPath, updated, 'utf8');
        return `Successfully replaced text in ${filePath}`;
    }
```

5. Update `insertCommand` — same pattern:
```typescript
    private async insertCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        const insertLineStr = params.insert_line;
        const newStr = params.new_str;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        if (!insertLineStr) {
            throw new Error("Missing 'insert_line' parameter");
        }
        if (newStr === undefined) {
            throw new Error("Missing 'new_str' parameter");
        }
        const insertLine = parseInt(insertLineStr, 10);

        // Route through frontend for undo/redo support when available
        if (this.client) {
            return this.client.insertText(filePath, insertLine, newStr);
        }

        // Fallback: direct fs write (no undo/redo)
        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        if (insertLine > lines.length) {
            throw new Error(`insert_line ${insertLine} exceeds file length ${lines.length} lines`);
        }
        let newContent: string;
        if (insertLine === 0) {
            newContent = newStr + '\n' + content;
        } else {
            lines.splice(insertLine, 0, newStr);
            newContent = lines.join('\n');
        }
        await fs.promises.writeFile(fullPath, newContent, 'utf8');
        return `Text inserted at line ${insertLine} in file: ${filePath}`;
    }
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/node/cookbot-tool-executor.ts
git commit -m "feat(cooklang-ai): route str_replace and insert through RPC for undo/redo"
```

---

### Task 4: Wire DI — backend module

**Files:**
- Modify: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`

**Context:**
- `CookbotToolExecutor` is bound inside the `ConnectionContainerModule`
- Need to add a `ConnectionHandler` binding (also inside the connection module) that:
  1. Creates an `RpcConnectionHandler` for `CookbotFileOperationsPath`
  2. In the target factory, gets `CookbotToolExecutor` from the container and calls `setClient(clientProxy)`
  3. Returns the executor as the server
- Import `RpcConnectionHandler` from `@theia/core/lib/common/messaging/proxy-factory`
- Import `ConnectionHandler` from `@theia/core/lib/common/messaging`
- Import `CookbotFileOperationsPath`, `CookbotFileOperationsClient` from the protocol

**Step 1: Add the RPC handler binding inside the ConnectionContainerModule**

Add these imports:
```typescript
import { CookbotFileOperationsPath, CookbotFileOperationsClient } from '../common/cookbot-file-operations-protocol';
import { CookbotToolExecutor } from './cookbot-tool-executor';
```

Inside the `ConnectionContainerModule.create(({ bind }) => { ... })` block, add:
```typescript
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler<CookbotFileOperationsClient>(
            CookbotFileOperationsPath,
            client => {
                const executor = ctx.container.get(CookbotToolExecutor);
                executor.setClient(client);
                return executor;
            }
        )
    ).inSingletonScope();
```

Note: `ConnectionHandler` and `RpcConnectionHandler` should already be imported (they're used for the auth service). If not, add:
```typescript
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts
git commit -m "feat(cooklang-ai): wire file operations RPC handler in backend module"
```

---

### Task 5: Wire DI — frontend module

**Files:**
- Modify: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`

**Context:**
- Need to bind `CookbotFileOperationsClientImpl` as a singleton
- Need to create a proxy for `CookbotFileOperationsServer` using `ServiceConnectionProvider.createProxy` with the client as the **second argument** (target for reverse RPC)
- The proxy binding makes the reverse RPC connection work — the backend can call the frontend client methods

**Step 1: Add bindings to the frontend module**

Add imports:
```typescript
import { CookbotFileOperationsPath, CookbotFileOperationsServer } from '../common/cookbot-file-operations-protocol';
import { CookbotFileOperationsClientImpl } from './cookbot-file-operations-client';
```

Add bindings inside the `ContainerModule`:
```typescript
    // File operations RPC — client handles write operations with undo/redo
    bind(CookbotFileOperationsClientImpl).toSelf().inSingletonScope();
    bind(CookbotFileOperationsServer).toDynamicValue(ctx => {
        const client = ctx.container.get(CookbotFileOperationsClientImpl);
        return ServiceConnectionProvider.createProxy(ctx.container, CookbotFileOperationsPath, client);
    }).inSingletonScope();
```

Note: `ServiceConnectionProvider` should already be imported. If not:
```typescript
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts
git commit -m "feat(cooklang-ai): wire file operations client in frontend module"
```

---

### Task 6: Bundle and verify

**Step 1: Bundle the Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Success, no errors

**Step 2: Start the app and test**

Run: `npm run start:electron` (from `examples/electron`)

Test scenario:
1. Open a `.cook` recipe file in the editor
2. Ask cookbot to modify the recipe (e.g. "change the amount of flour to 500g")
3. Verify the edit appears in the editor
4. Press Ctrl+Z — the AI's edit should be undone
5. Press Ctrl+Shift+Z — the edit should be redone

Also test:
- Edit a file that is NOT open in any editor tab — should still work (via FileService fallback)
- Verify read operations (list_files, view, search) still work normally

**Step 3: Commit**

```bash
git commit --allow-empty -m "test(cooklang-ai): verify undo/redo integration with tool executor"
```
