# Cook.md Editor Login - Design

## Goal

Implement a browser-based OAuth login flow for the Theia editor so users can authenticate with cook.md and use AI features that require a subscription.

## Architecture

The auth system follows the same OAuth pattern as the cookbot TUI: open browser to cook.md login page, capture JWT via local callback server, store token, pass to gRPC calls. A backend RPC service (`CookbotAuthService`) handles token storage, OAuth callback, and renewal. The frontend provides status bar UI and commands.

## Components

### Common Protocol (`src/common/cookbot-auth-protocol.ts`)
- `CookbotAuthService` interface + Symbol + path constant
- `AuthState` type: `{ status: 'logged-out' } | { status: 'logged-in', email: string }`
- `AuthData` DTO: `{ token, email, expiresAt, createdAt }`

### Backend Auth Service (`src/node/cookbot-auth-service.ts`)
- Reads/writes `~/.theia/cookbot-auth.json` with 0o600 permissions
- `login()`: generates CSRF state, starts one-shot Express callback server on localhost:19285, returns auth URL
- `logout()`: deletes token file, fires state change event
- `getToken()`: returns current token or undefined
- `getAuthState()`: returns current `AuthState`
- Token auto-renewal when within 24h of expiry (POST `/api/sessions/renew`)
- Fires JSON-RPC notification on auth state change (logged-in/out)

### Backend Integration
- `CookbotGrpcClient` injects `CookbotAuthService`, pulls token for `initialize()` and `sendMessage()`
- On UNAUTHENTICATED gRPC error → clear token, fire state change

### Frontend Auth Contribution (`src/browser/cookbot-auth-contribution.ts`)
- Implements `FrontendApplicationContribution`, `CommandContribution`
- Commands: `Cook.md: Login`, `Cook.md: Logout`
- Status bar item (left-aligned): shows "Cook.md: Login" or "user@email.com"
- Listens for auth state changes via the RPC service

### OAuth Flow
1. User triggers login command
2. Backend returns `https://cook.md/auth/desktops?callback=http://localhost:19285/callback&state={STATE}&app=theia`
3. Frontend opens URL in external browser via `WindowService`
4. User authenticates on cook.md
5. cook.md redirects to `localhost:19285/callback?token={JWT}&state={STATE}`
6. Backend validates state, saves token, fires event
7. Frontend updates status bar
8. gRPC client reinitializes session with token

### Token Storage
- Location: `~/.theia/cookbot-auth.json`
- Format: `{ "token": "...", "email": "...", "expiresAt": "ISO8601", "createdAt": "ISO8601" }`
- Permissions: 0o600 (owner read/write only)
