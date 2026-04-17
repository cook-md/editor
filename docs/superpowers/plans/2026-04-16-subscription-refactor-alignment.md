# Subscription Refactor Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the editor's subscription client with the refactored Rails
`/api/subscription` response (new `plan_slug`/`plan_name`/`tokens_remaining`
fields, drop legacy `monthly`|`annual` plan field), surface AI token balance
in the account widget, and remove the cosmetic sync paywall.

**Architecture:** Pure client-side alignment. No Rails, proto, or gRPC changes.
Subscription JSON mapping lives in `packages/cooklang-account/src/node/subscription-service.ts`;
UI lives in `packages/cooklang-account/src/browser/account-widget.tsx`. The
`SubscriptionService` RPC interface is unchanged — only the `SubscriptionState`
payload shape changes.

**Tech Stack:** TypeScript, InversifyJS, React (Theia ReactWidget), Lumino
messaging (`onActivateRequest` lifecycle hook).

---

## Preconditions

- Working directory: `/Users/alexeydubovskoy/Cooklang/editor`.
- Branch: `main` is clean. Create a feature branch before starting.
- Rails backend already returns the new fields (verified in `cook.md/web`
  at `app/controllers/api/subscriptions_controller.rb`).
- No backward compatibility required — fields are renamed/dropped cleanly.

## Files touched

- **Modify:** `packages/cooklang-account/src/common/subscription-protocol.ts`
- **Modify:** `packages/cooklang-account/src/node/subscription-service.ts`
- **Modify:** `packages/cooklang-account/src/browser/account-widget.tsx`
- **Modify:** `packages/cooklang-account/src/browser/style/index.css`

No new files. No package.json changes (dependencies already in place).

---

## Task 0: Create feature branch

**Files:** none (git-only).

- [ ] **Step 1: Verify clean tree and create branch**

Run:
```bash
git status
git checkout -b feat/subscription-refactor-alignment
```
Expected: `On branch feat/subscription-refactor-alignment`, clean tree.

---

## Task 1: Update `SubscriptionState` type

**Files:**
- Modify: `packages/cooklang-account/src/common/subscription-protocol.ts`

- [ ] **Step 1: Replace the `SubscriptionState` interface**

Current (lines 11–18) is:
```ts
export interface SubscriptionState {
    status: 'trial' | 'active' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    plan: 'monthly' | 'annual' | undefined;
    expiresAt: string | undefined;
    trialDaysRemaining: number | undefined;
}
```

Replace with:
```ts
export interface SubscriptionState {
    status: 'trial' | 'active' | 'past_due' | 'expired' | 'grandfathered' | 'canceled' | 'paused' | 'none';
    hasAccess: boolean;
    features: string[];
    planSlug: string | undefined;
    planName: string | undefined;
    tokensRemaining: number;
    expiresAt: string | undefined;
    trialDaysRemaining: number | undefined;
    trialAvailable: boolean;
    billingPeriodStart: string | undefined;
    billingPeriodEnd: string | undefined;
}
```

- [ ] **Step 2: Compile the account package to surface all type errors**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: TypeScript errors in `subscription-service.ts` (missing fields) and
`account-widget.tsx` (references to the removed `plan` field). These errors are
resolved by the next tasks. Do **not** run the root compile yet.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-account/src/common/subscription-protocol.ts
git commit -m "refactor(account): update SubscriptionState to match Rails refactor"
```

---

## Task 2: Map new JSON fields in subscription service

**Files:**
- Modify: `packages/cooklang-account/src/node/subscription-service.ts`

- [ ] **Step 1: Update `fetchSubscription()` to map the new Rails shape**

Replace the body of the `try` block that parses the response (current lines
73–83) with:

```ts
            const data = JSON.parse(response);
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
            this.cacheTimestamp = Date.now();
            this.onDidChangeSubscriptionEmitter.fire(this.cachedState);
```

Leave the 401/403 handling in the `catch` unchanged.

- [ ] **Step 2: Compile to verify the service is clean**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: errors in `account-widget.tsx` only (it still references the removed
`plan` field). `subscription-service.ts` is clean.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-account/src/node/subscription-service.ts
git commit -m "feat(account): map plan_slug/plan_name/tokens_remaining from Rails"
```

---

## Task 3: Account widget — plan label

**Files:**
- Modify: `packages/cooklang-account/src/browser/account-widget.tsx`

- [ ] **Step 1: Rewrite `getPlanLabel` to prefer `planName` and handle `past_due`**

Replace the current `getPlanLabel` method (lines 259–271):

```ts
    private getPlanLabel(subscription: SubscriptionState): string {
        switch (subscription.status) {
            case 'trial': return nls.localize('theia/cooklang-account/planTrial', 'Trial');
            case 'active': return subscription.plan === 'annual'
                ? nls.localize('theia/cooklang-account/planAnnual', 'Pro (Annual)')
                : nls.localize('theia/cooklang-account/planMonthly', 'Pro (Monthly)');
            case 'grandfathered': return nls.localize('theia/cooklang-account/planGrandfathered', 'Pro (Grandfathered)');
            case 'canceled': return nls.localize('theia/cooklang-account/planCanceled', 'Canceled');
            case 'paused': return nls.localize('theia/cooklang-account/planPaused', 'Paused');
            case 'expired': return nls.localize('theia/cooklang-account/planExpired', 'Expired');
            default: return nls.localize('theia/cooklang-account/planFree', 'Free');
        }
    }
```

with:

```ts
    private getPlanLabel(subscription: SubscriptionState): string {
        // Rails owns the display name — prefer it when present.
        if (subscription.planName) {
            return subscription.planName;
        }
        switch (subscription.status) {
            case 'trial': return nls.localize('theia/cooklang-account/planTrial', 'Trial');
            case 'grandfathered': return nls.localize('theia/cooklang-account/planGrandfathered', 'Pro (Grandfathered)');
            case 'past_due': return nls.localize('theia/cooklang-account/planPastDue', 'Pro (Payment Issue)');
            case 'canceled': return nls.localize('theia/cooklang-account/planCanceled', 'Canceled');
            case 'paused': return nls.localize('theia/cooklang-account/planPaused', 'Paused');
            case 'expired': return nls.localize('theia/cooklang-account/planExpired', 'Expired');
            default: return nls.localize('theia/cooklang-account/planFree', 'Free');
        }
    }
```

- [ ] **Step 2: Compile**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: clean. The removed `plan` field reference is gone.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-account/src/browser/account-widget.tsx
git commit -m "feat(account): use Rails plan_name for plan label, add past_due case"
```

---

## Task 4: Account widget — AI token balance section

**Files:**
- Modify: `packages/cooklang-account/src/browser/account-widget.tsx`
- Modify: `packages/cooklang-account/src/browser/style/index.css`

- [ ] **Step 1: Add a `renderAiTokensSection` method**

Insert this method immediately after `renderSyncSection` (around line 233,
before `renderSubscriptionUpgrade`):

```tsx
    protected renderAiTokensSection(subscription: SubscriptionState): React.ReactNode {
        const tokens = subscription.tokensRemaining;
        const tokensClass = tokens <= 0
            ? 'theia-account-row-label theia-account-sync-error'
            : 'theia-account-row-label';
        const resetsLabel = subscription.billingPeriodEnd
            ? new Date(subscription.billingPeriodEnd).toLocaleDateString()
            : undefined;
        return (
            <React.Fragment>
                <div className='theia-account-section-header'>{nls.localize('theia/cooklang-account/aiHeader', 'AI Assistant')}</div>
                <div className='theia-account-row'>
                    <i className='codicon codicon-sparkle' />
                    <span className={tokensClass}>
                        {nls.localize('theia/cooklang-account/aiTokensRemaining', '{0} tokens remaining', tokens.toLocaleString())}
                    </span>
                </div>
                {resetsLabel && (
                    <div className='theia-account-row theia-account-sync-status'>
                        <i className='codicon codicon-history' />
                        <span className='theia-account-row-label'>
                            {nls.localize('theia/cooklang-account/aiTokensResets', 'Resets {0}', resetsLabel)}
                        </span>
                    </div>
                )}
            </React.Fragment>
        );
    }
```

- [ ] **Step 2: Call `renderAiTokensSection` in `renderSubscriptionActive`**

In `renderSubscriptionActive` (around lines 170–198), currently:

```tsx
                {hasSyncFeature && this.renderSyncSection(statusLabel)}
```

Add an AI tokens section immediately before the sync section. The block from
`<div className='theia-account-row theia-account-row-interactive' onClick={this.handleManageSubscription}>` onward should look like:

```tsx
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleManageSubscription}>
                    <i className='codicon codicon-link-external' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/manageSubscription', 'Manage Subscription')}</span>
                </div>
                {subscription.features.includes('ai') && this.renderAiTokensSection(subscription)}
                {hasSyncFeature && this.renderSyncSection(statusLabel)}
```

(Task 5 will remove the `hasSyncFeature` gate; this task keeps it as-is.)

- [ ] **Step 3: Compile**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/src/browser/account-widget.tsx
git commit -m "feat(account): show AI token balance and reset date in widget"
```

---

## Task 5: Remove sync paywall

**Files:**
- Modify: `packages/cooklang-account/src/browser/account-widget.tsx`

- [ ] **Step 1: Drop the sync feature gate in `renderSubscriptionActive`**

In `renderSubscriptionActive` (the block edited in Task 4), currently:

```tsx
    protected renderSubscriptionActive(subscription: SubscriptionState): React.ReactNode {
        const planLabel = this.getPlanLabel(subscription);
        const hasSyncFeature = subscription.features.includes('sync');
        const statusLabel = this.syncStatus.status.charAt(0).toUpperCase() + this.syncStatus.status.slice(1);
```

Replace with:

```tsx
    protected renderSubscriptionActive(subscription: SubscriptionState): React.ReactNode {
        const planLabel = this.getPlanLabel(subscription);
        const statusLabel = this.syncStatus.status.charAt(0).toUpperCase() + this.syncStatus.status.slice(1);
```

And change the conditional sync render:

```tsx
                {hasSyncFeature && this.renderSyncSection(statusLabel)}
```

to:

```tsx
                {this.renderSyncSection(statusLabel)}
```

- [ ] **Step 2: Render sync section in `renderSubscriptionUpgrade`**

Current `renderSubscriptionUpgrade` (lines 235–257):

```tsx
    protected renderSubscriptionUpgrade(): React.ReactNode {
        return (
            <React.Fragment>
                <div className='theia-account-section-header'>{nls.localize('theia/cooklang-account/subscriptionHeader', 'Subscription')}</div>
                <div className='theia-account-upgrade-section'>
                    <div className='theia-account-upgrade-message'>
                        {nls.localize('theia/cooklang-account/upgradeMessage', 'Upgrade to unlock sync, AI assistance, and more features.')}
                    </div>
                    <button
                        className='theia-button main theia-account-upgrade-button'
                        onClick={this.handleUpgrade}
                    >
                        {nls.localize('theia/cooklang-account/upgradeButton', 'Upgrade to Pro')}
                    </button>
                </div>
                <div className='theia-account-divider' />
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleLogout}>
                    <i className='codicon codicon-sign-out' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/logOut', 'Log Out')}</span>
                </div>
            </React.Fragment>
        );
    }
```

Replace with (adds sync section; updates upgrade-message copy):

```tsx
    protected renderSubscriptionUpgrade(): React.ReactNode {
        const statusLabel = this.syncStatus.status.charAt(0).toUpperCase() + this.syncStatus.status.slice(1);
        return (
            <React.Fragment>
                <div className='theia-account-section-header'>{nls.localize('theia/cooklang-account/subscriptionHeader', 'Subscription')}</div>
                <div className='theia-account-upgrade-section'>
                    <div className='theia-account-upgrade-message'>
                        {nls.localize('theia/cooklang-account/upgradeMessage', 'Upgrade to unlock AI assistance and more features.')}
                    </div>
                    <button
                        className='theia-button main theia-account-upgrade-button'
                        onClick={this.handleUpgrade}
                    >
                        {nls.localize('theia/cooklang-account/upgradeButton', 'Upgrade to Pro')}
                    </button>
                </div>
                {this.renderSyncSection(statusLabel)}
                <div className='theia-account-divider' />
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleLogout}>
                    <i className='codicon codicon-sign-out' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/logOut', 'Log Out')}</span>
                </div>
            </React.Fragment>
        );
    }
```

- [ ] **Step 3: Compile**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/src/browser/account-widget.tsx
git commit -m "feat(account): remove sync feature paywall, sync available to all logged-in users"
```

---

## Task 6: Refresh subscription when widget activates

**Files:**
- Modify: `packages/cooklang-account/src/browser/account-widget.tsx`

- [ ] **Step 1: Import Lumino `Message` type**

At the top of the file, add (after the existing imports):

```ts
import { Message } from '@lumino/messaging';
```

- [ ] **Step 2: Override `onActivateRequest`**

Insert this method immediately before the existing `startSyncPolling` method
(around line 85):

```ts
    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        // Pull latest subscription state so tokens_remaining and plan reflect reality
        // whenever the user opens/focuses the account widget.
        this.subscriptionFrontendService.refresh().catch(err => {
            console.warn('Failed to refresh subscription on widget activation:', err);
        });
    }
```

- [ ] **Step 3: Compile**

Run:
```bash
npx lerna run compile --scope @theia/cooklang-account
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-account/src/browser/account-widget.tsx
git commit -m "feat(account): refresh subscription state when account widget activates"
```

---

## Task 7: Full build

**Files:** none (build-only).

- [ ] **Step 1: Compile the whole workspace**

Run:
```bash
npm run compile
```
Expected: clean. If errors reference `subscription-protocol`, `SubscriptionState`,
or the removed `plan` field in any other package, fix them in place with the
same renames used in Tasks 1–3 and add a follow-up commit scoped to that file.

- [ ] **Step 2: Lint the touched packages**

Run:
```bash
npx lerna run lint --scope @theia/cooklang-account
```
Expected: clean.

- [ ] **Step 3: Bundle the Electron app**

Run:
```bash
cd examples/electron && npm run bundle && cd -
```
Expected: bundle completes without errors.

- [ ] **Step 4: Commit any follow-ups if produced**

If Step 1 required fixes outside `cooklang-account`, commit them with a message
like:
```bash
git commit -m "refactor: propagate SubscriptionState rename to <package>"
```

---

## Task 8: Manual verification

**Files:** none (manual test only).

- [ ] **Step 1: Start the Electron app**

Run:
```bash
npm run start:electron
```

- [ ] **Step 2: Verify AI user (feature includes `'ai'`)**

Log in as a user with the `pro_early_adopter_v1` plan. Open the account panel.

Expected:
- Plan label shows `AI (Early Adopter)` (from Rails `plan_name`).
- AI section shows `1,000,000 tokens remaining` (or the real balance).
- Sync section is visible under AI section.
- Close and re-open the account widget → values reflect the latest Rails
  state (refresh-on-activate fired; inspect network tab or backend logs if
  in doubt).

- [ ] **Step 3: Verify free / non-AI user**

Log in as a user with no active subscription (or trigger an expired one).

Expected:
- Widget shows the upgrade section with copy "Upgrade to unlock AI
  assistance and more features." (no "sync" in the message).
- Sync section is **still visible** and toggle-able.
- No AI token row.
- Open the branded chat widget (Cookbot) → still shows the "Get AI Addon"
  overlay (unchanged behavior from `cooklang-branding`).

- [ ] **Step 4: Verify logged-out state**

Log out.

Expected:
- Widget shows login prompt only; no sync UI, no plan badge, no AI row.

- [ ] **Step 5: Verify past_due (optional — requires a prepared account)**

If a `past_due` test account is available, log in.

Expected:
- Plan label shows `AI (Early Adopter)` (Rails still returns `plan_name`; we
  prefer that over the status fallback). If Rails clears `plan_name` for
  `past_due`, the status fallback `Pro (Payment Issue)` kicks in.
- AI and sync sections still accessible (`active_for_access?` is true for
  `past_due` server-side).

- [ ] **Step 6: Open PR**

Run:
```bash
git push -u origin feat/subscription-refactor-alignment
gh pr create --title "Align subscription client with refactored Rails API" \
    --body "$(cat <<'EOF'
## Summary
- Replace `SubscriptionState.plan` (`'monthly'|'annual'`) with `planSlug`, `planName`, `tokensRemaining`, `billingPeriodStart/End`, `trialAvailable`.
- Map new fields from `/api/subscription` in `subscription-service.ts`.
- Show AI token balance and reset date in the account widget (gated on `features.includes('ai')`).
- Remove the cosmetic sync paywall — sync is available to any logged-in user.
- Refresh subscription state when the account widget is activated.
- Add `past_due` case to status handling.

Spec: `docs/superpowers/specs/2026-04-16-subscription-refactor-alignment-design.md`
Plan: `docs/superpowers/plans/2026-04-16-subscription-refactor-alignment.md`

## Test plan
- [ ] AI user: plan name, token balance, sync all show correctly
- [ ] Free user: upgrade copy updated, sync still visible
- [ ] Logged out: login prompt only
- [ ] Widget re-open triggers subscription refresh
EOF
)"
```

---

## Rollback

If any task produces unexpected behavior in production and a quick revert is
needed:

```bash
git revert <merge-commit-sha>
```

Rails is already returning the new fields; reverting the editor just means the
widget shows the old labels (`Pro (Monthly)`/`Pro (Annual)`) and sync
re-paywalls, but nothing breaks.
