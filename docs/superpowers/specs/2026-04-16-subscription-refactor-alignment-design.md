# Subscription refactor alignment (editor ↔ cook.md/web)

## Background

`cook.md/web` recently refactored billing (commits `3af93a43…0bdfceb5`):

- Dropped legacy `subscriptions.plan` (`'monthly'|'annual'`) and `purchased_features` columns.
- New source of truth: `plan_slug` → `Plans` catalog (`lib/plans.rb`) → `features` array + `monthly_token_allowance`.
- `GET /api/subscription` now returns `plan_slug`, `plan_name`, `tokens_remaining`,
  `billing_period_start/end`, `trial_available`, `usage`; no longer returns `plan`.
- New endpoint `GET /api/cookbot/session_snapshot` feeds the Rust cookbot server
  for AI gating and token quota.
- Only plan in the catalog today: `pro_early_adopter_v1` — features
  `%w[sync image_clipping ai]`, allowance `1_000_000` tokens/month.

The editor (`editor`) still speaks the pre-refactor protocol:

- `SubscriptionState.plan: 'monthly' | 'annual' | undefined` — dead field.
- `getPlanLabel()` in `account-widget.tsx` branches on the dead field.
- No `planSlug`, `planName`, `tokensRemaining`, `billingPeriodStart/End`,
  `trialAvailable` in `SubscriptionState`.
- Account widget shows no token balance (the refactored web UI does; commit `2a103770`).
- Account widget hides sync UI behind `features.includes('sync')`. Rails/sync-server
  don't actually enforce a `sync` feature flag, so this is a cosmetic paywall.

(AI chat is already UI-gated in `cooklang-branding`'s chat widget — a full
"Get AI Addon" overlay is shown when `features.includes('ai')` is false.
No additional agent-level gating is needed.)

## Goals

1. Align editor's subscription protocol with Rails' current JSON.
2. Surface AI token balance and billing cycle in the account widget.
3. Remove the cosmetic sync paywall from the account widget.

No backward-compatibility shims: fields are renamed/dropped cleanly.

## Non-goals

- Changing the Rails `Plans` catalog (including whether `sync` should remain in
  plan features now that the client treats it as free).
- Refreshing subscription state after each cookbot message — the 5-min cache is
  acceptable for v1.
- Token allowance / usage progress bar (we don't ship the `Plans` catalog to
  the client; Rails' own page is authoritative for detailed usage).
- Handling `past_due` specially beyond a status-aware label.
- Touching `cooklang-ai/proto/cookbot.proto` — `subscription_tier` in the proto
  is unused by the client.

## Design

### 1. Subscription protocol & data model

Replace `SubscriptionState` in
`packages/cooklang-account/src/common/subscription-protocol.ts` with the
current-Rails-aligned shape:

```ts
export interface SubscriptionState {
    status: 'trial' | 'active' | 'past_due' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];                       // e.g. ['sync', 'image_clipping', 'ai']
    planSlug: string | undefined;             // e.g. 'pro_early_adopter_v1'
    planName: string | undefined;             // e.g. 'AI (Early Adopter)'
    tokensRemaining: number;                  // 0 if no AI plan
    expiresAt: string | undefined;            // ISO8601
    trialDaysRemaining: number | undefined;
    trialAvailable: boolean;
    billingPeriodStart: string | undefined;   // ISO8601
    billingPeriodEnd: string | undefined;     // ISO8601
}
```

Changes vs. today: drop `plan`; add `planSlug`, `planName`, `tokensRemaining`,
`trialAvailable`, `billingPeriodStart`, `billingPeriodEnd`; expand `status` to
include `'past_due'`.

The rest of the file (the `SubscriptionService` RPC interface, the service
path, the symbol) stays unchanged.

### 2. Backend mapping

`packages/cooklang-account/src/node/subscription-service.ts` —
`fetchSubscription()` maps the new Rails JSON into the new `SubscriptionState`:

```ts
this.cachedState = {
    status: data.status ?? 'none',
    hasAccess: data.has_access ?? false,
    features: data.features ?? [],
    planSlug: data.plan_slug ?? undefined,
    planName: data.plan_name ?? undefined,
    tokensRemaining: typeof data.tokens_remaining === 'number' ? data.tokens_remaining : 0,
    expiresAt: data.expires_at ?? undefined,
    trialDaysRemaining: data.trial_days_remaining ?? undefined,
    trialAvailable: data.trial_available ?? false,
    billingPeriodStart: data.billing_period_start ?? undefined,
    billingPeriodEnd: data.billing_period_end ?? undefined,
};
```

401/403 handling (clear session) is unchanged.

### 3. Account widget — plan label + token balance

`packages/cooklang-account/src/browser/account-widget.tsx`:

- **Plan label** (`getPlanLabel`):
  - If `subscription.planName` is set → show verbatim. Rails owns the display
    name (future plans, marketing changes — client stays dumb).
  - Else fall back to status-based labels (`Trial`, `Grandfathered`,
    `Canceled`, `Paused`, `Expired`, default `Free`).
  - Add `'past_due'` → `'Pro (Payment Issue)'`.
- **Token balance section**, rendered inside `renderSubscriptionActive()` above
  the sync section, gated by `features.includes('ai')`:
  - Row: `AI tokens: {tokensRemaining.toLocaleString()} remaining`.
  - If `billingPeriodEnd` is set, muted sub-line: `Resets {localized date}`.
  - If `tokensRemaining <= 0`, mark the value with the existing
    `theia-account-sync-error` style so the depleted state reads clearly.
  - No progress bar (no client-side allowance). Rails' page has the full
    breakdown.

### 4. Remove sync paywall

`packages/cooklang-account/src/browser/account-widget.tsx`:

- Delete the `hasSyncFeature = features.includes('sync')` check.
- Render the sync section inside **both** `renderSubscriptionActive()` and
  `renderSubscriptionUpgrade()` — factor/call `renderSyncSection(...)` from
  both paths. Sync is free for any logged-in user.
- Sync UI is **not** shown when logged out (same as today — `renderLoginPrompt`
  unchanged).
- Update the upgrade-prompt copy (`theia/cooklang-account/upgradeMessage`):
  `'Upgrade to unlock sync, AI assistance, and more features.'` →
  `'Upgrade to unlock AI assistance and more features.'`
- Login-prompt copy (`theia/cooklang-account/loginMessage`) unchanged.

Rails' `Plans` catalog still lists `'sync'` in plan features. The editor now
ignores that bit for gating purposes. Deciding whether to remove it from the
catalog is a separate pricing/marketing call.

### 5. Refresh lifecycle

- Keep the existing 5-min TTL cache in `subscription-service.ts`.
- Keep the existing auth-change triggered refresh.
- Call `subscriptionFrontendService.refresh()` when the account widget is
  opened/activated so the token balance and plan reflect reality on user
  action. Cheap, and the natural UX check-in moment.
- No per-chat-message refresh.

## Files touched

1. `packages/cooklang-account/src/common/subscription-protocol.ts` — new `SubscriptionState` shape.
2. `packages/cooklang-account/src/node/subscription-service.ts` — map new Rails JSON fields.
3. `packages/cooklang-account/src/browser/account-widget.tsx` — new plan label, token balance, refresh-on-activate, remove sync paywall, updated copy.
4. `packages/cooklang-account/src/browser/style/index.css` — styling for token balance row (if needed).

## Files intentionally not touched

- `packages/cooklang-ai/**` — server gates AI via `session_snapshot`, and
  `cooklang-branding`'s chat widget already gates the UI on
  `hasFeature('ai')`. No client-side work needed in the AI package.
- `packages/cooklang-ai/proto/cookbot.proto` — unused `subscription_tier` field.
- `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts` —
  existing AI gate stays as-is.
- Rails `cook.md/web` — this is a client-side alignment.

## Testing

Manual verification in Electron:

- **AI user** (plan `pro_early_adopter_v1`, feature `ai`): plan name "AI (Early
  Adopter)" shown, token balance visible, chat works as today, balance
  refreshes on widget open.
- **Non-AI / free user**: chat widget shows the existing "Get AI Addon" gate
  (unchanged); sync section still visible and usable; no token balance.
- **Logged out**: login prompt only; no sync UI.
- **Past due**: label shows "Pro (Payment Issue)"; sync and AI still work
  (`active_for_access?` is true server-side for `past_due`).
- **Subscription still loading when chat invoked**: one-off load happens; if
  still unresolved, request goes through and server handles.

No new unit tests — changes are thin glue and UI.
