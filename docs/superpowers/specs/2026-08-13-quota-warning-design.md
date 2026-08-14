# Quota warning before Cookbot stops dead

**Issue:** [cook-md/editor#89](https://github.com/cook-md/editor/issues/89)
**Date:** 2026-08-13
**Status:** Approved

## Problem

Cookbot works normally until the billing-cycle token allowance is spent, then
every message fails immediately. #86 made the failure message accurate, but the
experience is still: works, works, works, hard stop. The server computes an 80%
warning threshold and only logs it; the editor never warns the user.

## Key findings

- The `GetUsage` RPC already exists in `packages/cooklang-ai/proto/cookbot.proto`
  and returns `input_tokens_used`, `output_tokens_used`, `token_limit`, and
  `billing_period_start/end`. The editor's gRPC client never calls it. No proto
  or server change is needed.
- `SubscriptionState.aiCreditsRemaining` (cook.md web API) has no total, so a
  percentage is not computable from it, and it is cached up to 5 minutes on the
  backend plus indefinitely on the frontend. It is not used for this feature.
- `CooklangChatViewWidget` (cooklang-branding) already subclasses the upstream
  chat widget, injects `SubscriptionFrontendService`, and manages a DOM overlay
  — the natural home for the banner.
- `GetUsage` requires a `session_id`; the cookbot session is currently created
  lazily by `CookbotLanguageModel` on the first chat message.

## Decisions

- **Data source:** the existing `GetUsage` gRPC RPC (accurate, fresh, gives a
  real percentage matching the server's 80% threshold).
- **Warning UI:** a passive banner pinned in the chat view — not a toast. It
  stays while over threshold and disappears when the cycle resets, so "once per
  cycle" needs no persistence bookkeeping.
- **Plumbing:** a new dedicated `CookbotUsageService` RPC rather than extending
  `CookbotServerToolsService`, keeping "server tools" meaning Claude tools.

## Design

### 1. Backend: expose `GetUsage` (packages/cooklang-ai)

- **`CookbotGrpcClient.getUsage()`** — new unary call wrapping the `GetUsage`
  proto RPC, using the same `withReconnectRetry` pattern as the other unary
  calls. Returns `{ inputTokensUsed, outputTokensUsed, tokenLimit,
  billingPeriodStart, billingPeriodEnd, subscriptionTier }`.
- **Session bootstrap:** extract the lazy-initialize logic (workspace dir +
  COOK.md read + `initialize`) out of `CookbotLanguageModel` into a shared,
  connection-scoped `CookbotSessionInitializer` class used by both the language
  model and the usage service, so whichever runs first creates the session and
  the other reuses it. If initialization fails (not logged in, no network),
  `getUsage` returns `undefined` — it never throws to the UI.
- **`CookbotUsageService`** — new RPC protocol at `/services/cookbot-usage`
  plus a backend impl bound with an `RpcConnectionHandler` inside the existing
  `cookbotConnectionModule`, reusing the connection-scoped `CookbotGrpcClient`.
  Single method: `getUsage(): Promise<CookbotUsageStats | undefined>`.

### 2. Frontend: banner in the chat view (packages/cooklang-branding)

- `cooklang-branding` gains a dependency on `@theia/cooklang-ai` (no cycle —
  cooklang-ai does not depend on branding).
- **`CooklangChatViewWidget`** owns a slim banner element pinned above the chat
  input, hidden by default.
- **Refresh triggers:** on widget activation/show, and whenever a chat response
  completes (via `ChatService`; streaming deltas do not trigger refreshes).
  No timers, no polling.
- **Thresholds** (percent = `(inputTokensUsed + outputTokensUsed) / tokenLimit`):
  - `< 80%`, `tokenLimit <= 0`, or usage unavailable → banner hidden. Unknown
    usage never shows a false warning.
  - `>= 80%` and `< 100%` → warning state: "You've used ~85% of your Cookbot AI
    credits this cycle — resets Sep 1" with an "Open Account" action (existing
    Account view command) and an upgrade link.
  - `>= 100%` → exhausted state: "Your Cookbot AI credits are used up until
    Sep 1" with the same actions. Complements the per-message error from #86
    with something persistent.
- The 80% constant lives client-side, mirroring the server's
  `USAGE_WARNING_THRESHOLD_PERCENT`.
- Styling per project guidelines: CSS classes in the branding stylesheet,
  `--theia-*` color variables only, all strings via `nls.localize`.

### 3. Error handling

- Every failure path in the usage query (no auth, init failure, gRPC error,
  missing/zero limit) collapses to `undefined` → hidden banner. Failures are
  logged with `console.info/warn`, not reported to Sentry — they are expected
  states, consistent with `CookbotError.isExpected`.
- Usage refresh is fire-and-forget from the widget; a slow query never blocks
  chat rendering.

### 4. Testing

- **Unit (node):** `CookbotUsageServiceImpl` with a stubbed gRPC client —
  session bootstrap on demand, `UsageStats` mapping, error → `undefined`.
- **Unit (browser):** threshold/label logic extracted into a pure helper,
  e.g. `computeQuotaBannerState(usage): { level: 'none' | 'warning' |
  'exhausted'; percent; resetsOn }`, kept in a monaco-free file so the spec
  runs under the test harness.
- **Manual:** run the dev app against a local cookbot (`COOKBOT_ADDRESS`) with
  a low token limit and walk usage through 80% and 100%.

## Out of scope

- Proto/server changes, toast notifications, an always-visible credits meter,
  and any change to `aiCreditsRemaining` or the Account view.
