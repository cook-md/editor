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
    /** The live timer at `ref`, if one has been started. */
    find(ref: TimerRecipeRef): ActiveTimer | undefined;
    /** Start a new timer at `ref` with the given title and duration. */
    start(ref: TimerRecipeRef, title: string, durationSeconds: number): void;
    /** Pause a running timer, or resume/restart a paused or finished one. */
    toggle(id: string): void;
    /** Reset a timer back to its full duration, paused. */
    reset(id: string): void;
    /** Extend (or shorten, with a negative value) a timer's remaining time. */
    addTime(id: string, seconds: number): void;
    /** The current wall-clock time, in milliseconds. */
    nowMs(): number;
}

const TimerBindingContext = React.createContext<TimerBinding | undefined>(undefined);

/** Wraps a subtree so the timer badges inside it are backed by `value`. */
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
    return timer.name || quantity;
}

/**
 * Enter and Space activate a `role='button'` element. The browser does this
 * for a real `<button>` but not for a span, so we have to.
 */
function activateOnKey(activate: () => void): (event: React.KeyboardEvent) => void {
    return event => {
        if (event.key === 'Enter' || event.key === ' ') {
            // Space would otherwise scroll the preview.
            event.preventDefault();
            activate();
        }
    };
}

/** Tooltip shown on a started badge, per lifecycle state. */
const BADGE_TITLES: Record<string, string> = {
    running: 'Pause timer',
    paused: 'Resume timer',
    finished: 'Restart timer',
};

/** Props for {@link TimerBadge}. */
export interface TimerBadgeProps {
    timer: Timer;
    globalStepIndex: number;
    timerPosition: number;
}

/**
 * The inline `~timer` badge in a recipe step. Renders as today's plain,
 * unclickable `<span className='timer-badge'>` when there is no
 * {@link TimerBindingProvider} above it, or when the timer has no runnable
 * duration (`~{until golden}`, bare `~sauce`). Otherwise it is clickable:
 * idle badges start the timer, and running/paused/finished badges toggle it.
 */
export const TimerBadge = ({ timer, globalStepIndex, timerPosition }: TimerBadgeProps): React.ReactElement => {
    const binding = React.useContext(TimerBindingContext);
    const label = timerBadgeLabel(timer);
    const duration = timerDurationSeconds(timer);

    if (!binding || duration === undefined) {
        return <span className='timer-badge'>{label}</span>;
    }

    const ref = binding.ref(globalStepIndex, timerPosition);
    const active = binding.find(ref);

    if (!active) {
        const start = (): void => binding.start(ref, timer.name || label, duration);
        return (
            <span className='timer-badge timer-badge-idle' role='button' tabIndex={0}
                title={`Start a ${formatDuration(duration)} timer`}
                onClick={start} onKeyDown={activateOnKey(start)}>
                <span className='codicon codicon-watch timer-badge-icon'></span>
                {label}
            </span>
        );
    }

    const toggle = (): void => binding.toggle(active.id);

    return (
        <span className={`timer-badge timer-badge-${active.state}`} role='button' tabIndex={0}
            title={BADGE_TITLES[active.state]}
            onClick={toggle} onKeyDown={activateOnKey(toggle)}>
            <span className='codicon codicon-watch timer-badge-icon'></span>
            <span className='timer-badge-clock'>{formatClock(remainingSeconds(active, binding.nowMs()))}</span>
        </span>
    );
};

// ---------------------------------------------------------------------------
// TimerRow  (one entry in the Timers panel)
// ---------------------------------------------------------------------------

/** Props for {@link TimerRow}. */
export interface TimerRowProps {
    timer: ActiveTimer;
    nowMs: number;
    onToggle: (id: string) => void;
    onReset: (id: string) => void;
    onAddTime: (id: string, seconds: number) => void;
    onRemove: (id: string) => void;
    onOpenRecipe?: (ref: TimerRecipeRef) => void;
}

/**
 * One row of the Timers panel: the countdown, the timer's title, a link back
 * to the recipe it came from (when it has one), a progress bar, and the
 * add-time/toggle/reset/remove controls.
 */
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
                    <button className='timer-row-recipe' title={`Open ${timer.recipeRef.recipeName}`}
                        onClick={() => onOpenRecipe(timer.recipeRef!)}>
                        <span className='codicon codicon-go-to-file'></span>
                        {timer.recipeRef.recipeName}
                        {timer.recipeRef.scale !== 1 && (
                            <span className='timer-row-scale'>×{timer.recipeRef.scale}</span>
                        )}
                    </button>
                )}
            </div>
            <div className='timer-row-progress'>
                <div className='timer-row-progress-fill' style={{ width: `${(elapsedFraction * 100).toFixed(2)}%` }}></div>
            </div>
            <div className='timer-row-actions'>
                <button className='timer-row-action' title='Add one minute'
                    onClick={() => onAddTime(timer.id, 60)}>+1 min</button>
                <button className='timer-row-action' title={toggleTitle} aria-label={toggleTitle}
                    onClick={() => onToggle(timer.id)}>
                    <span className={`codicon ${toggleIcon}`}></span>
                </button>
                <button className='timer-row-action' title='Reset' aria-label='Reset' onClick={() => onReset(timer.id)}>
                    <span className='codicon codicon-debug-restart'></span>
                </button>
                <button className='timer-row-action' title='Delete' aria-label='Delete' onClick={() => onRemove(timer.id)}>
                    <span className='codicon codicon-trash'></span>
                </button>
            </div>
        </div>
    );
};
