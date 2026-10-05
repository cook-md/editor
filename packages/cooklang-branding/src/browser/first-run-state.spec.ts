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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
// WidgetManager (injected by FirstRunState) loads lumino, which needs a DOM at import time.
// The DOM is removed again before the tests run, so they see no `window`, as before.
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common';
import { DidCreateWidgetEvent } from '@theia/core/lib/browser/widget-manager';
import { FirstRunFlags, FirstRunState, REPORT_WIDGET_FACTORY_ID } from './first-run-state';

disableJSDOM();

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const m = new Map<string, string>();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; // eslint-disable-line no-null/no-null
}

describe('FirstRunFlags', () => {
    it('starts empty', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.cookbotUsed).to.equal(false);
        expect(flags.reportRendered).to.equal(false);
        expect(flags.cookbotBannerDismissed).to.equal(false);
    });

    it('persists the CookBot banner dismissal', () => {
        const storage = memoryStorage();
        expect(new FirstRunFlags(storage).dismissCookbotBanner()).to.equal(true);
        expect(new FirstRunFlags(storage).cookbotBannerDismissed).to.equal(true);
    });

    it('reports whether a mark was the first one', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.markCookbotUsed()).to.equal(true);
        expect(flags.markCookbotUsed()).to.equal(false);
        expect(flags.cookbotUsed).to.equal(true);
    });

    it('persists across instances', () => {
        const storage = memoryStorage();
        new FirstRunFlags(storage).markReportRendered();
        expect(new FirstRunFlags(storage).reportRendered).to.equal(true);
    });

    it('has no reported steps until they are stored, then persists them', () => {
        const storage = memoryStorage();
        const flags = new FirstRunFlags(storage);
        expect(flags.reportedSteps).to.equal(undefined);
        flags.setReportedSteps([]);
        expect(flags.reportedSteps).to.deep.equal([]);
        flags.setReportedSteps(['folder', 'recipes']);
        expect(new FirstRunFlags(storage).reportedSteps).to.deep.equal(['folder', 'recipes']);
    });

    it('treats corrupt reported steps as nothing stored', () => {
        const storage = memoryStorage();
        storage.setItem('cook.firstRun.reportedSteps', '{not json');
        expect(new FirstRunFlags(storage).reportedSteps).to.equal(undefined);
        storage.setItem('cook.firstRun.reportedSteps', '{"a":1}');
        expect(new FirstRunFlags(storage).reportedSteps).to.equal(undefined);
        storage.setItem('cook.firstRun.reportedSteps', '["folder",3]');
        expect(new FirstRunFlags(storage).reportedSteps).to.deep.equal(['folder']);
    });

    it('keeps reported steps in memory when storage throws', () => {
        const flags = new FirstRunFlags({
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        });
        flags.setReportedSteps(['folder']);
        expect(flags.reportedSteps).to.deep.equal(['folder']);
    });

    it('says first_run exactly once for the welcome page', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.takeFirstWelcome()).to.equal(true);
        expect(flags.takeFirstWelcome()).to.equal(false);
    });
});

type Store = Pick<Storage, 'getItem' | 'setItem'>;

class TestState extends FirstRunState {
    constructor(widgets: unknown, protected readonly store: Store) {
        super();
        (this as unknown as { widgetManager: unknown }).widgetManager = widgets;
    }
    protected override storage(): Store { return this.store; }
    start(): void { this.init(); }
}

describe('FirstRunState', () => {
    function setup(store: Store = memoryStorage()): { state: TestState; create: (factoryId: string) => void; fired: () => number } {
        const emitter = new Emitter<DidCreateWidgetEvent>();
        const state = new TestState({ onDidCreateWidget: emitter.event }, store);
        state.start();
        let n = 0;
        state.onDidChange(() => n++);
        return { state, create: factoryId => emitter.fire({ factoryId, widget: {} as DidCreateWidgetEvent['widget'] }), fired: () => n };
    }

    it('fires onDidChange once when the first report widget is created', () => {
        const { state, create, fired } = setup();
        create(REPORT_WIDGET_FACTORY_ID);
        expect(fired()).to.equal(1);
        expect(state.flags.reportRendered).to.equal(true);
        create(REPORT_WIDGET_FACTORY_ID);
        expect(fired()).to.equal(1);
    });

    it('ignores other widgets (a cancelled template picker creates no report widget)', () => {
        const { state, create, fired } = setup();
        create('some-other-widget');
        expect(fired()).to.equal(0);
        expect(state.flags.reportRendered).to.equal(false);
    });

    it('fires onDidChange on the first CookBot use only', () => {
        const { state, fired } = setup();
        expect(state.markCookbotUsed()).to.equal(true);
        expect(state.markCookbotUsed()).to.equal(false);
        expect(fired()).to.equal(1);
    });

    it('fires onDidChange when the CookBot banner is first dismissed', () => {
        const { state, fired } = setup();
        state.dismissCookbotBanner();
        state.dismissCookbotBanner();
        expect(fired()).to.equal(1);
        expect(state.flags.cookbotBannerDismissed).to.equal(true);
    });

    it('survives storage that throws and keeps flags in memory', () => {
        const broken: Store = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        };
        const { state, create, fired } = setup(broken);
        create(REPORT_WIDGET_FACTORY_ID);
        expect(fired()).to.equal(1);
        expect(state.flags.reportRendered).to.equal(true);
        expect(state.flags.markReportRendered()).to.equal(false);
    });

    it('stops listening after dispose', () => {
        const { state, create, fired } = setup();
        state.dispose();
        create(REPORT_WIDGET_FACTORY_ID);
        expect(fired()).to.equal(0);
    });

    it('works when window.localStorage itself is unavailable', () => {
        // In Node there is no window, so the default storage() access throws, like a SecurityError in a browser.
        const emitter = new Emitter<DidCreateWidgetEvent>();
        const state = new FirstRunState();
        (state as unknown as { widgetManager: unknown }).widgetManager = { onDidCreateWidget: emitter.event };
        (state as unknown as { init(): void }).init();
        let n = 0;
        state.onDidChange(() => n++);
        expect(state.flags.cookbotUsed).to.equal(false);
        expect(state.markCookbotUsed()).to.equal(true);
        expect(state.markCookbotUsed()).to.equal(false);
        emitter.fire({ factoryId: REPORT_WIDGET_FACTORY_ID, widget: {} as DidCreateWidgetEvent['widget'] });
        expect(n).to.equal(2);
    });
});
