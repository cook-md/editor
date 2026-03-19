# Cook.md Editor Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add browser-based OAuth login to the Theia editor so users can authenticate with cook.md for AI features.

**Architecture:** Backend RPC service handles token storage, OAuth callback server, and renewal. Frontend provides status bar + commands. gRPC client pulls token from auth service.

**Tech Stack:** Theia DI (InversifyJS), Express (callback server), JSON-RPC (frontend↔backend), `@theia/core` StatusBar/Command APIs.

**Reference:** See design at `docs/plans/2026-02-27-cookmd-auth-design.md`. TUI auth reference at `../cook.md/cookbot/crates/tui/src/auth/`.

---

### Task 1: Auth Protocol (common types)

**Files:**
- Create: `packages/cooklang-ai/src/common/cookbot-auth-protocol.ts`
- Modify: `packages/cooklang-ai/src/common/index.ts`

**Step 1: Create the auth protocol file**

```typescript
// packages/cooklang-ai/src/common/cookbot-auth-protocol.ts

export const CookbotAuthServicePath = '/services/cookbot-auth';
export const CookbotAuthService = Symbol('CookbotAuthService');

export interface AuthState {
    status: 'logged-out' | 'logged-in';
    email?: string;
}

export interface AuthData {
    token: string;
    email: string;
    expiresAt: string;  // ISO 8601
    createdAt: string;  // ISO 8601
}

export interface LoginResult {
    authUrl: string;
}

export interface CookbotAuthService {
    login(): Promise<LoginResult>;
    logout(): Promise<void>;
    getAuthState(): Promise<AuthState>;
    getToken(): Promise<string | undefined>;
    setOnDidChangeAuthState(callback: (state: AuthState) => void): void;
}
```

**Step 2: Export from common index**

Add to `packages/cooklang-ai/src/common/index.ts`:
```typescript
export * from './cookbot-auth-protocol';
```

**Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 4: Commit**

```
feat(cooklang-ai): add auth protocol types
```

---

### Task 2: Backend Auth Service

**Files:**
- Create: `packages/cooklang-ai/src/node/cookbot-auth-service.ts`

**Context:** This service manages token storage on disk (`~/.theia/cookbot-auth.json`), runs a one-shot HTTP callback server for OAuth, and provides the token to other backend services.

**Step 1: Create the auth service implementation**

The service needs:
- `login()`: Generate CSRF state token (random UUID), start one-shot Express server on `localhost:19285/callback`, return auth URL. The callback server:
  - Validates `state` parameter matches expected
  - Extracts `token` from query params
  - Saves token to disk
  - Responds with HTML success page ("Login successful! You can close this tab.")
  - Shuts itself down after handling the callback
  - Has a 5-minute timeout (auto-shutdown if no callback)
- `logout()`: Delete `~/.theia/cookbot-auth.json`, clear in-memory state, notify listeners
- `getToken()`: Return token from memory (loaded from disk on first call)
- `getAuthState()`: Return `{ status: 'logged-in', email }` or `{ status: 'logged-out' }`
- `setOnDidChangeAuthState()`: Register callback for state changes (used by JSON-RPC notification layer)
- Token renewal: on `getToken()`, check if within 24h of expiry → POST `{WEB_BASE_URL}/api/sessions/renew` with Bearer token

**Key details:**
- Auth file path: `path.join(os.homedir(), '.theia', 'cookbot-auth.json')`
- File permissions: `0o600`
- Web base URL: `process.env.WEB_BASE_URL || 'https://cook.md'`
- Callback port: `19285`
- Auth URL format: `{WEB_BASE_URL}/auth/desktops?callback=http://localhost:19285/callback&state={STATE}&app=theia`
- Use `@theia/core/shared/inversify` for `@injectable()` and `@postConstruct()`
- Use Node.js `http` module (not Express) for the callback server — it's simpler for a one-shot server. Just parse the URL query params, validate state, write HTML response, close server.
- Import `crypto` for `randomUUID()`
- Import `fs/promises` for file read/write
- Import `http` for callback server
- Import `https` (or `http`) for token renewal request

**Step 2: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```
feat(cooklang-ai): add backend auth service with OAuth callback
```

---

### Task 3: Wire Auth Service into Backend Module

**Files:**
- Modify: `packages/cooklang-ai/src/node/cooklang-ai-backend-module.ts`
- Modify: `packages/cooklang-ai/src/node/index.ts`

**Step 1: Add auth service bindings to backend module**

The auth service must be a **global singleton** (not per-connection like the gRPC client), because there's one auth state per machine. Add these bindings to the outer `ContainerModule`, not inside the `ConnectionContainerModule`:

```typescript
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { CookbotAuthService, CookbotAuthServicePath } from '../common/cookbot-auth-protocol';
import { CookbotAuthServiceImpl } from './cookbot-auth-service';

// In the outer ContainerModule (not the ConnectionContainerModule):
bind(CookbotAuthServiceImpl).toSelf().inSingletonScope();
bind(CookbotAuthService).toService(CookbotAuthServiceImpl);
bind(ConnectionHandler).toDynamicValue(ctx =>
    new RpcConnectionHandler(CookbotAuthServicePath, () =>
        ctx.container.get(CookbotAuthService)
    )
).inSingletonScope();
```

Also make the auth service available inside the `ConnectionContainerModule` so the gRPC client can use it. Use `bindToParent`:

Inside the `ConnectionContainerModule`, add:
```typescript
bind(CookbotAuthService).toDynamicValue(ctx => {
    // Reach into parent container for the global auth service
    return ctx.container.parent!.get(CookbotAuthService);
}).inSingletonScope();
```

**Step 2: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 3: Commit**

```
feat(cooklang-ai): wire auth service into backend DI
```

---

### Task 4: Integrate Auth with gRPC Client

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-grpc-client.ts`
- Modify: `packages/cooklang-ai/src/node/cookbot-language-model.ts`

**Step 1: Inject auth service into gRPC client**

Add to `CookbotGrpcClient`:
```typescript
@inject(CookbotAuthService)
protected readonly authService: CookbotAuthService;
```

**Step 2: Update `initialize()` to use real token**

Change the `initialize` method to get the token from the auth service:
```typescript
async initialize(recipesDir: string, customInstructions?: string): Promise<CookbotInitResult> {
    this.ensureConnected();
    const token = await this.authService.getToken();
    return new Promise((resolve, reject) => {
        this.connectionService.Initialize({
            customInstructions: customInstructions || '',
            clientVersion: '0.1.0',
            recipesDir,
            authToken: token || '',
        }, (err: grpc.ServiceError | null, response: any) => {
            // ... existing callback logic
        });
    });
}
```

**Step 3: Update `sendMessage()` to include token**

Similarly pass the token in `sendMessage()`:
```typescript
const token = await this.authService.getToken();
```
Note: `sendMessage` is currently synchronous in its setup. You'll need to make it async or pre-fetch the token. The simplest approach: store the token as a field after `initialize()` and reuse it in `sendMessage()`.

Actually, simpler approach: store the session's auth token as a field after successful initialize, reuse in sendMessage. The token doesn't change mid-session.

**Step 4: Handle UNAUTHENTICATED errors**

In the `grpcStreamToAsync` error handling or in `CookbotLanguageModel.request()`, catch gRPC status 16 (UNAUTHENTICATED) and clear the auth state so the user gets prompted to re-login:
```typescript
if (error.code === 16) { // UNAUTHENTICATED
    // Reset init state so next request re-initializes
    this.initPromise = undefined;
}
```
(This goes in `CookbotLanguageModel`, not the gRPC client.)

**Step 5: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 6: Commit**

```
feat(cooklang-ai): pass auth token to gRPC calls
```

---

### Task 5: Frontend Auth Contribution (commands + status bar)

**Files:**
- Create: `packages/cooklang-ai/src/browser/cookbot-auth-contribution.ts`
- Modify: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts`

**Step 1: Create the frontend auth contribution**

This class implements `FrontendApplicationContribution` and `CommandContribution`. It:
- Injects `CookbotAuthService` (RPC proxy to backend) and `StatusBar` and `WindowService`
- On `initialize()`: fetch initial auth state, set status bar item, listen for changes
- Registers commands:
  - `cookmd.login` / `Cook.md: Login` — calls `authService.login()`, opens returned URL in external browser via `WindowService.openNewWindow(url, { external: true })`
  - `cookmd.logout` / `Cook.md: Logout` — calls `authService.logout()`
- Status bar element ID: `cookbot-auth-status`
- Alignment: `StatusBarAlignment.LEFT`, priority: `100`
- When logged out: text `$(account) Cook.md: Login`, command `cookmd.login`
- When logged in: text `$(account) {email}`, command `cookmd.logout`, tooltip `Cook.md: Logout`

**Key imports:**
```typescript
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar-types';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CookbotAuthService, AuthState } from '../common/cookbot-auth-protocol';
```

**Listening for state changes:** The `CookbotAuthService.setOnDidChangeAuthState()` won't work well over RPC (callbacks don't serialize). Instead, use polling or a different mechanism:

**Approach:** After `login()` returns the URL, the backend will wait for the callback. The frontend should poll `getAuthState()` every 2 seconds while waiting for login to complete. Once state changes to `logged-in`, stop polling and update UI.

Alternatively, use Theia's JSON-RPC notification mechanism. But polling is simpler for a first pass. Use `setInterval` during login wait, clear on state change.

**Step 2: Update frontend module with bindings**

Add to `cooklang-ai-frontend-module.ts`:
```typescript
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CookbotAuthService, CookbotAuthServicePath } from '../common/cookbot-auth-protocol';
import { CookbotAuthContribution } from './cookbot-auth-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandContribution } from '@theia/core/lib/common/command';

// RPC proxy
bind(CookbotAuthService).toDynamicValue(ctx =>
    ServiceConnectionProvider.createProxy<CookbotAuthService>(ctx.container, CookbotAuthServicePath)
).inSingletonScope();

// Auth contribution
bind(CookbotAuthContribution).toSelf().inSingletonScope();
bind(FrontendApplicationContribution).toService(CookbotAuthContribution);
bind(CommandContribution).toService(CookbotAuthContribution);
```

**Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang-ai`
Expected: Success

**Step 4: Commit**

```
feat(cooklang-ai): add login/logout commands and status bar
```

---

### Task 6: Bundle and End-to-End Test

**Files:** No new files

**Step 1: Bundle the electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Webpack compiles successfully

**Step 2: Start the cookbot server**

Ensure the cookbot dev server is running on port 50052.

**Step 3: Start the electron app and test login flow**

Run: `npm run start:electron`

Test:
1. Status bar shows "Cook.md: Login"
2. Click status bar item → browser opens cook.md login page
3. After authenticating → status bar updates to show email
4. Type a message in AI chat → cookbot responds (no UNAUTHENTICATED error)
5. Use command palette → "Cook.md: Logout" → status bar reverts to login prompt
6. Type a message → should get auth error or prompt to login

**Step 4: Commit**

```
feat(cooklang-ai): complete cook.md login integration
```

---

### Task 7: Cleanup and Error Handling

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-auth-service.ts`
- Modify: `packages/cooklang-ai/src/browser/cookbot-auth-contribution.ts`

**Step 1: Add error handling for common failures**

- Login timeout (5 min) → clean up callback server, return error
- Network failure on token renewal → log warning, continue with existing token
- Corrupted auth file → delete and treat as logged out
- Callback with mismatched state → respond with error HTML, don't save token

**Step 2: Add token renewal check**

In `getToken()`, before returning the token, check `expiresAt`. If within 24h of expiry, attempt renewal via POST to `{WEB_BASE_URL}/api/sessions/renew` with `Authorization: Bearer {token}`. Parse response for new token. Save updated auth data. If renewal fails, continue with existing token.

**Step 3: Compile, bundle, test**

Run: `npx lerna run compile --scope @theia/cooklang-ai && cd examples/electron && npm run bundle`

**Step 4: Commit**

```
fix(cooklang-ai): add auth error handling and token renewal
```
