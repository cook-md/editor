# Cooklang AI Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Theia to the cookbot gRPC server via a `LanguageModel` bridge so Theia's built-in AI chat works with Cooklang recipes.

**Architecture:** New `packages/cooklang-ai/` Theia extension. Backend implements `LanguageModel` with a gRPC client to cookbot. Frontend registers a `ChatAgent` and file operation `ToolProvider`s. Reuses Theia's existing `ai-chat-ui` for the chat interface.

**Tech Stack:** TypeScript, `@grpc/grpc-js`, `@grpc/proto-loader`, InversifyJS, Theia AI framework (`ai-core`, `ai-chat`)

**Design doc:** `docs/plans/2026-02-27-cooklang-ai-design.md`

---

### Task 1: Scaffold the `cooklang-ai` package

**Files:**
- Create: `packages/cooklang-ai/package.json`
- Create: `packages/cooklang-ai/tsconfig.json`
- Create: `packages/cooklang-ai/src/common/index.ts`
- Create: `packages/cooklang-ai/src/node/index.ts`
- Create: `packages/cooklang-ai/src/browser/index.ts`
- Modify: `examples/electron/package.json` (add dependency)
- Modify: `examples/electron/tsconfig.json` (add reference)

**Step 1: Create `packages/cooklang-ai/package.json`**

```json
{
  "name": "@theia/cooklang-ai",
  "version": "1.68.0",
  "description": "Theia - Cooklang AI Support",
  "dependencies": {
    "@theia/ai-chat": "1.68.0",
    "@theia/ai-core": "1.68.0",
    "@theia/core": "1.68.0",
    "@theia/filesystem": "1.68.0",
    "@theia/workspace": "1.68.0",
    "@grpc/grpc-js": "^1.12.0",
    "@grpc/proto-loader": "^0.7.0",
    "tslib": "^2.6.2"
  },
  "main": "lib/common",
  "theiaExtensions": [
    {
      "frontend": "lib/browser/cooklang-ai-frontend-module",
      "backend": "lib/node/cooklang-ai-backend-module"
    }
  ],
  "keywords": ["theia-extension"],
  "license": "MIT",
  "files": ["data", "lib", "src"],
  "scripts": {
    "build": "theiaext build",
    "clean": "theiaext clean",
    "compile": "theiaext compile",
    "lint": "theiaext lint",
    "test": "theiaext test",
    "watch": "theiaext watch"
  },
  "devDependencies": {
    "@theia/ext-scripts": "1.68.0"
  }
}
```

**Step 2: Create `packages/cooklang-ai/tsconfig.json`**

```json
{
  "extends": "../../configs/base.tsconfig",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "lib"
  },
  "include": ["src"],
  "references": [
    { "path": "../ai-chat" },
    { "path": "../ai-core" },
    { "path": "../core" },
    { "path": "../filesystem" },
    { "path": "../workspace" }
  ]
}
```

**Step 3: Create placeholder index files**

`packages/cooklang-ai/src/common/index.ts`:
```typescript
export { };
```

`packages/cooklang-ai/src/node/index.ts`:
```typescript
export { };
```

`packages/cooklang-ai/src/browser/index.ts`:
```typescript
export { };
```

**Step 4: Add to `examples/electron/package.json`**

Add `"@theia/cooklang-ai": "1.68.0"` to dependencies (after `@theia/cooklang`).

**Step 5: Add to `examples/electron/tsconfig.json`**

Add `{ "path": "../../packages/cooklang-ai" }` to references.

**Step 6: Run `npm install`**

Run: `npm install`
Expected: Creates workspace symlink at `node_modules/@theia/cooklang-ai`.

**Step 7: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully with empty modules.

**Step 8: Commit**

```bash
git add packages/cooklang-ai/ examples/electron/package.json examples/electron/tsconfig.json
git commit -m "feat(cooklang-ai): scaffold package"
```

---

### Task 2: Copy proto and create gRPC client wrapper

**Files:**
- Create: `packages/cooklang-ai/proto/cookbot.proto`
- Create: `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`
- Create: `packages/cooklang-ai/src/common/cookbot-protocol.ts`

**Step 1: Copy the proto file**

Copy `../cook.md/cookbot/proto/cookbot.proto` to `packages/cooklang-ai/proto/cookbot.proto`.

**Step 2: Create `packages/cooklang-ai/src/common/cookbot-protocol.ts`**

TypeScript interfaces mirroring the proto messages, plus the service symbol:

```typescript
import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const CookbotService = Symbol('CookbotService');
export const cookbotServicePath = '/services/cookbot';

export interface CookbotService extends RpcServer<CookbotServiceClient> {
    initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult>;
}

export interface CookbotServiceClient {
}

export interface CookbotInitResult {
    success: boolean;
    sessionId: string;
    serverVersion: string;
}

export interface CookbotChatChunk {
    type: 'text_delta' | 'thinking_delta' | 'tool_call' | 'tool_result' | 'tool_execution' | 'usage_info' | 'error' | 'stream_end' | 'context_status' | 'compaction_info';
    textDelta?: string;
    thinkingDelta?: { thinkingText: string; isSignature: boolean; signature: string };
    toolCall?: { toolId: string; toolName: string; toolInput: string };
    toolResult?: { toolId: string; toolName: string; success: boolean; result: string; error: string };
    usageInfo?: { tokensUsed: number; tokenLimit: number; warning: boolean; limitExceeded: boolean };
    error?: string;
    streamEnd?: boolean;
}
```

**Step 3: Create `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`**

The gRPC client wrapper that connects to the cookbot server:

```typescript
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { CookbotChatChunk, CookbotInitResult } from '../common/cookbot-protocol';
import { Emitter, Event } from '@theia/core';
import { CancellationToken } from '@theia/core/lib/common/cancellation';

@injectable()
export class CookbotGrpcClient {

    private chatService: any;
    private connectionService: any;
    private toolExecutionService: any;
    private sessionId: string | undefined;

    @postConstruct()
    protected init(): void {
        this.connect();
    }

    protected connect(): void {
        const protoPath = path.resolve(__dirname, '../../proto/cookbot.proto');
        const packageDefinition = protoLoader.loadSync(protoPath, {
            keepCase: false,
            longs: Number,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const proto = grpc.loadPackageDefinition(packageDefinition) as any;
        const address = '127.0.0.1:50051';

        this.chatService = new proto.cookbot.AIChatService(
            address, grpc.credentials.createInsecure()
        );
        this.connectionService = new proto.cookbot.Connection(
            address, grpc.credentials.createInsecure()
        );
        this.toolExecutionService = new proto.cookbot.ToolExecutionService(
            address, grpc.credentials.createInsecure()
        );
    }

    async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
        return new Promise((resolve, reject) => {
            this.connectionService.Initialize({
                customInstructions: customInstructions || '',
                clientVersion: '0.1.0',
                recipesDir,
                authToken: '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.sessionId = response.sessionId;
                resolve({
                    success: response.success,
                    sessionId: response.sessionId,
                    serverVersion: response.serverVersion,
                });
            });
        });
    }

    sendMessage(
        message: string,
        conversationHistory: Array<{ role: string; content: string }>,
        cancellationToken?: CancellationToken
    ): { stream: AsyncIterable<CookbotChatChunk> } {
        const call = this.chatService.SendMessage({
            message,
            conversationHistory,
            sessionId: this.sessionId || '',
            authToken: '',
        });

        if (cancellationToken) {
            cancellationToken.onCancellationRequested(() => {
                call.cancel();
            });
        }

        const stream = this.grpcStreamToAsync(call);
        return { stream };
    }

    sendToolResult(executionId: string, success: boolean, result: string, error?: string): void {
        // Send via the bidirectional tool execution stream
        if (this.toolStream) {
            this.toolStream.write({
                executionId,
                success,
                result,
                error: error || '',
            });
        }
    }

    private toolStream: grpc.ClientDuplexStream<any, any> | undefined;
    private readonly onToolRequestEmitter = new Emitter<{ executionId: string; toolName: string; parameters: Record<string, string> }>();
    readonly onToolRequest: Event<{ executionId: string; toolName: string; parameters: Record<string, string> }> = this.onToolRequestEmitter.event;

    connectToolStream(): void {
        this.toolStream = this.toolExecutionService.ExecuteTools();
        this.toolStream!.on('data', (request: any) => {
            this.onToolRequestEmitter.fire({
                executionId: request.executionId,
                toolName: request.toolName,
                parameters: request.parameters || {},
            });
        });
        this.toolStream!.on('error', (err: Error) => {
            console.error('Tool execution stream error:', err.message);
        });
    }

    private async *grpcStreamToAsync(call: grpc.ClientReadableStream<any>): AsyncIterable<CookbotChatChunk> {
        const queue: Array<CookbotChatChunk | Error | null> = [];
        let resolve: (() => void) | undefined;

        call.on('data', (chunk: any) => {
            const parsed = this.parseChatChunk(chunk);
            queue.push(parsed);
            resolve?.();
        });
        call.on('error', (err: Error) => {
            queue.push(err);
            resolve?.();
        });
        call.on('end', () => {
            queue.push(null);
            resolve?.();
        });

        while (true) {
            if (queue.length === 0) {
                await new Promise<void>(r => { resolve = r; });
            }
            const item = queue.shift();
            if (item === null || item === undefined) {
                return;
            }
            if (item instanceof Error) {
                throw item;
            }
            yield item;
        }
    }

    private parseChatChunk(chunk: any): CookbotChatChunk {
        if (chunk.textDelta !== undefined && chunk.textDelta !== '') {
            return { type: 'text_delta', textDelta: chunk.textDelta };
        }
        if (chunk.thinkingDelta) {
            return {
                type: 'thinking_delta',
                thinkingDelta: {
                    thinkingText: chunk.thinkingDelta.thinkingText,
                    isSignature: chunk.thinkingDelta.isSignature,
                    signature: chunk.thinkingDelta.signature,
                },
            };
        }
        if (chunk.toolCall) {
            return {
                type: 'tool_call',
                toolCall: {
                    toolId: chunk.toolCall.toolId,
                    toolName: chunk.toolCall.toolName,
                    toolInput: chunk.toolCall.toolInput,
                },
            };
        }
        if (chunk.toolResult) {
            return {
                type: 'tool_result',
                toolResult: {
                    toolId: chunk.toolResult.toolId,
                    toolName: chunk.toolResult.toolName,
                    success: chunk.toolResult.success,
                    result: chunk.toolResult.result,
                    error: chunk.toolResult.error,
                },
            };
        }
        if (chunk.usageInfo) {
            return {
                type: 'usage_info',
                usageInfo: {
                    tokensUsed: chunk.usageInfo.tokensUsed,
                    tokenLimit: chunk.usageInfo.tokenLimit,
                    warning: chunk.usageInfo.warning,
                    limitExceeded: chunk.usageInfo.limitExceeded,
                },
            };
        }
        if (chunk.error) {
            return { type: 'error', error: chunk.error };
        }
        if (chunk.streamEnd) {
            return { type: 'stream_end', streamEnd: true };
        }
        return { type: 'stream_end', streamEnd: true };
    }
}
```

**Step 4: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 5: Commit**

```bash
git add packages/cooklang-ai/
git commit -m "feat(cooklang-ai): add proto and gRPC client wrapper"
```

---

### Task 3: Implement `CookbotLanguageModel`

**Files:**
- Create: `packages/cooklang-ai/src/node/cookbot-language-model.ts`
- Create: `packages/cooklang-ai/src/node/cookbot-language-model-provider.ts`

**Step 1: Create `packages/cooklang-ai/src/node/cookbot-language-model.ts`**

Implements Theia's `LanguageModel` interface, delegating to the gRPC client:

```typescript
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
    LanguageModel,
    LanguageModelResponse,
    LanguageModelStreamResponse,
    LanguageModelStreamResponsePart,
    TextResponsePart,
    ThinkingResponsePart,
    ToolCallResponsePart,
    UsageResponsePart,
    UserRequest,
    isTextMessage,
    isToolResultMessage,
} from '@theia/ai-core/lib/common';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotChatChunk } from '../common/cookbot-protocol';

@injectable()
export class CookbotLanguageModel implements LanguageModel {

    readonly id = 'cookbot/claude';
    readonly name = 'Cookbot Claude';
    readonly vendor = 'Cookbot';
    readonly version = '1.0';
    readonly family = 'claude';
    readonly maxInputTokens = 200000;
    readonly maxOutputTokens = 8192;
    readonly status = { status: 'ready' as const };

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        const messages = request.messages.map(msg => {
            if (isTextMessage(msg)) {
                return { role: msg.actor === 'ai' ? 'assistant' : 'user', content: msg.query };
            }
            if (isToolResultMessage(msg)) {
                return { role: 'user', content: msg.result };
            }
            return { role: 'user', content: '' };
        });

        // Last message is the current user input
        const lastMessage = messages.pop();
        const messageText = lastMessage?.content || '';

        const { stream: grpcStream } = this.grpcClient.sendMessage(
            messageText,
            messages,
            cancellationToken
        );

        const stream = this.mapStream(grpcStream, request);
        return { stream } as LanguageModelStreamResponse;
    }

    private async *mapStream(
        grpcStream: AsyncIterable<CookbotChatChunk>,
        request: UserRequest
    ): AsyncIterable<LanguageModelStreamResponsePart> {
        for await (const chunk of grpcStream) {
            const part = this.mapChunkToPart(chunk, request);
            if (part) {
                yield part;
            }
        }
    }

    private mapChunkToPart(
        chunk: CookbotChatChunk,
        request: UserRequest
    ): LanguageModelStreamResponsePart | undefined {
        switch (chunk.type) {
            case 'text_delta':
                return { content: chunk.textDelta! } as TextResponsePart;

            case 'thinking_delta':
                if (chunk.thinkingDelta && !chunk.thinkingDelta.isSignature) {
                    return {
                        thought: chunk.thinkingDelta.thinkingText,
                        signature: '',
                    } as ThinkingResponsePart;
                }
                if (chunk.thinkingDelta?.isSignature) {
                    return {
                        thought: '',
                        signature: chunk.thinkingDelta.signature,
                    } as ThinkingResponsePart;
                }
                return undefined;

            case 'tool_call':
                if (chunk.toolCall) {
                    return {
                        tool_calls: [{
                            id: chunk.toolCall.toolId,
                            function: {
                                name: chunk.toolCall.toolName,
                                arguments: chunk.toolCall.toolInput,
                            },
                            finished: true,
                        }],
                    } as ToolCallResponsePart;
                }
                return undefined;

            case 'tool_result':
                // Tool results are handled by the server internally
                // or surfaced as text. No need to yield a part.
                return undefined;

            case 'usage_info':
                if (chunk.usageInfo) {
                    return {
                        input_tokens: chunk.usageInfo.tokensUsed,
                        output_tokens: 0,
                    } as UsageResponsePart;
                }
                return undefined;

            case 'error':
                throw new Error(chunk.error || 'Unknown cookbot error');

            case 'stream_end':
                return undefined;

            default:
                return undefined;
        }
    }
}
```

**Step 2: Create `packages/cooklang-ai/src/node/cookbot-language-model-provider.ts`**

```typescript
import { injectable, inject } from '@theia/core/shared/inversify';
import { LanguageModel } from '@theia/ai-core/lib/common';
import { CookbotLanguageModel } from './cookbot-language-model';

@injectable()
export class CookbotLanguageModelProvider {

    @inject(CookbotLanguageModel)
    protected readonly model: CookbotLanguageModel;

    async getModels(): Promise<LanguageModel[]> {
        return [this.model];
    }
}
```

**Step 3: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/cooklang-ai/src/node/cookbot-language-model.ts packages/cooklang-ai/src/node/cookbot-language-model-provider.ts
git commit -m "feat(cooklang-ai): implement CookbotLanguageModel with gRPC streaming"
```

---

### Task 4: Create backend DI module

**Files:**
- Create: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`
- Modify: `packages/cooklang-ai/src/node/index.ts`

**Step 1: Create `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`**

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
import { LanguageModelProvider } from '@theia/ai-core/lib/common';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotLanguageModel } from './cookbot-language-model';
import { CookbotLanguageModelProvider } from './cookbot-language-model-provider';

export default new ContainerModule(bind => {
    bind(CookbotGrpcClient).toSelf().inSingletonScope();
    bind(CookbotLanguageModel).toSelf().inSingletonScope();
    bind(CookbotLanguageModelProvider).toSelf().inSingletonScope();

    bind(LanguageModelProvider).toDynamicValue(ctx => {
        const provider = ctx.container.get(CookbotLanguageModelProvider);
        return () => provider.getModels();
    }).inSingletonScope();
});
```

**Step 2: Update `packages/cooklang-ai/src/node/index.ts`**

```typescript
export { CookbotGrpcClient } from './cookbot-grpc-client';
export { CookbotLanguageModel } from './cookbot-language-model';
```

**Step 3: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/cooklang-ai/src/node/
git commit -m "feat(cooklang-ai): add backend DI module"
```

---

### Task 5: Create `CookbotChatAgent`

**Files:**
- Create: `packages/cooklang-ai/src/browser/cookbot-chat-agent.ts`

**Step 1: Create `packages/cooklang-ai/src/browser/cookbot-chat-agent.ts`**

Extends `AbstractStreamParsingChatAgent` following the `CustomChatAgent` pattern:

```typescript
import { injectable } from '@theia/core/shared/inversify';
import { AbstractStreamParsingChatAgent, ChatAgent } from '@theia/ai-chat/lib/common';
import { LanguageModelRequirement } from '@theia/ai-core/lib/common';

@injectable()
export class CookbotChatAgent extends AbstractStreamParsingChatAgent implements ChatAgent {

    override id = 'cookbot';
    override name = 'Cooklang Assistant';
    override description = 'AI assistant for Cooklang recipe writing, meal planning, and recipe management';
    override languageModelRequirements: LanguageModelRequirement[] = [
        {
            purpose: 'chat',
            identifier: 'cookbot/claude',
        },
    ];
    protected override defaultLanguageModelPurpose = 'chat';

    protected override systemPromptId = 'cookbot-system';

    constructor() {
        super('cookbot', [{ purpose: 'chat', identifier: 'cookbot/claude' }], 'chat');
        this.prompts = [{
            id: 'cookbot-system',
            defaultVariant: {
                id: 'cookbot-system-default',
                template: 'You are a helpful Cooklang recipe assistant. Help users write, edit, and manage recipes in Cooklang format.',
            },
        }];
    }
}
```

**Step 2: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/browser/cookbot-chat-agent.ts
git commit -m "feat(cooklang-ai): add CookbotChatAgent"
```

---

### Task 6: Create file tool providers

**Files:**
- Create: `packages/cooklang-ai/src/browser/cookbot-tool-provider.ts`

**Step 1: Create `packages/cooklang-ai/src/browser/cookbot-tool-provider.ts`**

Registers file operation tools that use Theia's `FileService`:

```typescript
import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';

@injectable()
export class CookbotListFilesTool implements ToolProvider {
    static ID = 'cookbot_list_files';

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotListFilesTool.ID,
            name: CookbotListFilesTool.ID,
            description: 'List files in the recipes directory. Use glob patterns to filter.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Glob pattern to filter files (e.g. "**/*.cook")',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        // Return workspace root info for now; full glob implementation can use FileService.resolve
        const root = roots[0];
        return JSON.stringify({ root: root.resource.toString(), pattern: args.pattern || '**/*' });
    }
}

@injectable()
export class CookbotReadFileTool implements ToolProvider {
    static ID = 'cookbot_read_file';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotReadFileTool.ID,
            name: CookbotReadFileTool.ID,
            description: 'Read the contents of a file in the recipes directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from workspace root',
                    },
                },
                required: ['path'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = roots[0].resource.resolve(args.path);
        try {
            const content = await this.fileService.read(fileUri);
            return content.value;
        } catch (e) {
            return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

@injectable()
export class CookbotWriteFileTool implements ToolProvider {
    static ID = 'cookbot_write_file';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotWriteFileTool.ID,
            name: CookbotWriteFileTool.ID,
            description: 'Create or overwrite a file in the recipes directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from workspace root',
                    },
                    content: {
                        type: 'string',
                        description: 'File content to write',
                    },
                },
                required: ['path', 'content'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = roots[0].resource.resolve(args.path);
        try {
            const encoder = new TextEncoder();
            const content = encoder.encode(args.content);
            await this.fileService.write(fileUri, content);
            return `File written: ${args.path}`;
        } catch (e) {
            return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
```

**Step 2: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/cooklang-ai/src/browser/cookbot-tool-provider.ts
git commit -m "feat(cooklang-ai): add file operation tool providers"
```

---

### Task 7: Create frontend DI module

**Files:**
- Create: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`
- Modify: `packages/cooklang-ai/src/browser/index.ts`

**Step 1: Create `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`**

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
import { ChatAgent } from '@theia/ai-chat/lib/common';
import { Agent, ToolProvider, bindToolProvider } from '@theia/ai-core/lib/common';
import { CookbotChatAgent } from './cookbot-chat-agent';
import { CookbotListFilesTool, CookbotReadFileTool, CookbotWriteFileTool } from './cookbot-tool-provider';

export default new ContainerModule(bind => {
    // Chat agent
    bind(CookbotChatAgent).toSelf().inSingletonScope();
    bind(Agent).toService(CookbotChatAgent);
    bind(ChatAgent).toService(CookbotChatAgent);

    // File tools
    bindToolProvider(CookbotListFilesTool, bind);
    bindToolProvider(CookbotReadFileTool, bind);
    bindToolProvider(CookbotWriteFileTool, bind);
});
```

**Step 2: Update `packages/cooklang-ai/src/browser/index.ts`**

```typescript
export { CookbotChatAgent } from './cookbot-chat-agent';
```

**Step 3: Verify compilation**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/cooklang-ai/src/browser/
git commit -m "feat(cooklang-ai): add frontend DI module with agent and tools"
```

---

### Task 8: Integration test — build and run

**Step 1: Rebuild the Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Bundle succeeds, `src-gen/` includes `cooklang-ai` modules.

**Step 2: Verify the extension loads**

Run: `cd examples/electron && npm run start:electron`
Expected: App starts. Open the AI Chat panel (should be available from Theia's AI packages). The "Cooklang Assistant" agent should appear in the agent selector.

**Step 3: Verify gRPC connection (with cookbot running)**

Start cookbot server externally, then type a message in chat.
Expected: Message goes through gRPC to cookbot, response streams back into the chat UI.

**Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix(cooklang-ai): integration fixes"
```

---

### Task 9: Wire up tool execution round-trip

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-language-model.ts`
- Modify: `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`

This task connects the tool call flow: when cookbot streams a `tool_call` for a file operation, Theia's tool system executes it locally, and the result is sent back via the `ToolExecutionService` bidirectional stream.

**Step 1: Connect tool execution stream on initialize**

In `CookbotGrpcClient.initialize()`, after session is established, call `this.connectToolStream()`.

**Step 2: Update `CookbotLanguageModel.request()`**

When a `tool_call` chunk arrives for a client-side tool (file operations), the `ToolCallResponsePart` is yielded. Theia's delegate mechanism handles the round-trip automatically — the tool handler runs on the frontend, and the result comes back. After receiving the result, send it to cookbot via `grpcClient.sendToolResult()`.

The key insight: Theia's existing `LanguageModelFrontendDelegateImpl` already replaces tool handlers with RPC-delegated versions. When the backend yields a `ToolCallResponsePart`, Theia calls the tool handler, which executes on the frontend, and the result is returned. We then need to forward that result to cookbot.

**Step 3: Verify with a file read request**

Ask the AI to "read the first recipe in my collection". It should:
1. Stream a tool_call for `cookbot_read_file`
2. Theia executes via FileService
3. Result goes back to cookbot
4. Cookbot continues with Claude

**Step 4: Commit**

```bash
git add packages/cooklang-ai/src/node/
git commit -m "feat(cooklang-ai): wire up bidirectional tool execution"
```
