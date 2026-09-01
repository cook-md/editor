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
import { Section } from '../common/recipe-types';
import { ResolvedRecipeImages } from '../common/recipe-images';
import { InstructionsPanel } from './recipe-preview-components';
import { TimerBindingProvider } from './timer-components';

/** A step whose only content is `text`, so it is identifiable in the markup. */
function step(text: string, number: number): Section['content'][number] {
    return { type: 'step', value: { items: [{ type: 'text', value: text }], number } };
}

function render(sections: Section[], images: ResolvedRecipeImages): string {
    return renderToStaticMarkup(
        React.createElement(InstructionsPanel, {
            sections,
            ingredients: [],
            cookware: [],
            timers: [],
            inlineQuantities: [],
            images,
        })
    );
}

/** The `src` of the image rendered inside the step whose text is `text`, if any. */
function imageForStep(markup: string, text: string): string | undefined {
    const start = markup.indexOf(text);
    expect(start, `step "${text}" is not in the markup`).to.be.greaterThan(-1);
    const next = markup.indexOf('class="step-item"', start);
    const slice = next === -1 ? markup.substring(start) : markup.substring(start, next);
    return /class="step-image" src="([^"]*)"/.exec(slice)?.[1];
}

describe('InstructionsPanel step image indices', () => {

    // Two sections, 2 + 1 steps. The third step overall is both global index 2
    // (the linear entry `linear.jpg`) and section 1 / step 0 (`sec.jpg`), so it
    // pins the section-beats-linear precedence end to end.
    const sections: Section[] = [
        { name: 'Prep', content: [step('one', 1), step('two', 2)] },
        { name: 'Cook', content: [step('three', 1)] },
    ];

    const images: ResolvedRecipeImages = {
        steps: {
            '0': { '2': 'linear.jpg' },
            '1': { '0': 'sec.jpg' },
        },
    };

    it('gives the third step the section image, not the linear one', () => {
        expect(imageForStep(render(sections, images), 'three')).to.equal('sec.jpg');
    });

    it('gives the first two steps no image', () => {
        const markup = render(sections, images);
        expect(imageForStep(markup, 'one')).to.be.undefined;
        expect(imageForStep(markup, 'two')).to.be.undefined;
    });

    // Same recipe with the section entry removed: the third step now falls back
    // to the linear entry, which proves the global index really is 2 there.
    it('falls back to the linear image at the global step index', () => {
        const markup = render(sections, { steps: { '0': { '2': 'linear.jpg' } } });
        expect(imageForStep(markup, 'three')).to.equal('linear.jpg');
        expect(imageForStep(markup, 'one')).to.be.undefined;
        expect(imageForStep(markup, 'two')).to.be.undefined;
    });

    // Text content between steps must not advance either counter.
    it('does not count text notes as steps', () => {
        const withNote: Section[] = [
            { name: 'Only', content: [step('one', 1), { type: 'text', value: 'a note' }, step('two', 2)] },
        ];
        const markup = render(withNote, { steps: { '0': { '1': 'second.jpg' } } });
        expect(imageForStep(markup, 'two')).to.equal('second.jpg');
        expect(imageForStep(markup, 'one')).to.be.undefined;
    });
});

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
