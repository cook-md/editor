# Subscription Gating & CookCloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subscription-aware feature gating (AI chat, cloud sync) and a CookCloud sync client to the Cooklang editor, with a new Account sidebar for account management.

**Architecture:** Extract auth from `cooklang-ai` into a new `cooklang-account` package. Add `SubscriptionService` (backend, calls cook.md API, caches state), `SyncService` (wraps NAPI bindings to `cooklang-sync-client`), and `AccountWidget` (React sidebar). Gate AI chat in `ChatViewWidget` based on auth + subscription. Add sync NAPI bindings to `cooklang-native`.

**Tech Stack:** TypeScript (Theia/InversifyJS DI), React 18, Rust/NAPI-RS, `cooklang-sync-client` crate

**Spec:** `docs/superpowers/specs/2026-03-25-subscription-gating-and-cloud-sync-design.md`

---

## File Map

### New: `packages/cooklang-account/`

| File | Responsibility |
|------|---------------|
| `package.json` | Package manifest with dependencies on `@theia/core`, `@theia/workspace`, `@theia/cooklang-native` |
| `tsconfig.json` | TS config with references to `core`, `workspace`, `cooklang-native` |
| `src/common/auth-protocol.ts` | `AuthService` interface, `AuthState`, `AuthData`, `LoginResult` types, service path |
| `src/common/subscription-protocol.ts` | `SubscriptionService` interface, `SubscriptionState` type, service path |
| `src/common/sync-protocol.ts` | `SyncService` interface, `SyncStatus` type, service path |
| `src/node/auth-service.ts` | OAuth flow, JWT storage, `onDidChangeAuth` event, eager daily token renewal |
| `src/node/subscription-service.ts` | Calls `GET /api/subscription`, 5-min cache, listens to auth events |
| `src/node/sync-service.ts` | Wraps NAPI sync bindings, lifecycle management, status polling |
| `src/node/cooklang-account-backend-module.ts` | InversifyJS backend bindings |
| `src/browser/auth-contribution.ts` | Login/logout commands, status bar item |
| `src/browser/account-contribution.ts` | Account sidebar registration (`AbstractViewContribution`) |
| `src/browser/account-widget.tsx` | React sidebar widget with 4 states |
| `src/browser/subscription-frontend-service.ts` | RPC proxy to backend SubscriptionService |
| `src/browser/cooklang-account-frontend-module.ts` | InversifyJS frontend bindings |

### Modified: `packages/cooklang-ai/`

| File | Change |
|------|--------|
| `package.json` | Remove auth, add dep on `@theia/cooklang-account` |
| `tsconfig.json` | Replace self-reference with `cooklang-account` reference |
| `src/node/cooklang-ai-backend-module.ts` | Remove auth bindings, import `AuthService` from parent container |
| `src/browser/cooklang-ai-frontend-module.ts` | Remove auth contribution/proxy bindings, import from `cooklang-account` |
| `src/browser/cookbot-chat-agent.ts` | No change (agent definition stays) |
| `src/node/cookbot-language-model.ts` | Import `AuthService` from `cooklang-account` common |

### Modified: `packages/cooklang-native/`

| File | Change |
|------|--------|
| `Cargo.toml` | Add `cooklang-sync-client` dependency |
| `src/lib.rs` | Add `start_sync`, `stop_sync`, `get_sync_status` NAPI functions |

### Modified: `packages/ai-chat-ui/`

| File | Change |
|------|--------|
| `package.json` | Add dep on `@theia/cooklang-account` |
| `tsconfig.json` | Add reference to `cooklang-account` |
| `src/browser/chat-view-widget.tsx` | Add auth/subscription gating before rendering chat UI |

### Modified: `examples/electron/`

| File | Change |
|------|--------|
| `package.json` | Add `@theia/cooklang-account` dependency |
| `tsconfig.json` | Add reference to `cooklang-account` |

---

## Task 1: Create `cooklang-account` package skeleton

**Files:**
- Create: `packages/cooklang-account/package.json`
- Create: `packages/cooklang-account/tsconfig.json`
- Create: `packages/cooklang-account/src/common/auth-protocol.ts`
- Create: `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`
- Create: `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@theia/cooklang-account",
  "version": "1.68.0",
  "description": "Theia - Cook.md Account, Subscription & Sync",
  "dependencies": {
    "@theia/core": "1.68.0",
    "@theia/workspace": "1.68.0",
    "@theia/cooklang-native": "0.1.0",
    "tslib": "^2.6.2"
  },
  "main": "lib/common",
  "theiaExtensions": [
    {
      "frontend": "lib/browser/cooklang-account-frontend-module",
      "backend": "lib/node/cooklang-account-backend-module"
    }
  ],
  "keywords": ["theia-extension"],
  "license": "MIT",
  "files": ["lib", "src"],
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

- [ ] **Step 2: Create `tsconfig.json`**

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
    { "path": "../core" },
    { "path": "../workspace" },
    { "path": "../cooklang-native" }
  ]
}
```

- [ ] **Step 3: Create `src/common/auth-protocol.ts`**

Copy from `packages/cooklang-ai/src/common/cookbot-auth-protocol.ts` and modify:
- Rename `CookbotAuthService` → `AuthService` (symbol and interface)
- Rename `CookbotAuthServicePath` → `AuthServicePath`
- Keep `AuthState`, `AuthData`, `LoginResult` types unchanged
- Update service path string from `'/services/cookbot-auth'` to `'/services/cookmd-auth'`

```typescript
import { Event } from '@theia/core/lib/common';

export const AuthServicePath = '/services/cookmd-auth';
export const AuthService = Symbol('AuthService');

export interface AuthState {
    status: 'logged-out' | 'logged-in';
    email?: string;
}

export interface AuthData {
    token: string;
    email: string;
    expiresAt: string;
    createdAt: string;
}

export interface LoginResult {
    authUrl: string;
}

export interface AuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
    readonly onDidChangeAuth: Event<AuthState>;
}
```

- [ ] **Step 4: Create empty backend module**

Create `src/node/cooklang-account-backend-module.ts`:

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
    // Will be populated as services are added
});
```

- [ ] **Step 5: Create empty frontend module**

Create `src/browser/cooklang-account-frontend-module.ts`:

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
    // Will be populated as services are added
});
```

- [ ] **Step 6: Register in `examples/electron`**

Add to `examples/electron/package.json` dependencies:
```json
"@theia/cooklang-account": "1.68.0"
```

Add to `examples/electron/tsconfig.json` references:
```json
{ "path": "../../packages/cooklang-account" }
```

- [ ] **Step 7: Run `npm install` and verify compilation**

Run: `npm install && npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation with no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang-account/ examples/electron/package.json examples/electron/tsconfig.json
git commit -m "feat: create cooklang-account package skeleton"
```

---

## Task 2: Move auth service to `cooklang-account`

**Files:**
- Create: `packages/cooklang-account/src/node/auth-service.ts`
- Modify: `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`

- [ ] **Step 1: Create `auth-service.ts`**

Copy `packages/cooklang-ai/src/node/cookbot-auth-service.ts` to `packages/cooklang-account/src/node/auth-service.ts`. Apply these changes:

1. Rename class `CookbotAuthServiceImpl` → `AuthServiceImpl`
2. Update import: `AuthService`, `AuthData`, `AuthState`, `LoginResult` from `'../common/auth-protocol'`
3. Add `Emitter` and `Event` imports from `@theia/core/lib/common`
4. Add `onDidChangeAuth` event:

```typescript
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { AuthService, AuthData, AuthState, LoginResult } from '../common/auth-protocol';

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

@injectable()
export class AuthServiceImpl implements AuthService {

    private authData: AuthData | undefined;
    private callbackServer: http.Server | undefined;
    private callbackTimeout: ReturnType<typeof setTimeout> | undefined;
    private renewalTimer: ReturnType<typeof setInterval> | undefined;

    private readonly onDidChangeAuthEmitter = new Emitter<AuthState>();
    readonly onDidChangeAuth: Event<AuthState> = this.onDidChangeAuthEmitter.event;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk().then(() => {
            if (this.authData) {
                this.tryRenewToken();
            }
            this.startRenewalTimer();
        });
    }

    // ... (keep all existing methods from CookbotAuthServiceImpl)
```

5. In the callback server handler, after `this.authData = authData;` fire the event:
```typescript
this.onDidChangeAuthEmitter.fire({ status: 'logged-in', email: authData.email });
```

6. In `logout()`, after `this.authData = undefined;` fire the event:
```typescript
this.onDidChangeAuthEmitter.fire({ status: 'logged-out' });
```

7. Replace `tryRenewToken()` — remove the expiry-proximity check, just always renew:
```typescript
private async tryRenewToken(): Promise<void> {
    if (!this.authData?.token) {
        return;
    }
    try {
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const url = new URL('/api/sessions/renew', webBaseUrl);
        const response = await this.httpPost(url, this.authData.token);
        const data = JSON.parse(response);
        if (data.token) {
            const { email, exp } = this.parseJwtPayload(data.token);
            const renewed: AuthData = {
                token: data.token,
                email: email || this.authData.email,
                expiresAt: exp ? new Date(exp * 1000).toISOString() : this.authData.expiresAt,
                createdAt: this.authData.createdAt,
            };
            await this.saveToDisk(renewed);
            this.authData = renewed;
        }
    } catch {
        console.warn('Token renewal failed, clearing session');
        await this.logout();
    }
}
```

8. Add `startRenewalTimer()`:
```typescript
private startRenewalTimer(): void {
    this.renewalTimer = setInterval(() => {
        this.tryRenewToken();
    }, RENEWAL_INTERVAL_MS);
}
```

- [ ] **Step 2: Wire up backend module**

Update `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`:

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthServiceImpl } from './auth-service';

export default new ContainerModule(bind => {
    bind(AuthServiceImpl).toSelf().inSingletonScope();
    bind(AuthService).toService(AuthServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(AuthServicePath, () =>
            ctx.container.get(AuthService)
        )
    ).inSingletonScope();
});
```

- [ ] **Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add AuthService to cooklang-account with event-driven auth and eager renewal"
```

---

## Task 3: Move auth contribution to `cooklang-account`

**Files:**
- Create: `packages/cooklang-account/src/browser/auth-contribution.ts`
- Modify: `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`

- [ ] **Step 1: Create `auth-contribution.ts`**

Copy `packages/cooklang-ai/src/browser/cookbot-auth-contribution.ts` to `packages/cooklang-account/src/browser/auth-contribution.ts`. Apply changes:

1. Rename class `CookbotAuthContribution` → `AuthContribution`
2. Update import to use `AuthService` from `'../common/auth-protocol'`
3. Replace polling with event listener. Remove `loginPollTimer`, `startLoginPolling()`, `stopLoginPolling()` methods.
4. In `init()`, subscribe to `onDidChangeAuth`:

```typescript
@postConstruct()
protected init(): void {
    this.refreshAuthState();
    this.authService.onDidChangeAuth(state => {
        this.authState = state;
        this.updateStatusBar();
    });
}
```

5. In `doLogin()`, remove `this.startLoginPolling()` call (events handle it now).
6. In `doLogout()`, simplify — just call `this.authService.logout()` (event will update state).

```typescript
private async doLogout(): Promise<void> {
    try {
        await this.authService.logout();
    } catch (err) {
        console.error('Cook.md logout failed:', err);
    }
}
```

- [ ] **Step 2: Wire up frontend module**

Update `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`:

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthContribution } from './auth-contribution';

export default new ContainerModule(bind => {
    // Auth service RPC proxy
    bind(AuthService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<AuthService>(ctx.container, AuthServicePath)
    ).inSingletonScope();

    // Auth contribution (commands + status bar)
    bind(AuthContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AuthContribution);
    bind(CommandContribution).toService(AuthContribution);
});
```

- [ ] **Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add AuthContribution with event-driven state updates"
```

---

## Task 4: Update `cooklang-ai` to use `cooklang-account` for auth

**Files:**
- Delete: `packages/cooklang-ai/src/common/cookbot-auth-protocol.ts`
- Delete: `packages/cooklang-ai/src/browser/cookbot-auth-contribution.ts`
- Delete: `packages/cooklang-ai/src/node/cookbot-auth-service.ts`
- Modify: `packages/cooklang-ai/package.json`
- Modify: `packages/cooklang-ai/tsconfig.json`
- Modify: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`
- Modify: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`
- Modify: any files importing `cookbot-auth-protocol` (e.g. `cookbot-language-model.ts`, `cookbot-grpc-client.ts`)

- [ ] **Step 1: Update `package.json`**

Add dependency:
```json
"@theia/cooklang-account": "1.68.0"
```

- [ ] **Step 2: Update `tsconfig.json`**

Add reference:
```json
{ "path": "../cooklang-account" }
```

- [ ] **Step 3: Update backend module**

In `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`:

1. Remove all auth-related imports (`CookbotAuthService`, `CookbotAuthServicePath`, `CookbotAuthServiceImpl`)
2. Import `AuthService` from `@theia/cooklang-account/lib/common/auth-protocol`
3. Remove auth bindings from the root `ContainerModule` (the `bind(CookbotAuthServiceImpl)`, `bind(CookbotAuthService)`, and auth `ConnectionHandler`)
4. In `cookbotConnectionModule`, change the `CookbotAuthService` re-binding to `AuthService`:

```typescript
bind(AuthService).toDynamicValue(ctx =>
    ctx.container.parent!.get(AuthService)
).inSingletonScope();
```

- [ ] **Step 4: Update frontend module**

In `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`:

1. Remove imports: `CookbotAuthService`, `CookbotAuthServicePath`, `CookbotAuthContribution`
2. Remove bindings: `CookbotAuthService` proxy, `CookbotAuthContribution`, `FrontendApplicationContribution`, `CommandContribution`
3. Import `AuthService` from `@theia/cooklang-account/lib/common/auth-protocol` if needed by other services

- [ ] **Step 5: Update all internal imports**

Search for any file in `packages/cooklang-ai/` that imports from `'../common/cookbot-auth-protocol'` or re-exports auth symbols, and update accordingly. Key files to check:
- `src/node/cookbot-grpc-client.ts` — update import to `AuthService` from `'@theia/cooklang-account/lib/common/auth-protocol'`
- `src/node/index.ts` — remove the `export { CookbotAuthServiceImpl } from './cookbot-auth-service'` line
- `src/common/index.ts` — remove the `export * from './cookbot-auth-protocol'` line

Run `grep -r "cookbot-auth\|CookbotAuth" packages/cooklang-ai/src/ --include="*.ts"` to find all references.

- [ ] **Step 6: Delete moved files**

```bash
rm packages/cooklang-ai/src/common/cookbot-auth-protocol.ts
rm packages/cooklang-ai/src/browser/cookbot-auth-contribution.ts
rm packages/cooklang-ai/src/node/cookbot-auth-service.ts
```

- [ ] **Step 7: Compile both packages**

Run: `npx lerna run compile --scope @theia/cooklang-account --scope @theia/cooklang-ai`
Expected: Both compile without errors.

- [ ] **Step 8: Commit**

```bash
git add -A packages/cooklang-ai/ packages/cooklang-account/
git commit -m "refactor: migrate auth from cooklang-ai to cooklang-account"
```

---

## Task 5: Add subscription protocol and backend service

**Files:**
- Create: `packages/cooklang-account/src/common/subscription-protocol.ts`
- Create: `packages/cooklang-account/src/node/subscription-service.ts`
- Modify: `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`

- [ ] **Step 1: Create `subscription-protocol.ts`**

```typescript
import { Event } from '@theia/core/lib/common';

export const SubscriptionServicePath = '/services/cookmd-subscription';
export const SubscriptionService = Symbol('SubscriptionService');

export interface SubscriptionState {
    status: 'trial' | 'active' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    plan: 'monthly' | 'annual' | null;
    expiresAt: string | null;
    trialDaysRemaining: number | null;
}

export interface SubscriptionService {
    getSubscription(): Promise<SubscriptionState | undefined>;
    hasFeature(name: string): Promise<boolean>;
    refresh(): Promise<void>;
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined>;
}
```

- [ ] **Step 2: Create `subscription-service.ts`**

```typescript
import * as http from 'http';
import * as https from 'https';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { AuthService, AuthState } from '../common/auth-protocol';
import { SubscriptionService, SubscriptionState } from '../common/subscription-protocol';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@injectable()
export class SubscriptionServiceImpl implements SubscriptionService {

    @inject(AuthService)
    protected readonly authService: AuthService;

    private cachedState: SubscriptionState | undefined;
    private cacheTimestamp = 0;

    private readonly onDidChangeSubscriptionEmitter = new Emitter<SubscriptionState | undefined>();
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined> = this.onDidChangeSubscriptionEmitter.event;

    @postConstruct()
    protected init(): void {
        this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
    }

    async getSubscription(): Promise<SubscriptionState | undefined> {
        if (this.cachedState && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
            return this.cachedState;
        }
        await this.fetchSubscription();
        return this.cachedState;
    }

    async hasFeature(name: string): Promise<boolean> {
        const sub = await this.getSubscription();
        return sub?.features.includes(name) ?? false;
    }

    async refresh(): Promise<void> {
        await this.fetchSubscription();
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-in') {
            await this.fetchSubscription();
        } else {
            this.cachedState = undefined;
            this.cacheTimestamp = 0;
            this.onDidChangeSubscriptionEmitter.fire(undefined);
        }
    }

    private async fetchSubscription(): Promise<void> {
        const token = await this.authService.getToken();
        if (!token) {
            this.cachedState = undefined;
            this.cacheTimestamp = 0;
            return;
        }
        try {
            const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
            const url = new URL('/api/subscription', webBaseUrl);
            const response = await this.httpGet(url, token);
            const data = JSON.parse(response);
            this.cachedState = {
                status: data.status ?? 'none',
                hasAccess: data.has_access ?? false,
                features: data.features ?? [],
                plan: data.plan ?? null,
                expiresAt: data.expires_at ?? null,
                trialDaysRemaining: data.trial_days_remaining ?? null,
            };
            this.cacheTimestamp = Date.now();
            this.onDidChangeSubscriptionEmitter.fire(this.cachedState);
        } catch (err) {
            console.warn('Failed to fetch subscription:', err);
        }
    }

    private httpGet(url: URL, bearerToken: string): Promise<string> {
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${bearerToken}`,
                    'Accept': 'application/json',
                },
            }, (res: http.IncomingMessage) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(body);
                    } else {
                        reject(new Error(`Subscription request failed with status ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }
}
```

- [ ] **Step 3: Register in backend module**

Add to `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`:

```typescript
import { SubscriptionService, SubscriptionServicePath } from '../common/subscription-protocol';
import { SubscriptionServiceImpl } from './subscription-service';

// Inside ContainerModule:
bind(SubscriptionServiceImpl).toSelf().inSingletonScope();
bind(SubscriptionService).toService(SubscriptionServiceImpl);
bind(ConnectionHandler).toDynamicValue(ctx =>
    new RpcConnectionHandler(SubscriptionServicePath, () =>
        ctx.container.get(SubscriptionService)
    )
).inSingletonScope();
```

- [ ] **Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add SubscriptionService with API fetching and caching"
```

---

## Task 6: Add subscription frontend service

**Files:**
- Create: `packages/cooklang-account/src/browser/subscription-frontend-service.ts`
- Modify: `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`

- [ ] **Step 1: Create `subscription-frontend-service.ts`**

```typescript
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { SubscriptionService, SubscriptionState } from '../common/subscription-protocol';

export const SubscriptionFrontendService = Symbol('SubscriptionFrontendService');

@injectable()
export class SubscriptionFrontendServiceImpl {

    @inject(SubscriptionService)
    protected readonly subscriptionService: SubscriptionService;

    private cachedState: SubscriptionState | undefined;

    private readonly onDidChangeSubscriptionEmitter = new Emitter<SubscriptionState | undefined>();
    readonly onDidChangeSubscription: Event<SubscriptionState | undefined> = this.onDidChangeSubscriptionEmitter.event;

    @postConstruct()
    protected init(): void {
        this.subscriptionService.onDidChangeSubscription(state => {
            this.cachedState = state;
            this.onDidChangeSubscriptionEmitter.fire(state);
        });
        this.subscriptionService.getSubscription().then(state => {
            this.cachedState = state;
        });
    }

    get subscription(): SubscriptionState | undefined {
        return this.cachedState;
    }

    async hasFeature(name: string): Promise<boolean> {
        return this.subscriptionService.hasFeature(name);
    }

    async refresh(): Promise<void> {
        return this.subscriptionService.refresh();
    }
}
```

- [ ] **Step 2: Register in frontend module**

Add to `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`:

```typescript
import { SubscriptionService, SubscriptionServicePath } from '../common/subscription-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from './subscription-frontend-service';

// Inside ContainerModule:
bind(SubscriptionService).toDynamicValue(ctx =>
    ServiceConnectionProvider.createProxy<SubscriptionService>(ctx.container, SubscriptionServicePath)
).inSingletonScope();

bind(SubscriptionFrontendServiceImpl).toSelf().inSingletonScope();
bind(SubscriptionFrontendService).toService(SubscriptionFrontendServiceImpl);
```

- [ ] **Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add SubscriptionFrontendService for browser-side subscription access"
```

---

## Task 7: Add Account sidebar widget

**Files:**
- Create: `packages/cooklang-account/src/browser/account-widget.tsx`
- Create: `packages/cooklang-account/src/browser/account-contribution.ts`
- Modify: `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`

- [ ] **Step 1: Create `account-widget.tsx`**

Follow the pattern from `packages/cooklang/src/browser/shopping-list-widget.tsx`:

```tsx
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import * as React from '@theia/core/shared/react';
import { AuthService, AuthState } from '../common/auth-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from './subscription-frontend-service';
import { CookmdLoginCommand } from './auth-contribution';

export const ACCOUNT_WIDGET_ID = 'account-widget';

@injectable()
export class AccountWidget extends ReactWidget {

    static readonly ID = ACCOUNT_WIDGET_ID;
    static readonly LABEL = 'Account';

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptionFrontendService: SubscriptionFrontendServiceImpl;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    private authState: AuthState = { status: 'logged-out' };

    @postConstruct()
    protected init(): void {
        this.id = AccountWidget.ID;
        this.title.label = AccountWidget.LABEL;
        this.title.caption = AccountWidget.LABEL;
        this.title.iconClass = 'codicon codicon-account';
        this.title.closable = true;
        this.addClass('theia-account-widget');
        this.scrollOptions = { suppressScrollX: true };

        this.authService.getAuthState().then(state => {
            this.authState = state;
            this.update();
        });

        this.authService.onDidChangeAuth(state => {
            this.authState = state;
            this.update();
        });

        this.subscriptionFrontendService.onDidChangeSubscription(() => {
            this.update();
        });
    }

    protected render(): React.ReactNode {
        if (this.authState.status === 'logged-out') {
            return this.renderLoginPrompt();
        }
        return this.renderAccountPanel();
    }

    private renderLoginPrompt(): React.ReactNode {
        return <div className='account-gate-screen'>
            <div className='account-gate-icon'>&#128100;</div>
            <div className='account-gate-title'>Cook.md Account</div>
            <div className='account-gate-message'>
                Log in to manage your subscription, enable CookCloud sync, and access premium features.
            </div>
            <button className='theia-button main' onClick={this.handleLogin}>
                Log In
            </button>
        </div>;
    }

    private renderAccountPanel(): React.ReactNode {
        const sub = this.subscriptionFrontendService.subscription;
        if (!sub) {
            return <div className='account-loading'>Loading...</div>;
        }

        const statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
        const planLabel = sub.plan ? `${sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)} plan` : '';

        return <div className='account-panel'>
            <div className='account-info'>
                <div className='account-email'>{this.authState.email}</div>
                <div className='account-plan'>{statusLabel}{planLabel ? ` · ${planLabel}` : ''}</div>
            </div>

            {sub.features.length > 0 && <div className='account-section'>
                <div className='account-section-label'>Features</div>
                <div className='account-features'>
                    {sub.features.map(f => <span key={f} className='account-feature-badge'>{f}</span>)}
                </div>
            </div>}

            <div className='account-section'>
                <div className='account-section-label'>CookCloud Sync</div>
                {sub.features.includes('sync')
                    ? this.renderSyncControls()
                    : this.renderSyncUpgrade()
                }
            </div>

            <div className='account-manage'>
                <a href='#' onClick={this.handleManageSubscription}>Manage Subscription →</a>
            </div>
        </div>;
    }

    private renderSyncControls(): React.ReactNode {
        // Will be implemented in Task 11 when SyncService is ready
        return <div className='sync-placeholder'>Sync controls coming soon</div>;
    }

    private renderSyncUpgrade(): React.ReactNode {
        return <div className='account-upgrade-prompt'>
            <div className='account-gate-message'>
                CookCloud sync requires an active subscription with the sync feature.
            </div>
            <button className='theia-button main' onClick={this.handleUpgrade}>
                Upgrade Plan →
            </button>
        </div>;
    }

    private handleLogin = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    private handleManageSubscription = (e: React.MouseEvent): void => {
        e.preventDefault();
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        this.windowService.openNewWindow(`${webBaseUrl}/account`, { external: true });
    };

    private handleUpgrade = (): void => {
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        this.windowService.openNewWindow(`${webBaseUrl}/pricing`, { external: true });
    };
}
```

- [ ] **Step 2: Create `account-contribution.ts`**

Follow the pattern from `packages/cooklang/src/browser/shopping-list-contribution.ts`:

```typescript
import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AccountWidget, ACCOUNT_WIDGET_ID } from './account-widget';

export namespace AccountCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cookmd.toggleAccount',
        label: 'Cook.md: Toggle Account',
    };
}

@injectable()
export class AccountContribution extends AbstractViewContribution<AccountWidget> implements FrontendApplicationContribution {

    constructor() {
        super({
            widgetId: ACCOUNT_WIDGET_ID,
            widgetName: AccountWidget.LABEL,
            defaultWidgetOptions: { area: 'right' },
            toggleCommandId: AccountCommands.TOGGLE_VIEW.id,
        });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
    }
}
```

- [ ] **Step 3: Register in frontend module**

Add to `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`:

```typescript
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { AccountWidget, ACCOUNT_WIDGET_ID } from './account-widget';
import { AccountContribution } from './account-contribution';

// Inside ContainerModule:
bind(AccountWidget).toSelf();
bind(WidgetFactory).toDynamicValue(ctx => ({
    id: ACCOUNT_WIDGET_ID,
    createWidget: () => ctx.container.get(AccountWidget),
})).inSingletonScope();

bindViewContribution(bind, AccountContribution);
bind(FrontendApplicationContribution).toService(AccountContribution);
```

- [ ] **Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add Account sidebar widget with login, subscription, and upgrade UI"
```

---

## Task 8: Gate AI chat behind auth and subscription

**Files:**
- Modify: `packages/ai-chat-ui/package.json`
- Modify: `packages/ai-chat-ui/tsconfig.json`
- Modify: `packages/ai-chat-ui/src/browser/chat-view-widget.tsx`

- [ ] **Step 1: Add `cooklang-account` dependency**

In `packages/ai-chat-ui/package.json`, add:
```json
"@theia/cooklang-account": "1.68.0"
```

In `packages/ai-chat-ui/tsconfig.json`, add reference:
```json
{ "path": "../cooklang-account" }
```

- [ ] **Step 2: Modify `ChatViewWidget` to inject auth and subscription services**

In `packages/ai-chat-ui/src/browser/chat-view-widget.tsx`, add imports and injections:

```typescript
import { AuthService, AuthState } from '@theia/cooklang-account/lib/common/auth-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
```

Add injected properties:

```typescript
@inject(AuthService)
protected readonly authService: AuthService;

@inject(SubscriptionFrontendService)
protected readonly subscriptionFrontendService: SubscriptionFrontendServiceImpl;
```

Add state tracking:

```typescript
private authState: AuthState = { status: 'logged-out' };
private hasAiFeature = false;
```

In `@postConstruct init()` method, add:

```typescript
this.authService.getAuthState().then(state => {
    this.authState = state;
    this.update();
});
this.authService.onDidChangeAuth(state => {
    this.authState = state;
    this.checkAiFeature();
    this.update();
});
this.subscriptionFrontendService.onDidChangeSubscription(() => {
    this.checkAiFeature();
    this.update();
});
this.checkAiFeature();
```

Add helper:

```typescript
private async checkAiFeature(): Promise<void> {
    this.hasAiFeature = await this.subscriptionFrontendService.hasFeature('ai');
    this.update();
}
```

- [ ] **Step 3: Add gating overlay logic**

`ChatViewWidget` extends `BaseWidget` with a `PanelLayout` containing `treeWidget` and `inputWidget` as children. Do NOT destroy or clear the layout children. Instead, use a visibility-toggle approach:

1. Create a gate overlay `div` in `init()` and prepend it to `this.node`:
```typescript
private gateOverlay: HTMLDivElement;

// In init(), after existing setup:
this.gateOverlay = document.createElement('div');
this.gateOverlay.className = 'ai-chat-gate-overlay';
this.gateOverlay.style.display = 'none';
this.node.prepend(this.gateOverlay);
```

2. Add a method to update gating visibility:
```typescript
private updateGating(): void {
    const layout = this.layout as PanelLayout;

    if (this.authState.status === 'logged-out') {
        this.showGateScreen('login');
        return;
    }
    if (!this.hasAiFeature) {
        this.showGateScreen('upgrade');
        return;
    }

    // Authorized — hide overlay, show chat
    this.gateOverlay.style.display = 'none';
    for (let i = 0; i < layout.widgets.length; i++) {
        layout.widgets[i].show();
    }
}

private showGateScreen(type: 'login' | 'upgrade'): void {
    // Hide chat layout children
    const layout = this.layout as PanelLayout;
    for (let i = 0; i < layout.widgets.length; i++) {
        layout.widgets[i].hide();
    }

    // Show overlay with appropriate content
    this.gateOverlay.style.display = 'flex';
    this.gateOverlay.innerHTML = '';

    const icon = document.createElement('div');
    icon.className = 'ai-chat-gate-icon';
    icon.textContent = '🤖';

    const title = document.createElement('div');
    title.className = 'ai-chat-gate-title';
    title.textContent = 'AI Assistant';

    const message = document.createElement('div');
    message.className = 'ai-chat-gate-message';

    const button = document.createElement('button');
    button.className = 'theia-button main';

    if (type === 'login') {
        message.textContent = 'Log in to your Cook.md account to use the AI recipe assistant.';
        button.textContent = 'Log In';
        button.addEventListener('click', () => {
            this.commandService.executeCommand('cookmd.login');
        });
    } else {
        message.textContent = 'The AI assistant requires the AI addon. Add it to your subscription to get started.';
        button.textContent = 'Get AI Addon →';
        button.addEventListener('click', () => {
            this.windowService.openNewWindow('https://cook.md/pricing', { external: true });
        });
        const note = document.createElement('div');
        note.className = 'ai-chat-gate-note';
        note.textContent = 'Opens cook.md in your browser';
        this.gateOverlay.append(icon, title, message, button, note);
        return;
    }

    this.gateOverlay.append(icon, title, message, button);
}
```

3. Call `this.updateGating()` at the end of `init()`, in the `onDidChangeAuth` handler, and after `checkAiFeature()`.

4. Also inject `WindowService` for the upgrade link:
```typescript
@inject(WindowService)
protected readonly windowService: WindowService;
```

- [ ] **Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/ai-chat-ui`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-chat-ui/
git commit -m "feat: gate AI chat behind auth and subscription check"
```

---

## Task 9: Add sync NAPI-RS bindings to `cooklang-native`

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Modify: `packages/cooklang-native/src/lib.rs`

- [ ] **Step 1: Add `cooklang-sync-client` dependency to `Cargo.toml`**

```toml
cooklang-sync-client = "0.4"
```

Also ensure `tokio` has `sync` feature (likely already has `full`).

- [ ] **Step 2: Add sync NAPI functions to `lib.rs`**

Add at the end of `src/lib.rs`:

```rust
use std::sync::{Arc, Mutex};
use tokio::sync::CancellationToken;

// Global sync state
static SYNC_CANCEL_TOKEN: Mutex<Option<CancellationToken>> = Mutex::new(None);

#[derive(serde::Serialize)]
#[napi(object)]
pub struct SyncStatus {
    pub status: String,       // "idle", "syncing", "error", "stopped"
    pub last_synced_at: Option<String>,
    pub error: Option<String>,
}

#[napi]
pub async fn start_sync(
    recipes_dir: String,
    db_path: String,
    sync_endpoint: String,
    jwt: String,
    namespace_id: i64,
) -> napi::Result<()> {
    // Cancel any existing sync
    stop_sync().await?;

    let cancel_token = CancellationToken::new();
    {
        let mut guard = SYNC_CANCEL_TOKEN.lock().unwrap();
        *guard = Some(cancel_token.clone());
    }

    let token_clone = cancel_token.clone();
    tokio::spawn(async move {
        let context = cooklang_sync_client::SyncContext::new(token_clone);
        let result = cooklang_sync_client::run_async(
            context,
            &recipes_dir,
            &db_path,
            &sync_endpoint,
            &jwt,
            namespace_id,
            false, // bidirectional
        )
        .await;

        if let Err(e) = result {
            eprintln!("Sync error: {}", e);
        }
    });

    Ok(())
}

#[napi]
pub async fn stop_sync() -> napi::Result<()> {
    let mut guard = SYNC_CANCEL_TOKEN.lock().unwrap();
    if let Some(token) = guard.take() {
        token.cancel();
    }
    Ok(())
}

#[napi]
pub fn get_sync_status() -> SyncStatus {
    let guard = SYNC_CANCEL_TOKEN.lock().unwrap();
    if guard.is_some() {
        SyncStatus {
            status: "syncing".to_string(),
            last_synced_at: None,
            error: None,
        }
    } else {
        SyncStatus {
            status: "idle".to_string(),
            last_synced_at: None,
            error: None,
        }
    }
}
```

Note: The exact `cooklang_sync_client` API may differ from the above. Consult `../sync-agent/src/sync/manager.rs` for the actual function signatures and `SyncContext` usage. The above is a skeleton — adjust the `start_sync` body to match the actual crate API.

- [ ] **Step 3: Build native addon**

Run: `cd packages/cooklang-native && cargo build`
Expected: Successful compilation. If `cooklang-sync-client` has incompatible dependencies, resolve version conflicts.

- [ ] **Step 4: Rebuild NAPI bindings**

Run: `cd packages/cooklang-native && npm run build`
Expected: Generates updated `index.js` and `index.d.ts` with new functions.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-native/
git commit -m "feat: add sync NAPI-RS bindings wrapping cooklang-sync-client"
```

---

## Task 10: Add sync protocol and backend service

**Files:**
- Create: `packages/cooklang-account/src/common/sync-protocol.ts`
- Create: `packages/cooklang-account/src/node/sync-service.ts`
- Modify: `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`

- [ ] **Step 1: Create `sync-protocol.ts`**

```typescript
import { Event } from '@theia/core/lib/common';

export const SyncServicePath = '/services/cookmd-sync';
export const SyncService = Symbol('SyncService');

export interface SyncStatus {
    status: 'idle' | 'syncing' | 'error' | 'stopped';
    lastSyncedAt: string | null;
    error: string | null;
}

export interface SyncService {
    enableSync(): Promise<void>;
    disableSync(): Promise<void>;
    isSyncEnabled(): Promise<boolean>;
    getSyncStatus(): Promise<SyncStatus>;
    readonly onDidChangeSyncStatus: Event<SyncStatus>;
}
```

- [ ] **Step 2: Create `sync-service.ts`**

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { AuthService, AuthState } from '../common/auth-protocol';
import { SyncService, SyncStatus } from '../common/sync-protocol';

const STATUS_POLL_INTERVAL_MS = 5000; // 5 seconds
const SYNC_PREFS_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.json');
const SYNC_DB_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.db');

@injectable()
export class SyncServiceImpl implements SyncService {

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private syncEnabled = false;
    private statusPollTimer: ReturnType<typeof setInterval> | undefined;
    private lastStatus: SyncStatus = { status: 'stopped', lastSyncedAt: null, error: null };

    private readonly onDidChangeSyncStatusEmitter = new Emitter<SyncStatus>();
    readonly onDidChangeSyncStatus: Event<SyncStatus> = this.onDidChangeSyncStatusEmitter.event;

    @postConstruct()
    protected init(): void {
        this.loadPreferences();
        this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
    }

    async enableSync(): Promise<void> {
        this.syncEnabled = true;
        this.savePreferences();
        await this.startSyncIfReady();
    }

    async disableSync(): Promise<void> {
        this.syncEnabled = false;
        this.savePreferences();
        await this.stopSync();
    }

    async isSyncEnabled(): Promise<boolean> {
        return this.syncEnabled;
    }

    async getSyncStatus(): Promise<SyncStatus> {
        if (!this.syncEnabled) {
            return { status: 'stopped', lastSyncedAt: null, error: null };
        }
        try {
            // Import dynamically to avoid issues if native addon not available
            const native = require('@theia/cooklang-native');
            const nativeStatus = native.getSyncStatus();
            return {
                status: nativeStatus.status,
                lastSyncedAt: nativeStatus.lastSyncedAt ?? null,
                error: nativeStatus.error ?? null,
            };
        } catch {
            return this.lastStatus;
        }
    }

    private async startSyncIfReady(): Promise<void> {
        if (!this.syncEnabled) {
            return;
        }
        const token = await this.authService.getToken();
        if (!token) {
            return;
        }

        const namespaceId = this.extractUserId(token);
        if (!namespaceId) {
            return;
        }

        const recipesDir = await this.getWorkspaceRoot();
        if (!recipesDir) {
            console.warn('No workspace root found, cannot start sync');
            return;
        }

        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const syncEndpoint = `${webBaseUrl}/api`;

        try {
            const native = require('@theia/cooklang-native');
            await native.startSync(
                recipesDir,
                SYNC_DB_PATH,
                syncEndpoint,
                token,
                namespaceId
            );
            this.startStatusPolling();
        } catch (err) {
            console.error('Failed to start sync:', err);
        }
    }

    private async stopSync(): Promise<void> {
        this.stopStatusPolling();
        try {
            const native = require('@theia/cooklang-native');
            await native.stopSync();
        } catch {
            // Native module not available
        }
        this.lastStatus = { status: 'stopped', lastSyncedAt: null, error: null };
        this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
    }

    private startStatusPolling(): void {
        this.stopStatusPolling();
        this.statusPollTimer = setInterval(async () => {
            const status = await this.getSyncStatus();
            if (status.status !== this.lastStatus.status || status.error !== this.lastStatus.error) {
                this.lastStatus = status;
                this.onDidChangeSyncStatusEmitter.fire(status);
            }
        }, STATUS_POLL_INTERVAL_MS);
    }

    private stopStatusPolling(): void {
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = undefined;
        }
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-out') {
            await this.stopSync();
        } else if (this.syncEnabled) {
            await this.startSyncIfReady();
        }
    }

    private extractUserId(token: string): number | undefined {
        try {
            const payload = token.split('.')[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            const data = JSON.parse(decoded);
            return data.uid;
        } catch {
            return undefined;
        }
    }

    private loadPreferences(): void {
        try {
            const content = fs.readFileSync(SYNC_PREFS_PATH, 'utf8');
            const prefs = JSON.parse(content);
            this.syncEnabled = prefs.enabled ?? false;
        } catch {
            this.syncEnabled = false;
        }
    }

    private savePreferences(): void {
        try {
            const dir = path.dirname(SYNC_PREFS_PATH);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SYNC_PREFS_PATH, JSON.stringify({ enabled: this.syncEnabled }, undefined, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save sync preferences:', err);
        }
    }

    private async getWorkspaceRoot(): Promise<string | undefined> {
        const uri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!uri) {
            return undefined;
        }
        // Use FileUri.fsPath equivalent — strip file:// scheme
        try {
            return new URL(uri).pathname;
        } catch {
            return uri;
        }
    }
}
```

- [ ] **Step 3: Register in backend module**

Add to `packages/cooklang-account/src/node/cooklang-account-backend-module.ts`:

```typescript
import { SyncService, SyncServicePath } from '../common/sync-protocol';
import { SyncServiceImpl } from './sync-service';

// Inside ContainerModule:
bind(SyncServiceImpl).toSelf().inSingletonScope();
bind(SyncService).toService(SyncServiceImpl);
bind(ConnectionHandler).toDynamicValue(ctx =>
    new RpcConnectionHandler(SyncServicePath, () =>
        ctx.container.get(SyncService)
    )
).inSingletonScope();
```

- [ ] **Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: add SyncService with NAPI bindings, lifecycle management, and status polling"
```

---

## Task 11: Wire sync controls into Account sidebar

**Files:**
- Modify: `packages/cooklang-account/src/browser/account-widget.tsx`
- Modify: `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`

- [ ] **Step 1: Add sync service proxy to frontend module**

Add to `packages/cooklang-account/src/browser/cooklang-account-frontend-module.ts`:

```typescript
import { SyncService, SyncServicePath } from '../common/sync-protocol';

// Inside ContainerModule:
bind(SyncService).toDynamicValue(ctx =>
    ServiceConnectionProvider.createProxy<SyncService>(ctx.container, SyncServicePath)
).inSingletonScope();
```

- [ ] **Step 2: Inject SyncService into AccountWidget**

In `packages/cooklang-account/src/browser/account-widget.tsx`, add:

```typescript
import { SyncService, SyncStatus } from '../common/sync-protocol';

// In the class:
@inject(SyncService)
protected readonly syncService: SyncService;

private syncEnabled = false;
private syncStatus: SyncStatus = { status: 'stopped', lastSyncedAt: null, error: null };
```

In `init()`, add:

```typescript
this.syncService.isSyncEnabled().then(enabled => {
    this.syncEnabled = enabled;
    this.update();
});
this.syncService.onDidChangeSyncStatus(status => {
    this.syncStatus = status;
    this.update();
});
```

- [ ] **Step 3: Implement `renderSyncControls()`**

Replace the placeholder in `account-widget.tsx`:

```tsx
private renderSyncControls(): React.ReactNode {
    const statusLabel = this.syncStatus.status.charAt(0).toUpperCase() + this.syncStatus.status.slice(1);
    return <div className='sync-controls'>
        <div className='sync-toggle-row'>
            <span>Sync enabled</span>
            <input
                type='checkbox'
                checked={this.syncEnabled}
                onChange={this.handleSyncToggle}
            />
        </div>
        <div className='sync-status'>Status: {statusLabel}</div>
        {this.syncStatus.lastSyncedAt &&
            <div className='sync-last'>Last synced: {this.syncStatus.lastSyncedAt}</div>
        }
        {this.syncStatus.error &&
            <div className='sync-error'>Error: {this.syncStatus.error}</div>
        }
    </div>;
}

private handleSyncToggle = async (): Promise<void> => {
    if (this.syncEnabled) {
        await this.syncService.disableSync();
        this.syncEnabled = false;
    } else {
        await this.syncService.enableSync();
        this.syncEnabled = true;
    }
    this.update();
};
```

- [ ] **Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-account`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-account/
git commit -m "feat: wire sync toggle and status into Account sidebar"
```

---

## Task 12: Bundle and smoke test

**Files:**
- Modify: `examples/electron/package.json` (already done in Task 1)
- Modify: `examples/electron/tsconfig.json` (already done in Task 1)

- [ ] **Step 1: Run full compile**

Run: `npm run compile`
Expected: All packages compile without errors.

- [ ] **Step 2: Bundle Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Successful bundle with `cooklang-account` module included in `src-gen/`.

- [ ] **Step 3: Start and smoke test**

Run: `cd examples/electron && npm run start:electron`

Verify:
1. Status bar shows "Cook.md: Login" when not logged in
2. Account sidebar opens from right sidebar, shows login prompt
3. AI chat sidebar shows login prompt when not authenticated
4. Login flow works (opens browser, receives callback, status updates)
5. After login, account sidebar shows email and subscription info
6. AI chat gates correctly based on subscription features
7. Sync toggle works (if sync feature available)
8. Logout clears all state and reverts to login prompts

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from smoke testing"
```

---

## Task 13: Final cleanup

- [ ] **Step 1: Verify no leftover auth references in `cooklang-ai`**

Search for any remaining references to old auth protocol:
```bash
grep -r "cookbot-auth" packages/cooklang-ai/src/ --include="*.ts"
grep -r "CookbotAuth" packages/cooklang-ai/src/ --include="*.ts"
```
Expected: No matches found.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Fix any lint errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up remaining references after auth migration"
```
