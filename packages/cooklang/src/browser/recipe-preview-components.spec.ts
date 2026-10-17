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
import { Recipe, Section } from '../common/recipe-types';
import { ResolvedRecipeImages } from '../common/recipe-images';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { OutletItem } from './cooklang-outlet-service';
import { InstructionsPanel, RecipeView, RecipeViewProps } from './recipe-preview-components';
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

    // Hub images are third-party URLs: loading one must not tell that host
    // which recipe (or which local path) the user is looking at.
    it('loads step images without a referrer', () => {
        const markup = render([{ name: null, content: [step('one', 1)] }], { steps: { '0': { '0': 'https://cdn.example/one.jpg' } } });
        expect(markup).to.match(/<img [^>]*referrerPolicy="no-referrer"/i);
    });
});

describe('RecipeView badges', () => {

    const EMPTY_RECIPE: Recipe = {
        metadata: { map: {} },
        sections: [],
        ingredients: [],
        cookware: [],
        timers: [],
        inline_quantities: [],
    };

    const TOOLBAR_ITEMS: OutletItem[] = [{ id: 'save', label: 'Save' }];

    const BADGES: PreviewBadge[] = [
        { kind: 'nutriscore', grade: 'B', tooltipMarkdown: 'Nutri-Score B' },
        { kind: 'pill', text: '540 kcal', tone: 'neutral', tooltipMarkdown: 'Per serving' },
    ];

    function renderView(props: Partial<RecipeViewProps> = {}): string {
        return renderToStaticMarkup(
            React.createElement(RecipeView, {
                recipe: EMPTY_RECIPE,
                title: 'Pancakes',
                scale: 1,
                onScaleChange: () => undefined,
                toolbarItems: TOOLBAR_ITEMS,
                onRunToolbarItem: () => undefined,
                ...props,
            })
        );
    }

    it('renders badges in the header before the action bar when badges and handlers are provided', () => {
        const markup = renderView({ badges: BADGES, onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
        const nutriscoreIndex = markup.indexOf('cooklang-nutriscore');
        const pillIndex = markup.indexOf('cooklang-badge-pill');
        const actionBarIndex = markup.indexOf('theia-cooklang-action-bar');
        expect(nutriscoreIndex, markup).to.be.greaterThan(-1);
        expect(pillIndex, markup).to.be.greaterThan(-1);
        expect(actionBarIndex, markup).to.be.greaterThan(-1);
        expect(nutriscoreIndex).to.be.lessThan(actionBarIndex);
        expect(pillIndex).to.be.lessThan(actionBarIndex);
    });

    it('renders no badges when badges are provided without handlers', () => {
        const markup = renderView({ badges: BADGES });
        expect(markup).to.not.contain('cooklang-nutriscore');
        expect(markup).to.not.contain('cooklang-badge-pill');
    });

    it('renders no badges when handlers are provided without badges', () => {
        const markup = renderView({ onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
        expect(markup).to.not.contain('cooklang-nutriscore');
        expect(markup).to.not.contain('cooklang-badge-pill');
    });

    it('renders placeholders instead of badges while the first result is pending', () => {
        const markup = renderView({
            badges: [], badgesPending: true, placeholderCount: 3,
            onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined,
        });
        expect((markup.match(/cooklang-badge-placeholder/g) ?? []).length).to.equal(3);
        expect(markup).to.contain('aria-label="Loading badges"');
        expect(markup).to.contain('aria-busy="true"');
        expect(markup).to.not.contain('cooklang-badge-pill');
        // Placeholders are decorative; only the container is announced.
        expect(markup.match(/<span class="cooklang-badge-placeholder"[^>]*>/g)?.every(span => span.includes('aria-hidden="true"'))).to.equal(true);
    });

    it('caps the placeholders at 6 and renders none for a remembered count of 0', () => {
        const handlers = { onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined };
        expect((renderView({ badgesPending: true, placeholderCount: 50, ...handlers }).match(/cooklang-badge-placeholder/g) ?? []).length).to.equal(6);
        expect(renderView({ badgesPending: true, placeholderCount: 0, ...handlers })).to.not.contain('cooklang-preview-badges');
    });

    it('replaces the placeholders with the real badges once the result arrives', () => {
        const markup = renderView({
            badges: BADGES, badgesPending: false, placeholderCount: 3,
            onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined,
        });
        expect(markup).to.not.contain('cooklang-badge-placeholder');
        expect(markup).to.not.contain('Loading badges');
        expect(markup).to.contain('cooklang-badge-pill');
    });

    it('keeps showing the previous badges across a refresh (not pending)', () => {
        const handlers = { onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined };
        const before = renderView({ badges: BADGES, badgesPending: false, ...handlers });
        const duringRefresh = renderView({ badges: BADGES, badgesPending: false, placeholderCount: 3, ...handlers });
        expect(duringRefresh).to.equal(before);
        expect(duringRefresh).to.contain('cooklang-badge-pill');
    });

    it('renders the action bar inside the fixed actions container, outside the badges container', () => {
        const markup = renderView({
            badges: BADGES, onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined,
        });
        const badgesMatch = markup.match(/<div class="cooklang-preview-badges">.*?<\/div>(?=<div class="cooklang-preview-actions">)/s);
        expect(badgesMatch, markup).to.not.equal(null); // eslint-disable-line no-null/no-null
        expect(markup).to.match(/<div class="cooklang-preview-actions"><div class="theia-cooklang-action-bar">/);
        expect(badgesMatch![0]).to.not.contain('theia-cooklang-action-bar');
        // The actions container is rendered even with no badges and while pending, so its position never depends on them.
        expect(renderView()).to.contain('cooklang-preview-actions');
        expect(renderView({ badgesPending: true, placeholderCount: 2 })).to.contain('cooklang-preview-actions');
    });
});
