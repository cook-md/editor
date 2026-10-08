# Core Vitals — Editor Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give plugins a badge outlet on the menu preview (`cooklang/menuPreview/badge`) and a `cooklang.api.openReport` command that opens a report tab from a plugin-supplied template, so the Core Vitals plugin can badge meal plans and open its report.

**Architecture:** The badge machinery that lives inside `RecipePreviewWidget` (debounce, sequence guard, stale-while-hidden, hover ownership) moves into a `PreviewBadgeController` class that both preview widgets own; `MenuView` learns to render badges like `RecipeView`. `CooklangPluginApiContribution` gains `openReport`, which validates like `renderReport` and hands an inline template to the existing `ReportPresenter`. Both changes are additive: `CooklangPluginApi.VERSION` and `CooklangOutlets.VERSION` stay 1.

**Tech Stack:** TypeScript 5.4, InversifyJS, React 18, Theia `HoverService`, mocha/chai, jsdom.

**Spec:** `~/Cooklang/plugins/docs/superpowers/specs/2026-10-08-core-vitals-plugin-design.md` (section "Changes outside the plugin").

---

## Conventions for every task

- Repo: `/Users/alexeydubovskoy/Cooklang/editor`. Create and work on branch `feature/core-vitals-editor-api` from `main` (Task 1 does this).
- Mocha needs Node 22: prefix every test command with `PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH` (the default `node` is 20 and aborts browser specs with `ERR_UNKNOWN_FILE_EXTENSION ... .css`).
- Editor specs run from compiled output. Compile with `npx lerna run compile --scope @theia/cooklang` (from the repo root), then run one spec with:
  `cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/<name>.spec.js`
  and the whole package with `cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`.
- Browser specs that import `@theia/monaco`, `@theia/filesystem` or `HoverService` start with the JSDOM preamble (copy from `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` lines 14–23: `enableJSDOM()` then the guarded `FrontendApplicationConfigProvider.set({})`) **before** any other import. Never call `disableJSDOM()` in `after()`.
- New editor `.ts`/`.tsx` files start with the AGPL header copied verbatim from `packages/cooklang/src/browser/cooklang-outlets.ts` lines 1–12.
- Code style: 4 spaces, single quotes, `undefined` not `null` (`// eslint-disable-line no-null/no-null` where a `null` check is unavoidable), explicit return types, property injection, `nls.localize` for user-facing strings.
- Lint before each commit: `npx lerna run lint --scope @theia/cooklang`.
- Commit messages use conventional commits with the `cooklang` scope (release-please builds the changelog from them; never edit `CHANGELOG.md` by hand).

## File map

| File | Change |
|---|---|
| `packages/cooklang/src/browser/cooklang-outlets.ts` | add `MENU_PREVIEW_BADGE` |
| `packages/cooklang/src/browser/preview-badge-controller.ts` | create: debounce / sequence / stale / hover bookkeeping shared by both previews |
| `packages/cooklang/src/browser/preview-badge-controller.spec.ts` | create |
| `packages/cooklang/src/browser/recipe-preview-widget.tsx` | delegate badge work to the controller |
| `packages/cooklang/src/browser/recipe-preview-widget.spec.ts` | point the badge tests at the controller |
| `packages/cooklang/src/browser/menu-preview-components.tsx` | `MenuView` renders badges |
| `packages/cooklang/src/browser/menu-preview-components.spec.ts` | create: badge rendering test |
| `packages/cooklang/src/browser/menu-preview-widget.tsx` | own a controller on the menu badge outlet |
| `packages/cooklang/src/browser/menu-preview-widget.spec.ts` | create: badge collection + rendering |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` | `OPEN_REPORT` command |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | `openReport` tests |

---

### Task 1: Branch and the menu badge outlet constant

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-outlets.ts:36-46`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && git checkout main && git pull --ff-only && git checkout -b feature/core-vitals-editor-api
```

- [ ] **Step 2: Add the outlet constant**

In `packages/cooklang/src/browser/cooklang-outlets.ts`, directly after the `RECIPE_PREVIEW_BADGE` declaration (line 44) and before `MENU_PREVIEW_TOOLBAR`, insert:

```ts
    /**
     * Badges in the menu preview header. Same contract as
     * {@link RECIPE_PREVIEW_BADGE}: a `PreviewOutletContext` in, a
     * `PreviewBadge` (or nothing) out, 10 s timeout, visible previews only.
     * Re-runs when the menu text, the scale, the user's subscription, or the
     * contributed commands/menus change.
     */
    export const MENU_PREVIEW_BADGE: MenuPath = ['cooklang/menuPreview/badge'];
```

- [ ] **Step 3: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-outlets.ts
git commit -m "feat(cooklang): cooklang/menuPreview/badge outlet constant"
```

---

### Task 2: `PreviewBadgeController`

**Files:**
- Create: `packages/cooklang/src/browser/preview-badge-controller.ts`
- Create: `packages/cooklang/src/browser/preview-badge-controller.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang/src/browser/preview-badge-controller.spec.ts` (AGPL header first, then):

```ts
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { MenuPath } from '@theia/core/lib/common/menu';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { PreviewBadgeController, PreviewBadgeHost } from './preview-badge-controller';

const OUTLET: MenuPath = ['cooklang/test/badge'];
const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 };
const PILL: PreviewBadge = { kind: 'pill', text: 'x', tone: 'neutral', tooltipMarkdown: '' };

/** Poll until `condition` holds. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

class Harness {
    readonly calls: Array<{ menuPath: MenuPath; context: object; element: HTMLElement | undefined }> = [];
    collect: () => Promise<PreviewBadge[]> = async () => [];
    context: object | undefined = CONTEXT;
    visible = true;
    changes = 0;
    cancels = 0;
    lastOnHide: (() => void) | undefined;
    readonly element = document.createElement('div');
    readonly controller: PreviewBadgeController;

    constructor() {
        const outlets = {
            collectBadges: async (menuPath: MenuPath, context: object, element?: HTMLElement): Promise<PreviewBadge[]> => {
                this.calls.push({ menuPath, context, element });
                return this.collect();
            },
        };
        const hoverService = {
            requestHover: (request: { onHide?: () => void }) => {
                // The real service cancels the open hover first, running its `onHide` synchronously.
                this.lastOnHide?.();
                this.lastOnHide = request.onHide;
            },
            cancelHover: () => { this.cancels++; },
        };
        const host: PreviewBadgeHost = {
            outlet: OUTLET,
            element: this.element,
            context: () => this.context,
            isVisible: () => this.visible,
            onDidChangeBadges: () => { this.changes++; },
        };
        this.controller = new PreviewBadgeController(outlets as never, hoverService as never, host);
        this.controller.debounceMs = 1;
    }
}

describe('PreviewBadgeController', () => {

    it('collects badges from the outlet with the host context and element once the debounce elapses', async () => {
        const harness = new Harness();
        harness.collect = async () => [PILL];
        harness.controller.schedule();
        await until(() => harness.controller.badges.length > 0);
        expect(harness.calls).to.have.lengthOf(1);
        expect(harness.calls[0]).to.deep.equal({ menuPath: OUTLET, context: CONTEXT, element: harness.element });
        expect(harness.controller.badges).to.deep.equal([PILL]);
        expect(harness.changes).to.equal(1);
    });

    it('coalesces several schedule calls in one window into a single collect', async () => {
        const harness = new Harness();
        harness.controller.schedule();
        harness.controller.schedule();
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.calls).to.have.lengthOf(1);
    });

    it('collects nothing and notifies nobody when the host has no context', async () => {
        const harness = new Harness();
        harness.context = undefined;
        await harness.controller.refresh();
        expect(harness.calls).to.deep.equal([]);
        expect(harness.changes).to.equal(0);
    });

    it('does not notify when the badges are unchanged', async () => {
        const harness = new Harness();
        harness.collect = async () => [PILL];
        await harness.controller.refresh();
        await harness.controller.refresh();
        expect(harness.changes).to.equal(1);
    });

    it('drops a refresh in flight when reset is called', async () => {
        const harness = new Harness();
        let resolveOld!: (badges: PreviewBadge[]) => void;
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolveOld = resolve; });
        const inFlight = harness.controller.refresh();
        harness.controller.reset();
        resolveOld([PILL]);
        await inFlight;
        expect(harness.controller.badges).to.deep.equal([]);
        expect(harness.changes).to.equal(0);
    });

    it('drops a stale refresh that resolves after a newer one', async () => {
        const harness = new Harness();
        const resolvers: Array<(badges: PreviewBadge[]) => void> = [];
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolvers.push(resolve); });
        const first = harness.controller.refresh();
        const second = harness.controller.refresh();
        const newer: PreviewBadge = { kind: 'pill', text: 'new', tone: 'good', tooltipMarkdown: '' };
        resolvers[1]([newer]);
        await second;
        resolvers[0]([PILL]);
        await first;
        expect(harness.controller.badges).to.deep.equal([newer]);
    });

    it('defers a refresh while hidden and runs it on flushStale once visible', async () => {
        const harness = new Harness();
        harness.visible = false;
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.calls).to.have.lengthOf(0);
        expect(harness.controller.stale).to.equal(true);

        harness.controller.flushStale();
        expect(harness.calls, 'still hidden: must not run').to.have.lengthOf(0);

        harness.visible = true;
        harness.controller.flushStale();
        await until(() => harness.calls.length === 1);
        expect(harness.controller.stale).to.equal(false);
    });

    it('does nothing after dispose, even for a refresh that was in flight', async () => {
        const harness = new Harness();
        let resolveOld!: (badges: PreviewBadge[]) => void;
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolveOld = resolve; });
        const inFlight = harness.controller.refresh();
        harness.controller.dispose();
        resolveOld([PILL]);
        await inFlight;
        expect(harness.controller.badges).to.deep.equal([]);
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.calls).to.have.lengthOf(1);
    });

    it('owns the hover it opened and cancels it on dispose', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        expect(harness.controller.hoverShown).to.equal(true);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(1);
        expect(harness.controller.hoverShown).to.equal(false);
    });

    it('never calls the global cancelHover when it opened no hover', () => {
        const harness = new Harness();
        harness.controller.dispose();
        expect(harness.cancels).to.equal(0);
    });

    it('tracks HoverService closing the hover on its own', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        expect(harness.lastOnHide, 'requestHover was not given an onHide callback').to.not.be.undefined;
        harness.lastOnHide!();
        expect(harness.controller.hoverShown).to.equal(false);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(0);
    });

    it('keeps hover ownership across a move straight from one badge to another', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        harness.controller.showDetails({ ...PILL, text: 'b' }, harness.element, true);
        expect(harness.controller.hoverShown).to.equal(true);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(1);
    });

    it('hideDetails cancels the hover and clears ownership', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, false);
        harness.controller.hideDetails();
        expect(harness.cancels).to.equal(1);
        expect(harness.controller.hoverShown).to.equal(false);
    });
});
```

- [ ] **Step 2: Compile and run to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: compile error `Cannot find module './preview-badge-controller'`.

- [ ] **Step 3: Write the controller**

Create `packages/cooklang/src/browser/preview-badge-controller.ts` (AGPL header first, then):

```ts
import { Disposable } from '@theia/core/lib/common/disposable';
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { MenuPath } from '@theia/core/lib/common/menu';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { CooklangOutletService } from './cooklang-outlet-service';

/** What a preview widget tells its {@link PreviewBadgeController} about itself. */
export interface PreviewBadgeHost {
    /** The badge outlet to query, e.g. `CooklangOutlets.RECIPE_PREVIEW_BADGE`. */
    readonly outlet: MenuPath;
    /** The widget's DOM node; outlet `when` clauses are evaluated against it. */
    readonly element: HTMLElement;
    /** The outlet context for what the preview currently shows, or `undefined` when nothing is loaded (no badges). */
    context(): object | undefined;
    /** Lumino's `isVisible`: a hidden preview defers refreshes until it is shown again. */
    isVisible(): boolean;
    /** `badges` changed; the widget should re-render. */
    onDidChangeBadges(): void;
}

/**
 * Badge bookkeeping shared by the recipe and menu previews: badges call plugins
 * (and the network), so refreshes are debounced, deferred while the preview is
 * hidden, guarded against out-of-order results, and the hover card the badges
 * open is cancelled only by the controller that opened it.
 */
export class PreviewBadgeController implements Disposable {

    static readonly DEBOUNCE_MS = 500;

    badges: PreviewBadge[] = [];
    /** Overridable in tests; production code always uses {@link DEBOUNCE_MS}. */
    debounceMs = PreviewBadgeController.DEBOUNCE_MS;
    /** A refresh was requested while hidden; run it once the preview is shown again. */
    stale = false;
    /** Whether this controller currently has a badge hover open, so {@link hideHover} never cancels another widget's. */
    hoverShown = false;
    protected sequence = 0;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;

    constructor(
        protected readonly outlets: CooklangOutletService,
        protected readonly hoverService: HoverService,
        protected readonly host: PreviewBadgeHost,
    ) { }

    /** Refresh after edits settle; a hidden preview defers until `flushStale`. */
    schedule(): void {
        if (this.disposed) {
            return;
        }
        if (!this.host.isVisible()) {
            this.stale = true;
            return;
        }
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.refresh().catch(e => console.warn('[cooklang] badge refresh failed:', e));
        }, this.debounceMs);
    }

    /** Runs a refresh deferred by `schedule` while hidden, once the preview is visible again. */
    flushStale(): void {
        if (this.stale && this.host.isVisible()) {
            this.stale = false;
            this.schedule();
        }
    }

    /**
     * The preview switched to another source: forget the old badges and let no
     * refresh for the old source land after this.
     */
    reset(): void {
        this.badges = [];
        this.sequence++;
        this.clearTimer();
    }

    async refresh(): Promise<void> {
        const sequence = ++this.sequence;
        const context = this.host.context();
        const badges = context ? await this.outlets.collectBadges(this.host.outlet, context, this.host.element) : [];
        if (this.disposed || sequence !== this.sequence) {
            return;
        }
        if (!PreviewBadge.equals(this.badges, badges)) {
            this.badges = badges;
            this.host.onDidChangeBadges();
        }
    }

    /** `immediate` is true for keyboard focus and clicks, where the hover delay would feel broken. */
    showDetails(badge: PreviewBadge, target: HTMLElement, immediate: boolean): void {
        // `requestHover` first cancels any hover already open, which runs ITS
        // `onHide` synchronously — moving the mouse from one badge straight to
        // another would otherwise clear the flag this call is about to set.
        // Setting it after, not before, keeps it true across the move.
        this.hoverService.requestHover({
            // Untrusted, no HTML: plugin text never runs commands or injects markup.
            content: new MarkdownStringImpl(badge.tooltipMarkdown, { isTrusted: false, supportHtml: false }),
            target,
            position: 'bottom',
            cssClasses: ['cooklang-preview-badge-hover'],
            skipHoverDelay: immediate,
            // HoverService can close the hover on its own (mouseout, mousedown
            // elsewhere), without going through `hideDetails`.
            onHide: () => { this.hoverShown = false; },
        });
        this.hoverShown = true;
    }

    hideDetails(): void {
        this.hoverShown = false;
        this.hoverService.cancelHover();
    }

    /**
     * Hides this controller's own hover, if any. `HoverService.cancelHover`
     * is global — it hides whatever hover is open, regardless of who opened
     * it — so this only calls it when `hoverShown` confirms it is ours.
     */
    hideHover(): void {
        if (this.hoverShown) {
            this.hoverService.cancelHover();
        }
        this.hoverShown = false;
    }

    dispose(): void {
        this.disposed = true;
        this.clearTimer();
        this.hideHover();
    }

    protected clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
```

- [ ] **Step 4: Compile and run the spec**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/preview-badge-controller.spec.js; cd ../..`
Expected: `12 passing`.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/preview-badge-controller.ts packages/cooklang/src/browser/preview-badge-controller.spec.ts
git commit -m "feat(cooklang): PreviewBadgeController shared by the preview widgets"
```

---

### Task 3: Recipe preview delegates to the controller

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.spec.ts`

- [ ] **Step 1: Update the spec's badge internals**

In `packages/cooklang/src/browser/recipe-preview-widget.spec.ts`, add to the imports (after the `RecipePreviewWidget` import):

```ts
import { PreviewBadgeController } from './preview-badge-controller';
```

Replace the whole `BadgeInternals` interface (lines 68–85) with:

```ts
/** The badge-related internals exercised directly by `RecipePreviewWidget badges` below. */
interface BadgeInternals {
    outlets: { collectBadges: (menuPath: MenuPath, context: object, element?: HTMLElement) => Promise<PreviewBadge[]> };
    badgeController: PreviewBadgeController;
    handleShowBadgeDetails(badge: PreviewBadge, target: HTMLElement, immediate: boolean): void;
    handleHideBadgeDetails(): void;
    onAfterShow(msg: unknown): void;
    onAfterAttach(msg: unknown): void;
    onBeforeHide(msg: unknown): void;
}
```

Then rename every access inside the `describe('RecipePreviewWidget badges', …)` block:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
f=packages/cooklang/src/browser/recipe-preview-widget.spec.ts
sed -i '' \
  -e 's/internals\.badgeDebounceMs/internals.badgeController.debounceMs/g' \
  -e 's/internals\.badges\./internals.badgeController.badges./g' \
  -e 's/internals\.badges)/internals.badgeController.badges)/g' \
  -e 's/internals\.badgesStale/internals.badgeController.stale/g' \
  -e 's/internals\.badgeHoverShown/internals.badgeController.hoverShown/g' \
  -e 's/internals\.scheduleBadges()/internals.badgeController.schedule()/g' \
  -e 's/internals\.refreshBadges()/internals.badgeController.refresh()/g' \
  -e 's/internals\.hideBadgeHover()/internals.badgeController.hideHover()/g' \
  "$f"
grep -n "badgeTimer\|badgeSequence\|badgeDebounceMs\|badgesStale\|badgeHoverShown" "$f"
```

Expected: the final `grep` prints nothing (if it prints a line, rename it the same way by hand).

- [ ] **Step 2: Compile to see the widget no longer matches the spec**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: errors in `recipe-preview-widget.spec.ts` about `badgeController` not existing on the internals type's target (the widget has no such field yet). If it compiles cleanly instead, the sed in Step 1 did not apply; check the file.

- [ ] **Step 3: Rewrite the widget's badge code**

In `packages/cooklang/src/browser/recipe-preview-widget.tsx`:

1. Imports: remove the `HoverService`-only usages? No — keep `import { HoverService }` (it is still injected and handed to the controller). Remove the now-unused `MarkdownStringImpl` import (line 24). Add after the `CooklangOutlets` import:

```ts
import { PreviewBadgeController } from './preview-badge-controller';
```

2. Replace the field block (lines 109–118):

```ts
    protected badges: PreviewBadge[] = [];
    protected badgeSequence = 0;
    protected badgeTimer: ReturnType<typeof setTimeout> | undefined;
    static readonly BADGE_DEBOUNCE_MS = 500;
    /** Overridable in tests; production code always uses {@link BADGE_DEBOUNCE_MS}. */
    protected badgeDebounceMs = RecipePreviewWidget.BADGE_DEBOUNCE_MS;
    /** A badge refresh was requested while hidden; run it once the preview is shown again. */
    protected badgesStale = false;
    /** Whether this widget currently has a badge hover open, so {@link hideBadgeHover} never cancels another widget's. */
    protected badgeHoverShown = false;
```

with:

```ts
    /** Created in `init`, once `outlets` and `hoverService` are injected. */
    protected badgeController: PreviewBadgeController;
```

3. In `init()`, before `this.listenToDocumentChanges();`, insert:

```ts
        this.badgeController = new PreviewBadgeController(this.outlets, this.hoverService, {
            outlet: CooklangOutlets.RECIPE_PREVIEW_BADGE,
            element: this.node,
            context: () => this.recipe ? this.previewContext() : undefined,
            isVisible: () => this.isVisible,
            onDidChangeBadges: () => this.update(),
        });
        this.toDispose.push(this.badgeController);
```

and change the two listeners at the end of `init()` to:

```ts
        this.toDispose.push(this.outlets.onDidChange(() => {
            this.update();
            this.badgeController.schedule();
        }));
        this.toDispose.push(this.subscriptions.onDidChangeSubscription(() => this.badgeController.schedule()));
```

4. `onAfterShow` and `onAfterAttach`: replace `this.flushStaleBadges();` with `this.badgeController.flushStale();`. `onBeforeHide`: replace `this.hideBadgeHover();` with `this.badgeController.hideHover();`. Delete the `flushStaleBadges()` method and its doc comment.

5. In `setUri`, replace

```ts
        this.badges = [];
        this.badgeSequence++;
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
            this.badgeTimer = undefined;
        }
```

with `this.badgeController.reset();` (keep the comment above it).

6. In `parseContent`: the success branch's `this.scheduleBadges();` becomes `this.badgeController.schedule();`; the catch branch's `this.badges = [];` becomes `this.badgeController.reset();`.

7. `handleScaleChange` and `setScale`: `this.scheduleBadges();` → `this.badgeController.schedule();`.

8. Delete `scheduleBadges()`, `refreshBadges()`, `hideBadgeHover()` (with their doc comments) and replace `handleShowBadgeDetails` / `handleHideBadgeDetails` with:

```ts
    protected handleShowBadgeDetails = (badge: PreviewBadge, target: HTMLElement, immediate: boolean): void => {
        this.badgeController.showDetails(badge, target, immediate);
    };

    protected handleHideBadgeDetails = (): void => {
        this.badgeController.hideDetails();
    };
```

9. In `render()`, `badges={this.badges}` → `badges={this.badgeController.badges}`.

10. In `dispose()`, delete the `badgeTimer` block and `this.hideBadgeHover();` (the controller is in `toDispose`, which `super.dispose()` disposes).

- [ ] **Step 4: Compile, run the recipe spec and the controller spec**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js lib/browser/preview-badge-controller.spec.js; cd ../..`
Expected: all passing, including every test under `RecipePreviewWidget badges` (same count as before the change).

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git commit -m "refactor(cooklang): recipe preview badges go through PreviewBadgeController"
```

---

### Task 4: `MenuView` renders badges

**Files:**
- Modify: `packages/cooklang/src/browser/menu-preview-components.tsx:189-241`
- Create: `packages/cooklang/src/browser/menu-preview-components.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang/src/browser/menu-preview-components.spec.ts` (AGPL header, then):

```ts
import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuParseResult } from '../common/menu-types';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { OutletItem } from './cooklang-outlet-service';
import { MenuView, MenuViewProps } from './menu-preview-components';

describe('MenuView badges', () => {

    const MENU: MenuParseResult = {
        metadata: null, // eslint-disable-line no-null/no-null
        sections: [{ name: null, lines: [[{ type: 'text', value: 'Breakfast:' }]] }], // eslint-disable-line no-null/no-null
        errors: [],
        warnings: [],
    };

    const TOOLBAR_ITEMS: OutletItem[] = [{ id: 'cart', label: 'Add Menu to Shopping List' }];

    const BADGES: PreviewBadge[] = [
        { kind: 'pill', text: 'Vitals 14/17', tone: 'good', tooltipMarkdown: 'Core Vitals' },
    ];

    function renderView(props: Partial<MenuViewProps> = {}): string {
        return renderToStaticMarkup(
            React.createElement(MenuView, {
                menuResult: MENU,
                fileName: 'week.menu',
                scale: 1,
                toolbarItems: TOOLBAR_ITEMS,
                onRunToolbarItem: () => undefined,
                ...props,
            })
        );
    }

    it('renders badges in the header before the action bar when badges and handlers are provided', () => {
        const markup = renderView({ badges: BADGES, onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
        const pillIndex = markup.indexOf('cooklang-badge-pill');
        const actionBarIndex = markup.indexOf('theia-cooklang-action-bar');
        expect(pillIndex, markup).to.be.greaterThan(-1);
        expect(actionBarIndex, markup).to.be.greaterThan(-1);
        expect(pillIndex).to.be.lessThan(actionBarIndex);
        expect(markup).to.contain('Vitals 14/17');
    });

    it('renders no badges when badges are provided without handlers', () => {
        expect(renderView({ badges: BADGES })).to.not.contain('cooklang-badge-pill');
    });

    it('renders no badges when handlers are provided without badges', () => {
        const markup = renderView({ onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
        expect(markup).to.not.contain('cooklang-badge-pill');
    });
});
```

- [ ] **Step 2: Compile to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: errors: `badges` / `onShowBadgeDetails` / `onHideBadgeDetails` do not exist in `MenuViewProps`.

- [ ] **Step 3: Add the props and rendering**

In `packages/cooklang/src/browser/menu-preview-components.tsx`:

Imports — add after the `OutletItem` import:

```ts
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { PreviewBadgeView } from './preview-badge';
```

`MenuViewProps` — add at the end of the interface:

```ts
    /** Plugin badges for the header; rendered only when both detail handlers are given. */
    badges?: readonly PreviewBadge[];
    onShowBadgeDetails?: (badge: PreviewBadge, target: HTMLElement, immediate: boolean) => void;
    onHideBadgeDetails?: () => void;
```

Destructuring in `MenuView` — add `badges, onShowBadgeDetails, onHideBadgeDetails,` after `onRecipeContextMenu,`.

JSX — between the closing `</div>` of `menu-scale-control` and `<CooklangActionBar …/>` insert:

```tsx
                    {onShowBadgeDetails && onHideBadgeDetails && badges?.map((badge, index) => (
                        <PreviewBadgeView key={`${badge.kind}-${index}`} badge={badge}
                            onShowDetails={onShowBadgeDetails} onHideDetails={onHideBadgeDetails} />
                    ))}
```

- [ ] **Step 4: Compile and run the spec**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/menu-preview-components.spec.js; cd ../..`
Expected: `3 passing`.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/menu-preview-components.tsx packages/cooklang/src/browser/menu-preview-components.spec.ts
git commit -m "feat(cooklang): MenuView renders preview badges"
```

---

### Task 5: Menu preview owns a badge controller

**Files:**
- Modify: `packages/cooklang/src/browser/menu-preview-widget.tsx`
- Create: `packages/cooklang/src/browser/menu-preview-widget.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang/src/browser/menu-preview-widget.spec.ts` (AGPL header, then):

```ts
// The widget module imports `MonacoWorkspace` and `FileService`, which need
// browser globals at require time. jsdom stays up for the whole run.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { MenuParseResult } from '../common/menu-types';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { CooklangOutletService, OutletItem } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { MenuPreviewWidget } from './menu-preview-widget';
import { PreviewBadgeController } from './preview-badge-controller';

const ROOT = new URI('file:///ws');
const MENU_URI = new URI('file:///ws/plans/week.menu');

const MENU: MenuParseResult = {
    metadata: null, // eslint-disable-line no-null/no-null
    sections: [{ name: null, lines: [[{ type: 'text', value: 'Breakfast:' }]] }], // eslint-disable-line no-null/no-null
    errors: [],
    warnings: [],
};

interface MenuInternals {
    init(): void;
    render(): React.ReactNode;
    menuResult: MenuParseResult | undefined;
    badgeController: PreviewBadgeController;
    outlets: { collectBadges: (menuPath: MenuPath, context: object, element?: HTMLElement) => Promise<PreviewBadge[]> };
    handleScaleChange(scale: number): void;
}

async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

/** A real menu preview widget over stubbed services. */
class MenuHarness {
    readonly subscriptionChanged = new Emitter<void>();
    hoverCancelCount = 0;
    readonly widget: MenuPreviewWidget;

    constructor() {
        const never = new Emitter<unknown>().event;
        const outlets = new CooklangOutletService();
        Object.assign(outlets, {
            menus: { getMenu: () => undefined },
            workspaceService: { tryGetRoots: () => [{ resource: ROOT }] },
            getItems: (): OutletItem[] => [],
            run: async (): Promise<void> => undefined,
            collectBadges: async () => [],
        });
        const widget = new MenuPreviewWidget();
        // `isVisible` derives from DOM attachment, which a widget built by `new` never has.
        Object.defineProperty(widget, 'isVisible', { value: true, writable: true, configurable: true });
        Object.assign(widget, {
            service: { parseMenu: async () => JSON.stringify(MENU) },
            monacoWorkspace: { onDidChangeTextDocument: never, onDidOpenTextDocument: never, getTextDocument: () => undefined },
            fileService: { read: async () => ({ value: '= Day 1 =\n\nBreakfast:\n\n@./pancakes{1}\n' }) },
            editorManager: {},
            navigator: { navigate: () => undefined },
            outlets,
            hoverService: {
                requestHover: () => undefined,
                cancelHover: () => { this.hoverCancelCount++; },
            },
            subscriptions: { onDidChangeSubscription: this.subscriptionChanged.event },
            update: () => undefined,
        });
        (widget as unknown as MenuInternals).init();
        this.widget = widget;
    }

    get internals(): MenuInternals {
        return this.widget as unknown as MenuInternals;
    }

    async open(uri: URI): Promise<void> {
        this.widget.setUri(uri);
        await until(() => this.internals.menuResult !== undefined);
    }

    markup(): string {
        return renderToStaticMarkup(this.internals.render() as React.ReactElement);
    }
}

describe('MenuPreviewWidget badges', () => {

    it('collects badges from the menu badge outlet with the preview context once a menu is parsed', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        const badge: PreviewBadge = { kind: 'pill', text: 'Vitals 14/17', tone: 'good', tooltipMarkdown: 'Core Vitals' };
        const calls: Array<{ menuPath: MenuPath; context: object; element: HTMLElement | undefined }> = [];
        harness.internals.outlets.collectBadges = async (menuPath, context, element) => {
            calls.push({ menuPath, context, element });
            return [badge];
        };

        await harness.open(MENU_URI);
        await until(() => harness.internals.badgeController.badges.length > 0);

        expect(calls).to.have.lengthOf(1);
        expect(calls[0].menuPath).to.deep.equal(CooklangOutlets.MENU_PREVIEW_BADGE);
        expect(calls[0].context).to.deep.equal({ version: 1, uri: MENU_URI.toString(), path: 'plans/week.menu', scale: 1 });
        expect(calls[0].element).to.equal(harness.widget.node);
        expect(harness.markup()).to.contain('Vitals 14/17');
    });

    it('re-queries badges when the scale or the subscription changes', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        const contexts: Array<{ scale: number }> = [];
        harness.internals.outlets.collectBadges = async (_menuPath, context) => {
            contexts.push(context as { scale: number });
            return [];
        };
        await harness.open(MENU_URI);
        await until(() => contexts.length === 1);

        harness.internals.handleScaleChange(2);
        await until(() => contexts.length === 2);
        expect(contexts[1].scale).to.equal(2);

        harness.subscriptionChanged.fire();
        await until(() => contexts.length === 3);
    });

    it('forgets badges when re-bound to another menu', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        harness.internals.outlets.collectBadges = async () => [{ kind: 'pill', text: 'old', tone: 'neutral', tooltipMarkdown: '' }];
        await harness.open(MENU_URI);
        await until(() => harness.internals.badgeController.badges.length > 0);

        harness.internals.outlets.collectBadges = async () => [];
        harness.widget.setUri(new URI('file:///ws/plans/other.menu'));
        expect(harness.internals.badgeController.badges).to.deep.equal([]);
    });

    it('cancels its own hover on dispose only', async () => {
        const harness = new MenuHarness();
        await harness.open(MENU_URI);
        harness.widget.dispose();
        expect(harness.hoverCancelCount).to.equal(0);
    });
});
```

- [ ] **Step 2: Compile to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: the spec compiles against `MenuInternals` casts (no type error), but running it fails: `cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/menu-preview-widget.spec.js` → `TypeError: Cannot read properties of undefined (reading 'debounceMs')`.

- [ ] **Step 3: Wire the controller into the widget**

In `packages/cooklang/src/browser/menu-preview-widget.tsx`:

Imports — add:

```ts
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { PreviewBadgeController } from './preview-badge-controller';
```

(`PreviewBadge` is used by the two handler signatures below; `MenuRecipeOutletInfo, PreviewOutletContext` stay.)

Injections — after `outlets`:

```ts
    @inject(HoverService)
    protected readonly hoverService: HoverService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;
```

Fields — after `parseSequence = 0;`:

```ts
    /** Created in `init`, once `outlets` and `hoverService` are injected. */
    protected badgeController: PreviewBadgeController;
```

`init()` — replace `this.toDispose.push(this.outlets.onDidChange(() => this.update()));` with:

```ts
        this.badgeController = new PreviewBadgeController(this.outlets, this.hoverService, {
            outlet: CooklangOutlets.MENU_PREVIEW_BADGE,
            element: this.node,
            context: () => this.menuResult ? this.previewContext() : undefined,
            isVisible: () => this.isVisible,
            onDidChangeBadges: () => this.update(),
        });
        this.toDispose.push(this.badgeController);
        this.toDispose.push(this.outlets.onDidChange(() => {
            this.update();
            this.badgeController.schedule();
        }));
        this.toDispose.push(this.subscriptions.onDidChangeSubscription(() => this.badgeController.schedule()));
```

Lifecycle — after `onActivateRequest`, add:

```ts
    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.badgeController.flushStale();
    }

    /** See `RecipePreviewWidget.onAfterAttach`: the first tab in an empty area gets no `after-show`. */
    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.badgeController.flushStale();
    }

    protected override onBeforeHide(msg: Message): void {
        super.onBeforeHide(msg);
        this.badgeController.hideHover();
    }
```

`setUri` — after `this.id = createMenuPreviewWidgetId(uri);` insert:

```ts
        // A reused widget must not keep showing a previous menu's badges, nor
        // let a badge refresh for the old menu land after this switch.
        this.badgeController.reset();
```

`parseContent` — in the success path, after `this.update();` add `this.badgeController.schedule();`; in the two failure paths (`menuResult = undefined`), add `this.badgeController.reset();` before `this.update();`.

`handleScaleChange` — add `this.badgeController.schedule();` after `this.parseCurrentContent();` (the parse also schedules on success; the controller coalesces both).

Handlers — after `handleNavigateToRecipe`, add:

```ts
    protected handleShowBadgeDetails = (badge: PreviewBadge, target: HTMLElement, immediate: boolean): void => {
        this.badgeController.showDetails(badge, target, immediate);
    };

    protected handleHideBadgeDetails = (): void => {
        this.badgeController.hideDetails();
    };
```

`render()` — pass to `MenuView`, after `onNavigateToRecipe={…}`:

```tsx
                    badges={this.badgeController.badges}
                    onShowBadgeDetails={this.handleShowBadgeDetails}
                    onHideBadgeDetails={this.handleHideBadgeDetails}
```

`getItems` for the toolbar should also see the element, matching the recipe preview: change `this.outlets.getItems(CooklangOutlets.MENU_PREVIEW_TOOLBAR, context)` to `this.outlets.getItems(CooklangOutlets.MENU_PREVIEW_TOOLBAR, context, this.node)` and `this.outlets.run(CooklangOutlets.MENU_PREVIEW_TOOLBAR, id, context)` to `this.outlets.run(CooklangOutlets.MENU_PREVIEW_TOOLBAR, id, context, this.node)`.

- [ ] **Step 4: Compile and run the menu specs**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/menu-preview-widget.spec.js lib/browser/menu-preview-components.spec.js; cd ../..`
Expected: `7 passing`.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/menu-preview-widget.tsx packages/cooklang/src/browser/menu-preview-widget.spec.ts
git commit -m "feat(cooklang): badges on the menu preview (cooklang/menuPreview/badge)"
```

---

### Task 6: `cooklang.api.openReport`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`:

Add to the `Fixture` class fields (after `refreshes = 0;`):

```ts
    shown: ReportWidgetOptions[] = [];
```

and the import (after the `URI` import):

```ts
import { ReportWidgetOptions } from './report-widget-types';
```

In `create()`, extend the `reportConfigService` stub with a `buildConfigJson` and add a `reportPresenter` stub. Replace the existing `(contribution as any).reportConfigService = { … };` block with:

```ts
        (contribution as any).reportConfigService = {
            resolveWorkspaceUri: (arg: string) => {
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) { return new URI(arg).normalizePath(); }
                return this.root ? this.root.resolve(arg).normalizePath() : undefined;
            },
            buildConfigJson: async (scale: number, uri?: URI) => JSON.stringify({ scale, uri: uri?.toString() }),
        };
        (contribution as any).reportPresenter = {
            show: async (options: ReportWidgetOptions) => { this.shown.push(options); },
        };
```

Append a new describe block at the end of the file:

```ts
describe('CooklangPluginApiContribution — openReport', () => {
    const { OPEN_REPORT } = CooklangPluginApi.Commands;

    it('opens a report tab with the inline template, defaulting to markdown at scale 1', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(OPEN_REPORT, { uri: 'file:///ws/week.menu', template: '{{ 1 }}', label: 'Core Vitals' })).to.equal(undefined);
        expect(fixture.shown).to.deep.equal([{
            uri: 'file:///ws/week.menu',
            templateId: 'inline:plugin:Core Vitals',
            templateLabel: 'Core Vitals',
            inlineTemplateContent: '{{ 1 }}',
            outputFormat: 'markdown',
            configJson: JSON.stringify({ scale: 1, uri: 'file:///ws/week.menu' }),
        }]);
    });

    it('passes outputFormat and scale through, for any recipe or menu scheme', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(OPEN_REPORT, { uri: 'cooklang-hub:/x/Soup.cook', template: '<b>x</b>', label: 'Vitals', outputFormat: 'html', scale: 2 });
        expect(fixture.shown[0].outputFormat).to.equal('html');
        expect(fixture.shown[0].configJson).to.equal(JSON.stringify({ scale: 2, uri: 'cooklang-hub:/x/Soup.cook' }));
    });

    it('rejects bad URIs, templates, labels, formats and scales', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            { uri: 'file:///ws/notes.md', template: '{{ 1 }}', label: 'x' },
            { uri: 'a.cook', template: '{{ 1 }}', label: 'x' },
            { uri: 'file:///ws/a.cook', template: '', label: 'x' },
            { uri: 'file:///ws/a.cook', template: 'x'.repeat(64 * 1024 + 1), label: 'x' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: '  ' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x'.repeat(61) },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'a\u0000b' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x', outputFormat: 'pdf' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', label: 'x', scale: 0 },
        ]) {
            expect(await fixture.error(OPEN_REPORT, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.shown).to.deep.equal([]);
    });
});
```

- [ ] **Step 2: Compile to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: error `Property 'OPEN_REPORT' does not exist on type …Commands`.

- [ ] **Step 3: Implement the command**

In `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`:

Imports — add after the `PluginReportService` import:

```ts
import { ReportPresenter } from './report-presenter';
import { ReportOutputFormat } from '../common/report-templates';
```

`Commands` — after the `REFRESH_BADGES` entry add:

```ts
        /**
         * `{ uri, template, label, outputFormat?, scale? }` → `undefined`: opens a report tab
         * rendering `template` (same limits as {@link RENDER_REPORT}) against the `.cook` or
         * `.menu` at `uri`, titled `label` (≤ {@link MAX_REPORT_LABEL_LENGTH} characters, no
         * control characters). `outputFormat` is `markdown` (default), `html` or `text`;
         * `scale` defaults to 1. Calling it again with the same `uri` and `label` focuses the
         * existing tab. The tab re-renders on edits and exports like any other report.
         */
        OPEN_REPORT: 'cooklang.api.openReport',
```

After `MAX_TEMPLATE_LENGTH` add:

```ts
    /** Maximum `cooklang.api.openReport` label length, in characters. */
    export const MAX_REPORT_LABEL_LENGTH = 60;
```

Injection — after `outlets`:

```ts
    @inject(ReportPresenter)
    protected readonly reportPresenter: ReportPresenter;
```

`registerCommands` — after the `REFRESH_BADGES` registration:

```ts
        registry.registerCommand({ id: Commands.OPEN_REPORT }, { execute: (args: unknown) => this.openReport(args) });
```

Method — after `renderReport(...)`:

```ts
    protected async openReport(args: unknown): Promise<void> {
        const request = this.object(args);
        const raw = this.string(request.uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !(CooklangUri.isRecipe(uri) || CooklangUri.isMenu(uri))) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe or .menu file.');
        }
        const template = this.text(request.template, '`template`');
        if (template.trim() === '' || template.length > CooklangPluginApi.MAX_TEMPLATE_LENGTH) {
            throw this.invalid(`\`template\` must be non-empty and at most ${CooklangPluginApi.MAX_TEMPLATE_LENGTH} characters.`);
        }
        const label = this.string(request.label, '`label`');
        if (label.length > CooklangPluginApi.MAX_REPORT_LABEL_LENGTH) {
            throw this.invalid(`\`label\` must be at most ${CooklangPluginApi.MAX_REPORT_LABEL_LENGTH} characters.`);
        }
        const outputFormat = request.outputFormat === undefined ? 'markdown' : request.outputFormat;
        if (outputFormat !== 'markdown' && outputFormat !== 'html' && outputFormat !== 'text') {
            throw this.invalid('`outputFormat` must be "markdown", "html" or "text".');
        }
        const scale = request.scale === undefined ? 1 : request.scale;
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
            throw this.invalid('`scale` must be a positive number.');
        }
        await this.reportPresenter.show({
            uri: uri.toString(),
            templateId: `inline:plugin:${label}`,
            templateLabel: label,
            inlineTemplateContent: template,
            outputFormat: outputFormat as ReportOutputFormat,
            configJson: await this.reportConfigService.buildConfigJson(scale, uri),
        });
    }
```

(`this.string` already trims and rejects empty strings and control characters, so the `'  '` and `'a\u0000b'` cases fail there.)

- [ ] **Step 4: Compile and run the spec**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js; cd ../..`
Expected: all passing, including the three new `openReport` tests and the first test (`registers every API command without a label`), which now covers `OPEN_REPORT` automatically.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.openReport opens a report tab from a plugin template"
```

---

### Task 7: Whole-package verification and bundle

- [ ] **Step 1: Run every cooklang spec**

Run: `cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test; cd ../..`
Expected: `0 failing`.

- [ ] **Step 2: Lint the package**

Run: `npx lerna run lint --scope @theia/cooklang`
Expected: exit 0.

- [ ] **Step 3: Bundle the app so the plugin plan can run end to end**

Run: `cd app && npm run bundle; cd ..`
Expected: exit 0 (webpack reports no errors).

- [ ] **Step 4: Smoke in the running app**

Run: `npm run start:electron` and open a workspace with a `.menu` file. Confirm the menu preview still renders with its toolbar, and that no console error mentions `badgeController` or `HoverService`. Close the app.

- [ ] **Step 5: Hand off**

The branch is complete when Steps 1–4 pass. Use `superpowers:finishing-a-development-branch` to open a PR titled `feat(cooklang): menu preview badges and cooklang.api.openReport for the Core Vitals plugin`. The plugin plan (`~/Cooklang/plugins/docs/superpowers/plans/2026-10-08-core-vitals-plugin.md`) depends on this branch being built in the editor checkout used for `npm run deploy`.
