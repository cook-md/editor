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
    visible = true;
    changes = 0;
    cancels = 0;
    lastOnHide: (() => void) | undefined;
    readonly element = document.createElement('div');
    readonly controller: PreviewBadgeController;

    constructor() {
        const outlets = {
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
            onDidChangeBadges: () => { this.changes++; },
        };
        this.controller = new PreviewBadgeController(outlets as never, hoverService as never, host);
        this.controller.debounceMs = 1;
    }
}

describe('PreviewBadgeController', () => {

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

    it('collects nothing and notifies nobody when the host has no context', async () => {
        const harness = new Harness();
        harness.context = undefined;
        await harness.controller.refresh();
        expect(harness.calls).to.deep.equal([]);
        expect(harness.changes).to.equal(0);
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
