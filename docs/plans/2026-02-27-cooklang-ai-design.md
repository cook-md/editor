# Cooklang AI Support Design

## Goal

Integrate AI chat into the Cooklang Theia editor by connecting to the existing cookbot gRPC server and leveraging Theia's built-in AI framework.

## Architecture

The cookbot gRPC server (external process) handles Claude API calls, streaming, prompt caching, context compaction, web search, and recipe conversion. Theia connects to it as a client, handling file operations locally via its native services.

```
Theia Electron App
├── Browser (Frontend)
│   ├── ai-chat-ui (existing) ── chat UI, tool approval, variables
│   ├── CookbotChatAgent ─────── recipe-focused agent with system prompt
│   └── CookbotToolProvider ──── file tools via FileService
│         │
│         │ Theia RPC
│         ▼
├── Node (Backend)
│   └── CookbotLanguageModel ─── LanguageModel impl, gRPC bridge
│         │
│         │ gRPC/HTTP2
│         ▼
└── Cookbot Server (external, port 50051)
    ├── AIChatService ─────────── Claude API, streaming, caching
    ├── WebSearchService ──────── Exa semantic search, URL fetch
    ├── ToolExecutionService ──── bidirectional tool round-trip
    └── Connection ────────────── session init, auth
```

## New Package: `packages/cooklang-ai/`

### Structure

```
packages/cooklang-ai/
├── package.json
├── tsconfig.json
├── src/
│   ├── common/
│   │   ├── cookbot-protocol.ts            # gRPC message types as TS interfaces
│   │   └── cookbot-service.ts             # Service interface (symbol + methods)
│   ├── node/
│   │   ├── cookbot-backend-module.ts      # DI bindings
│   │   ├── cookbot-grpc-client.ts         # gRPC client wrapper
│   │   ├── cookbot-language-model.ts      # LanguageModel implementation
│   │   └── cookbot-language-model-provider.ts
│   └── browser/
│       ├── cookbot-frontend-module.ts     # DI bindings
│       ├── cookbot-chat-agent.ts          # ChatAgent implementation
│       └── cookbot-tool-provider.ts       # ToolProvider (file ops)
```

### Dependencies

- `@grpc/grpc-js` + `@grpc/proto-loader` for gRPC client (pure JS, no native build)
- Cookbot's `proto/cookbot.proto` (copied or symlinked)

## Components

### CookbotLanguageModel (backend, Node)

Implements Theia's `LanguageModel` interface. Lives in the backend Node process.

**`request()` flow:**
1. Convert `LanguageModelMessage[]` to cookbot `ChatRequest` (message + conversation history)
2. Call `AIChatService.SendMessage()`, receive `stream ChatChunk`
3. Map each chunk to Theia's `LanguageModelStreamResponsePart`:
   - `text_delta` -> `TextResponsePart`
   - `thinking_delta` -> `ThinkingResponsePart`
   - `tool_call` -> `ToolCallResponsePart`
   - `usage_info` -> `UsageResponsePart`
   - `error` -> error handling
   - `stream_end` -> close iterable

**Session management:** Call `Connection.Initialize()` on first request with workspace recipes directory. Cache `session_id`.

### CookbotToolProvider (frontend, browser)

Registers file operation tools matching cookbot's tool definitions:
- `str_replace_editor` — view/create/edit/insert via Theia FileService
- `search_files` — regex search via Theia search service
- `list_files` / `list_directory` — workspace file listing

Tools use Theia's native services, giving undo/redo, dirty state, and editor integration.

### Tool Call Round-Trip

When cookbot streams a `tool_call` for a file operation:
1. Backend yields `ToolCallResponsePart` (tool name + args)
2. Theia's delegate mechanism routes to frontend
3. Frontend's `FrontendLanguageModelRegistry` finds matching `ToolRequest` handler
4. Handler executes via Theia FileService
5. Result flows back to backend via Theia RPC
6. Backend sends result to cookbot via `ToolExecutionService` bidirectional stream
7. Cookbot feeds result to Claude, continues the loop

Server-side tools (web search, recipe conversion) execute internally in cookbot and stream results as text.

### CookbotChatAgent (frontend, browser)

- id: `cookbot`, name: "Cooklang Assistant"
- Declares cookbot language model as requirement
- Loads system prompt context from workspace `COOK.md` (if present)
- Default agent for `.cook` file contexts

## Responsibilities Split

| Concern | Owner |
|---|---|
| Claude API calls | Cookbot server |
| Streaming responses | Cookbot server -> gRPC -> Theia backend -> RPC -> frontend |
| Prompt caching | Cookbot server |
| Context compaction | Cookbot server |
| Web search (Exa) | Cookbot server |
| Recipe conversion | Cookbot server |
| Auth/subscription | Cookbot server |
| File read/write/edit | Theia frontend (FileService) |
| Editor integration (diffs) | Theia frontend |
| Chat UI | Theia ai-chat-ui (existing) |
| Tool approval UI | Theia ai-core (existing) |
| Variable resolution | Theia ai-core (existing) |
| Chat persistence | Theia ChatSessionStore (existing) |

## Configuration

Preference: cookbot server address (default `127.0.0.1:50051`).

## No Server Changes Needed

The existing cookbot proto already supports this pattern. The `ToolExecutionService` bidirectional stream is designed for exactly this client-side tool execution flow (currently used by the TUI).
