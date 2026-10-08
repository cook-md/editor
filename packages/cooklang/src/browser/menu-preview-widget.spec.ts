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

// The widget module imports `MonacoWorkspace` and `FileService`, which need
// browser globals at require time. jsdom stays up for the whole run.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { MenuParseResult } from '../common/menu-types';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { CooklangOutletService, OutletItem } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { MenuPreviewWidget } from './menu-preview-widget';
import { PreviewBadgeController } from './preview-badge-controller';

const ROOT = new URI('file:///ws');
const MENU_URI = new URI('file:///ws/plans/week.menu');

const MENU: MenuParseResult = {
    metadata: null, // eslint-disable-line no-null/no-null
    sections: [{ name: null, lines: [[{ type: 'text', value: 'Breakfast:' }]] }], // eslint-disable-line no-null/no-null
    errors: [],
    warnings: [],
};

interface MenuInternals {
    init(): void;
    render(): React.ReactNode;
    menuResult: MenuParseResult | undefined;
    badgeController: PreviewBadgeController;
    outlets: { collectBadges: (menuPath: MenuPath, context: object, element?: HTMLElement) => Promise<PreviewBadge[]> };
    handleScaleChange(scale: number): void;
}

async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

const harnesses: MenuHarness[] = [];

/** A real menu preview widget over stubbed services. */
class MenuHarness {
    readonly subscriptionChanged = new Emitter<void>();
    hoverCancelCount = 0;
    menuJson = JSON.stringify(MENU);
    readonly widget: MenuPreviewWidget;

    constructor() {
        harnesses.push(this);
        const never = new Emitter<unknown>().event;
        const outlets = new CooklangOutletService();
        Object.assign(outlets, {
            menus: { getMenu: () => undefined },
            workspaceService: { tryGetRoots: () => [{ resource: ROOT }] },
            getItems: (): OutletItem[] => [],
            run: async (): Promise<void> => undefined,
            collectBadges: async () => [],
        });
        const widget = new MenuPreviewWidget();
        // `isVisible` derives from DOM attachment, which a widget built by `new` never has.
        Object.defineProperty(widget, 'isVisible', { value: true, writable: true, configurable: true });
        Object.assign(widget, {
            service: { parseMenu: async () => this.menuJson },
            monacoWorkspace: { onDidChangeTextDocument: never, onDidOpenTextDocument: never, getTextDocument: () => undefined },
            fileService: { read: async () => ({ value: '= Day 1 =\n\nBreakfast:\n\n@./pancakes{1}\n' }) },
            editorManager: {},
            navigator: { navigate: () => undefined },
            outlets,
            hoverService: {
                requestHover: () => undefined,
                cancelHover: () => { this.hoverCancelCount++; },
            },
            subscriptions: { onDidChangeSubscription: this.subscriptionChanged.event },
            update: () => undefined,
        });
        (widget as unknown as MenuInternals).init();
        this.widget = widget;
    }

    get internals(): MenuInternals {
        return this.widget as unknown as MenuInternals;
    }

    async open(uri: URI): Promise<void> {
        this.widget.setUri(uri);
        await until(() => this.internals.menuResult !== undefined);
    }

    markup(): string {
        return renderToStaticMarkup(this.internals.render() as React.ReactElement);
    }
}

describe('MenuPreviewWidget badges', () => {

    afterEach(() => {
        for (const harness of harnesses.splice(0)) {
            harness.widget.dispose();
        }
    });

    it('asks plugins for nothing when the menu has no sections', async () => {
        const harness = new MenuHarness();
        harness.menuJson = JSON.stringify({ ...MENU, sections: [] });
        harness.internals.badgeController.debounceMs = 1;
        let calls = 0;
        harness.internals.outlets.collectBadges = async () => {
            calls++;
            return [];
        };
        await harness.open(MENU_URI);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(calls).to.equal(0);
    });

    it('collects badges from the menu badge outlet with the preview context once a menu is parsed', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        const badge: PreviewBadge = { kind: 'pill', text: 'Vitals 14/17', tone: 'good', tooltipMarkdown: 'Core Vitals' };
        const calls: Array<{ menuPath: MenuPath; context: object; element: HTMLElement | undefined }> = [];
        harness.internals.outlets.collectBadges = async (menuPath, context, element) => {
            calls.push({ menuPath, context, element });
            return [badge];
        };

        await harness.open(MENU_URI);
        await until(() => harness.internals.badgeController.badges.length > 0);

        expect(calls).to.have.lengthOf(1);
        expect(calls[0].menuPath).to.deep.equal(CooklangOutlets.MENU_PREVIEW_BADGE);
        expect(calls[0].context).to.deep.equal({ version: 1, uri: MENU_URI.toString(), path: 'plans/week.menu', scale: 1 });
        expect(calls[0].element).to.equal(harness.widget.node);
        expect(harness.markup()).to.contain('Vitals 14/17');
    });

    it('re-queries badges when the scale or the subscription changes', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        const contexts: Array<{ scale: number }> = [];
        harness.internals.outlets.collectBadges = async (_menuPath, context) => {
            contexts.push(context as { scale: number });
            return [];
        };
        await harness.open(MENU_URI);
        await until(() => contexts.length === 1);

        harness.internals.handleScaleChange(2);
        await until(() => contexts.length >= 2);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(contexts).to.have.lengthOf(2);
        expect(contexts[1].scale).to.equal(2);

        harness.subscriptionChanged.fire();
        await until(() => contexts.length >= 3);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(contexts).to.have.lengthOf(3);
    });

    it('forgets badges when re-bound to another menu', async () => {
        const harness = new MenuHarness();
        harness.internals.badgeController.debounceMs = 1;
        harness.internals.outlets.collectBadges = async () => [{ kind: 'pill', text: 'old', tone: 'neutral', tooltipMarkdown: '' }];
        await harness.open(MENU_URI);
        await until(() => harness.internals.badgeController.badges.length > 0);

        harness.internals.outlets.collectBadges = async () => [];
        harness.widget.setUri(new URI('file:///ws/plans/other.menu'));
        expect(harness.internals.badgeController.badges).to.deep.equal([]);
    });

    it('does not cancel another widget\'s hover on dispose', async () => {
        const harness = new MenuHarness();
        await harness.open(MENU_URI);
        harness.widget.dispose();
        expect(harness.hoverCancelCount).to.equal(0);
    });
});
