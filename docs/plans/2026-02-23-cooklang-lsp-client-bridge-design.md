# Cooklang LSP Client Bridge

**Date:** 2026-02-23
**Status:** Approved

## Problem

The in-process LSP server (via NAPI-RS) starts on the backend but nothing connects it to Monaco in the frontend. `initialize()` is never called, document events are never forwarded, and no language feature providers are registered. Result: no completions, hover, diagnostics, or aisle.conf ingredient suggestions.

## Approach

Typed LSP methods on the existing `CooklangLanguageService` RPC interface. Frontend registers Monaco providers that delegate to the backend via RPC proxy. Backend forwards to the in-process LSP `MessageConnection`.

## Service Interface

Expand `CooklangLanguageService` with primitive-parameter methods (avoids serialization edge cases):

```typescript
interface CooklangLanguageService {
    // Lifecycle
    initialize(rootUri: string | null): Promise<InitializeResult>;
    shutdown(): Promise<void>;

    // Document sync (notifications)
    didOpenTextDocument(uri: string, languageId: string, version: number, text: string): void;
    didChangeTextDocument(uri: string, version: number, text: string): void;
    didCloseTextDocument(uri: string): void;
    didSaveTextDocument(uri: string): void;

    // Language features (requests)
    completion(uri: string, line: number, character: number): Promise<CompletionList | null>;
    hover(uri: string, line: number, character: number): Promise<Hover | null>;
    documentSymbol(uri: string): Promise<DocumentSymbol[] | null>;
    semanticTokensFull(uri: string): Promise<SemanticTokens | null>;
}
```

## Backend Implementation

`CooklangLanguageServiceImpl` forwards each method to the existing `MessageConnection`:

- `initialize()` returns `InitializeResult` (includes `SemanticTokensLegend`)
- Document sync methods reconstruct LSP notification params and send via `sendNotification()`
- Language feature methods reconstruct LSP request params and send via `sendRequest()`

## Frontend Bridge

New `CooklangLanguageClientContribution` implementing `FrontendApplicationContribution`:

1. **Startup:** Creates RPC proxy, calls `initialize(rootUri)`, captures semantic tokens legend
2. **Monaco providers:** Registers completion, hover, document symbol, semantic tokens providers for `cooklang` language ID. Each delegates to the backend service via RPC.
3. **Document lifecycle:** Listens to `MonacoWorkspace` events (`onDidOpen/Change/Close/SaveTextDocument`), filters for `cooklang` language, forwards to backend.

Type conversions (LSP 0-based ↔ Monaco 1-based positions, CompletionItem shapes, MarkupContent ↔ IMarkdownString) are inline in this file.

## Frontend Module

Adds RPC proxy binding via `ServiceConnectionProvider.createProxy()` and registers the contribution as `FrontendApplicationContribution`.

## Files Changed

| File | Action |
|------|--------|
| `src/common/cooklang-language-service.ts` | Edit — expand interface |
| `src/node/cooklang-language-service-impl.ts` | Edit — implement forwarding methods |
| `src/browser/cooklang-language-client-contribution.ts` | New — Monaco providers + document tracking |
| `src/browser/cooklang-frontend-module.ts` | Edit — add RPC proxy + contribution binding |

No new packages or dependencies.
