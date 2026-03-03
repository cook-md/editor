# Tool Executor Undo/Redo Integration Design

**Goal:** When the cookbot AI edits a file that's open in an editor tab, the change should appear in the editor's native undo stack so the user can Ctrl+Z to revert it.

**Architecture:** Route text editing operations (`str_replace`, `insert`) from the backend tool executor to the frontend via bidirectional RPC. The frontend applies edits through Monaco's `pushEditOperations()` which integrates with the undo/redo stack. Read-only and filesystem-level operations stay on the backend using direct `fs`.

## Scope

**Routed to frontend (undo/redo support):**
- `str_replace` — replace text in an existing file
- `insert` — insert text at a specific line in an existing file

**Stays on backend (direct fs):**
- `view`, `list_files`, `list_directory`, `search_files` — read-only
- `create` — new file, no editor open yet
- `delete_path`, `rename_path` — filesystem operations where undo is complex and low-value

## Data Flow

```
cookbot gRPC server
  -> ToolExecutionService stream
  -> CookbotToolExecutor (backend, connection-scoped)
  -> RPC call to frontend
  -> CookbotFileOperationsClientImpl (browser)
  -> Monaco model.pushEditOperations() if file is open in editor
  -> or FileService read/modify/write if not open
  -> result returned to tool executor
  -> sendToolResult() back to cookbot
```

## Protocol

New file: `common/cookbot-file-operations-protocol.ts`

```typescript
export interface CookbotFileOperationsServer extends RpcServer<CookbotFileOperationsClient> {
    // Empty — frontend never calls backend for file operations
}

export interface CookbotFileOperationsClient {
    replaceText(relativePath: string, oldText: string, newText: string): Promise<string>;
    insertText(relativePath: string, line: number, text: string): Promise<string>;
}
```

## Backend Changes

`CookbotToolExecutor` implements `CookbotFileOperationsServer`:
- Stores the frontend client proxy via `setClient()`
- For `str_replace`: calls `this.client.replaceText()` instead of `fs.promises.writeFile()`
- For `insert`: calls `this.client.insertText()` instead of `fs.promises.writeFile()`
- Falls back to direct `fs` if no client is connected (e.g. during initialization before frontend connects)

## Frontend Implementation

New class: `browser/cookbot-file-operations-client.ts`

`CookbotFileOperationsClientImpl` implements `CookbotFileOperationsClient`:

### replaceText(relativePath, oldText, newText)

1. Resolve URI from workspace root + relativePath
2. Check `EditorManager.all` for an open editor with this URI
3. If editor is open:
   - Get the Monaco text model
   - Find `oldText` in model content
   - Convert string offset to line/column via `model.getPositionAt()`
   - Build a Range covering oldText
   - `model.pushStackElement()`
   - `model.pushEditOperations([], [{ range, text: newText }], () => [])`
   - `model.pushStackElement()`
4. If not open:
   - `FileService.read(uri)` -> string replace -> `FileService.write(uri, newContent)`

### insertText(relativePath, line, text)

Same pattern — if editor open, create Range at target line, use `pushEditOperations`. If not, read/modify/write via FileService.

### Error handling

If `oldText` is not found, throw an error. It propagates through RPC back to the tool executor, which sends it as a failed tool result to cookbot.

## DI Wiring

### Backend module

`CookbotToolExecutor` is already in the `ConnectionContainerModule`. Bind the `ConnectionHandler` for the file operations RPC in the same connection module so it can access the per-connection tool executor:

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

### Frontend module

```typescript
bind(CookbotFileOperationsClientImpl).toSelf().inSingletonScope();
bind(CookbotFileOperationsServer).toDynamicValue(ctx => {
    const client = ctx.container.get(CookbotFileOperationsClientImpl);
    return ServiceConnectionProvider.createProxy(ctx.container, path, client);
}).inSingletonScope();
```

The second argument to `createProxy` registers the client as the target for reverse RPC calls from the backend.

## Dependencies

Frontend `CookbotFileOperationsClientImpl` injects:
- `EditorManager` — check for open editors
- `FileService` — fallback read/write for non-open files
- `WorkspaceService` — resolve relative paths to URIs
