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

    it('treats non-finite input as zero', () => {
        expect(formatClock(NaN)).to.equal('00:00');
        expect(formatClock(Infinity)).to.equal('00:00');
        expect(formatClock(-Infinity)).to.equal('00:00');
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

    it('treats non-finite input as zero', () => {
        expect(formatDuration(NaN)).to.equal('0 sec');
        expect(formatDuration(Infinity)).to.equal('0 sec');
    });
});
