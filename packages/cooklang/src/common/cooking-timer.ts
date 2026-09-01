// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

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

/**
 * Creates a new timer, already running, anchored to `nowMs`.
 */
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

/**
 * The time left on `timer` at `nowMs`, in seconds. Never negative.
 */
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

/**
 * Whether a running `timer` has counted all the way down by `nowMs`.
 */
export function isExpired(timer: ActiveTimer, nowMs: number): boolean {
    return timer.state === 'running' && remainingSeconds(timer, nowMs) <= 0;
}

/**
 * Freezes a running timer's remaining time. A no-op on a timer that is not
 * running.
 */
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

/**
 * Continues a paused (or finished) timer from where it left off. A no-op on
 * a timer that is already running.
 */
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

/**
 * Marks `timer` as expired, with no time remaining.
 */
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

/**
 * Extends `timer` by `seconds`. Extending a finished timer revives it as
 * paused, holding just the added time.
 */
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
