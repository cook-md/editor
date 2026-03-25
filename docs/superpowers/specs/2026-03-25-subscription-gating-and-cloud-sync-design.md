# Subscription Gating & CookCloud Sync

## Overview

Add subscription-aware feature gating and CookCloud recipe sync to the Cooklang editor. Users log into their cook.md account, and their subscription determines which features are available (AI chat, cloud sync). A new Account sidebar provides account management, sync controls, and upgrade prompts.

## Goals

1. Gate AI chat behind authentication + `ai` feature check
2. Gate CookCloud sync behind authentication + `sync` feature check
3. Provide a central Account sidebar for account info, sync controls, and subscription management
4. Integrate `cooklang-sync-client` Rust library via NAPI-RS for full recipe folder sync

## Package Architecture

### New: `packages/cooklang-account`

Owns authentication, subscription checking, sync lifecycle, and the account sidebar.

**Extracted from `cooklang-ai`:**
- `cookbot-auth-service.ts` → `auth-service.ts`
- `cookbot-auth-contribution.ts` → `auth-contribution.ts`
- `cookbot-auth-protocol.ts` → `auth-protocol.ts`
- Rename `CookbotAuth*` → `Auth*` (no longer AI-specific)

**New code:**
- `SubscriptionService` (backend) — fetches and caches subscription state
- `SubscriptionFrontendService` (browser) — RPC proxy for frontend access
- `SyncService` (backend) — manages sync lifecycle via NAPI bindings
- `AccountWidget` (browser) — React sidebar widget
- `AccountContribution` (browser) — sidebar registration, commands

### Modified: `packages/cooklang-native`

Add `cooklang-sync-client` as a Rust dependency. Expose NAPI bindings:
- `startSync(recipesDir, dbPath, syncEndpoint, jwt, namespaceId)` — spawns async Tokio task, returns immediately
- `stopSync()` — cancels sync context
- `getSyncStatus()` — returns `{ status: 'idle' | 'syncing' | 'error', lastSyncedAt: string | null, error: string | null }`

### Modified: `packages/cooklang-ai`

- Remove auth code (moved to `cooklang-account`)
- Add dependency on `cooklang-account`
- Import `AuthService` for JWT access
- Check `SubscriptionService.hasFeature('ai')` to gate AI chat

### Unchanged: `packages/cooklang`

No changes — language support, shopping list, and preview remain independent.

### Dependency Graph

```
cooklang-account (auth + subscription + sync + account sidebar)
    depends on: @theia/core, cooklang-native

cooklang-ai (AI chat agent + gRPC language model)
    depends on: @theia/core, @theia/ai-chat, cooklang-account

cooklang (language support, shopping list, preview)
    no dependency on account/auth
```

## Subscription Service

### Backend: `SubscriptionService`

Location: `cooklang-account/src/node/subscription-service.ts`

- Singleton, injected via DI
- Depends on `AuthService` for JWT token
- Calls `GET {WEB_BASE_URL}/api/subscription` with `Authorization: Bearer <jwt>`
- Caches response in memory with 5-minute TTL
- Re-fetches on: login event, explicit refresh call, cache expiry
- Clears state on logout

**API:**
- `getSubscription(): Promise<SubscriptionState>`
- `hasFeature(name: string): Promise<boolean>`
- `onDidChangeSubscription: Event<SubscriptionState | undefined>`

### Frontend: `SubscriptionFrontendService`

Location: `cooklang-account/src/browser/subscription-frontend-service.ts`

- Thin RPC proxy to backend `SubscriptionService`
- Caches last-known state for immediate widget rendering
- Fires `onDidChangeSubscription` when backend pushes updates

### Subscription State

```typescript
interface SubscriptionState {
    status: 'trial' | 'active' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];  // e.g. ["sync", "scan_recipe", "ai"]
    plan: 'monthly' | 'annual' | null;
    expiresAt: string | null;
    trialDaysRemaining: number | null;
}
```

## Sync Integration

### NAPI-RS Bindings (`cooklang-native`)

Add `cooklang-sync-client` crate as dependency. The sync client runs as an async Tokio task inside the native addon process.

Functions exposed to Node.js:
- `startSync(recipesDir, dbPath, syncEndpoint, jwt, namespaceId)` — starts continuous bidirectional sync
- `stopSync()` — gracefully cancels the running sync
- `getSyncStatus()` — returns current sync state

### Backend: `SyncService`

Location: `cooklang-account/src/node/sync-service.ts`

- Wraps NAPI bindings with lifecycle management
- Starts sync on toggle-on, stops on toggle-off or logout
- Persists sync-enabled preference in `~/.theia/cookcloud-sync.json`
- SQLite state DB at `~/.theia/cookcloud-sync.db`
- Gets JWT from `AuthService`, workspace path from Theia workspace service
- Sync endpoint derived from `WEB_BASE_URL` environment variable
- Namespace ID extracted from JWT payload (user ID)
- Exposes sync status to frontend via RPC + event stream

## Account Sidebar

### Widget: `AccountWidget`

- ReactWidget, ID: `account-widget`
- Registered via `AccountContribution` (extends `AbstractViewContribution`)
- Default area: right sidebar
- Toggle command: `cookmd.toggleAccount`

### Widget States

**1. Not logged in:**
- User icon + "Log in to your Cook.md account" message
- "Log In" button (triggers existing OAuth flow)

**2. Logged in, subscription loading:**
- Spinner while subscription data is fetched

**3. Logged in, has access:**
- Email + plan status (e.g. "Active · Monthly plan")
- Feature badges showing enabled features (sync, ai, scan_recipe)
- CookCloud Sync section:
  - If `hasFeature('sync')`: Toggle switch + status (idle/syncing/error) + last synced time
  - If `!hasFeature('sync')`: Upgrade prompt with "Upgrade Plan" button (opens cook.md)
- "Manage Subscription" link at bottom (opens `cook.md/account` in external browser)

**4. Logged in, no subscription:**
- Account info + prompt to start trial or purchase plan

## AI Chat Gating

The `ChatViewWidget` render is modified to check auth and subscription before showing the chat UI:

**Not authenticated →** Login prompt replaces chat content:
- Robot icon + "Log in to use AI assistant" + "Log In" button

**Authenticated, `!hasFeature('ai')` →** Upgrade prompt replaces chat content:
- Robot icon + "AI assistant requires the AI addon" + "Get AI Addon" button (opens cook.md)
- Small note: "Opens cook.md in your browser"

**Authenticated, `hasFeature('ai')` →** Normal chat UI

## Data Flows

### Login

1. User clicks "Log In" (account sidebar, AI chat, or status bar)
2. `AuthService` opens browser to `cook.md/auth/desktops`, starts local callback server
3. JWT received → stored in `~/.theia/cookbot-auth.json` (mode 0600)
4. `AuthService` fires `onDidChangeAuth`
5. `SubscriptionService` fetches `GET /api/subscription`
6. `SubscriptionService` fires `onDidChangeSubscription`
7. All gated widgets re-render

### Sync Toggle

1. User toggles sync ON in account sidebar
2. Frontend calls `SyncService.enableSync()`
3. `SyncService` persists preference, gets JWT + workspace path
4. Calls NAPI: `startSync(recipesDir, dbPath, endpoint, jwt, namespaceId)`
5. Sync runs continuously in background
6. Status updates flow to frontend → sidebar updates

### Logout

1. User clicks "Log Out"
2. `AuthService` clears JWT, fires `onDidChangeAuth`
3. `SyncService` stops sync if running
4. `SubscriptionService` clears cached state, fires `onDidChangeSubscription`
5. All gated widgets revert to login prompts

### Token Renewal

- Runs on app start and then on a fixed daily interval (every 24 hours)
- Calls `POST {WEB_BASE_URL}/api/sessions/renew` with current JWT
- On success: stores new JWT, `SyncService` picks up fresh token
- On failure: clears session (user must re-login)
- Logic lives in `cooklang-account` (moved from `cooklang-ai`)

## Status Bar

The existing login/logout status bar item moves from `cooklang-ai` to `cooklang-account`. No additional status bar items needed — the account sidebar covers subscription and sync status.

## File Structure

```
packages/cooklang-account/
├── package.json
├── tsconfig.json
├── src/
│   ├── common/
│   │   ├── auth-protocol.ts          (RPC interfaces for auth)
│   │   ├── subscription-protocol.ts  (RPC interfaces for subscription)
│   │   └── sync-protocol.ts          (RPC interfaces for sync)
│   ├── browser/
│   │   ├── cooklang-account-frontend-module.ts
│   │   ├── auth-contribution.ts      (status bar, commands)
│   │   ├── account-contribution.ts   (sidebar registration)
│   │   ├── account-widget.tsx        (React sidebar widget)
│   │   └── subscription-frontend-service.ts
│   └── node/
│       ├── cooklang-account-backend-module.ts
│       ├── auth-service.ts           (OAuth flow, JWT storage, daily renewal)
│       ├── subscription-service.ts   (API calls, caching)
│       └── sync-service.ts           (NAPI wrapper, lifecycle)
```
