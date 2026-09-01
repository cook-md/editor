# Recipe preview: clickable URLs and working timers

Design for [issue #95](https://github.com/cook-md/editor/issues/95).

Date: 2026-09-01

## Problem

The recipe preview was built on the assumption that people read recipes in the
editor but cook from the mobile app. A trialing user wants to cook directly from
the editor, and hit two gaps:

- URLs in metadata and step text render as plain, unclickable text.
- `~timer` values render as a static highlighted badge — they look like timers
  but do nothing.

## Goals

- Every URL in the rendered recipe is clickable and opens in the system browser.
- Every `~timer` with a numeric duration can be started from the step it appears
  in, counts down in place, and keeps running while you navigate away.
- A Timers panel lists all started timers across recipes, with a link back to the
  recipe each one came from — at the scale that recipe was at when the timer
  started.
- When a timer finishes you get an OS notification and a sound, even if the
  editor is in the background.

## Non-goals

- Quick/custom timers not bound to a recipe step (the iOS app has these).
- LLM-generated timer labels (iOS `TimerNameHelper`).
- Lock-screen / Live Activity / tray-icon equivalents.
- Changing how timers are parsed or scaled — the existing `scaleRecipe`
  behaviour is kept as-is.

## Reference implementation

The iOS app (`../mobile-app-ios`) already solves this, and this design is a
deliberate port of its model so the two apps behave the same:

| iOS | Here |
| --- | --- |
| `Packages/Timers/.../Models/ActiveTimer.swift` | `common/cooking-timer.ts` |
| `Packages/Timers/.../Core/TimerManager.swift` | `browser/cooking-timer-service.ts` |
| `Packages/Timers/.../Core/TimerStorage.swift` | persistence inside the same service |
| `Packages/Timers/.../DurationFormatter.swift` | `common/timer-duration.ts` |
| `extractTimers` in `RecipesProvider.swift` | `timerDurationSeconds` in `common/timer-duration.ts` |
| `Presentation/Views/TimerCellView.swift` | `browser/timer-components.tsx` (`TimerRow`) |
| `Presentation/Views/TimersView.swift` | `browser/timers-widget.tsx` |

User-facing behaviour reference: <https://cook.md/help/ios/using-the-app>
(multiple simultaneous timers, play/pause, stop, `+1 minute`, notification with
sound when the app is backgrounded).

## Architecture

### 1. Pure core — `packages/cooklang/src/common/`

No dependency injection, no Monaco imports, no React. These are the pieces that
get real unit tests; keeping them Monaco-free is required, otherwise the browser
spec harness dies with the `.css` ESM error (see
`feedback_spec_monaco_css_harness`).

#### `cooking-timer.ts`

```ts
export type TimerState = 'running' | 'paused' | 'finished';

export interface TimerRecipeRef {
    /** URI string of the .cook file. */
    recipePath: string;
    /** Display name, for the panel row. */
    recipeName: string;
    /** Index of the step across the whole recipe, 0-based. */
    globalStepIndex: number;
    /** Index of this timer among the timers of that step, 0-based. */
    timerPosition: number;
    /** Recipe scale factor in force when the timer was started. */
    scale: number;
}

export interface ActiveTimer {
    id: string;
    title: string;
    durationSeconds: number;
    state: TimerState;
    startedAtMs?: number;
    pausedRemainingSeconds?: number;
    recipeRef?: TimerRecipeRef;
    updatedAtMs: number;
}
```

iOS's `idle` state is deliberately dropped: a record only exists once the timer
has been started, because the panel lists started timers only (see decisions).

Pure transition functions, each taking `nowMs` so tests use a fake clock:
`createAndStart`, `pause`, `resume`, `reset`, `restart`, `finish`, `addTime`,
plus `remainingSeconds(timer, nowMs)`, `isExpired(timer, nowMs)` and
`fireAtMs(timer)`.

`resume` follows the iOS trick of back-dating `startedAtMs` by the elapsed
portion, so `remainingSeconds` stays a pure function of the clock and never
drifts across pause/resume cycles.

#### `timer-duration.ts`

`timerDurationSeconds(timer: Timer): number | undefined` — the port of iOS
`extractTimers` + `Value.toSeconds`:

- Unit is matched on its **first character**: `s` → seconds, `m` → minutes,
  `h` → hours, `d` → days. (iOS supports s/m/h; `d` is added here for
  fermentation and proving times.)
- `number` → value × multiplier, keeping fractions (`1.5 hours` → 5400).
- `range` → the **start** value.
- `text` → the first number parsed out of it. The parser returns
  `~{50-60%minutes}` as the text `"50-60"`, which must yield 3000.
- No unit, or no quantity → `undefined`. Such timers (`~{until golden}`, or a
  bare named `~sauce`) are **not startable** and keep rendering exactly as they
  do today.

`formatClock(seconds)` → `07:42`, `01:05:30`, `4d 08:05:30` (hours only when
non-zero, days only at ≥ 24h). `formatDuration(seconds)` → `10 min`,
`1 hour 5 min`.

#### `recipe-links.ts`

`linkify(text: string): Array<TextToken | LinkToken>` — a pure tokenizer over a
run of text, recognising `http(s)://…`, `www.…` (linked as `https://…`),
`mailto:…` and bare email addresses. Trailing sentence punctuation is trimmed
off the match and unbalanced closing parens are excluded, so `(see
https://example.com/x).` links only `https://example.com/x`.

### 2. `CookingTimerService` — `browser/cooking-timer-service.ts`

An `@injectable()` singleton, the port of `TimerManager` + `TimerStorage`.

- State: `Map<string, ActiveTimer>`.
- Events: `onDidChangeTimers: Event<void>`, `onDidFinishTimer: Event<ActiveTimer>`.
- Query: `list()`, `get(id)`, `find(ref)` — matching on `recipePath` +
  `globalStepIndex` + `timerPosition` only, ignoring `scale`, so re-scaling the
  preview still finds the running timer.
- Commands: `start(ref, title, durationSeconds)`, `pause`, `resume`, `toggle`,
  `reset`, `restart`, `addTime(id, seconds)`, `remove`, `removeFinished`,
  `removeAll`.
- One shared 1s tick drives both expiry detection and countdown re-renders. It
  is started when the first timer starts running and **stopped when none are
  running**, so an idle window has no permanent interval.
- Persistence: Theia's `StorageService` under key `cooklang.timers`. That
  service is workspace-scoped, so timers do not leak between workspaces; the
  stored `recipePath` is still the full absolute URI string. The stored shape
  is the `ActiveTimer[]` JSON directly, written on every mutation — mutations
  are user-driven plus one write per expiry, so there is nothing to debounce.
- Restore validates every record and drops the ones it cannot run, rather than
  trusting what storage returns. Persisted timers outlive the build that wrote
  them, and an unvalidated record with a non-finite duration would produce a
  timer that never expires and a tick interval that never stops.
- Restore: remaining time is recomputed from `startedAtMs + durationSeconds`, so
  a timer that expired while the app was closed comes back as `finished`
  **without replaying the alarm**. The 20-most-recent cleanup rule from
  `TimerManager.cleanupOldTimers` is kept.
- The load is kicked off from a **synchronous** `@postConstruct` that calls an
  async helper without awaiting. `@postConstruct` must never be `async` —
  Inversify 6.2.2 breaks sync DI and the frontend fails to start (see
  `feedback_async_postconstruct`).

### 3. Alarm — `browser/timer-alarm-service.ts`

A `FrontendApplicationContribution` that subscribes to `onDidFinishTimer`:

- **Notification**: reuses the existing `OSNotificationService` from
  `@theia/ai-core/lib/browser/os-notification-service`. `@theia/ai-core` is
  already a dependency of `@theia/cooklang` and already binds the service in
  singleton scope, so nothing new is wired up. Title = timer title, body =
  recipe name, `requireInteraction: true`; clicking reveals the Timers view.
  Permission is requested the first time a timer is started, not at startup.
- **Sound**: a bell chime synthesized with the Web Audio API — sine strikes with
  an exponential decay envelope, three of them. It is synthesized rather than
  shipped as `ShortBell.wav` because the generated webpack config has no audio
  asset rule (`dev-packages/application-manager/src/generator/webpack-generator.ts`
  handles `jpg|png|gif|svg|woff|wasm|plist` only), and adding one means editing
  an upstream file. Swapping in the real iOS bell later is a one-line rule
  addition.

Both are gated on new preferences in `common/cooklang-preferences.ts`:

- `cooklang.timers.sound` — boolean, default `true`.
- `cooklang.timers.notifications` — boolean, default `true`.

### 4. Inline timers in the preview

`recipe-preview-components.tsx` stays presentational: no service imports, no DI.
The widget supplies a `TimerBinding` through a new React context:

```ts
export interface TimerBinding {
    find(ref: TimerRecipeRef): ActiveTimer | undefined;
    start(ref: TimerRecipeRef, title: string, durationSeconds: number): void;
    toggle(id: string): void;
    reset(id: string): void;
    addTime(id: string, seconds: number): void;
}
```

`StepItemView`'s `case 'timer'` renders a `TimerBadge` when the context provides
a binding, and otherwise falls back to today's static
`<span className='timer-badge'>`. That fallback is what keeps the existing
`renderToStaticMarkup` spec (`recipe-preview-components.spec.ts`) working
untouched.

Badge states:

| State | Rendering |
| --- | --- |
| not started | `⏱ 10 min`, clickable, `timer-badge timer-badge-idle` |
| running | `⏱ 07:42` + pause affordance |
| paused | dimmed, resume + reset affordances |
| finished | highlighted `00:00`, restart affordance |
| not startable | exactly today's static badge |

Countdown re-renders are driven by the service's shared tick calling the
widget's `update()` — no per-badge `setInterval`.

Timer identity is iOS's triple: `recipePath` + `globalStepIndex` +
`timerPosition`. `globalStepIndex` is already tracked by `InstructionsPanel` for
step images; `timerPosition` is the nth timer item within the step, computed in
`SectionContentView`.

### 5. Scale

`scale` moves out of `RecipeView`'s local `useState` and up into
`RecipePreviewWidget` (a `protected scale` field plus `setScale(n)` that calls
`update()`), passed back down as a controlled prop with an `onScaleChange`
callback. That makes the scale settable from outside the React tree.

Each timer records the scale in force when it was started, in
`TimerRecipeRef.scale`. A new command `cooklang.openPreviewAtScale(uri, scale)`
in `recipe-preview-contribution.ts` reuses the existing `getOrCreatePreview` +
`shell.addWidget` + `activateWidget` path, calling `setScale` before the widget
is revealed so no stale scale is ever painted. The panel's
recipe link invokes that command.

Timer durations already reflect scaling: `scaleRecipe` scales `timers[].quantity`
whenever the parser marks the quantity scalable, so the badge shows — and the
started timer uses — the scaled duration. No change needed.

### 6. Timers panel

`browser/timers-widget.tsx` (`TimersWidget extends ReactWidget`) plus
`browser/timers-view-contribution.ts` (`AbstractViewContribution`), docked with
`area: 'right'` — the same area as the Shopping List view, id `cooklang-timers`,
icon `codicon-watch`, toggled by `cooklang.timers.toggle`.

Rows are sorted running (soonest to fire first) → paused → finished. Each row is
a port of `TimerCellView`: large monospace countdown, timer title, recipe name
rendered as a link, a progress indicator, and the controls the iOS help page
documents — `+1 min`, play/pause, reset, delete. A header row inside the panel
carries "Clear finished" and "Clear all"; the latter asks for confirmation when
a timer is still running, since that one represents something actually cooking.

Empty state: a short line pointing at the inline badges — "No timers yet. Click a
time in a recipe step to start one."

### 7. URLs

`linkify` is applied in four places in `recipe-preview-components.tsx`:

- `MetadataPills` — pill values (this is where `source:` URLs live).
- `StepItemView` `case 'text'` — step body text.
- The `note-item` block.
- The `recipe-description` paragraph. `description` is a metadata value too; it
  is only rendered apart from the pills because `SKIP_META_KEYS` excludes it,
  and it is a natural place to paste the URL a recipe was adapted from.

Matches render as `<a className='recipe-link' href={href}>` whose `onClick`
prevents default and calls an `openExternal(url)` callback supplied by the
widget, which delegates to `WindowService.openNewWindow(url, { external: true })`
— the same path already used by `cooklang-account` and the branding chat widget.
When no callback is supplied (specs), the anchor renders with its `href` and no
handler, so the components stay pure.

## Decisions

These were settled during brainstorming and are recorded so the plan does not
relitigate them:

- **Both inline and panel.** Inline countdown in the step, plus a side panel of
  all timers. Not either/or.
- **Panel lists started timers only** — across all recipes, in running, paused
  and finished states. It does not list not-yet-started timers of the open
  recipe (iOS's merged `RecipeTimerItem` list), which keeps panel state simple.
- **Full persistence.** Timers survive closing the preview, reloading, and
  restarting the app, with expiry recomputed on restore.
- **OS notification + sound** on completion. No in-app toast; the visual state
  change in badge and panel covers the foreground case.
- **URLs in both metadata and step text**, opened in the system browser rather
  than the mini-browser.
- **Right dock area** for the panel, matching Shopping List.

## Testing

New specs, all Monaco-free:

- `common/cooking-timer.spec.ts` — state machine: pause/resume with no drift
  across repeated cycles, `addTime` in each state, expiry boundary, `reset` and
  `restart`.
- `common/timer-duration.spec.ts` — unit first-char matching for s/m/h/d,
  fractional hours, range → start value, text `"50-60"` → 3000, missing
  unit/quantity → `undefined`; clock and duration formatting including the days
  form.
- `common/recipe-links.spec.ts` — plain text passthrough, bare and `www` URLs,
  mailto and bare email, trailing punctuation, parens, multiple links in one
  run, and text that merely contains a colon.
- `browser/cooking-timer-service.spec.ts` — fake clock plus an in-memory
  `StorageService` double: start → persist → restore, a timer that expired while
  "closed" restores as finished without firing `onDidFinishTimer`, the 20-timer
  cap evicts oldest by `updatedAtMs`, and the tick stops when no timer runs.
- `browser/timer-components.spec.ts` — `renderToStaticMarkup` of the badge in
  each state and of a panel row.

The existing `recipe-preview-components.spec.ts` must keep passing unchanged;
that is the regression check on the presentational fallback path.

Manual verification: `npm run start:electron`, start a short timer, background
the window, confirm the OS notification and chime; reload the window mid-timer
and confirm the countdown resumes correctly; click a recipe link in the panel
and confirm the preview opens at the recorded scale.

Note that mocha needs the Node 22 at `~/.local/node-v22.23.2-darwin-x64/bin`;
the default `node` on this machine is 20.
