# Chat Quota Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the user in the chat view when their Cookbot AI credits pass 80% of the billing-cycle allowance, instead of stopping dead at 100% (issue #89).

**Architecture:** Wire the existing-but-never-called `GetUsage` gRPC RPC through a new connection-scoped `CookbotUsageService` (backend → browser RPC), extract the lazy cookbot session bootstrap into a shared `CookbotSessionInitializer`, and render a passive banner above the chat input in `CooklangChatViewWidget`, refreshed on widget attach/show and on chat response completion. Spec: `docs/superpowers/specs/2026-08-13-quota-warning-design.md`.

**Tech Stack:** Theia extension packages (`@theia/cooklang-ai`, `@theia/cooklang-branding`, forked `@theia/ai-chat-ui` CSS), InversifyJS DI, `@grpc/grpc-js` + `@grpc/proto-loader`, mocha/chai via `theiaext test`.

**Conventions that apply to every task:** 4-space indent, single quotes, explicit return types, `undefined` over `null`, property injection, every file starts with the standard cook.md license header (copy it verbatim from any sibling file). All user-facing strings via `nls.localize`.

---

### Task 1: Usage protocol types (`@theia/cooklang-ai` common)

Pure types — no behavior, so no test. This unblocks every later task.

**Files:**
- Create: `packages/cooklang-ai/src/common/cookbot-usage-protocol.ts`
- Modify: `packages/cooklang-ai/src/common/index.ts`

- [ ] **Step 1: Create the protocol file**

Create `packages/cooklang-ai/src/common/cookbot-usage-protocol.ts` (license header first, copied from `cookbot-protocol.ts`):

```ts
export const CookbotUsagePath = '/services/cookbot-usage';
export const CookbotUsageService = Symbol('CookbotUsageService');

/**
 * Cookbot AI usage for the current billing cycle, as reported by the
 * cookbot server's GetUsage RPC.
 */
export interface CookbotUsageStats {
    inputTokensUsed: number;
    outputTokensUsed: number;
    tokenLimit: number;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    subscriptionTier?: string;
}

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts in
 * cooklang-account for why). Remote service: interface + symbol on purpose.
 *
 * `getUsage` resolves to `undefined` on ANY failure (not logged in, session
 * init failed, gRPC error): a quota warning must never itself become a
 * source of user-visible errors.
 */
export interface CookbotUsageService {
    getUsage(): Promise<CookbotUsageStats | undefined>;
}
```

- [ ] **Step 2: Export from the common index**

In `packages/cooklang-ai/src/common/index.ts`, append after the `cookbot-server-tools-protocol` export block:

```ts
export {
    CookbotUsagePath,
    CookbotUsageService,
    CookbotUsageStats,
} from './cookbot-usage-protocol';
```

- [ ] **Step 3: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-ai/src/common/cookbot-usage-protocol.ts packages/cooklang-ai/src/common/index.ts
git commit -m "feat(ai): add CookbotUsageService protocol types (#89)"
```

---

### Task 2: Extract `CookbotSessionInitializer` from the language model

`GetUsage` needs a `session_id`, but the cookbot session is created lazily inside `CookbotLanguageModel`. Extract that logic into a shared connection-scoped class so the usage service can bootstrap the session too. TDD: initializer spec first, then the refactor, keeping the existing language-model spec green.

**Files:**
- Test: `packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts` (create)
- Create: `packages/cooklang-ai/src/node/cookbot-session-initializer.ts`
- Modify: `packages/cooklang-ai/src/node/cookbot-language-model.ts`
- Modify: `packages/cooklang-ai/src/node/cookbot-language-model.spec.ts`
- Modify: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`

- [ ] **Step 1: Write the failing initializer spec**

Create `packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts` (license header first):

```ts
import { expect } from 'chai';
import { CookbotSessionInitializer } from './cookbot-session-initializer';

class FakeGrpcClient {
    initializeCalls = 0;
    failNext = false;

    async initialize(): Promise<unknown> {
        this.initializeCalls++;
        if (this.failNext) {
            this.failNext = false;
            throw new Error('init failed');
        }
        return { success: true, sessionId: `session-${this.initializeCalls}`, serverVersion: 'test' };
    }
}

function createInitializer(grpcClient: FakeGrpcClient): CookbotSessionInitializer {
    const initializer = new CookbotSessionInitializer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).workspaceServer = { getMostRecentlyUsedWorkspace: async () => undefined };
    return initializer;
}

describe('CookbotSessionInitializer', () => {

    it('initializes only once across concurrent and repeated callers', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient);

        await Promise.all([initializer.ensureInitialized(), initializer.ensureInitialized()]);
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('retries on the next call after a failed initialization', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.failNext = true;
        const initializer = createInitializer(grpcClient);

        let thrown: Error | undefined;
        try {
            await initializer.ensureInitialized();
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown?.message).to.equal('init failed');

        await initializer.ensureInitialized();
        expect(grpcClient.initializeCalls).to.equal(2);
    });

    it('re-initializes after reset', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient);

        await initializer.ensureInitialized();
        initializer.reset();
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: FAILS with `Cannot find module './cookbot-session-initializer'` (compile error is the failure mode here since the module doesn't exist).

- [ ] **Step 3: Implement `CookbotSessionInitializer`**

Create `packages/cooklang-ai/src/node/cookbot-session-initializer.ts` (license header first). The body of `doInitialize` is moved verbatim from `CookbotLanguageModel.doInitialize`:

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import * as fs from 'fs';
import * as path from 'path';
import { CookbotGrpcClient } from './cookbot-grpc-client';

/**
 * Creates the cookbot session on demand and shares it between every consumer
 * of the connection-scoped gRPC client (language model, usage service):
 * whichever caller runs first creates the session, the others reuse it.
 */
@injectable()
export class CookbotSessionInitializer {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private initPromise: Promise<void> | undefined;

    async ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            // Drop a failed initialization so the next request can retry it,
            // instead of awaiting the same rejected promise forever.
            this.initPromise = this.doInitialize().catch(error => {
                this.initPromise = undefined;
                throw error;
            });
        }
        await this.initPromise;
    }

    /**
     * Forget the current session so the next call re-initializes. Used when
     * the server invalidates an idle session (UNAUTHENTICATED).
     */
    reset(): void {
        this.initPromise = undefined;
    }

    private async doInitialize(): Promise<void> {
        let recipesDir = '';
        let customInstructions = '';
        try {
            const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
            if (workspaceUri) {
                recipesDir = FileUri.fsPath(workspaceUri);
                const cookMdPath = path.join(recipesDir, 'COOK.md');
                try {
                    customInstructions = await fs.promises.readFile(cookMdPath, 'utf-8');
                } catch {
                    // COOK.md not present, that's fine
                }
            }
        } catch {
            // Workspace may not be set yet
        }
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }
}
```

- [ ] **Step 4: Refactor `CookbotLanguageModel` to use it**

In `packages/cooklang-ai/src/node/cookbot-language-model.ts`:

1. Remove the imports of `FileUri`, `WorkspaceServer`, `fs`, and `path` (they move to the initializer). Add:

```ts
import { CookbotSessionInitializer } from './cookbot-session-initializer';
```

2. Replace the `workspaceServer` injection with the initializer — delete:

```ts
    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;
```

add:

```ts
    @inject(CookbotSessionInitializer)
    protected readonly sessionInitializer: CookbotSessionInitializer;
```

3. Delete the `initPromise` field and the whole `ensureInitialized()` and `doInitialize()` methods (lines defining `private initPromise`, `protected async ensureInitialized`, `private async doInitialize`).

4. In `request()`, replace `await this.ensureInitialized();` with `await this.sessionInitializer.ensureInitialized();`.

5. In the session-expiry retry inside `handleStreamingRequest` (the `catch` block of the `attempt` loop), replace:

```ts
                        if (CookbotError.isSessionExpired(error)) {
                            that.initPromise = undefined;
                            if (!sessionRetryDone && !partsYielded) {
                                sessionRetryDone = true;
                                console.info('[CookbotLM] Session expired, re-initializing and retrying');
                                await that.ensureInitialized();
                                continue attempt;
                            }
                        }
```

with:

```ts
                        if (CookbotError.isSessionExpired(error)) {
                            that.sessionInitializer.reset();
                            if (!sessionRetryDone && !partsYielded) {
                                sessionRetryDone = true;
                                console.info('[CookbotLM] Session expired, re-initializing and retrying');
                                await that.sessionInitializer.ensureInitialized();
                                continue attempt;
                            }
                        }
```

- [ ] **Step 5: Update the language-model spec wiring**

In `packages/cooklang-ai/src/node/cookbot-language-model.spec.ts`, add the import:

```ts
import { CookbotSessionInitializer } from './cookbot-session-initializer';
```

and replace the whole `createModel` function with:

```ts
function createModel(grpcClient: FakeGrpcClient, errorReporter?: FakeErrorReporter): CookbotLanguageModel {
    const initializer = new CookbotSessionInitializer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (initializer as any).workspaceServer = { getMostRecentlyUsedWorkspace: async () => undefined };
    const model = new CookbotLanguageModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).sessionInitializer = initializer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).errorReporter = errorReporter;
    return model;
}
```

- [ ] **Step 6: Bind the initializer in the backend module**

In `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`, add the import:

```ts
import { CookbotSessionInitializer } from './cookbot-session-initializer';
```

and inside `cookbotConnectionModule`, directly after `bind(CookbotGrpcClient).toSelf().inSingletonScope();`, add:

```ts
    bind(CookbotSessionInitializer).toSelf().inSingletonScope();
```

- [ ] **Step 7: Compile and run the package tests**

Run: `npx lerna run compile --scope @theia/cooklang-ai && npx lerna run test --scope @theia/cooklang-ai`
Expected: compile exit 0; all specs pass, including the 3 new `CookbotSessionInitializer` tests and the pre-existing `CookbotLanguageModel` session-expiry tests (their `initializeCalls` assertions still hold because the fake gRPC client is shared with the initializer).

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang-ai/src/node/cookbot-session-initializer.ts \
        packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts \
        packages/cooklang-ai/src/node/cookbot-language-model.ts \
        packages/cooklang-ai/src/node/cookbot-language-model.spec.ts \
        packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts
git commit -m "refactor(ai): extract cookbot session bootstrap into CookbotSessionInitializer (#89)"
```

---

### Task 3: `CookbotGrpcClient.getUsage()`

The gRPC client has no unit tests today (its service object is loaded dynamically from the .proto); the mapping logic is exercised through the usage-service spec in Task 4 with a stubbed client. This task is implementation + compile only.

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`

- [ ] **Step 1: Add the unary call**

In `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`, extend the import from `'../common/cookbot-protocol'`'s sibling — add a new import line after the existing `cookbot-server-tools-protocol` import:

```ts
import { CookbotUsageStats } from '../common/cookbot-usage-protocol';
```

Then add these methods directly after `getSessionId()`:

```ts
    async getUsage(): Promise<CookbotUsageStats> {
        return this.withReconnectRetry('GetUsage', () => this.doGetUsage());
    }

    protected async doGetUsage(): Promise<CookbotUsageStats> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.GetUsage({
                sessionId: this.sessionId || '',
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    inputTokensUsed: response.inputTokensUsed ?? 0,
                    outputTokensUsed: response.outputTokensUsed ?? 0,
                    tokenLimit: response.tokenLimit ?? 0,
                    billingPeriodStart: response.billingPeriodStart || undefined,
                    billingPeriodEnd: response.billingPeriodEnd || undefined,
                    subscriptionTier: response.subscriptionTier || undefined,
                });
            });
        });
    }
```

(Field names are camelCase because the proto loader runs with `keepCase: false`; `longs: Number` makes the int64 fields plain numbers.)

- [ ] **Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-ai/src/node/cookbot-grpc-client.ts
git commit -m "feat(ai): wire the GetUsage gRPC call into the cookbot client (#89)"
```

---

### Task 4: `CookbotUsageServiceImpl` (TDD)

**Files:**
- Test: `packages/cooklang-ai/src/node/cookbot-usage-service.spec.ts` (create)
- Create: `packages/cooklang-ai/src/node/cookbot-usage-service.ts`

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang-ai/src/node/cookbot-usage-service.spec.ts` (license header first):

```ts
import { expect } from 'chai';
import { CookbotUsageStats } from '../common/cookbot-usage-protocol';
import { CookbotUsageServiceImpl } from './cookbot-usage-service';

const SAMPLE_USAGE: CookbotUsageStats = {
    inputTokensUsed: 700_000,
    outputTokensUsed: 150_000,
    tokenLimit: 1_000_000,
    billingPeriodStart: '2026-08-01T00:00:00Z',
    billingPeriodEnd: '2026-09-01T00:00:00Z',
    subscriptionTier: 'pro',
};

/** gRPC UNAUTHENTICATED error as @grpc/grpc-js surfaces it. */
function sessionExpiredError(): Error {
    return Object.assign(
        new Error('16 UNAUTHENTICATED: Invalid or expired session. Please call Initialize to start a new session.'),
        { code: 16 }
    );
}

class FakeGrpcClient {
    getUsageCalls = 0;
    errors: Error[] = [];
    usage: CookbotUsageStats = SAMPLE_USAGE;

    async getUsage(): Promise<CookbotUsageStats> {
        this.getUsageCalls++;
        const error = this.errors.shift();
        if (error) {
            throw error;
        }
        return this.usage;
    }
}

class FakeInitializer {
    ensureCalls = 0;
    resetCalls = 0;
    error: Error | undefined;

    async ensureInitialized(): Promise<void> {
        this.ensureCalls++;
        if (this.error) {
            throw this.error;
        }
    }

    reset(): void {
        this.resetCalls++;
    }
}

function createService(grpcClient: FakeGrpcClient, initializer: FakeInitializer): CookbotUsageServiceImpl {
    const service = new CookbotUsageServiceImpl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).grpcClient = grpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).sessionInitializer = initializer;
    return service;
}

describe('CookbotUsageServiceImpl', () => {

    it('bootstraps the session before querying usage', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(initializer.ensureCalls).to.equal(1);
        expect(usage).to.deep.equal(SAMPLE_USAGE);
    });

    it('returns undefined when session initialization fails', async () => {
        const grpcClient = new FakeGrpcClient();
        const initializer = new FakeInitializer();
        initializer.error = new Error('not logged in');
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
        expect(grpcClient.getUsageCalls).to.equal(0);
    });

    it('returns undefined when the usage query fails', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [new Error('boom')];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
    });

    it('re-initializes and retries once when the session has expired', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [sessionExpiredError()];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(initializer.ensureCalls).to.equal(2);
        expect(initializer.resetCalls).to.equal(1);
        expect(grpcClient.getUsageCalls).to.equal(2);
        expect(usage).to.deep.equal(SAMPLE_USAGE);
    });

    it('returns undefined when the retry also fails with an expired session', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.errors = [sessionExpiredError(), sessionExpiredError()];
        const initializer = new FakeInitializer();
        const service = createService(grpcClient, initializer);

        const usage = await service.getUsage();

        expect(usage).to.equal(undefined);
        expect(grpcClient.getUsageCalls).to.equal(2);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: FAILS with `Cannot find module './cookbot-usage-service'`.

- [ ] **Step 3: Implement the service**

Create `packages/cooklang-ai/src/node/cookbot-usage-service.ts` (license header first):

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotSessionInitializer } from './cookbot-session-initializer';
import { CookbotError } from '../common/cookbot-error';
import { CookbotUsageService, CookbotUsageStats } from '../common/cookbot-usage-protocol';

/**
 * Backend service reporting Cookbot AI usage to the browser via RPC.
 *
 * Every failure collapses to `undefined` rather than throwing: the quota
 * warning is advisory UI, and it must never become a source of user-visible
 * errors. Failures here are expected states (not logged in, offline, session
 * expired) and are deliberately not reported to error tracking, consistent
 * with CookbotError.isExpected on the chat path.
 */
@injectable()
export class CookbotUsageServiceImpl implements CookbotUsageService {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    @inject(CookbotSessionInitializer)
    protected readonly sessionInitializer: CookbotSessionInitializer;

    async getUsage(): Promise<CookbotUsageStats | undefined> {
        try {
            await this.sessionInitializer.ensureInitialized();
            return await this.queryWithSessionRetry();
        } catch (error) {
            console.info('[CookbotUsage] Usage unavailable:', error instanceof Error ? error.message : error);
            return undefined;
        }
    }

    /**
     * The server invalidates idle sessions; a usage query may be the first
     * call after a long idle, so retry once on a fresh session — the same
     * recovery the language model performs for chat requests.
     */
    private async queryWithSessionRetry(): Promise<CookbotUsageStats> {
        try {
            return await this.grpcClient.getUsage();
        } catch (error) {
            if (!CookbotError.isSessionExpired(error)) {
                throw error;
            }
            this.sessionInitializer.reset();
            await this.sessionInitializer.ensureInitialized();
            return this.grpcClient.getUsage();
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx lerna run compile --scope @theia/cooklang-ai && npx lerna run test --scope @theia/cooklang-ai`
Expected: all pass, including the 5 new `CookbotUsageServiceImpl` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-ai/src/node/cookbot-usage-service.ts packages/cooklang-ai/src/node/cookbot-usage-service.spec.ts
git commit -m "feat(ai): add CookbotUsageService backend impl (#89)"
```

---

### Task 5: DI wiring — backend RPC handler + frontend proxy

**Files:**
- Modify: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`
- Modify: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`

- [ ] **Step 1: Backend — expose the service on the connection**

In `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`, add imports:

```ts
import { CookbotUsagePath } from '../common/cookbot-usage-protocol';
import { CookbotUsageServiceImpl } from './cookbot-usage-service';
```

and inside `cookbotConnectionModule`, after the server-tools `ConnectionHandler` binding, add:

```ts
    // Usage service — exposed to browser via RPC for the chat quota banner
    bind(CookbotUsageServiceImpl).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(
            CookbotUsagePath,
            () => ctx.container.get(CookbotUsageServiceImpl)
        )
    ).inSingletonScope();
```

- [ ] **Step 2: Frontend — bind the RPC proxy**

In `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`, add the import:

```ts
import { CookbotUsagePath, CookbotUsageService } from '../common/cookbot-usage-protocol';
```

and after the `CookbotServerToolsService` proxy binding, add:

```ts
    // Usage — RPC proxy to backend (consumed by the chat quota banner)
    bind(CookbotUsageService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy(ctx.container, CookbotUsagePath)
    ).inSingletonScope();
```

- [ ] **Step 3: Compile and test**

Run: `npx lerna run compile --scope @theia/cooklang-ai && npx lerna run test --scope @theia/cooklang-ai`
Expected: exit 0, tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts
git commit -m "feat(ai): expose CookbotUsageService over frontend RPC (#89)"
```

---

### Task 6: Banner state helper in `@theia/cooklang-branding` (TDD)

Pure threshold/label logic in a monaco-free file (a browser spec that transitively imports monaco dies under the test harness — keep this file dependency-free apart from the usage type). This task also gives cooklang-branding its dependency on cooklang-ai and its first spec, so it gains the `test` script now (adding it earlier would abort the whole `test:theia` run on "No test files found").

**Files:**
- Modify: `packages/cooklang-branding/package.json`
- Modify: `packages/cooklang-branding/tsconfig.json`
- Test: `packages/cooklang-branding/src/browser/cookbot-quota-banner-state.spec.ts` (create)
- Create: `packages/cooklang-branding/src/browser/cookbot-quota-banner-state.ts`

- [ ] **Step 1: Add the dependency, test script, and project reference**

In `packages/cooklang-branding/package.json`:
- add `"@theia/cooklang-ai": "1.70.0",` to `dependencies` (alphabetical: after `@theia/cooklang-account`);
- add `"test": "theiaext test",` to `scripts` (between `lint` and `watch`).

In `packages/cooklang-branding/tsconfig.json`, add to `references` (after `../cooklang-account`):

```json
    { "path": "../cooklang-ai" },
```

Then run: `npm install`
Expected: exit 0 (refreshes workspace symlinks and the lockfile).

- [ ] **Step 2: Write the failing spec**

Create `packages/cooklang-branding/src/browser/cookbot-quota-banner-state.spec.ts` (license header first):

```ts
import { expect } from 'chai';
import { CookbotUsageStats } from '@theia/cooklang-ai/lib/common';
import { computeQuotaBannerState } from './cookbot-quota-banner-state';

function usage(overrides: Partial<CookbotUsageStats> = {}): CookbotUsageStats {
    return {
        inputTokensUsed: 0,
        outputTokensUsed: 0,
        tokenLimit: 1_000_000,
        billingPeriodEnd: '2026-09-01T00:00:00Z',
        ...overrides,
    };
}

describe('computeQuotaBannerState', () => {

    it('is hidden when usage is unavailable', () => {
        expect(computeQuotaBannerState(undefined)).to.equal(undefined);
    });

    it('is hidden when the limit is missing or zero', () => {
        expect(computeQuotaBannerState(usage({ tokenLimit: 0, inputTokensUsed: 999 }))).to.equal(undefined);
    });

    it('is hidden below the warning threshold', () => {
        expect(computeQuotaBannerState(usage({ inputTokensUsed: 700_000, outputTokensUsed: 99_999 }))).to.equal(undefined);
    });

    it('warns from exactly 80%, counting input and output tokens together', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 700_000, outputTokensUsed: 100_000 }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 80, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('reports whole percent, rounded down, and passes the reset date through', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 876_543 }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 87, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('is exhausted at exactly 100%', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 1_000_000 }));
        expect(state?.level).to.equal('exhausted');
        expect(state?.percentUsed).to.equal(100);
    });

    it('caps the reported percent at 100 when over the limit', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 1_500_000 }));
        expect(state).to.deep.equal({ level: 'exhausted', percentUsed: 100, resetsOn: '2026-09-01T00:00:00Z' });
    });

    it('omits the reset date when the server did not send one', () => {
        const state = computeQuotaBannerState(usage({ inputTokensUsed: 900_000, billingPeriodEnd: undefined }));
        expect(state).to.deep.equal({ level: 'warning', percentUsed: 90, resetsOn: undefined });
    });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-branding`
Expected: FAILS with `Cannot find module './cookbot-quota-banner-state'`.

- [ ] **Step 4: Implement the helper**

Create `packages/cooklang-branding/src/browser/cookbot-quota-banner-state.ts` (license header first):

```ts
import { CookbotUsageStats } from '@theia/cooklang-ai/lib/common';

/**
 * Mirrors USAGE_WARNING_THRESHOLD_PERCENT in the cookbot server's
 * chat_service.rs, so client warning and server logging stay consistent.
 */
export const QUOTA_WARNING_THRESHOLD = 0.8;

/**
 * What the chat quota banner should show. `undefined` means: show nothing.
 * Kept free of widget and localization concerns so it stays unit-testable
 * in a monaco-free spec.
 */
export interface CookbotQuotaBannerState {
    level: 'warning' | 'exhausted';
    /** Whole percent of the allowance used, rounded down, capped at 100. */
    percentUsed: number;
    /** ISO date the cycle resets (billing_period_end), when the server sent one. */
    resetsOn: string | undefined;
}

export function computeQuotaBannerState(usage: CookbotUsageStats | undefined): CookbotQuotaBannerState | undefined {
    if (!usage || usage.tokenLimit <= 0) {
        return undefined;
    }
    const fraction = (usage.inputTokensUsed + usage.outputTokensUsed) / usage.tokenLimit;
    if (fraction < QUOTA_WARNING_THRESHOLD) {
        return undefined;
    }
    return {
        level: fraction >= 1 ? 'exhausted' : 'warning',
        percentUsed: Math.min(100, Math.floor(fraction * 100)),
        resetsOn: usage.billingPeriodEnd,
    };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx lerna run compile --scope @theia/cooklang-branding && npx lerna run test --scope @theia/cooklang-branding`
Expected: compile exit 0; all 8 specs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-branding/package.json packages/cooklang-branding/tsconfig.json \
        packages/cooklang-branding/src/browser/cookbot-quota-banner-state.ts \
        packages/cooklang-branding/src/browser/cookbot-quota-banner-state.spec.ts \
        package-lock.json
git commit -m "feat(branding): add quota banner threshold logic (#89)"
```

---

### Task 7: Banner UI in `CooklangChatViewWidget` + CSS

DOM banner pinned above the chat input, refreshed on attach/show and on chat response completion. No unit test — this is DOM/widget glue over the already-tested helper; it is verified by compile, lint, and the manual smoke test in Task 8.

**Files:**
- Modify: `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts`
- Modify: `packages/ai-chat-ui/src/browser/style/index.css`

- [ ] **Step 1: Extend the widget**

In `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts`:

1. Add imports (after the existing ones):

```ts
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Message } from '@theia/core/lib/browser';
import { ChatModel, ChatResponseModel, isActiveSessionChangedEvent } from '@theia/ai-chat/lib/common';
import { CookbotUsageService } from '@theia/cooklang-ai/lib/common';
import { AccountCommands } from '@theia/cooklang-account/lib/browser/account-contribution';
import { computeQuotaBannerState, CookbotQuotaBannerState } from './cookbot-quota-banner-state';
```

Note: no `CommandService` import is needed — the base class (`ChatViewWidget` in `@theia/ai-chat-ui`) already injects `commandService` as a protected member, used below for the Open Account action.

2. Add fields after `private webBaseUrl: string = DEFAULT_WEB_BASE_URL;`:

```ts
    @inject(CookbotUsageService)
    protected readonly cookbotUsageService: CookbotUsageService;

    private quotaBanner: HTMLDivElement;
    private quotaBannerState: CookbotQuotaBannerState | undefined;
    private readonly usageTracking = new DisposableCollection();
```

3. In `init()`, after the `gateOverlay` setup block, add:

```ts
        this.quotaBanner = document.createElement('div');
        this.quotaBanner.className = 'ai-chat-quota-banner';
        this.quotaBanner.style.display = 'none';

        this.trackModelForUsage(this.chatSession.model);
        this.toDispose.push(this.chatService.onSessionEvent(event => {
            // Runs after the base class's own listener, so chatSession is
            // already switched to the new active session here.
            if (isActiveSessionChangedEvent(event)) {
                this.trackModelForUsage(this.chatSession.model);
            }
        }));
        this.toDispose.push(this.usageTracking);
```

4. Add these methods at the end of the class:

```ts
    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // The banner sits between the chat tree and the input inside the
        // widget's flex column, outside the PanelLayout's own widgets.
        if (!this.quotaBanner.isConnected) {
            this.node.insertBefore(this.quotaBanner, this.inputWidget.node);
        }
        this.refreshUsage();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refreshUsage();
    }

    private trackModelForUsage(model: ChatModel): void {
        this.usageTracking.dispose();
        this.usageTracking.push(model.onDidChange(event => {
            if (event.kind === 'addResponse') {
                this.watchResponseCompletion(event.response);
            }
        }));
    }

    /**
     * Refresh once per exchange, when the response settles — streaming
     * deltas must not each trigger a usage query.
     */
    private watchResponseCompletion(response: ChatResponseModel): void {
        const listener = response.onDidChange(() => {
            if (response.isComplete || response.isCanceled || response.isError) {
                listener.dispose();
                this.refreshUsage();
            }
        });
        this.usageTracking.push(listener);
    }

    private refreshUsage(): void {
        this.cookbotUsageService.getUsage().then(usageStats => {
            this.quotaBannerState = computeQuotaBannerState(usageStats);
            this.renderQuotaBanner();
        }).catch(error => {
            // The backend already collapses expected failures to undefined;
            // anything surfacing here is RPC noise not worth a banner change.
            console.info('[Chat] Could not refresh Cookbot usage:', error);
        });
    }

    private renderQuotaBanner(): void {
        const state = this.quotaBannerState;
        const gated = this.authState.status !== 'logged-in' || !this.hasAiFeature;
        if (!state || gated) {
            this.quotaBanner.style.display = 'none';
            return;
        }
        this.quotaBanner.replaceChildren();
        this.quotaBanner.classList.toggle('exhausted', state.level === 'exhausted');

        const message = document.createElement('span');
        message.className = 'ai-chat-quota-banner-message';
        const resetsOn = state.resetsOn ? new Date(state.resetsOn).toLocaleDateString() : undefined;
        if (state.level === 'exhausted') {
            message.textContent = resetsOn
                ? nls.localize('theia/ai-chat/quota/exhaustedWithDate', 'Your Cookbot AI credits are used up until {0}.', resetsOn)
                : nls.localize('theia/ai-chat/quota/exhausted', 'Your Cookbot AI credits for this billing cycle are used up.');
        } else {
            message.textContent = resetsOn
                ? nls.localize('theia/ai-chat/quota/warningWithDate', "You've used {0}% of your Cookbot AI credits this cycle — resets {1}.", state.percentUsed, resetsOn)
                : nls.localize('theia/ai-chat/quota/warning', "You've used {0}% of your Cookbot AI credits this cycle.", state.percentUsed);
        }

        const account = document.createElement('a');
        account.className = 'ai-chat-quota-banner-link';
        account.textContent = nls.localize('theia/ai-chat/quota/openAccount', 'Open Account');
        account.addEventListener('click', () => {
            this.commandService.executeCommand(AccountCommands.OPEN_VIEW.id);
        });

        const upgrade = document.createElement('a');
        upgrade.className = 'ai-chat-quota-banner-link';
        upgrade.textContent = nls.localize('theia/ai-chat/quota/upgrade', 'Upgrade');
        upgrade.addEventListener('click', () => {
            this.startUpgradeFlow();
        });

        this.quotaBanner.append(message, account, upgrade);
        this.quotaBanner.style.display = 'flex';
    }
```

5. Keep the banner consistent with the gate: at the end of `showGateScreen(...)` (both return paths go through the top — add it right after `this.gateOverlay.replaceChildren();`):

```ts
        this.quotaBanner.style.display = 'none';
```

and in `updateGating()`, in the ungated branch, after the `for (const widget of layout)` loop, add:

```ts
        this.refreshUsage();
```

- [ ] **Step 2: Add the CSS**

In `packages/ai-chat-ui/src/browser/style/index.css`, directly after the `.ai-chat-gate-note` rule block, add (4-space indent to match the neighboring gate rules; theme colors only, no hard-coded values):

```css
/* Chat quota banner — warns when Cookbot AI credits near/at the cycle limit */
.ai-chat-quota-banner {
    display: none;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 12px 4px 12px;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 4px;
    background-color: var(--theia-inputValidation-warningBackground);
    border: 1px solid var(--theia-inputValidation-warningBorder);
}

.ai-chat-quota-banner.exhausted {
    background-color: var(--theia-inputValidation-errorBackground);
    border-color: var(--theia-inputValidation-errorBorder);
}

.ai-chat-quota-banner-link {
    cursor: pointer;
    text-decoration: underline;
    color: var(--theia-textLink-foreground);
    white-space: nowrap;
}
```

- [ ] **Step 3: Compile and lint**

Run: `npx lerna run compile --scope @theia/cooklang-branding && npx lerna run lint --scope @theia/cooklang-branding --scope @theia/ai-chat-ui`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts packages/ai-chat-ui/src/browser/style/index.css
git commit -m "feat(branding): show quota banner in chat view past 80% usage (#89)"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Compile everything and run the affected packages' tests**

Run: `npm run compile && npx lerna run test --scope @theia/cooklang-ai --scope @theia/cooklang-branding`
Expected: exit 0, all specs green.

- [ ] **Step 2: Lint the touched packages**

Run: `npx lerna run lint --scope @theia/cooklang-ai --scope @theia/cooklang-branding --scope @theia/ai-chat-ui`
Expected: exit 0.

- [ ] **Step 3: Manual smoke test (requires a local cookbot server)**

Only possible with a local cookbot running (`COOKBOT_ADDRESS=127.0.0.1:50052`); if unavailable, note that in the final report instead of skipping silently.

```bash
cd app && npm run bundle && npm run start:electron
```

Walkthrough:
1. Log in, open the AI Chat view — with usage below 80% no banner appears.
2. With the local server's token limit configured low, chat until crossing 80% — after the response completes, the warning banner appears above the input with percent and reset date; "Open Account" opens the Account view.
3. Cross 100% — the banner switches to the exhausted style/message, and a new message still fails with the #86 error text (banner and error coexist).
4. Log out — the gate screen shows and no banner is visible.

- [ ] **Step 4: Update the issue**

Do not close #89 automatically; the final PR description should reference it with `Closes #89` and mention the discovery that `GetUsage` already existed in the proto.
