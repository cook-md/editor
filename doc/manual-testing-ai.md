# Manual Test Scenarios — AI Feature, Paywall & Subscription

Covers paywall gating, purchase, cancellation, quota, auth, and offline
flows for the AI chat addon. Grounded in the current code paths:

- `packages/cooklang-account/src/common/subscription-protocol.ts`
- `packages/cooklang-account/src/node/subscription-service.ts`
- `packages/cooklang-account/src/node/auth-service.ts`
- `packages/cooklang-account/src/browser/account-widget.tsx`
- `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts`

## Preconditions / Fixtures

- **Test accounts** in the web backend (cook.md):
  - `free@test` — logged-in, no subscription (`status: 'none'`)
  - `active@test` — `status: 'active'`, `features: ['ai']`, credits: 100
  - `active-low@test` — same, `aiCreditsRemaining: 0`
  - `pastdue@test` — `status: 'past_due'`
  - `canceled@test` — `status: 'canceled'`, `billingPeriodEnd` in future
  - `expired@test` — `status: 'expired'`
- **Environment:** `WEB_BASE_URL` env var points the app at staging without touching production billing (see `cooklang-chat-view-widget.ts:59`).
- **Access needed:** app DevTools console, web billing admin, ability to kill network (airplane mode / Little Snitch).

---

## A. Paywall gating (chat widget)

Code: `cooklang-chat-view-widget.ts:66-91`

| # | Scenario | Expected |
|---|---|---|
| A1 | Launch app logged-out, open AI Chat view | Gate overlay visible, "Log in" message, chat input hidden |
| A2 | From A1, click login button | Browser opens `{WEB_BASE_URL}/auth/desktops?...` |
| A3 | Login as `free@test`, open AI Chat | Gate switches to "upgrade" variant, "Get AI Addon" CTA visible |
| A4 | Login as `active@test`, open AI Chat | Gate hidden, chat fully usable |
| A5 | While chat open as `active@test`, revoke `ai` feature on backend, refresh account widget | Gate reappears without restart (driven by `onDidChangeSubscription`) |
| A6 | Logout while AI chat is open | Gate flips to "login" variant immediately |
| A7 | Login as `pastdue@test` | If `hasFeature('ai')` true: chat usable, badge shows "Payment Issue". If false: upgrade gate |

---

## B. Purchase flow

Code: `subscription-service.ts:68-152`

| # | Scenario | Expected |
|---|---|---|
| B1 | As `free@test`, click "Get AI Addon" in chat gate | Default browser opens `{WEB_BASE_URL}/pricing?callback=http://localhost:19295/upgrade-done&state=<uuid>` |
| B2 | Complete Stripe/Paddle checkout successfully | Web redirects to callback with `status=ok&state=<uuid>`; app auto-refreshes; chat gate dismisses; account widget shows active plan + credits |
| B3 | Click "Cancel" on checkout page | Redirect with `status=cancelled`; user unchanged (still free); gate still present; no error toast |
| B4 | Start upgrade, close browser tab without completing | After ~10 min (`UPGRADE_CALLBACK_TIMEOUT_MS`) `awaitUpgradeCallback()` rejects; retry works |
| B5 | Tamper with redirect: change `state` param before completing | Callback server rejects (state mismatch); user sees error; retry works cleanly |
| B6 | Bind ports 19295–19304, then start upgrade | App falls back: opens pricing page without callback server; user completes externally; next refresh picks up new state |
| B7 | Start upgrade flow twice in rapid succession | Second attempt cleanly replaces the first (no zombie port listener) |
| B8 | During B1–B2, kill the app before callback arrives | On restart, subscription refresh reflects backend truth |

---

## C. Cancellation flow

Code: `account-widget.tsx:361` (Manage Subscription opens external portal)

| # | Scenario | Expected |
|---|---|---|
| C1 | As `active@test`, click "Manage Subscription" | Opens `{WEB_BASE_URL}/subscription` in browser |
| C2 | Cancel on web (end-of-period), return to app, refresh | `status='canceled'`, `billingPeriodEnd` set; chat **still usable** until period end; badge shows "Canceled" |
| C3 | C2 then wait until `billingPeriodEnd` passes, refresh | `status='expired'`, `hasFeature('ai')=false`, chat shows upgrade gate |
| C4 | Cancel immediately (refund) on web, refresh | `hasAccess=false` right away; chat gates within ≤5 min cache TTL, or instantly on explicit refresh |
| C5 | After C2, re-subscribe on web, refresh | Status returns to `active`; chat ungates |
| C6 | Cache behavior: cancel on web but do NOT refresh | App serves cached "active" state for up to 5 min (`CACHE_TTL_MS`), then auto-refetches on next call |

---

## D. Quota / credits

Code: `account-widget.tsx:258-285`

| # | Scenario | Expected |
|---|---|---|
| D1 | `active@test` with 100 credits, send chat message | Credits decrement (may require backend push/refresh to see new count) |
| D2 | `active-low@test` (0 credits), open chat | Chat UI visible but sending fails with quota error; widget shows "0 credits" in red |
| D3 | D2 then advance clock past `billingPeriodEnd`, refresh | Credits reset to plan allotment |
| D4 | `aiCreditsRemaining` undefined/null in payload | UI degrades gracefully (no NaN, no crash) |

---

## E. Auth edge cases

Code: `auth-service.ts:54-96`

| # | Scenario | Expected |
|---|---|---|
| E1 | Login, restart app | Session persists (token read from `~/.theia/auth.json`); still logged in |
| E2 | Manually corrupt `auth.json` | App falls back to logged-out cleanly; no crash |
| E3 | Revoke token server-side, next API call | 401/403 detected; auto-logout; chat gates to "login" |
| E4 | Login, wait 24h | Token auto-renews (`RENEWAL_INTERVAL_MS`) silently |
| E5 | Start login, close browser before completing | After 5 min timeout, retry works; no stale port bind |
| E6 | Login on two devices with same account | Independent tokens; canceling on one doesn't log out the other unless backend does so |

---

## F. Offline / network failures

| # | Scenario | Expected |
|---|---|---|
| F1 | Launch offline, logged-in as `active@test` with cached subscription | Chat usable with cached state; widget may show stale credits |
| F2 | Go offline mid-session, send chat message | Backend call fails; network error toast; no false logout |
| F3 | Offline, attempt upgrade flow | `startUpgradeFlow()` succeeds (local server starts) but browser can't reach web; clear error when back online |
| F4 | Backend (cook.md) down but network OK | Subscription fetch logs warning, cached state preserved; chat works until cache expires |
| F5 | Token refresh fails with transient 500 | Auth retained; retries on next interval; does NOT log out |
| F6 | DNS fails for `cook.md` | Login/upgrade buttons show clear "can't reach server" state (not a silent hang) |

---

## G. State-transition smoke matrix

Run end-to-end, one flow per build before release:

1. **Full happy path:** logged-out → login → free → upgrade → active → use AI → cancel (end-of-period) → expire → re-subscribe → use AI.
2. **Refund path:** active → refund/immediate-cancel via web → verify access cutoff within 5 min.
3. **Payment failure:** active → simulate card decline → `past_due` state → update card → back to active.

---

## Notes for QA

- **Cache TTL is 5 min** — always click "Refresh" in account widget or wait after backend changes; don't expect instant updates.
- **Ports used:** auth callback 19285+, upgrade callback 19295+. If testing port-collision, use `lsof -i :19295`.
- **`WEB_BASE_URL` env var** overrides `https://cook.md` — point it at staging for safe testing.
- **DevTools console** surfaces subscription-service warnings useful for debugging flaky refreshes.
