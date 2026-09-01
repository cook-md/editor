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
