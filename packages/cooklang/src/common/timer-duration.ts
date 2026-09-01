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
