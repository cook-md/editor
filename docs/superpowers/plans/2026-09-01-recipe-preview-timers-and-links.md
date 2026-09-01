# Recipe Preview Timers and Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make URLs in the recipe preview clickable and make `~timer` values runnable — inline countdowns in the step plus a Timers side panel that survives restarts and links back to each recipe at the scale it was started at.

**Architecture:** Pure, DI-free, Monaco-free modules in `packages/cooklang/src/common/` hold the timer state machine, duration parsing and URL tokenizer. A `CookingTimerService` singleton in `src/browser/` owns all live timers, persists them through Theia's `StorageService`, and drives a single 1s tick. Presentational React lives in `timer-components.tsx` and reaches the service through a React context supplied by `RecipePreviewWidget`, so `recipe-preview-components.tsx` stays free of services and its existing spec keeps passing. This is a port of the iOS app's `Packages/Timers` (`ActiveTimer`, `TimerManager`, `TimerStorage`, `DurationFormatter`, `TimerCellView`).

**Tech Stack:** TypeScript 5.4 (strict), React 18, InversifyJS property injection, Eclipse Theia 1.70 (`ReactWidget`, `AbstractViewContribution`, `StorageService`, `WindowService`), `OSNotificationService` from `@theia/ai-core`, Web Audio API, mocha + chai against compiled `lib/**/*.spec.js`.

**Spec:** `docs/superpowers/specs/2026-09-01-recipe-preview-timers-and-links-design.md`

---

## Before you start

Everything below runs from the repo root `/Users/alexeydubovskoy/Cooklang/editor` on branch `feature/preview-timers-and-links`.

**The default `node` on this machine is v20, and mocha needs v22.** Every shell that runs tests must start with:

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
node -v   # must print v22.23.2
```

Tests run against **compiled JavaScript**, not TypeScript. The loop is always:

```bash
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/<path>/<name>.spec.js" && cd ../..
```

To run every spec in the package: `npx lerna run test --scope @theia/cooklang`.

**House style** (from `doc/coding-guidelines.md`): 4-space indent, single quotes, `undefined` never `null`, explicit return types on every function including local helpers, arrow functions, kebab-case file names, PascalCase types. Every new file starts with the 12-line license header — copy it verbatim from the top of `packages/cooklang/src/common/recipe-types.ts`. In this plan that header is written as `<LICENSE HEADER>`; replace it with the real thing.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/cooklang/src/common/timer-duration.ts` | Cooklang `Timer` → seconds; clock and duration formatting |
| `packages/cooklang/src/common/timer-duration.spec.ts` | Tests for the above |
| `packages/cooklang/src/common/cooking-timer.ts` | `ActiveTimer` type + pure state transitions |
| `packages/cooklang/src/common/cooking-timer.spec.ts` | Tests for the above |
| `packages/cooklang/src/common/recipe-links.ts` | `linkify(text)` URL tokenizer |
| `packages/cooklang/src/common/recipe-links.spec.ts` | Tests for the above |
| `packages/cooklang/src/browser/cooking-timer-service.ts` | Singleton owning live timers, tick, persistence |
| `packages/cooklang/src/browser/cooking-timer-service.spec.ts` | Tests with a fake clock and in-memory storage |
| `packages/cooklang/src/browser/timer-chime.ts` | Web Audio bell |
| `packages/cooklang/src/browser/timer-alarm-service.ts` | Notification + sound on timer completion |
| `packages/cooklang/src/browser/timer-components.tsx` | `TimerBinding` context, `TimerBadge`, `TimerRow` |
| `packages/cooklang/src/browser/timer-components.spec.ts` | Static-markup tests for badge and row |
| `packages/cooklang/src/browser/timers-widget.tsx` | The Timers panel `ReactWidget` |
| `packages/cooklang/src/browser/timers-view-contribution.ts` | View registration, toggle command |
| `packages/cooklang/src/browser/style/timers.css` | Panel styling |

**Modified:**

| File | Change |
| --- | --- |
| `packages/cooklang/src/browser/recipe-preview-components.tsx` | Linkified text, `TimerBadge` in `StepItemView`, `scale` becomes a controlled prop |
| `packages/cooklang/src/browser/recipe-preview-widget.tsx` | Supplies the timer binding and link opener, owns `scale`, exposes `setScale` |
| `packages/cooklang/src/browser/recipe-preview-contribution.ts` | New `cooklang.openPreviewAtScale` command |
| `packages/cooklang/src/browser/cooklang-frontend-module.ts` | Bindings for the new services, widget and view |
| `packages/cooklang/src/common/cooklang-preferences.ts` | `cooklang.timers.sound`, `cooklang.timers.notifications` |
| `packages/cooklang/src/browser/style/recipe-preview.css` | Timer badge states, `.recipe-link` |

---

## Task 1: Timer duration parsing and formatting

Port of iOS `Value.toSeconds` (`CooklangApp/Presentation/Scenes/Base/ViewModel/Providers/RecipesProvider.swift`) and `DurationFormatter.swift`.

**Files:**
- Create: `packages/cooklang/src/common/timer-duration.ts`
- Test: `packages/cooklang/src/common/timer-duration.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/common/timer-duration.spec.ts`:

```ts
<LICENSE HEADER>

/* eslint-disable no-null/no-null */

import { expect } from 'chai';
import { Timer } from './recipe-types';
import { timerDurationSeconds, formatClock, formatDuration } from './timer-duration';

/** A timer with a plain numeric quantity, e.g. `~name{value%unit}`. */
function numberTimer(value: number, unit: string | null, name: string | null = null): Timer {
    return {
        name,
        quantity: {
            value: { type: 'number', value: { type: 'regular', value } },
            unit,
            scalable: true,
        },
    };
}

describe('timerDurationSeconds', () => {

    it('reads the unit from its first character', () => {
        expect(timerDurationSeconds(numberTimer(30, 'seconds'))).to.equal(30);
        expect(timerDurationSeconds(numberTimer(10, 'minutes'))).to.equal(600);
        expect(timerDurationSeconds(numberTimer(2, 'hours'))).to.equal(7200);
        expect(timerDurationSeconds(numberTimer(3, 'days'))).to.equal(259200);
    });

    it('accepts abbreviated and capitalised units', () => {
        expect(timerDurationSeconds(numberTimer(10, 'min'))).to.equal(600);
        expect(timerDurationSeconds(numberTimer(10, 'M'))).to.equal(600);
        expect(timerDurationSeconds(numberTimer(1, 'hr'))).to.equal(3600);
    });

    it('keeps fractional values', () => {
        expect(timerDurationSeconds(numberTimer(1.5, 'hours'))).to.equal(5400);
    });

    it('resolves fractions', () => {
        const timer: Timer = {
            name: null,
            quantity: {
                value: { type: 'number', value: { type: 'fraction', value: { whole: 1, num: 1, den: 2, err: 0 } } },
                unit: 'hours',
                scalable: true,
            },
        };
        expect(timerDurationSeconds(timer)).to.equal(5400);
    });

    it('uses the start of a range', () => {
        const timer: Timer = {
            name: null,
            quantity: {
                value: {
                    type: 'range',
                    value: {
                        start: { type: 'regular', value: 50 },
                        end: { type: 'regular', value: 60 },
                    },
                },
                unit: 'minutes',
                scalable: true,
            },
        };
        expect(timerDurationSeconds(timer)).to.equal(3000);
    });

    it('uses the first number of a text quantity, which is how the parser returns ranges', () => {
        const timer: Timer = {
            name: null,
            quantity: { value: { type: 'text', value: '50-60' }, unit: 'minutes', scalable: false },
        };
        expect(timerDurationSeconds(timer)).to.equal(3000);
    });

    it('returns undefined when the timer cannot be run', () => {
        // ~{until golden}: text quantity, no unit
        expect(timerDurationSeconds({
            name: null,
            quantity: { value: { type: 'text', value: 'until golden' }, unit: null, scalable: false },
        })).to.equal(undefined);
        // ~sauce: a name and nothing else
        expect(timerDurationSeconds({ name: 'sauce', quantity: null })).to.equal(undefined);
        // an unrecognised unit
        expect(timerDurationSeconds(numberTimer(10, 'cups'))).to.equal(undefined);
        // a zero or negative duration is not a timer
        expect(timerDurationSeconds(numberTimer(0, 'minutes'))).to.equal(undefined);
    });
});

describe('formatClock', () => {

    it('shows minutes and seconds by default', () => {
        expect(formatClock(0)).to.equal('00:00');
        expect(formatClock(62)).to.equal('01:02');
        expect(formatClock(600)).to.equal('10:00');
    });

    it('adds hours only when there are hours', () => {
        expect(formatClock(3930)).to.equal('01:05:30');
    });

    it('adds days at 24 hours and above', () => {
        expect(formatClock(4 * 86400 + 8 * 3600 + 5 * 60 + 30)).to.equal('4d 08:05:30');
    });

    it('rounds up, so a countdown never shows a value it has not reached', () => {
        expect(formatClock(0.2)).to.equal('00:01');
    });

    it('clamps negatives to zero', () => {
        expect(formatClock(-5)).to.equal('00:00');
    });
});

describe('formatDuration', () => {

    it('renders the largest units first and skips empty ones', () => {
        expect(formatDuration(600)).to.equal('10 min');
        expect(formatDuration(330)).to.equal('5 min 30 sec');
        expect(formatDuration(3900)).to.equal('1 hour 5 min');
        expect(formatDuration(4 * 86400 + 8 * 3600)).to.equal('4 day 8 hour');
    });

    it('renders zero explicitly', () => {
        expect(formatDuration(0)).to.equal('0 sec');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Cannot find module './timer-duration'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/common/timer-duration.ts`:

```ts
<LICENSE HEADER>

/* eslint-disable no-null/no-null */

import { NumberValue, Quantity, QuantityValue, Timer } from './recipe-types';

/**
 * Seconds per unit, keyed by the unit's first character. This mirrors the iOS
 * app's `CookingTimerUnit`, which also matches on the first character so that
 * `m`, `min` and `minutes` all mean the same thing.
 */
const UNIT_SECONDS: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
};

function unitSeconds(unit: string | null): number | undefined {
    if (!unit) {
        return undefined;
    }
    const first = unit.trim().charAt(0).toLowerCase();
    return UNIT_SECONDS[first];
}

function numberValueToNumber(value: NumberValue): number {
    switch (value.type) {
        case 'regular':
            return value.value;
        case 'fraction': {
            const { whole, num, den } = value.value;
            return den === 0 ? whole : whole + num / den;
        }
    }
}

/**
 * The first number in `text`. The parser hands ranges written as
 * `~{50-60%minutes}` back as the text `'50-60'`, and the iOS app takes the
 * first value; we do the same so both apps start the same timer.
 */
function firstNumberInText(text: string): number | undefined {
    const match = /\d+(?:\.\d+)?/.exec(text);
    return match ? parseFloat(match[0]) : undefined;
}

function quantityValueToNumber(value: QuantityValue): number | undefined {
    switch (value.type) {
        case 'number':
            return numberValueToNumber(value.value);
        case 'range':
            return numberValueToNumber(value.value.start);
        case 'text':
            return firstNumberInText(value.value);
    }
}

/**
 * The runnable duration of `quantity` in whole seconds, or `undefined` when it
 * does not describe a duration (no unit, no number, or a non-time unit).
 */
export function quantityDurationSeconds(quantity: Quantity | null): number | undefined {
    if (quantity === null || quantity === undefined) {
        return undefined;
    }
    const multiplier = unitSeconds(quantity.unit);
    if (multiplier === undefined) {
        return undefined;
    }
    const value = quantityValueToNumber(quantity.value);
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    return Math.round(value * multiplier);
}

/**
 * The runnable duration of `timer`, or `undefined` when the timer cannot be
 * run — `~{until golden}` and bare named timers like `~sauce` have no duration
 * and stay as plain decoration in the preview.
 */
export function timerDurationSeconds(timer: Timer): number | undefined {
    return quantityDurationSeconds(timer.quantity);
}

interface DurationParts {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
}

function splitDuration(totalSeconds: number): DurationParts {
    const total = Math.max(0, totalSeconds);
    return {
        days: Math.floor(total / 86400),
        hours: Math.floor((total % 86400) / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60,
    };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/**
 * A countdown clock: `10:00`, `01:05:30`, `4d 08:05:30`. Rounds up, so a
 * counter started at 10 minutes reads `10:00` rather than `09:59`.
 */
export function formatClock(totalSeconds: number): string {
    const { days, hours, minutes, seconds } = splitDuration(Math.ceil(totalSeconds));
    if (days > 0) {
        return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * A human-readable duration: `10 min`, `5 min 30 sec`, `1 hour 5 min`.
 */
export function formatDuration(totalSeconds: number): string {
    const { days, hours, minutes, seconds } = splitDuration(Math.round(totalSeconds));
    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${days} day`);
    }
    if (hours > 0) {
        parts.push(`${hours} hour`);
    }
    if (minutes > 0) {
        parts.push(`${minutes} min`);
    }
    if (seconds > 0) {
        parts.push(`${seconds} sec`);
    }
    return parts.length === 0 ? '0 sec' : parts.join(' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/common/timer-duration.spec.js"; cd ../..
```

Expected: all `timerDurationSeconds`, `formatClock` and `formatDuration` tests PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/common/timer-duration.ts packages/cooklang/src/common/timer-duration.spec.ts
git commit -m "feat(cooklang): parse and format timer durations"
```

---

## Task 2: `ActiveTimer` state machine

Port of iOS `ActiveTimer.swift`. Every function is pure and takes `nowMs`, so tests never touch the real clock.

**Files:**
- Create: `packages/cooklang/src/common/cooking-timer.ts`
- Test: `packages/cooklang/src/common/cooking-timer.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/common/cooking-timer.spec.ts`:

```ts
<LICENSE HEADER>

import { expect } from 'chai';
import {
    ActiveTimer,
    TimerRecipeRef,
    addTime,
    createAndStart,
    finish,
    fireAtMs,
    isExpired,
    matchesRef,
    pause,
    remainingSeconds,
    reset,
    restart,
    resume,
} from './cooking-timer';

const T0 = 1_700_000_000_000;

function ref(overrides: Partial<TimerRecipeRef> = {}): TimerRecipeRef {
    return {
        recipePath: 'file:///recipes/Soup.cook',
        recipeName: 'Soup',
        globalStepIndex: 2,
        timerPosition: 0,
        scale: 1,
        ...overrides,
    };
}

function started(): ActiveTimer {
    return createAndStart('id-1', 'simmer', 600, T0, ref());
}

describe('createAndStart', () => {

    it('produces a running timer anchored to now', () => {
        const timer = started();
        expect(timer.state).to.equal('running');
        expect(timer.startedAtMs).to.equal(T0);
        expect(timer.pausedRemainingSeconds).to.equal(undefined);
        expect(timer.durationSeconds).to.equal(600);
        expect(timer.updatedAtMs).to.equal(T0);
        expect(timer.recipeRef?.recipeName).to.equal('Soup');
    });
});

describe('remainingSeconds', () => {

    it('counts down while running', () => {
        expect(remainingSeconds(started(), T0)).to.equal(600);
        expect(remainingSeconds(started(), T0 + 90_000)).to.equal(510);
    });

    it('never goes below zero', () => {
        expect(remainingSeconds(started(), T0 + 999_000)).to.equal(0);
    });

    it('freezes while paused', () => {
        const paused = pause(started(), T0 + 90_000);
        expect(remainingSeconds(paused, T0 + 90_000)).to.equal(510);
        expect(remainingSeconds(paused, T0 + 900_000)).to.equal(510);
    });

    it('is zero once finished', () => {
        expect(remainingSeconds(finish(started(), T0 + 600_000), T0 + 700_000)).to.equal(0);
    });
});

describe('pause and resume', () => {

    it('does not drift across repeated cycles', () => {
        let timer = started();
        // run 100s, pause 1000s, run 100s, pause 1000s
        timer = pause(timer, T0 + 100_000);
        timer = resume(timer, T0 + 1_100_000);
        timer = pause(timer, T0 + 1_200_000);
        timer = resume(timer, T0 + 2_200_000);
        // 200 seconds of running have elapsed in total
        expect(remainingSeconds(timer, T0 + 2_200_000)).to.equal(400);
    });

    it('ignores a pause on an already paused timer', () => {
        const paused = pause(started(), T0 + 60_000);
        expect(pause(paused, T0 + 300_000)).to.deep.equal(paused);
    });

    it('ignores a resume on a running timer', () => {
        const running = started();
        expect(resume(running, T0 + 60_000)).to.deep.equal(running);
    });
});

describe('reset and restart', () => {

    it('reset returns a paused timer at full duration', () => {
        const timer = reset(pause(started(), T0 + 60_000), T0 + 70_000);
        expect(timer.state).to.equal('paused');
        expect(remainingSeconds(timer, T0 + 70_000)).to.equal(600);
    });

    it('restart returns a running timer at full duration', () => {
        const timer = restart(finish(started(), T0 + 600_000), T0 + 700_000);
        expect(timer.state).to.equal('running');
        expect(remainingSeconds(timer, T0 + 700_000)).to.equal(600);
        expect(remainingSeconds(timer, T0 + 760_000)).to.equal(540);
    });
});

describe('addTime', () => {

    it('extends a running timer', () => {
        const timer = addTime(started(), 60, T0 + 60_000);
        expect(remainingSeconds(timer, T0 + 60_000)).to.equal(600);
    });

    it('extends a paused timer', () => {
        const timer = addTime(pause(started(), T0 + 60_000), 60, T0 + 60_000);
        expect(remainingSeconds(timer, T0 + 60_000)).to.equal(600);
    });

    it('revives a finished timer as paused with just the added time', () => {
        const timer = addTime(finish(started(), T0 + 600_000), 60, T0 + 700_000);
        expect(timer.state).to.equal('paused');
        expect(remainingSeconds(timer, T0 + 700_000)).to.equal(60);
    });
});

describe('isExpired and fireAtMs', () => {

    it('expires exactly at the end of the duration', () => {
        expect(isExpired(started(), T0 + 599_000)).to.equal(false);
        expect(isExpired(started(), T0 + 600_000)).to.equal(true);
    });

    it('does not expire while paused', () => {
        expect(isExpired(pause(started(), T0 + 60_000), T0 + 10_000_000)).to.equal(false);
    });

    it('reports when a running timer will fire', () => {
        expect(fireAtMs(started())).to.equal(T0 + 600_000);
        expect(fireAtMs(pause(started(), T0 + 60_000))).to.equal(undefined);
    });
});

describe('matchesRef', () => {

    it('matches on recipe, step and position, ignoring scale', () => {
        const timer = started();
        expect(matchesRef(timer, ref({ scale: 4 }))).to.equal(true);
        expect(matchesRef(timer, ref({ timerPosition: 1 }))).to.equal(false);
        expect(matchesRef(timer, ref({ globalStepIndex: 3 }))).to.equal(false);
        expect(matchesRef(timer, ref({ recipePath: 'file:///other.cook' }))).to.equal(false);
    });

    it('never matches a timer with no recipe', () => {
        const orphan: ActiveTimer = { ...started(), recipeRef: undefined };
        expect(matchesRef(orphan, ref())).to.equal(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Cannot find module './cooking-timer'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/common/cooking-timer.ts`:

```ts
<LICENSE HEADER>

/**
 * The live state of a cooking timer. This is a port of the iOS app's
 * `ActiveTimer` (`Packages/Timers/Sources/Timers/Models/ActiveTimer.swift`),
 * minus its `idle` state: here a record only exists once the timer has been
 * started, because the Timers panel lists started timers only.
 *
 * Every function is pure and takes the current time as an argument, so the
 * whole state machine is testable with a fake clock.
 */

export type TimerState = 'running' | 'paused' | 'finished';

/** Where a timer came from, and how to get back there. */
export interface TimerRecipeRef {
    /** Full URI string of the `.cook` file. */
    recipePath: string;
    /** Display name of the recipe, for the panel row. */
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
    /**
     * When the timer's countdown is anchored. While running this may be in the
     * past by more than the elapsed wall time: `resume` back-dates it so that
     * `remainingSeconds` stays a pure function of the clock.
     */
    startedAtMs?: number;
    /** Frozen remaining time; set while paused. */
    pausedRemainingSeconds?: number;
    recipeRef?: TimerRecipeRef;
    updatedAtMs: number;
}

export function createAndStart(
    id: string,
    title: string,
    durationSeconds: number,
    nowMs: number,
    recipeRef?: TimerRecipeRef
): ActiveTimer {
    return {
        id,
        title,
        durationSeconds,
        state: 'running',
        startedAtMs: nowMs,
        recipeRef,
        updatedAtMs: nowMs,
    };
}

export function remainingSeconds(timer: ActiveTimer, nowMs: number): number {
    switch (timer.state) {
        case 'running': {
            if (timer.startedAtMs === undefined) {
                return timer.durationSeconds;
            }
            const elapsed = (nowMs - timer.startedAtMs) / 1000;
            return Math.max(0, timer.durationSeconds - elapsed);
        }
        case 'paused':
            return timer.pausedRemainingSeconds ?? timer.durationSeconds;
        case 'finished':
            return 0;
    }
}

/** When a running timer will fire, or `undefined` if it is not running. */
export function fireAtMs(timer: ActiveTimer): number | undefined {
    if (timer.state !== 'running' || timer.startedAtMs === undefined) {
        return undefined;
    }
    return timer.startedAtMs + timer.durationSeconds * 1000;
}

export function isExpired(timer: ActiveTimer, nowMs: number): boolean {
    return timer.state === 'running' && remainingSeconds(timer, nowMs) <= 0;
}

export function pause(timer: ActiveTimer, nowMs: number): ActiveTimer {
    if (timer.state !== 'running') {
        return timer;
    }
    return {
        ...timer,
        state: 'paused',
        pausedRemainingSeconds: remainingSeconds(timer, nowMs),
        startedAtMs: undefined,
        updatedAtMs: nowMs,
    };
}

export function resume(timer: ActiveTimer, nowMs: number): ActiveTimer {
    if (timer.state === 'running') {
        return timer;
    }
    const remaining = timer.state === 'paused'
        ? (timer.pausedRemainingSeconds ?? timer.durationSeconds)
        : timer.durationSeconds;
    // Back-date the anchor by the portion already spent, so that
    // `remainingSeconds` needs nothing but the clock.
    return {
        ...timer,
        state: 'running',
        startedAtMs: nowMs - (timer.durationSeconds - remaining) * 1000,
        pausedRemainingSeconds: undefined,
        updatedAtMs: nowMs,
    };
}

export function finish(timer: ActiveTimer, nowMs: number): ActiveTimer {
    return {
        ...timer,
        state: 'finished',
        startedAtMs: undefined,
        pausedRemainingSeconds: 0,
        updatedAtMs: nowMs,
    };
}

/** Back to the full duration, paused. */
export function reset(timer: ActiveTimer, nowMs: number): ActiveTimer {
    return {
        ...timer,
        state: 'paused',
        startedAtMs: undefined,
        pausedRemainingSeconds: timer.durationSeconds,
        updatedAtMs: nowMs,
    };
}

/** Back to the full duration, running. */
export function restart(timer: ActiveTimer, nowMs: number): ActiveTimer {
    return resume(reset(timer, nowMs), nowMs);
}

export function addTime(timer: ActiveTimer, seconds: number, nowMs: number): ActiveTimer {
    switch (timer.state) {
        case 'running':
            return {
                ...timer,
                startedAtMs: (timer.startedAtMs ?? nowMs) + seconds * 1000,
                updatedAtMs: nowMs,
            };
        case 'paused':
            return {
                ...timer,
                pausedRemainingSeconds: (timer.pausedRemainingSeconds ?? timer.durationSeconds) + seconds,
                updatedAtMs: nowMs,
            };
        case 'finished':
            return {
                ...timer,
                state: 'paused',
                pausedRemainingSeconds: seconds,
                updatedAtMs: nowMs,
            };
    }
}

/**
 * Whether `timer` is the timer at `ref`'s position. The scale is deliberately
 * ignored: re-scaling the preview must not lose a running timer.
 */
export function matchesRef(timer: ActiveTimer, ref: TimerRecipeRef): boolean {
    const own = timer.recipeRef;
    if (!own) {
        return false;
    }
    return own.recipePath === ref.recipePath
        && own.globalStepIndex === ref.globalStepIndex
        && own.timerPosition === ref.timerPosition;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/common/cooking-timer.spec.js"; cd ../..
```

Expected: every describe block PASSES.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/common/cooking-timer.ts packages/cooklang/src/common/cooking-timer.spec.ts
git commit -m "feat(cooklang): add ActiveTimer state machine"
```

---

## Task 3: URL tokenizer

**Files:**
- Create: `packages/cooklang/src/common/recipe-links.ts`
- Test: `packages/cooklang/src/common/recipe-links.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/common/recipe-links.spec.ts`:

```ts
<LICENSE HEADER>

import { expect } from 'chai';
import { linkify } from './recipe-links';

describe('linkify', () => {

    it('returns a single text token when there is no link', () => {
        expect(linkify('Simmer for a while.')).to.deep.equal([
            { type: 'text', value: 'Simmer for a while.' },
        ]);
    });

    it('returns an empty array for empty text', () => {
        expect(linkify('')).to.deep.equal([]);
    });

    it('splits text around an http url', () => {
        expect(linkify('See https://cooklang.org/spec now')).to.deep.equal([
            { type: 'text', value: 'See ' },
            { type: 'link', value: 'https://cooklang.org/spec', href: 'https://cooklang.org/spec' },
            { type: 'text', value: ' now' },
        ]);
    });

    it('upgrades a bare www host to https', () => {
        expect(linkify('www.cook.md')).to.deep.equal([
            { type: 'link', value: 'www.cook.md', href: 'https://www.cook.md' },
        ]);
    });

    it('links a bare email address through mailto', () => {
        expect(linkify('ask chef@cook.md')).to.deep.equal([
            { type: 'text', value: 'ask ' },
            { type: 'link', value: 'chef@cook.md', href: 'mailto:chef@cook.md' },
        ]);
    });

    it('keeps an explicit mailto scheme', () => {
        expect(linkify('mailto:chef@cook.md')).to.deep.equal([
            { type: 'link', value: 'mailto:chef@cook.md', href: 'mailto:chef@cook.md' },
        ]);
    });

    it('leaves trailing sentence punctuation outside the link', () => {
        expect(linkify('Source: https://cook.md/x.')).to.deep.equal([
            { type: 'text', value: 'Source: ' },
            { type: 'link', value: 'https://cook.md/x', href: 'https://cook.md/x' },
            { type: 'text', value: '.' },
        ]);
    });

    it('leaves an unbalanced closing paren outside the link', () => {
        expect(linkify('(see https://cook.md/x)')).to.deep.equal([
            { type: 'text', value: '(see ' },
            { type: 'link', value: 'https://cook.md/x', href: 'https://cook.md/x' },
            { type: 'text', value: ')' },
        ]);
    });

    it('keeps a balanced paren inside the link', () => {
        expect(linkify('https://en.wikipedia.org/wiki/Roux_(cooking)')).to.deep.equal([
            {
                type: 'link',
                value: 'https://en.wikipedia.org/wiki/Roux_(cooking)',
                href: 'https://en.wikipedia.org/wiki/Roux_(cooking)',
            },
        ]);
    });

    it('finds several links in one run of text', () => {
        const tokens = linkify('a https://one.example b https://two.example c');
        expect(tokens.filter(t => t.type === 'link').map(t => t.value)).to.deep.equal([
            'https://one.example',
            'https://two.example',
        ]);
        expect(tokens).to.have.length(5);
    });

    it('does not mistake a plain colon or a decimal for a link', () => {
        expect(linkify('Cook: 1.5 hours')).to.deep.equal([
            { type: 'text', value: 'Cook: 1.5 hours' },
        ]);
    });

    it('does not emit a link when trimming eats the scheme', () => {
        expect(linkify('mailto:.')).to.deep.equal([{ type: 'text', value: 'mailto:.' }]);
        expect(linkify('www..')).to.deep.equal([{ type: 'text', value: 'www..' }]);
        expect(linkify('Check www.: it works')).to.deep.equal([
            { type: 'text', value: 'Check www.: it works' },
        ]);
    });

    it('reproduces the input exactly, whatever the tokens', () => {
        const inputs = [
            '',
            '.',
            'www.',
            'mailto:.',
            'https://',
            'https://a.example',
            'a https://b.example',
            'https://a.example b',
            'https://a.example https://a.example',
            'Boil at 100°C — see https://a.example/√ for why.',
            'no links at all',
            'bare @ sign and a lone www without a dot',
        ];
        for (const input of inputs) {
            const rebuilt = linkify(input).map(token => token.value).join('');
            expect(rebuilt, `round trip of ${JSON.stringify(input)}`).to.equal(input);
        }
    });

    it('stays linear on long input without links', function (): void {
        this.timeout(5000);
        const haystack = `${'a.'.repeat(100_000)} end`;
        const started = Date.now();
        expect(linkify(haystack)).to.have.length(1);
        expect(Date.now() - started, 'linkify should not backtrack quadratically').to.be.lessThan(1000);
    });

    it('stays linear when trimming a long run of brackets', function (): void {
        this.timeout(5000);
        const haystack = `https://a.example${')'.repeat(50_000)}`;
        const started = Date.now();
        linkify(haystack);
        expect(Date.now() - started, 'trimTrailing should not rescan per character').to.be.lessThan(1000);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Cannot find module './recipe-links'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/common/recipe-links.ts`:

```ts
<LICENSE HEADER>

/** A run of plain, non-link text. */
export interface TextToken {
    type: 'text';
    value: string;
}

/** A run of text that should be rendered as a clickable link. */
export interface LinkToken {
    type: 'link';
    /** The text as written in the recipe. */
    value: string;
    /** The absolute URL to open. */
    href: string;
}

/** One token produced by {@link linkify}: either plain text or a link. */
export type LinkifyToken = TextToken | LinkToken;

/**
 * Matches, in order: an explicit http(s) URL, a bare `www.` host, an explicit
 * `mailto:`, and a bare email address. Deliberately greedy up to whitespace or
 * a quote/angle bracket; trailing punctuation is trimmed afterwards.
 *
 * Two adjacent links with no separating whitespace collapse into a single
 * token (e.g. the greedy `https?://` alternative swallows a `www.` host that
 * immediately follows it). That is a known and accepted ambiguity, not an
 * oversight.
 *
 * The `(?<!...)` lookbehind on the bare-email alternative is purely a
 * performance guard, not a semantic requirement: without it, a long run of
 * local-part characters with no `@` (a hash, a base64 paste, a run-on word)
 * makes the engine retry the greedy character class from every offset inside
 * the run, which is quadratic in the run's length. The lookbehind stops a
 * match attempt from starting partway through such a run, so only the run's
 * first offset does real backtracking work.
 */
const LINK_PATTERN = new RegExp([
    'https?://[^\\s<>"\']+',
    'www\\.[^\\s<>"\']+',
    'mailto:[^\\s<>"\']+',
    '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
].join('|'), 'g');

const TRAILING_PUNCTUATION = '.,;:!?';

function count(text: string, character: string): number {
    let total = 0;
    for (const c of text) {
        if (c === character) {
            total++;
        }
    }
    return total;
}

/**
 * Drop characters a writer meant as prose rather than as part of the URL: a
 * full stop that ends the sentence, or a closing bracket that was never opened
 * inside the URL itself. Counts brackets once up front and adjusts
 * incrementally rather than rescanning the shrinking value on every
 * character, which keeps this linear in the length of `match`.
 */
function trimTrailing(match: string): string {
    let end = match.length;
    const openParens = count(match, '(');
    let closeParens = count(match, ')');
    const openBrackets = count(match, '[');
    let closeBrackets = count(match, ']');
    while (end > 0) {
        const last = match.charAt(end - 1);
        if (TRAILING_PUNCTUATION.includes(last)) {
            end--;
            continue;
        }
        if (last === ')' && closeParens > openParens) {
            closeParens--;
            end--;
            continue;
        }
        if (last === ']' && closeBrackets > openBrackets) {
            closeBrackets--;
            end--;
            continue;
        }
        break;
    }
    return match.substring(0, end);
}

function hrefFor(value: string): string {
    if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) {
        return value;
    }
    if (/^www\./i.test(value)) {
        return `https://${value}`;
    }
    return `mailto:${value}`;
}

/**
 * Whether a match still looks like a link after {@link trimTrailing} has had
 * its way with it. Trimming can eat a scheme down to nothing meaningful —
 * `mailto:.` becomes `mailto`, `www..` becomes `www` — and those must render
 * as plain text rather than as an anchor pointing somewhere nonsensical.
 */
function isUsableLink(value: string): boolean {
    if (/^https?:\/\//i.test(value)) {
        return value.replace(/^https?:\/\//i, '').length > 0;
    }
    if (/^www\./i.test(value)) {
        return value.length > 'www.'.length;
    }
    const address = /^mailto:/i.test(value) ? value.substring('mailto:'.length) : value;
    return /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(address);
}

/**
 * Split `text` into plain runs and links. Text with no links yields a single
 * text token; empty text yields no tokens at all.
 */
export function linkify(text: string): LinkifyToken[] {
    if (text.length === 0) {
        return [];
    }
    const tokens: LinkifyToken[] = [];
    let cursor = 0;
    LINK_PATTERN.lastIndex = 0;
    let match = LINK_PATTERN.exec(text);
    while (match) {
        const start = match.index;
        const value = trimTrailing(match[0]);
        if (isUsableLink(value)) {
            if (start > cursor) {
                tokens.push({ type: 'text', value: text.substring(cursor, start) });
            }
            tokens.push({ type: 'link', value, href: hrefFor(value) });
            cursor = start + value.length;
            LINK_PATTERN.lastIndex = cursor;
        }
        match = LINK_PATTERN.exec(text);
    }
    if (cursor < text.length) {
        tokens.push({ type: 'text', value: text.substring(cursor) });
    }
    return tokens;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/common/recipe-links.spec.js"; cd ../..
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/common/recipe-links.ts packages/cooklang/src/common/recipe-links.spec.ts
git commit -m "feat(cooklang): add URL tokenizer for recipe text"
```

---

## Task 4: Render links in the preview

Renders `linkify` output in metadata pill values, step text and notes. The link opener arrives through a React context so `recipe-preview-components.tsx` keeps no service dependency and the existing spec still renders.

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx`
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`
- Modify: `packages/cooklang/src/browser/style/recipe-preview.css`
- Test: `packages/cooklang/src/browser/recipe-preview-links.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/recipe-preview-links.spec.ts`:

```ts
<LICENSE HEADER>

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetadataPills, LinkedText } from './recipe-preview-components';

describe('LinkedText', () => {

    it('renders plain text unchanged', () => {
        const markup = renderToStaticMarkup(React.createElement(LinkedText, { text: 'Simmer gently.' }));
        expect(markup).to.equal('Simmer gently.');
    });

    it('renders an anchor for a url in step text', () => {
        const markup = renderToStaticMarkup(
            React.createElement(LinkedText, { text: 'Method from https://cook.md/x here' })
        );
        expect(markup).to.contain('<a class="recipe-link" href="https://cook.md/x">https://cook.md/x</a>');
        expect(markup).to.contain('Method from ');
        expect(markup).to.contain(' here');
    });
});

describe('MetadataPills', () => {

    it('links a url in a metadata value', () => {
        const markup = renderToStaticMarkup(
            React.createElement(MetadataPills, { meta: { source: 'https://cook.md/recipes/soup' } })
        );
        expect(markup).to.contain('href="https://cook.md/recipes/soup"');
    });

    it('leaves a non-url metadata value alone', () => {
        const markup = renderToStaticMarkup(
            React.createElement(MetadataPills, { meta: { servings: '4' } })
        );
        expect(markup).to.not.contain('<a');
        expect(markup).to.contain('4');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Module '"./recipe-preview-components"' has no exported member 'LinkedText'`.

- [ ] **Step 3: Add `LinkedText` and use it in the three text sites**

In `packages/cooklang/src/browser/recipe-preview-components.tsx`, add to the imports:

```tsx
import { linkify } from '../common/recipe-links';
```

Add this section immediately after the `// Internal helpers` block (before `StepItemView`):

```tsx
// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Opens a URL outside the preview. Supplied by the widget. */
export type LinkOpener = (url: string) => void;

const LinkOpenerContext = React.createContext<LinkOpener | undefined>(undefined);

/** Wraps a subtree so the links inside it open through `value`. */
export const LinkOpenerProvider = LinkOpenerContext.Provider;

interface LinkedTextProps {
    text: string;
}

/**
 * Recipe text with any URLs in it turned into links. Without a
 * {@link LinkOpenerProvider} above it the anchors still render with their
 * `href`, they just have no click behaviour — which is what keeps this
 * component renderable in tests.
 */
export const LinkedText = ({ text }: LinkedTextProps): React.ReactElement => {
    const openLink = React.useContext(LinkOpenerContext);
    const tokens = linkify(text);
    if (tokens.length === 0) {
        return <></>;
    }
    if (tokens.length === 1 && tokens[0].type === 'text') {
        return <React.Fragment>{text}</React.Fragment>;
    }
    return (
        <React.Fragment>
            {tokens.map((token, idx) => token.type === 'text' ? (
                <React.Fragment key={idx}>{token.value}</React.Fragment>
            ) : (
                <a key={idx} className='recipe-link' href={token.href}
                    onClick={e => {
                        if (openLink) {
                            e.preventDefault();
                            openLink(token.href);
                        }
                    }}>
                    {token.value}
                </a>
            ))}
        </React.Fragment>
    );
};
```

In `StepItemView`, replace the text case:

```tsx
        case 'text':
            return <LinkedText text={item.value} />;
```

In `SectionContentView`, replace the note branch:

```tsx
    if (content.type === 'text') {
        return <div className='note-item'><LinkedText text={content.value} /></div>;
    }
```

In `MetadataPills`, replace the pill body:

```tsx
                <span key={idx} className='metadata-pill'>
                    <strong>{pill.label}:</strong> <LinkedText text={pill.value} />
                </span>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/browser/recipe-preview-links.spec.js" "./lib/browser/recipe-preview-components.spec.js"; cd ../..
```

Expected: the new link tests PASS **and** the pre-existing `InstructionsPanel step image indices` suite still PASSES.

- [ ] **Step 5: Wire the opener into the widget**

In `packages/cooklang/src/browser/recipe-preview-widget.tsx` add the import:

```tsx
import { WindowService } from '@theia/core/lib/browser/window/window-service';
```

change the `RecipeView` import to:

```tsx
import { RecipeView, LinkOpenerProvider } from './recipe-preview-components';
```

add the injection next to the other `@inject` fields:

```tsx
    @inject(WindowService)
    protected readonly windowService: WindowService;
```

add the handler next to `handleNavigateToRecipe`:

```tsx
    protected handleOpenLink = (url: string): void => {
        this.windowService.openNewWindow(url, { external: true });
    };
```

and wrap the rendered `RecipeView` in `render()`:

```tsx
        if (this.recipe) {
            return (
                <LinkOpenerProvider value={this.handleOpenLink}>
                    <RecipeView
                        recipe={this.recipe}
                        fileName={this.uri?.path.base ?? ''}
                        images={this.images}
                        onShowSource={this.handleShowSource}
                        onAddToShoppingList={this.handleAddToShoppingList}
                        onNavigateToRecipe={this.handleNavigateToRecipe}
                    />
                </LinkOpenerProvider>
            );
        }
```

- [ ] **Step 6: Style the link**

Append to `packages/cooklang/src/browser/style/recipe-preview.css`:

```css
/* Links found in metadata values, step text and notes */
.theia-recipe-preview .recipe-link {
    color: var(--theia-textLink-foreground);
    text-decoration: none;
    cursor: pointer;
}

.theia-recipe-preview .recipe-link:hover {
    color: var(--theia-textLink-activeForeground);
    text-decoration: underline;
}
```

- [ ] **Step 7: Compile, lint and commit**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-components.tsx \
        packages/cooklang/src/browser/recipe-preview-widget.tsx \
        packages/cooklang/src/browser/recipe-preview-links.spec.ts \
        packages/cooklang/src/browser/style/recipe-preview.css
git commit -m "feat(cooklang): make URLs in the recipe preview clickable"
```

---

## Task 5: `CookingTimerService`

Port of iOS `TimerManager` + `TimerStorage`. Persistence writes on every mutation rather than on a debounce: mutations are user-driven (start, pause, reset) plus one write per expiry, so there is nothing to debounce and the code stays testable.

**Files:**
- Create: `packages/cooklang/src/browser/cooking-timer-service.ts`
- Test: `packages/cooklang/src/browser/cooking-timer-service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/cooking-timer-service.spec.ts`:

```ts
<LICENSE HEADER>

import { expect } from 'chai';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { ActiveTimer, TimerRecipeRef, remainingSeconds } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';

const T0 = 1_700_000_000_000;

class FakeStorage {
    data = new Map<string, unknown>();
    writes = 0;
    async setData<T>(key: string, value: T): Promise<void> {
        this.writes++;
        this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
    async getData<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        return this.data.has(key) ? this.data.get(key) as T : defaultValue;
    }
}

/** Exposes the clock, the id generator and the protected lifecycle to tests. */
class TestTimerService extends CookingTimerService {
    currentTimeMs = T0;
    protected idCounter = 0;
    protected override now(): number {
        return this.currentTimeMs;
    }
    protected override newId(): string {
        return `t${++this.idCounter}`;
    }
    /** Number of live tick intervals; 0 or 1. */
    get ticking(): boolean {
        return this.tickHandle !== undefined;
    }
    async load(): Promise<void> {
        await this.restore();
    }
    tickNow(): void {
        this.tick();
    }
}

function ref(overrides: Partial<TimerRecipeRef> = {}): TimerRecipeRef {
    return {
        recipePath: 'file:///recipes/Soup.cook',
        recipeName: 'Soup',
        globalStepIndex: 2,
        timerPosition: 0,
        scale: 1,
        ...overrides,
    };
}

function createService(storage: FakeStorage): TestTimerService {
    const service = new TestTimerService();
    (service as unknown as { storageService: StorageService }).storageService =
        storage as unknown as StorageService;
    return service;
}

describe('CookingTimerService', () => {

    it('starts a timer, keeps it, and persists it', async () => {
        const storage = new FakeStorage();
        const service = createService(storage);
        await service.load();

        service.start(ref(), 'simmer', 600);

        expect(service.list()).to.have.length(1);
        expect(service.list()[0].title).to.equal('simmer');
        expect(service.find(ref())?.id).to.equal('t1');
        expect(storage.data.get('cooklang.timers')).to.have.length(1);
        expect(service.ticking).to.equal(true);
    });

    it('finds a timer regardless of the scale in the lookup ref', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref({ scale: 1 }), 'simmer', 600);
        expect(service.find(ref({ scale: 4 }))?.id).to.equal('t1');
    });

    it('restarts an existing timer instead of creating a second one for the same step', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        service.start(ref(), 'simmer', 600);
        expect(service.list()).to.have.length(1);
    });

    it('fires onDidFinishTimer when a running timer expires', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        const finished: ActiveTimer[] = [];
        service.onDidFinishTimer(timer => finished.push(timer));

        service.start(ref(), 'simmer', 600);
        service.currentTimeMs = T0 + 599_000;
        service.tickNow();
        expect(finished).to.have.length(0);

        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        expect(finished.map(t => t.id)).to.deep.equal(['t1']);
        expect(service.list()[0].state).to.equal('finished');
    });

    it('stops ticking once nothing is running', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref(), 'simmer', 600);
        expect(service.ticking).to.equal(true);
        service.pause('t1');
        expect(service.ticking).to.equal(false);
        service.resume('t1');
        expect(service.ticking).to.equal(true);
    });

    it('restores timers and keeps counting down', async () => {
        const storage = new FakeStorage();
        const first = createService(storage);
        await first.load();
        first.start(ref(), 'simmer', 600);
        first.dispose();

        const second = createService(storage);
        second.currentTimeMs = T0 + 120_000;
        await second.load();

        expect(second.list()).to.have.length(1);
        expect(remainingSeconds(second.list()[0], second.currentTimeMs)).to.equal(480);
    });

    it('restores a timer that expired while the app was closed as finished, without alarming', async () => {
        const storage = new FakeStorage();
        const first = createService(storage);
        await first.load();
        first.start(ref(), 'simmer', 600);
        first.dispose();

        const second = createService(storage);
        second.currentTimeMs = T0 + 3_600_000;
        const finished: ActiveTimer[] = [];
        second.onDidFinishTimer(timer => finished.push(timer));
        await second.load();

        expect(second.list()[0].state).to.equal('finished');
        expect(finished).to.have.length(0);
    });

    it('keeps only the 20 most recently updated timers', async () => {
        const storage = new FakeStorage();
        const service = createService(storage);
        await service.load();
        for (let i = 0; i < 25; i++) {
            service.currentTimeMs = T0 + i * 1000;
            service.start(ref({ globalStepIndex: i }), `timer ${i}`, 600);
        }
        expect(service.list()).to.have.length(20);
        expect(service.find(ref({ globalStepIndex: 0 }))).to.equal(undefined);
        expect(service.find(ref({ globalStepIndex: 24 }))).to.not.equal(undefined);
    });

    it('removes finished timers on request and leaves the rest', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        service.start(ref({ globalStepIndex: 1 }), 'a', 600);
        service.start(ref({ globalStepIndex: 2 }), 'b', 600);
        service.currentTimeMs = T0 + 600_000;
        service.tickNow();
        service.resume('t1');
        service.removeFinished();
        expect(service.list().map(t => t.id)).to.deep.equal(['t1']);
    });

    it('notifies listeners on every change', async () => {
        const service = createService(new FakeStorage());
        await service.load();
        let changes = 0;
        service.onDidChangeTimers(() => changes++);
        service.start(ref(), 'simmer', 600);
        service.pause('t1');
        service.addTime('t1', 60);
        service.remove('t1');
        expect(changes).to.equal(4);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Cannot find module './cooking-timer-service'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/browser/cooking-timer-service.ts`:

```ts
<LICENSE HEADER>

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import {
    ActiveTimer,
    TimerRecipeRef,
    addTime,
    createAndStart,
    finish,
    fireAtMs,
    isExpired,
    matchesRef,
    pause,
    reset,
    restart,
    resume,
} from '../common/cooking-timer';

/**
 * Owns every live cooking timer for the window. A port of the iOS app's
 * `TimerManager` plus `TimerStorage`
 * (`Packages/Timers/Sources/Timers/Core/`).
 *
 * A single interval ticks once a second while at least one timer is running:
 * it both detects expiry and drives countdown re-renders in the preview and
 * the Timers panel. It is torn down as soon as nothing is running.
 */
@injectable()
export class CookingTimerService implements Disposable {

    static readonly STORAGE_KEY = 'cooklang.timers';
    /** Matches the iOS `TimerManager.maxRetainedTimers`. */
    static readonly MAX_TIMERS = 20;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    protected readonly timers = new Map<string, ActiveTimer>();

    protected readonly onDidChangeTimersEmitter = new Emitter<void>();
    readonly onDidChangeTimers: Event<void> = this.onDidChangeTimersEmitter.event;

    protected readonly onDidFinishTimerEmitter = new Emitter<ActiveTimer>();
    readonly onDidFinishTimer: Event<ActiveTimer> = this.onDidFinishTimerEmitter.event;

    protected tickHandle: ReturnType<typeof setInterval> | undefined;

    @postConstruct()
    protected init(): void {
        // Never make this method async: Inversify 6.2.2 treats an async
        // @postConstruct as an async binding and the whole frontend fails to
        // construct. Kick the load off and let it settle on its own.
        this.restore().catch(e => console.warn('Could not restore cooking timers', e));
    }

    // --- Overridable seams (tests substitute a fake clock and ids) ---

    protected now(): number {
        return Date.now();
    }

    protected newId(): string {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    // --- Query ---

    /** Every timer, in insertion order. */
    list(): ActiveTimer[] {
        return Array.from(this.timers.values());
    }

    get(id: string): ActiveTimer | undefined {
        return this.timers.get(id);
    }

    /** The timer started for `ref`'s step and position, whatever its scale. */
    find(ref: TimerRecipeRef): ActiveTimer | undefined {
        for (const timer of this.timers.values()) {
            if (matchesRef(timer, ref)) {
                return timer;
            }
        }
        return undefined;
    }

    nowMs(): number {
        return this.now();
    }

    // --- Commands ---

    /**
     * Start the timer for `ref`. If one is already there — paused, finished, or
     * still running — it is restarted rather than duplicated.
     */
    start(ref: TimerRecipeRef, title: string, durationSeconds: number): ActiveTimer {
        const now = this.now();
        const existing = this.find(ref);
        if (existing) {
            // Re-read title, duration and scale: the recipe may have been
            // edited or re-scaled since this timer was first started.
            const updated = { ...existing, title, durationSeconds, recipeRef: ref };
            return this.replace(restart(updated, now));
        }
        return this.replace(createAndStart(this.newId(), title, durationSeconds, now, ref));
    }

    pause(id: string): void {
        this.mutate(id, timer => pause(timer, this.now()));
    }

    resume(id: string): void {
        this.mutate(id, timer => resume(timer, this.now()));
    }

    /** Pause a running timer, resume a paused one, restart a finished one. */
    toggle(id: string): void {
        const timer = this.timers.get(id);
        if (!timer) {
            return;
        }
        const now = this.now();
        this.mutate(id, () => {
            switch (timer.state) {
                case 'running':
                    return pause(timer, now);
                case 'paused':
                    return resume(timer, now);
                case 'finished':
                    return restart(timer, now);
            }
        });
    }

    reset(id: string): void {
        this.mutate(id, timer => reset(timer, this.now()));
    }

    restart(id: string): void {
        this.mutate(id, timer => restart(timer, this.now()));
    }

    addTime(id: string, seconds: number): void {
        this.mutate(id, timer => addTime(timer, seconds, this.now()));
    }

    remove(id: string): void {
        if (this.timers.delete(id)) {
            this.changed();
        }
    }

    removeFinished(): void {
        let removed = false;
        for (const timer of this.list()) {
            if (timer.state === 'finished') {
                this.timers.delete(timer.id);
                removed = true;
            }
        }
        if (removed) {
            this.changed();
        }
    }

    removeAll(): void {
        if (this.timers.size > 0) {
            this.timers.clear();
            this.changed();
        }
    }

    dispose(): void {
        this.stopTicking();
        this.onDidChangeTimersEmitter.dispose();
        this.onDidFinishTimerEmitter.dispose();
    }

    // --- Internals ---

    protected replace(timer: ActiveTimer): ActiveTimer {
        this.timers.set(timer.id, timer);
        this.evictOldest();
        this.changed();
        return timer;
    }

    protected mutate(id: string, transform: (timer: ActiveTimer) => ActiveTimer): void {
        const timer = this.timers.get(id);
        if (!timer) {
            return;
        }
        this.timers.set(id, transform(timer));
        this.changed();
    }

    protected changed(): void {
        void this.persist();
        this.updateTicking();
        this.onDidChangeTimersEmitter.fire();
    }

    /**
     * Drop the least recently touched timers once there are more than
     * {@link MAX_TIMERS}, matching iOS `cleanupOldTimers`.
     */
    protected evictOldest(): void {
        if (this.timers.size <= CookingTimerService.MAX_TIMERS) {
            return;
        }
        const keep = new Set(
            this.list()
                .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
                .slice(0, CookingTimerService.MAX_TIMERS)
                .map(timer => timer.id)
        );
        for (const timer of this.list()) {
            if (!keep.has(timer.id)) {
                this.timers.delete(timer.id);
            }
        }
    }

    protected async persist(): Promise<void> {
        try {
            await this.storageService.setData(CookingTimerService.STORAGE_KEY, this.list());
        } catch (e) {
            console.warn('Could not persist cooking timers', e);
        }
    }

    /**
     * Reload timers saved by an earlier session. A timer whose fire time has
     * already passed comes back finished, but no `onDidFinishTimer` is fired:
     * the alarm belongs to the moment it expired, not to startup.
     */
    protected async restore(): Promise<void> {
        const stored = await this.storageService.getData<ActiveTimer[]>(CookingTimerService.STORAGE_KEY, []);
        const now = this.now();
        for (const timer of stored ?? []) {
            this.timers.set(timer.id, isExpired(timer, now) ? finish(timer, now) : timer);
        }
        this.evictOldest();
        this.updateTicking();
        this.onDidChangeTimersEmitter.fire();
    }

    protected hasRunning(): boolean {
        return this.list().some(timer => timer.state === 'running');
    }

    protected updateTicking(): void {
        if (this.hasRunning()) {
            this.startTicking();
        } else {
            this.stopTicking();
        }
    }

    protected startTicking(): void {
        if (this.tickHandle === undefined) {
            this.tickHandle = setInterval(() => this.tick(), 1000);
        }
    }

    protected stopTicking(): void {
        if (this.tickHandle !== undefined) {
            clearInterval(this.tickHandle);
            this.tickHandle = undefined;
        }
    }

    protected tick(): void {
        const now = this.now();
        const finished: ActiveTimer[] = [];
        for (const timer of this.list()) {
            if (isExpired(timer, now)) {
                const done = finish(timer, now);
                this.timers.set(done.id, done);
                finished.push(done);
            }
        }
        if (finished.length > 0) {
            void this.persist();
        }
        this.updateTicking();
        // Fired every second so countdowns re-render, not only on state change.
        this.onDidChangeTimersEmitter.fire();
        for (const timer of finished) {
            this.onDidFinishTimerEmitter.fire(timer);
        }
    }

    /** Running timers first, soonest to fire at the top, then paused, then finished. */
    static sortForDisplay(timers: ActiveTimer[]): ActiveTimer[] {
        const rank: Record<string, number> = { running: 0, paused: 1, finished: 2 };
        return [...timers].sort((a, b) => {
            const byState = rank[a.state] - rank[b.state];
            if (byState !== 0) {
                return byState;
            }
            if (a.state === 'running') {
                return (fireAtMs(a) ?? 0) - (fireAtMs(b) ?? 0);
            }
            return b.updatedAtMs - a.updatedAtMs;
        });
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/browser/cooking-timer-service.spec.js"; cd ../..
```

Expected: all 10 `CookingTimerService` tests PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/cooking-timer-service.ts packages/cooklang/src/browser/cooking-timer-service.spec.ts
git commit -m "feat(cooklang): add CookingTimerService with persistence"
```

---

## Task 6: Alarm — preferences, chime and notification

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-preferences.ts`
- Create: `packages/cooklang/src/browser/timer-chime.ts`
- Create: `packages/cooklang/src/browser/timer-alarm-service.ts`

There is no unit test here: the payload is a `Notification` and an `AudioContext`, both of which only exist in the real renderer. This task is verified manually in Task 12.

- [ ] **Step 1: Add the preferences**

In `packages/cooklang/src/common/cooklang-preferences.ts`, add two properties to `cooklangPreferencesSchema.properties`, after `cooklang.nutrition.serviceUrl`:

```ts
        'cooklang.timers.notifications': {
            'type': 'boolean',
            'description': 'Show a system notification when a recipe timer finishes.',
            'default': true
        },
        'cooklang.timers.sound': {
            'type': 'boolean',
            'description': 'Play a sound when a recipe timer finishes.',
            'default': true
        }
```

and the matching entries in `CooklangConfiguration`:

```ts
export interface CooklangConfiguration {
    'cooklang.openInPreviewMode': boolean;
    'cooklang.nutrition.serviceUrl': string;
    'cooklang.timers.notifications': boolean;
    'cooklang.timers.sound': boolean;
}
```

- [ ] **Step 2: Write the chime**

Create `packages/cooklang/src/browser/timer-chime.ts`:

```ts
<LICENSE HEADER>

import { injectable } from '@theia/core/shared/inversify';

/** Frequency in Hz and relative level for each partial of one bell strike. */
const PARTIALS: ReadonlyArray<readonly [number, number]> = [
    [880, 1],
    [1320, 0.4],
    [1760, 0.2],
];

const STRIKES = 3;
const STRIKE_SPACING_SECONDS = 0.45;
const STRIKE_LENGTH_SECONDS = 0.4;

/**
 * The sound a finished timer makes. Synthesized rather than shipped as an
 * audio file: the generated webpack config has no rule for audio assets, so a
 * `.wav` import would silently fail to bundle.
 */
@injectable()
export class TimerChime {

    protected context: AudioContext | undefined;

    play(): void {
        try {
            const context = this.audioContext();
            // A context created before any user gesture starts suspended.
            void context.resume();
            for (let i = 0; i < STRIKES; i++) {
                this.strike(context, context.currentTime + i * STRIKE_SPACING_SECONDS);
            }
        } catch (e) {
            console.debug('Could not play the timer chime', e);
        }
    }

    protected audioContext(): AudioContext {
        if (!this.context) {
            this.context = new AudioContext();
        }
        return this.context;
    }

    /** One bell strike: a struck-metal spectrum under an exponential decay. */
    protected strike(context: AudioContext, at: number): void {
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + STRIKE_LENGTH_SECONDS);
        envelope.connect(context.destination);

        for (const [frequency, level] of PARTIALS) {
            const oscillator = context.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, at);

            const partialGain = context.createGain();
            partialGain.gain.setValueAtTime(level, at);

            oscillator.connect(partialGain);
            partialGain.connect(envelope);
            oscillator.start(at);
            oscillator.stop(at + STRIKE_SPACING_SECONDS);
        }
    }
}
```

- [ ] **Step 3: Write the alarm service**

Create `packages/cooklang/src/browser/timer-alarm-service.ts`:

```ts
<LICENSE HEADER>

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { OSNotificationService } from '@theia/ai-core/lib/browser/os-notification-service';
import { ActiveTimer } from '../common/cooking-timer';
import { CooklangPreferences } from '../common/cooklang-preferences';
import { CookingTimerService } from './cooking-timer-service';
import { TimerChime } from './timer-chime';
import { TimersCommands } from './timers-commands';

/**
 * Turns a finished timer into something you notice from the other side of the
 * kitchen: a system notification (so it lands even when the window is in the
 * background) and a chime.
 */
@injectable()
export class TimerAlarmService implements FrontendApplicationContribution {

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    @inject(OSNotificationService)
    protected readonly notificationService: OSNotificationService;

    @inject(TimerChime)
    protected readonly chime: TimerChime;

    @inject(CooklangPreferences)
    protected readonly preferences: CooklangPreferences;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    protected permissionRequested = false;

    onStart(): void {
        this.timerService.onDidFinishTimer(timer => this.alarm(timer));
        // Ask for notification permission the first time a timer exists, not at
        // startup: nobody wants a permission prompt for opening a recipe.
        this.timerService.onDidChangeTimers(() => this.ensurePermission());
    }

    protected ensurePermission(): void {
        if (this.permissionRequested || this.timerService.list().length === 0) {
            return;
        }
        this.permissionRequested = true;
        void this.notificationService.requestPermission();
    }

    protected alarm(timer: ActiveTimer): void {
        if (this.preferences['cooklang.timers.sound']) {
            this.chime.play();
        }
        if (!this.preferences['cooklang.timers.notifications']) {
            return;
        }
        void this.notificationService.showNotification(
            `${timer.title} — done`,
            {
                body: timer.recipeRef?.recipeName,
                requireInteraction: true,
                tag: `cooklang-timer-${timer.id}`,
            },
            () => {
                void this.commands.executeCommand(TimersCommands.TOGGLE_VIEW.id);
            }
        );
    }
}
```

- [ ] **Step 3b: Create the commands module**

`TimersCommands` lives in its own file so the alarm service compiles now
rather than waiting for the view in Task 11. Create
`packages/cooklang/src/browser/timers-commands.ts`:

```ts
<LICENSE HEADER>

import { Command } from '@theia/core/lib/common/command';

export namespace TimersCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cooklang.toggleTimers',
        label: 'Cooklang: Toggle Timers',
    };
}
```

- [ ] **Step 4: Compile, lint and commit**

Everything in this task compiles on its own — there is nothing left pending on
a later task.

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
```

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
git add packages/cooklang/src/common/cooklang-preferences.ts \
        packages/cooklang/src/browser/timers-commands.ts \
        packages/cooklang/src/browser/timer-chime.ts \
        packages/cooklang/src/browser/timer-alarm-service.ts
git commit -m "feat(cooklang): add timer alarm preferences, chime and notification service"
```

---

## Task 7: Timer badge and panel row components

`timer-components.tsx` holds every timer-shaped piece of React: the context that hands the service to the tree, the inline badge, and the panel row. It imports only from `common/`, so it is testable with `renderToStaticMarkup`.

**Files:**
- Create: `packages/cooklang/src/browser/timer-components.tsx`
- Test: `packages/cooklang/src/browser/timer-components.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/timer-components.spec.ts`:

```ts
<LICENSE HEADER>

/* eslint-disable no-null/no-null */

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActiveTimer, TimerRecipeRef, createAndStart, finish, pause } from '../common/cooking-timer';
import { Timer } from '../common/recipe-types';
import { TimerBadge, TimerBinding, TimerBindingProvider, TimerRow } from './timer-components';

const T0 = 1_700_000_000_000;

function ref(): TimerRecipeRef {
    return {
        recipePath: 'file:///recipes/Soup.cook',
        recipeName: 'Soup',
        globalStepIndex: 2,
        timerPosition: 0,
        scale: 1,
    };
}

function minuteTimer(minutes: number, name: string | null = null): Timer {
    return {
        name,
        quantity: {
            value: { type: 'number', value: { type: 'regular', value: minutes } },
            unit: 'minutes',
            scalable: true,
        },
    };
}

function binding(active: ActiveTimer | undefined): TimerBinding {
    return {
        ref: () => ref(),
        find: () => active,
        start: () => undefined,
        toggle: () => undefined,
        reset: () => undefined,
        addTime: () => undefined,
        nowMs: () => T0,
    };
}

function renderBadge(timer: Timer, active: ActiveTimer | undefined): string {
    return renderToStaticMarkup(
        React.createElement(
            TimerBindingProvider,
            { value: binding(active) },
            React.createElement(TimerBadge, { timer, globalStepIndex: 2, timerPosition: 0 })
        )
    );
}

describe('TimerBadge', () => {

    it('renders a plain badge with no binding above it', () => {
        const markup = renderToStaticMarkup(
            React.createElement(TimerBadge, { timer: minuteTimer(10), globalStepIndex: 2, timerPosition: 0 })
        );
        expect(markup).to.contain('class="timer-badge"');
        expect(markup).to.contain('10 minutes');
    });

    it('renders a startable badge when the timer has a duration', () => {
        const markup = renderBadge(minuteTimer(10), undefined);
        expect(markup).to.contain('timer-badge-idle');
        expect(markup).to.contain('10 minutes');
    });

    it('shows the name alongside the duration', () => {
        const markup = renderBadge(minuteTimer(10, 'sauce'), undefined);
        expect(markup).to.contain('sauce');
        expect(markup).to.contain('10 minutes');
    });

    it('stays a plain badge when the timer has no runnable duration', () => {
        const timer: Timer = {
            name: null,
            quantity: { value: { type: 'text', value: 'until golden' }, unit: null, scalable: false },
        };
        const markup = renderBadge(timer, undefined);
        expect(markup).to.equal('<span class="timer-badge">until golden</span>');
    });

    it('shows a running countdown', () => {
        const active = createAndStart('t1', 'sauce', 600, T0 - 90_000, ref());
        const markup = renderBadge(minuteTimer(10, 'sauce'), active);
        expect(markup).to.contain('timer-badge-running');
        expect(markup).to.contain('08:30');
    });

    it('marks a paused timer', () => {
        const active = pause(createAndStart('t1', 'sauce', 600, T0 - 90_000, ref()), T0);
        expect(renderBadge(minuteTimer(10, 'sauce'), active)).to.contain('timer-badge-paused');
    });

    it('marks a finished timer at zero', () => {
        const active = finish(createAndStart('t1', 'sauce', 600, T0 - 600_000, ref()), T0);
        const markup = renderBadge(minuteTimer(10, 'sauce'), active);
        expect(markup).to.contain('timer-badge-finished');
        expect(markup).to.contain('00:00');
    });
});

describe('TimerRow', () => {

    function renderRow(active: ActiveTimer): string {
        return renderToStaticMarkup(
            React.createElement(TimerRow, {
                timer: active,
                nowMs: T0,
                onToggle: () => undefined,
                onReset: () => undefined,
                onAddTime: () => undefined,
                onRemove: () => undefined,
                onOpenRecipe: () => undefined,
            })
        );
    }

    it('shows the countdown, the title and the recipe', () => {
        const markup = renderRow(createAndStart('t1', 'simmer sauce', 600, T0 - 90_000, ref()));
        expect(markup).to.contain('08:30');
        expect(markup).to.contain('simmer sauce');
        expect(markup).to.contain('Soup');
    });

    it('carries its state as a class', () => {
        expect(renderRow(createAndStart('t1', 'a', 600, T0, ref()))).to.contain('timer-row-running');
        expect(renderRow(finish(createAndStart('t1', 'a', 600, T0 - 600_000, ref()), T0)))
            .to.contain('timer-row-finished');
    });

    it('omits the recipe link for a timer with no recipe', () => {
        const orphan: ActiveTimer = { ...createAndStart('t1', 'a', 600, T0, ref()), recipeRef: undefined };
        expect(renderRow(orphan)).to.not.contain('timer-row-recipe');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```

Expected: compile FAILS with `Cannot find module './timer-components'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/browser/timer-components.tsx`:

```tsx
<LICENSE HEADER>

/* eslint-disable no-null/no-null */

import * as React from '@theia/core/shared/react';
import { ActiveTimer, TimerRecipeRef, remainingSeconds } from '../common/cooking-timer';
import { Timer, formatQuantity } from '../common/recipe-types';
import { formatClock, formatDuration, timerDurationSeconds } from '../common/timer-duration';

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * Everything a timer badge needs from the outside world. `RecipePreviewWidget`
 * supplies one; without it the badges render as inert decoration, which is what
 * keeps this module testable and `recipe-preview-components.tsx` service-free.
 */
export interface TimerBinding {
    /** Build the identity of the timer at this position in the open recipe. */
    ref(globalStepIndex: number, timerPosition: number): TimerRecipeRef;
    find(ref: TimerRecipeRef): ActiveTimer | undefined;
    start(ref: TimerRecipeRef, title: string, durationSeconds: number): void;
    toggle(id: string): void;
    reset(id: string): void;
    addTime(id: string, seconds: number): void;
    nowMs(): number;
}

const TimerBindingContext = React.createContext<TimerBinding | undefined>(undefined);

export const TimerBindingProvider = TimerBindingContext.Provider;

// ---------------------------------------------------------------------------
// TimerBadge
// ---------------------------------------------------------------------------

/**
 * The text shown on a badge that has not been started: the name and the
 * duration together, so `~sauce{10%minutes}` reads `sauce 10 minutes` rather
 * than hiding the duration behind the name.
 */
export function timerBadgeLabel(timer: Timer): string {
    const quantity = timer.quantity ? formatQuantity(timer.quantity) : '';
    if (timer.name && quantity) {
        return `${timer.name} ${quantity}`;
    }
    return timer.name ?? quantity;
}

export interface TimerBadgeProps {
    timer: Timer;
    globalStepIndex: number;
    timerPosition: number;
}

export const TimerBadge = ({ timer, globalStepIndex, timerPosition }: TimerBadgeProps): React.ReactElement => {
    const binding = React.useContext(TimerBindingContext);
    const label = timerBadgeLabel(timer);
    const duration = timerDurationSeconds(timer);

    if (!binding || duration === undefined) {
        // `~{until golden}` and bare named timers have nothing to count down.
        return <span className='timer-badge'>{label}</span>;
    }

    const ref = binding.ref(globalStepIndex, timerPosition);
    const active = binding.find(ref);

    if (!active) {
        return (
            <span className='timer-badge timer-badge-idle' role='button' tabIndex={0}
                title={`Start a ${formatDuration(duration)} timer`}
                onClick={() => binding.start(ref, timer.name ?? label, duration)}>
                <span className='codicon codicon-watch timer-badge-icon'></span>
                {label}
            </span>
        );
    }

    const titles: Record<string, string> = {
        running: 'Pause timer',
        paused: 'Resume timer',
        finished: 'Restart timer',
    };

    return (
        <span className={`timer-badge timer-badge-${active.state}`} role='button' tabIndex={0}
            title={titles[active.state]}
            onClick={() => binding.toggle(active.id)}>
            <span className='codicon codicon-watch timer-badge-icon'></span>
            <span className='timer-badge-clock'>{formatClock(remainingSeconds(active, binding.nowMs()))}</span>
        </span>
    );
};

// ---------------------------------------------------------------------------
// TimerRow  (one entry in the Timers panel)
// ---------------------------------------------------------------------------

export interface TimerRowProps {
    timer: ActiveTimer;
    nowMs: number;
    onToggle: (id: string) => void;
    onReset: (id: string) => void;
    onAddTime: (id: string, seconds: number) => void;
    onRemove: (id: string) => void;
    onOpenRecipe?: (ref: TimerRecipeRef) => void;
}

export const TimerRow = ({
    timer,
    nowMs,
    onToggle,
    onReset,
    onAddTime,
    onRemove,
    onOpenRecipe,
}: TimerRowProps): React.ReactElement => {
    const remaining = remainingSeconds(timer, nowMs);
    const elapsedFraction = timer.durationSeconds > 0
        ? Math.min(1, Math.max(0, 1 - remaining / timer.durationSeconds))
        : 0;
    const toggleIcon = timer.state === 'running' ? 'codicon-debug-pause' : 'codicon-play';
    const toggleTitle = timer.state === 'running'
        ? 'Pause'
        : timer.state === 'paused' ? 'Resume' : 'Restart';

    return (
        <div className={`timer-row timer-row-${timer.state}`}>
            <div className='timer-row-main'>
                <div className='timer-row-clock'>{formatClock(remaining)}</div>
                <div className='timer-row-title'>{timer.title}</div>
                {timer.recipeRef && onOpenRecipe && (
                    <a className='timer-row-recipe' title={`Open ${timer.recipeRef.recipeName}`}
                        onClick={() => onOpenRecipe(timer.recipeRef!)}>
                        <span className='codicon codicon-go-to-file'></span>
                        {timer.recipeRef.recipeName}
                        {timer.recipeRef.scale !== 1 && (
                            <span className='timer-row-scale'>×{timer.recipeRef.scale}</span>
                        )}
                    </a>
                )}
            </div>
            <div className='timer-row-progress'>
                <div className='timer-row-progress-fill' style={{ width: `${elapsedFraction * 100}%` }}></div>
            </div>
            <div className='timer-row-actions'>
                <button className='timer-row-action' title='Add one minute'
                    onClick={() => onAddTime(timer.id, 60)}>+1 min</button>
                <button className='timer-row-action' title={toggleTitle} onClick={() => onToggle(timer.id)}>
                    <span className={`codicon ${toggleIcon}`}></span>
                </button>
                <button className='timer-row-action' title='Reset' onClick={() => onReset(timer.id)}>
                    <span className='codicon codicon-debug-restart'></span>
                </button>
                <button className='timer-row-action' title='Delete' onClick={() => onRemove(timer.id)}>
                    <span className='codicon codicon-trash'></span>
                </button>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/browser/timer-components.spec.js"; cd ../..
```

Expected: all `TimerBadge` and `TimerRow` tests PASS.

> Everything from Task 6 compiles already, so a compile failure here is a real
> failure — do not work around it.

- [ ] **Step 5: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/timer-components.tsx packages/cooklang/src/browser/timer-components.spec.ts
git commit -m "feat(cooklang): add timer badge and panel row components"
```

---

## Task 8: Inline timers in the preview

Thread the step and timer position down to `StepItemView`, swap the static timer span for `TimerBadge`, and lift `scale` out of `RecipeView` so the widget owns it.

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx`
- Modify: `packages/cooklang/src/browser/style/recipe-preview.css`
- Test: `packages/cooklang/src/browser/recipe-preview-components.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/cooklang/src/browser/recipe-preview-components.spec.ts`:

```ts
describe('InstructionsPanel timer positions', () => {

    it('numbers timers within their step and steps across sections', () => {
        const sections: Section[] = [
            {
                name: null,
                content: [
                    {
                        type: 'step',
                        value: {
                            number: 1,
                            items: [
                                { type: 'timer', index: 0 },
                                { type: 'text', value: ' then ' },
                                { type: 'timer', index: 1 },
                            ],
                        },
                    },
                ],
            },
            {
                name: null,
                content: [
                    { type: 'step', value: { number: 1, items: [{ type: 'timer', index: 2 }] } },
                ],
            },
        ];
        const seen: Array<[number, number]> = [];
        const markup = renderToStaticMarkup(
            React.createElement(
                TimerBindingProvider,
                {
                    value: {
                        ref: (globalStepIndex: number, timerPosition: number) => {
                            seen.push([globalStepIndex, timerPosition]);
                            return {
                                recipePath: 'file:///a.cook',
                                recipeName: 'a',
                                globalStepIndex,
                                timerPosition,
                                scale: 1,
                            };
                        },
                        find: () => undefined,
                        start: () => undefined,
                        toggle: () => undefined,
                        reset: () => undefined,
                        addTime: () => undefined,
                        nowMs: () => 0,
                    },
                },
                React.createElement(InstructionsPanel, {
                    sections,
                    ingredients: [],
                    cookware: [],
                    timers: [
                        { name: null, quantity: { value: { type: 'number', value: { type: 'regular', value: 5 } }, unit: 'minutes', scalable: true } },
                        { name: null, quantity: { value: { type: 'number', value: { type: 'regular', value: 6 } }, unit: 'minutes', scalable: true } },
                        { name: null, quantity: { value: { type: 'number', value: { type: 'regular', value: 7 } }, unit: 'minutes', scalable: true } },
                    ],
                    inlineQuantities: [],
                    images: { steps: {} },
                })
            )
        );
        expect(seen).to.deep.equal([[0, 0], [0, 1], [1, 0]]);
        expect(markup).to.contain('5 minutes');
        expect(markup).to.contain('7 minutes');
    });
});
```

Add one import to the top of that spec file — everything else it needs (`expect`, `React`, `renderToStaticMarkup`, `Section`, `InstructionsPanel`) is already imported there:

```ts
import { TimerBindingProvider } from './timer-components';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/browser/recipe-preview-components.spec.js"; cd ../..
```

Expected: FAIL — `seen` is empty, because `StepItemView` still renders a static span.

- [ ] **Step 3: Thread the positions and render the badge**

In `packages/cooklang/src/browser/recipe-preview-components.tsx`:

Add the import:

```tsx
import { TimerBadge } from './timer-components';
```

Delete the now-unused `formatTimer` helper (its job moved to `timerBadgeLabel` in `timer-components.tsx`) and the `Timer` entry stays in the type imports because the props still carry timers.

Give `StepItemViewProps` the two new fields and use them:

```tsx
interface StepItemViewProps {
    item: StepItem;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
    globalStepIndex: number;
    /** Index of this item among the timer items of its step. */
    timerPosition: number;
}

const StepItemView = ({
    item,
    ingredients,
    cookware,
    timers,
    inlineQuantities,
    globalStepIndex,
    timerPosition,
}: StepItemViewProps): React.ReactElement => {
```

and replace the timer case:

```tsx
        case 'timer': {
            const timer = timers[item.index];
            if (!timer) {
                return <span className='timer-badge'>{`timer[${item.index}]`}</span>;
            }
            return (
                <TimerBadge timer={timer} globalStepIndex={globalStepIndex} timerPosition={timerPosition} />
            );
        }
```

In `SectionContentView`, accept `globalStepIndex` and count the timers as it maps:

```tsx
interface SectionContentViewProps {
    content: SectionContent;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
    imageSrc?: string;
    globalStepIndex: number;
}
```

and inside its step branch replace the `items.map(...)` call with:

```tsx
                {(() => {
                    let timerPosition = 0;
                    return items.map((item, idx) => {
                        const position = item.type === 'timer' ? timerPosition++ : 0;
                        return (
                            <StepItemView
                                key={idx}
                                item={item}
                                ingredients={ingredients}
                                cookware={cookware}
                                timers={timers}
                                inlineQuantities={inlineQuantities}
                                globalStepIndex={globalStepIndex}
                                timerPosition={position}
                            />
                        );
                    });
                })()}
```

In `InstructionsPanel`, capture the step's global index before it is incremented and pass it down:

```tsx
                        {section.content.map((content, cIdx) => {
                            let imageSrc: string | undefined;
                            const stepIndex = globalStepIndex;
                            if (content.type === 'step') {
                                if (images) {
                                    imageSrc = lookupStepImage(images, sIdx, stepInSection, globalStepIndex);
                                }
                                stepInSection++;
                                globalStepIndex++;
                            }
                            return (
                                <SectionContentView
                                    key={cIdx}
                                    content={content}
                                    ingredients={ingredients}
                                    cookware={cookware}
                                    timers={timers}
                                    inlineQuantities={inlineQuantities}
                                    imageSrc={imageSrc}
                                    globalStepIndex={stepIndex}
                                />
                            );
                        })}
```

- [ ] **Step 4: Make `scale` a controlled prop**

> Making these props required breaks `recipe-preview-widget.tsx`, whose
> `RecipeView` call site does not pass them yet. Fix that in this same commit
> so the package always compiles — add `protected scale = 1;` and a
> `handleScaleChange` to the widget and pass both down. Nothing else from
> Task 9: no `setScale()`, no timer service, no subscriptions.


Still in `recipe-preview-components.tsx`, change `RecipeViewProps` and the top of `RecipeView`:

```tsx
export interface RecipeViewProps {
    recipe: Recipe;
    fileName: string;
    images?: ResolvedRecipeImages;
    scale: number;
    onScaleChange: (scale: number) => void;
    onShowSource?: () => void;
    onAddToShoppingList?: (scale: number) => void;
    onNavigateToRecipe?: (referencePath: string) => void;
}

export const RecipeView = ({
    recipe,
    fileName,
    images,
    scale,
    onScaleChange,
    onShowSource,
    onAddToShoppingList,
    onNavigateToRecipe,
}: RecipeViewProps): React.ReactElement => {
    const meta = recipe.metadata.map;
```

(delete the `const [scale, setScale] = React.useState(1);` line) and change the input's handler:

```tsx
                            onChange={e => {
                                const val = parseFloat(e.target.value);
                                if (Number.isFinite(val) && val > 0) {
                                    onScaleChange(val);
                                }
                            }}
```

- [ ] **Step 5: Style the badge states**

Replace the `.theia-recipe-preview .timer-badge` rule in `packages/cooklang/src/browser/style/recipe-preview.css` with:

```css
.theia-recipe-preview .timer-badge {
    display: inline;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--theia-textCodeBlock-background, rgba(128, 128, 128, 0.15));
    border: 1px solid var(--theia-panel-border);
    font-weight: 700;
    font-size: 0.92em;
    white-space: nowrap;
}

.theia-recipe-preview .timer-badge-icon {
    margin-right: 3px;
    font-size: 0.9em;
    vertical-align: baseline;
}

.theia-recipe-preview .timer-badge-clock {
    font-family: var(--theia-editor-font-family, monospace);
}

.theia-recipe-preview .timer-badge-idle,
.theia-recipe-preview .timer-badge-running,
.theia-recipe-preview .timer-badge-paused,
.theia-recipe-preview .timer-badge-finished {
    cursor: pointer;
}

.theia-recipe-preview .timer-badge-idle:hover {
    border-color: var(--theia-focusBorder);
}

.theia-recipe-preview .timer-badge-running {
    background: var(--theia-editorInfo-foreground);
    border-color: var(--theia-editorInfo-foreground);
    color: var(--theia-editor-background);
}

.theia-recipe-preview .timer-badge-paused {
    opacity: 0.7;
    border-style: dashed;
}

.theia-recipe-preview .timer-badge-finished {
    /* The inputValidation warning pair is designed as background-plus-text and
       stays legible in both themes. Using editorWarning-foreground as a
       background instead only reached ~3.1:1 against editor-background in the
       light theme, under the 4.5:1 needed for text this size. */
    background: var(--theia-inputValidation-warningBackground);
    border-color: var(--theia-inputValidation-warningBorder, var(--theia-editorWarning-foreground));
    color: var(--theia-foreground);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml "./lib/browser/recipe-preview-components.spec.js"; cd ../..
```

Expected: the new `InstructionsPanel timer positions` test PASSES **and** the original `InstructionsPanel step image indices` tests still PASS.

- [ ] **Step 7: Lint and commit**

```bash
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-components.tsx \
        packages/cooklang/src/browser/recipe-preview-components.spec.ts \
        packages/cooklang/src/browser/style/recipe-preview.css
git commit -m "feat(cooklang): render runnable timer badges in recipe steps"
```

---

## Task 9: Widget supplies the timer binding and owns the scale

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`

No new spec: this file imports `MonacoWorkspace`, so a spec for it would break the mocha harness (see `feedback_spec_monaco_css_harness`). Its logic is thin glue over already-tested pieces.

- [ ] **Step 1: Add the imports and injections**

In `packages/cooklang/src/browser/recipe-preview-widget.tsx` add:

```tsx
import { TimerRecipeRef } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';
import { TimerBinding, TimerBindingProvider } from './timer-components';
```

and next to the other `@inject` fields:

```tsx
    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;
```

- [ ] **Step 2: Own the scale and expose a setter**

Task 8 already added `protected scale = 1;` and `handleScaleChange`, and
already passes both to `RecipeView`. Only the external setter is missing.
Add it next to `handleShowSource`:

```tsx
    /**
     * Set the displayed scale from outside the React tree — used when opening a
     * recipe from a timer that was started at a different scale.
     */
    setScale(scale: number): void {
        if (Number.isFinite(scale) && scale > 0 && scale !== this.scale) {
            this.scale = scale;
            this.update();
        }
    }
```

- [ ] **Step 3: Build the timer binding**

Add next to the other handlers:

```tsx
    /** The recipe's display name, used to label timers in the Timers panel. */
    protected recipeName(): string {
        const name = this.recipe?.metadata.map['name'];
        if (name !== undefined && name !== '') {
            return String(name);
        }
        return (this.uri?.path.base ?? '').replace(/\.cook$/i, '');
    }

    protected readonly timerBinding: TimerBinding = {
        ref: (globalStepIndex: number, timerPosition: number): TimerRecipeRef => ({
            recipePath: this.uri?.toString() ?? '',
            recipeName: this.recipeName(),
            globalStepIndex,
            timerPosition,
            scale: this.scale,
        }),
        find: ref => this.timerService.find(ref),
        start: (ref, title, durationSeconds) => this.timerService.start(ref, title, durationSeconds),
        toggle: id => this.timerService.toggle(id),
        reset: id => this.timerService.reset(id),
        addTime: (id, seconds) => this.timerService.addTime(id, seconds),
        nowMs: () => this.timerService.nowMs(),
    };
```

- [ ] **Step 4: Re-render on every tick**

In `init()`, after `this.listenToDocumentChanges();`, add:

```tsx
        this.toDispose.push(this.timerService.onDidChangeTimers(() => this.update()));
```

- [ ] **Step 5: Wrap the view**

Replace the `this.recipe` branch of `render()`:

```tsx
        if (this.recipe) {
            return (
                <TimerBindingProvider value={this.timerBinding}>
                    <LinkOpenerProvider value={this.handleOpenLink}>
                        <RecipeView
                            recipe={this.recipe}
                            fileName={this.uri?.path.base ?? ''}
                            images={this.images}
                            scale={this.scale}
                            onScaleChange={this.handleScaleChange}
                            onShowSource={this.handleShowSource}
                            onAddToShoppingList={this.handleAddToShoppingList}
                            onNavigateToRecipe={this.handleNavigateToRecipe}
                        />
                    </LinkOpenerProvider>
                </TimerBindingProvider>
            );
        }
```

- [ ] **Step 6: Compile, lint and commit**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-widget.tsx
git commit -m "feat(cooklang): connect the recipe preview to the timer service"
```

> The package compiles cleanly at this point. A compile failure here is a real
> failure — do not work around it.

---

## Task 10: Open a recipe at a recorded scale

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-contribution.ts`

- [ ] **Step 1: Add the command**

In `packages/cooklang/src/browser/recipe-preview-contribution.ts`, add to the `CooklangPreviewCommands` namespace:

```ts
    export const OPEN_PREVIEW_AT_SCALE: Command = {
        id: 'cooklang.openPreviewAtScale',
        label: 'Cooklang: Open Preview at Scale',
    };
```

- [ ] **Step 2: Register it**

In `registerCommands`, after the existing `OPEN_SOURCE` registration:

```ts
        commands.registerCommand(CooklangPreviewCommands.OPEN_PREVIEW_AT_SCALE, {
            execute: (uri: URI | string, scale: number) => this.openPreviewAtScale(uri, scale),
            // Invoked from the Timers panel, never from the command palette.
            isVisible: () => false,
        });
```

- [ ] **Step 3: Implement it**

Add next to `togglePreview`:

```ts
    /**
     * Open (or reveal) the preview for `uri` and set its scale — the way back
     * from a timer in the Timers panel to the recipe it came from.
     */
    protected async openPreviewAtScale(uri: URI | string, scale: number): Promise<void> {
        const target = typeof uri === 'string' ? new URI(uri) : uri;
        if (!CooklangUri.isRecipe(target)) {
            return;
        }
        const preview = await this.getOrCreatePreview(target);
        preview.setScale(scale);
        await this.shell.addWidget(preview, { area: 'main' });
        this.shell.activateWidget(preview.id);
    }
```

- [ ] **Step 4: Compile, lint and commit**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-contribution.ts
git commit -m "feat(cooklang): add openPreviewAtScale command"
```

---

## Task 11: Timers panel, view contribution and bindings

**Files:**
- Create: `packages/cooklang/src/browser/timers-widget.tsx`
- Create: `packages/cooklang/src/browser/timers-view-contribution.ts`
- Create: `packages/cooklang/src/browser/style/timers.css`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the widget**

Create `packages/cooklang/src/browser/timers-widget.tsx`:

```tsx
<LICENSE HEADER>

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import * as React from '@theia/core/shared/react';
import { TimerRecipeRef } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';
import { TimerRow } from './timer-components';

import '../../src/browser/style/timers.css';

export const TIMERS_WIDGET_ID = 'cooklang-timers';

/**
 * Lists every started timer across every recipe, so a timer stays visible after
 * you scroll past its step or close its preview. A port of the iOS app's
 * `TimersView`.
 */
@injectable()
export class TimersWidget extends ReactWidget {

    static readonly ID = TIMERS_WIDGET_ID;
    static readonly LABEL = 'Timers';

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @postConstruct()
    protected init(): void {
        this.id = TIMERS_WIDGET_ID;
        this.title.label = TimersWidget.LABEL;
        this.title.caption = TimersWidget.LABEL;
        this.title.iconClass = 'codicon codicon-watch';
        this.title.closable = true;
        this.addClass('theia-cooklang-timers');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.toDispose.push(this.timerService.onDidChangeTimers(() => this.update()));
        this.update();
    }

    protected handleToggle = (id: string): void => this.timerService.toggle(id);
    protected handleReset = (id: string): void => this.timerService.reset(id);
    protected handleAddTime = (id: string, seconds: number): void => this.timerService.addTime(id, seconds);
    protected handleRemove = (id: string): void => this.timerService.remove(id);
    protected handleRemoveFinished = (): void => this.timerService.removeFinished();
    protected handleRemoveAll = (): void => this.timerService.removeAll();

    protected handleOpenRecipe = (ref: TimerRecipeRef): void => {
        this.commandRegistry.executeCommand('cooklang.openPreviewAtScale', ref.recipePath, ref.scale);
    };

    protected render(): React.ReactNode {
        const timers = CookingTimerService.sortForDisplay(this.timerService.list());
        if (timers.length === 0) {
            return (
                <div className='timers-empty'>
                    No timers yet. Click a time in a recipe step to start one.
                </div>
            );
        }
        const hasFinished = timers.some(timer => timer.state === 'finished');
        const nowMs = this.timerService.nowMs();
        return (
            <div className='timers-body'>
                <div className='timers-header'>
                    {hasFinished && (
                        <button className='timers-header-action' onClick={this.handleRemoveFinished}>
                            Clear finished
                        </button>
                    )}
                    <button className='timers-header-action' onClick={this.handleRemoveAll}>
                        Clear all
                    </button>
                </div>
                {timers.map(timer => (
                    <TimerRow
                        key={timer.id}
                        timer={timer}
                        nowMs={nowMs}
                        onToggle={this.handleToggle}
                        onReset={this.handleReset}
                        onAddTime={this.handleAddTime}
                        onRemove={this.handleRemove}
                        onOpenRecipe={this.handleOpenRecipe}
                    />
                ))}
            </div>
        );
    }
}
```

- [ ] **Step 2: Write the view contribution**

Create `packages/cooklang/src/browser/timers-view-contribution.ts`:

```ts
<LICENSE HEADER>

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TimersWidget, TIMERS_WIDGET_ID } from './timers-widget';
import { TimersCommands } from './timers-commands';

@injectable()
export class TimersViewContribution extends AbstractViewContribution<TimersWidget> {

    constructor() {
        super({
            widgetId: TIMERS_WIDGET_ID,
            widgetName: TimersWidget.LABEL,
            defaultWidgetOptions: {
                area: 'right',
            },
            toggleCommandId: TimersCommands.TOGGLE_VIEW.id,
        });
    }
}
```

- [ ] **Step 3: Write the stylesheet**

Create `packages/cooklang/src/browser/style/timers.css`:

```css
.theia-cooklang-timers {
    padding: 8px;
    color: var(--theia-foreground);
    font-size: var(--theia-ui-font-size1);
}

.theia-cooklang-timers .timers-empty {
    padding: 16px 8px;
    color: var(--theia-descriptionForeground);
    line-height: 1.5;
}

.theia-cooklang-timers .timers-header {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-bottom: 8px;
}

.theia-cooklang-timers .timers-header-action {
    background: none;
    border: none;
    color: var(--theia-textLink-foreground);
    cursor: pointer;
    padding: 2px 4px;
}

.theia-cooklang-timers .timer-row {
    border: 1px solid var(--theia-panel-border);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 8px;
}

.theia-cooklang-timers .timer-row-finished {
    border-color: var(--theia-editorWarning-foreground);
}

.theia-cooklang-timers .timer-row-paused {
    opacity: 0.75;
}

.theia-cooklang-timers .timer-row-clock {
    font-family: var(--theia-editor-font-family, monospace);
    font-size: 1.8em;
    font-weight: 700;
    line-height: 1.1;
}

.theia-cooklang-timers .timer-row-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.theia-cooklang-timers .timer-row-recipe {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    /* A real button for keyboard and assistive tech, styled as a link. */
    background: none;
    border: none;
    padding: 0;
    color: var(--theia-textLink-foreground);
    cursor: pointer;
    font-size: 0.92em;
    font-family: inherit;
}

.theia-cooklang-timers .timer-row-recipe:focus-visible {
    outline: 1px solid var(--theia-focusBorder);
    outline-offset: 2px;
}

.theia-cooklang-timers .timer-row-recipe:hover {
    text-decoration: underline;
}

.theia-cooklang-timers .timer-row-scale {
    color: var(--theia-descriptionForeground);
}

.theia-cooklang-timers .timer-row-progress {
    height: 3px;
    background: var(--theia-panel-border);
    border-radius: 2px;
    margin: 8px 0;
    overflow: hidden;
}

.theia-cooklang-timers .timer-row-progress-fill {
    height: 100%;
    background: var(--theia-progressBar-background);
}

.theia-cooklang-timers .timer-row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
}

.theia-cooklang-timers .timer-row-action {
    background: none;
    border: 1px solid var(--theia-panel-border);
    border-radius: 3px;
    color: var(--theia-foreground);
    cursor: pointer;
    padding: 2px 6px;
}

.theia-cooklang-timers .timer-row-action:hover {
    border-color: var(--theia-focusBorder);
}
```

- [ ] **Step 4: Bind everything**

In `packages/cooklang/src/browser/cooklang-frontend-module.ts`, add the imports:

```ts
import { CookingTimerService } from './cooking-timer-service';
import { TimerChime } from './timer-chime';
import { TimerAlarmService } from './timer-alarm-service';
import { TimersWidget, TIMERS_WIDGET_ID } from './timers-widget';
import { TimersViewContribution } from './timers-view-contribution';
```

and add this block next to the shopping-list bindings:

```ts
    // --- Timers ---
    bind(CookingTimerService).toSelf().inSingletonScope();
    bind(TimerChime).toSelf().inSingletonScope();
    bind(TimerAlarmService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TimerAlarmService);

    bind(TimersWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: TIMERS_WIDGET_ID,
        createWidget: () => ctx.container.get<TimersWidget>(TimersWidget),
    })).inSingletonScope();

    bindViewContribution(bind, TimersViewContribution);
```

- [ ] **Step 5: Compile, lint and run the whole suite**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
npx lerna run test --scope @theia/cooklang
```

Expected: compile succeeds with no errors, lint is clean, every spec in `@theia/cooklang` passes.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/timers-widget.tsx \
        packages/cooklang/src/browser/timers-view-contribution.ts \
        packages/cooklang/src/browser/style/timers.css \
        packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): add the Timers panel"
```

---

## Task 12: Verify in the real app

- [ ] **Step 1: Build and launch**

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd app && npm run bundle && cd ..
npm run start:electron
```

- [ ] **Step 2: Write a test recipe**

Create a `.cook` file in the open workspace. Use YAML frontmatter — the `>>` metadata syntax is deprecated and must not be used.

```
---
title: Timer Check
source: https://cooklang.org/docs/spec/
author: chef@cook.md
---

Boil the @water{1%l} for ~{10%seconds} then rest ~dough{15%seconds}.

Bake for ~{50-60%minutes} and reduce ~{until thick}.

> Notes at https://cook.md/help/ios/using-the-app are worth reading.
```

- [ ] **Step 3: Walk the checklist**

- [ ] The `source` URL and the `author` email in the metadata pills are links; clicking one opens the system browser, not a tab inside the editor.
- [ ] The URL in the note block is a link.
- [ ] `~{10%seconds}` and `~dough{15%seconds}` render as clickable badges; `~{until thick}` renders as plain, unclickable text.
- [ ] `~{50-60%minutes}` shows the range as written and starts a 50-minute timer.
- [ ] Clicking a badge starts it; the badge counts down; clicking again pauses; clicking again resumes.
- [ ] Switch between a light and a dark theme with a running, a paused and a finished badge on screen. All three read clearly and are distinguishable from an unstarted badge in both.
- [ ] Tab to a timer badge and press Enter, then Space. Both start it. The badge is a `span` with `role='button'`, which gets no keyboard activation from the browser, and `renderToStaticMarkup` cannot exercise handlers — so this is only ever verified here.
- [ ] Tab through a Timers panel row: the recipe control and all four buttons take focus and activate from the keyboard.
- [ ] The Timers view (right side bar, `codicon-watch`) lists the running timers with recipe name, `+1 min`, play/pause, reset and delete.
- [ ] Set Scale to 2, start a timer, then click that timer's recipe link in the panel — the preview opens with Scale showing 2.
- [ ] Let a 10-second timer finish with the editor window **in the background**: an OS notification appears and the chime plays.
- [ ] The chime specifically: start a timer and let it finish **without clicking anything else in the window first**, with the window backgrounded. A renderer `AudioContext` starts suspended until a user gesture, and the whole promise of this feature is that it fires while you are not interacting with the app. Electron defaults `autoplayPolicy` to `no-user-gesture-required`, so this should work — but that is reasoning, not evidence, and this is the check that turns it into evidence. If it is silent, the fix is `webPreferences.autoplayPolicy`, not the chime code.
- [ ] Two timers finishing within a second of each other: both notifications appear, and the chime does not distort.
- [ ] Reload the window (`Ctrl/Cmd+R`) mid-countdown: the timer is still there with the right remaining time.
- [ ] Quit and relaunch with a timer whose duration has passed in the meantime: it comes back finished, with no notification replayed.
- [ ] Turn off `cooklang.timers.sound` in Preferences: a finishing timer notifies silently.

- [ ] **Step 4: Commit any fixes and open the PR**

```bash
git add -A
git commit -m "fix(cooklang): address manual verification findings"
git push -u origin feature/preview-timers-and-links
gh pr create --fill --base main
```

The PR body should close the issue: add `Closes #95`.
