// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { MenuPath } from '@theia/core/lib/common/menu';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { PreviewBadgeController, PreviewBadgeHost } from './preview-badge-controller';

const OUTLET: MenuPath = ['cooklang/test/badge'];
const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 };
const PILL: PreviewBadge = { kind: 'pill', text: 'x', tone: 'neutral', tooltipMarkdown: '' };

/** Poll until `condition` holds. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

class Harness {
    readonly calls: Array<{ menuPath: MenuPath; context: object; element: HTMLElement | undefined }> = [];
    collect: () => Promise<PreviewBadge[]> = async () => [];
    context: object | undefined = CONTEXT;
    uri: string | undefined = 'file:///ws/a.cook';
    contributions = 4;
    visible = true;
    changes = 0;
    cancels = 0;
    lastOnHide: (() => void) | undefined;
    readonly element = document.createElement('div');
    readonly controller: PreviewBadgeController;

    constructor() {
        const outlets = {
            getItems: () => Array.from({ length: this.contributions }, (_, i) => ({ id: `c${i}`, label: 'c' })),
            collectBadges: async (menuPath: MenuPath, context: object, element?: HTMLElement): Promise<PreviewBadge[]> => {
                this.calls.push({ menuPath, context, element });
                return this.collect();
            },
        };
        const hoverService = {
            requestHover: (request: { onHide?: () => void }) => {
                // The real service cancels the open hover first, running its `onHide` synchronously.
                this.lastOnHide?.();
                this.lastOnHide = request.onHide;
            },
            cancelHover: () => { this.cancels++; },
        };
        const host: PreviewBadgeHost = {
            outlet: OUTLET,
            element: this.element,
            context: () => this.context,
            isVisible: () => this.visible,
            uri: () => this.uri,
            onDidChangeBadges: () => { this.changes++; },
        };
        this.controller = new PreviewBadgeController(outlets as never, hoverService as never, host);
        this.controller.debounceMs = 1;
    }
}

describe('PreviewBadgeController', () => {

    beforeEach(() => PreviewBadgeController.clearMemory());

    it('collects badges from the outlet with the host context and element once the debounce elapses', async () => {
        const harness = new Harness();
        harness.collect = async () => [PILL];
        harness.controller.schedule();
        await until(() => harness.controller.badges.length > 0);
        expect(harness.calls).to.have.lengthOf(1);
        expect(harness.calls[0]).to.deep.equal({ menuPath: OUTLET, context: CONTEXT, element: harness.element });
        expect(harness.controller.badges).to.deep.equal([PILL]);
        expect(harness.changes).to.equal(1);
    });

    it('coalesces several schedule calls in one window into a single collect', async () => {
        const harness = new Harness();
        harness.controller.schedule();
        harness.controller.schedule();
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.calls).to.have.lengthOf(1);
    });

    it('collects nothing and settles the pending state once when the host has no context', async () => {
        const harness = new Harness();
        harness.context = undefined;
        await harness.controller.refresh();
        expect(harness.calls).to.deep.equal([]);
        expect(harness.controller.pending).to.equal(false);
        expect(harness.changes).to.equal(1);
        await harness.controller.refresh();
        expect(harness.changes).to.equal(1);
    });

    describe('pending state', () => {

        it('is pending from the start until the first result arrives, even an empty one', async () => {
            const harness = new Harness();
            expect(harness.controller.pending).to.equal(true);
            await harness.controller.refresh();
            expect(harness.controller.pending).to.equal(false);
            expect(harness.changes, 'the host must re-render to drop the placeholders').to.equal(1);
        });

        it('is pending again after reset, and not when the caller expects no result', () => {
            const harness = new Harness();
            harness.controller.pending = false;
            harness.controller.reset();
            expect(harness.controller.pending).to.equal(true);
            harness.controller.reset(false);
            expect(harness.controller.pending).to.equal(false);
        });

        it('keeps the previous badges and stays settled while a later refresh is in flight', async () => {
            const harness = new Harness();
            harness.collect = async () => [PILL];
            await harness.controller.refresh();
            let resolveNext!: (badges: PreviewBadge[]) => void;
            harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolveNext = resolve; });
            const inFlight = harness.controller.refresh();
            expect(harness.controller.pending).to.equal(false);
            expect(harness.controller.badges).to.deep.equal([PILL]);
            const next: PreviewBadge = { kind: 'pill', text: 'next', tone: 'good', tooltipMarkdown: '' };
            resolveNext([next]);
            await inFlight;
            expect(harness.controller.badges).to.deep.equal([next]);
        });

        it('settles when the outlet throws', async () => {
            const harness = new Harness();
            harness.collect = async () => { throw new Error('boom'); };
            const warn = console.warn;
            console.warn = () => undefined;
            try {
                await harness.controller.refresh();
            } finally {
                console.warn = warn;
            }
            expect(harness.controller.pending).to.equal(false);
            expect(harness.controller.badges).to.deep.equal([]);
        });
    });

    describe('placeholder count', () => {

        it('uses the number of outlet contributions when nothing is remembered', () => {
            const harness = new Harness();
            harness.contributions = 4;
            expect(harness.controller.placeholderCount).to.equal(4);
        });

        it('falls back to 3 when the context (and so the contributions) are not known yet', () => {
            const harness = new Harness();
            harness.context = undefined;
            expect(harness.controller.placeholderCount).to.equal(3);
        });

        it('caps the count at 6', () => {
            const harness = new Harness();
            harness.contributions = 20;
            expect(harness.controller.placeholderCount).to.equal(6);
        });

        it('remembers the last count per document URI, including zero', async () => {
            const first = new Harness();
            first.collect = async () => [PILL, PILL];
            await first.controller.refresh();

            const other = new Harness();
            other.uri = 'file:///ws/b.cook';
            other.collect = async () => [];
            await other.controller.refresh();

            // New controllers (e.g. a reopened preview) pick the counts up.
            const reopened = new Harness();
            reopened.contributions = 5;
            expect(reopened.controller.placeholderCount).to.equal(2);
            const reopenedOther = new Harness();
            reopenedOther.uri = 'file:///ws/b.cook';
            expect(reopenedOther.controller.placeholderCount, 'no placeholders flash for a document known to have none').to.equal(0);
            const unseen = new Harness();
            unseen.uri = 'file:///ws/c.cook';
            unseen.contributions = 5;
            expect(unseen.controller.placeholderCount).to.equal(5);
        });

        it('updates the remembered count on a later refresh', async () => {
            const harness = new Harness();
            harness.collect = async () => [PILL, PILL, PILL];
            await harness.controller.refresh();
            harness.collect = async () => [PILL];
            await harness.controller.refresh();
            expect(harness.controller.placeholderCount).to.equal(1);
        });

        it('remembers nothing for a refresh without context or without a URI', async () => {
            const noContext = new Harness();
            noContext.context = undefined;
            await noContext.controller.refresh();
            expect(noContext.controller.placeholderCount).to.equal(3);

            const noUri = new Harness();
            noUri.uri = undefined;
            noUri.collect = async () => [PILL];
            await noUri.controller.refresh();
            expect(noUri.controller.placeholderCount).to.equal(4);
        });
    });

    it('does not notify when the badges are unchanged', async () => {
        const harness = new Harness();
        harness.collect = async () => [PILL];
        await harness.controller.refresh();
        await harness.controller.refresh();
        expect(harness.changes).to.equal(1);
    });

    it('drops a refresh in flight when reset is called', async () => {
        const harness = new Harness();
        let resolveOld!: (badges: PreviewBadge[]) => void;
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolveOld = resolve; });
        const inFlight = harness.controller.refresh();
        harness.controller.reset();
        resolveOld([PILL]);
        await inFlight;
        expect(harness.controller.badges).to.deep.equal([]);
        expect(harness.changes).to.equal(0);
    });

    it('drops a stale refresh that resolves after a newer one', async () => {
        const harness = new Harness();
        const resolvers: Array<(badges: PreviewBadge[]) => void> = [];
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolvers.push(resolve); });
        const first = harness.controller.refresh();
        const second = harness.controller.refresh();
        const newer: PreviewBadge = { kind: 'pill', text: 'new', tone: 'good', tooltipMarkdown: '' };
        resolvers[1]([newer]);
        await second;
        resolvers[0]([PILL]);
        await first;
        expect(harness.controller.badges).to.deep.equal([newer]);
    });

    it('defers a refresh while hidden and runs it on flushStale once visible', async () => {
        const harness = new Harness();
        harness.visible = false;
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.calls).to.have.lengthOf(0);
        expect(harness.controller.stale).to.equal(true);

        harness.controller.flushStale();
        expect(harness.calls, 'still hidden: must not run').to.have.lengthOf(0);

        harness.visible = true;
        harness.controller.flushStale();
        await until(() => harness.calls.length === 1);
        expect(harness.controller.stale).to.equal(false);
    });

    it('does nothing after dispose, even for a refresh that was in flight', async () => {
        const harness = new Harness();
        let resolveOld!: (badges: PreviewBadge[]) => void;
        harness.collect = () => new Promise<PreviewBadge[]>(resolve => { resolveOld = resolve; });
        const inFlight = harness.controller.refresh();
        harness.controller.dispose();
        resolveOld([PILL]);
        await inFlight;
        expect(harness.controller.badges).to.deep.equal([]);
        harness.controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 20));
        await harness.controller.refresh();
        expect(harness.calls).to.have.lengthOf(1);
    });

    it('owns the hover it opened and cancels it on dispose', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        expect(harness.controller.hoverShown).to.equal(true);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(1);
        expect(harness.controller.hoverShown).to.equal(false);
    });

    it('never calls the global cancelHover when it opened no hover', () => {
        const harness = new Harness();
        harness.controller.dispose();
        expect(harness.cancels).to.equal(0);
    });

    it('tracks HoverService closing the hover on its own', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        expect(harness.lastOnHide, 'requestHover was not given an onHide callback').to.not.be.undefined;
        harness.lastOnHide!();
        expect(harness.controller.hoverShown).to.equal(false);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(0);
    });

    it('keeps hover ownership across a move straight from one badge to another', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, true);
        harness.controller.showDetails({ ...PILL, text: 'b' }, harness.element, true);
        expect(harness.controller.hoverShown).to.equal(true);
        harness.controller.dispose();
        expect(harness.cancels).to.equal(1);
    });

    it('hideDetails cancels the hover and clears ownership', () => {
        const harness = new Harness();
        harness.controller.showDetails(PILL, harness.element, false);
        harness.controller.hideDetails();
        expect(harness.cancels).to.equal(1);
        expect(harness.controller.hoverShown).to.equal(false);
    });
});
