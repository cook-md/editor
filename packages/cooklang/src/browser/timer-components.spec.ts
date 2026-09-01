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
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActiveTimer, TimerRecipeRef, createAndStart, finish, pause } from '../common/cooking-timer';
import { Timer } from '../common/recipe-types';
import { TimerBadge, TimerBinding, TimerBindingProvider, TimerRow, timerBadgeLabel } from './timer-components';

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

    it('falls back to the duration when the name is empty', () => {
        expect(timerBadgeLabel(minuteTimer(10, ''))).to.equal('10 minutes');
        expect(renderBadge(minuteTimer(10, ''), undefined)).to.contain('10 minutes');
    });

    it('shows a bare named timer with no duration', () => {
        expect(timerBadgeLabel({ name: 'sauce', quantity: null })).to.equal('sauce');
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

    it('shows the frozen clock on a paused timer', () => {
        const active = pause(createAndStart('t1', 'sauce', 600, T0 - 90_000, ref()), T0);
        expect(renderBadge(minuteTimer(10, 'sauce'), active)).to.contain('08:30');
    });

    it('marks a finished timer at zero', () => {
        const active = finish(createAndStart('t1', 'sauce', 600, T0 - 600_000, ref()), T0);
        const markup = renderBadge(minuteTimer(10, 'sauce'), active);
        expect(markup).to.contain('timer-badge-finished');
        expect(markup).to.contain('00:00');
    });

    it('escapes user-authored text rather than rendering it as markup', () => {
        const markup = renderBadge(minuteTimer(10, '<img src=x onerror=alert(1)>'), undefined);
        expect(markup).to.not.contain('<img');
        expect(markup).to.contain('&lt;img');
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

    it('shows the scale when the recipe was not at 1x', () => {
        const scaled: TimerRecipeRef = { ...ref(), scale: 2 };
        const timer: ActiveTimer = { ...createAndStart('t1', 'a', 600, T0, scaled) };
        expect(renderRow(timer)).to.contain('×2');
    });

    it('omits the recipe control when there is no handler for it', () => {
        const markup = renderToStaticMarkup(
            React.createElement(TimerRow, {
                timer: createAndStart('t1', 'a', 600, T0, ref()),
                nowMs: T0,
                onToggle: () => undefined,
                onReset: () => undefined,
                onAddTime: () => undefined,
                onRemove: () => undefined,
            })
        );
        expect(markup).to.not.contain('timer-row-recipe');
    });
});
