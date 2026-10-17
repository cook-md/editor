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

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuParseResult } from '../common/menu-types';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { OutletItem } from './cooklang-outlet-service';
import { MenuView, MenuViewProps } from './menu-preview-components';

describe('MenuView badges', () => {

    const MENU: MenuParseResult = {
        metadata: null, // eslint-disable-line no-null/no-null
        sections: [{ name: null, lines: [[{ type: 'text', value: 'Breakfast:' }]] }], // eslint-disable-line no-null/no-null
        errors: [],
        warnings: [],
    };

    const TOOLBAR_ITEMS: OutletItem[] = [{ id: 'cart', label: 'Add Menu to Shopping List' }];

    const BADGES: PreviewBadge[] = [
        { kind: 'pill', text: 'Vitals 14/17', tone: 'good', tooltipMarkdown: 'Core Vitals' },
    ];

    function renderView(props: Partial<MenuViewProps> = {}): string {
        return renderToStaticMarkup(
            React.createElement(MenuView, {
                menuResult: MENU,
                fileName: 'week.menu',
                scale: 1,
                toolbarItems: TOOLBAR_ITEMS,
                onRunToolbarItem: () => undefined,
                ...props,
            })
        );
    }

    it('renders badges in the header before the action bar when badges and handlers are provided', () => {
        const markup = renderView({ badges: BADGES, onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
        const pillIndex = markup.indexOf('cooklang-badge-pill');
        const actionBarIndex = markup.indexOf('theia-cooklang-action-bar');
        expect(pillIndex, markup).to.be.greaterThan(-1);
        expect(actionBarIndex, markup).to.be.greaterThan(-1);
        expect(pillIndex).to.be.lessThan(actionBarIndex);
        expect(markup).to.contain('Vitals 14/17');
    });

    it('renders no badges when badges are provided without handlers', () => {
        expect(renderView({ badges: BADGES })).to.not.contain('cooklang-badge-pill');
    });

    it('renders no badges when handlers are provided without badges', () => {
        const markup = renderView({ onShowBadgeDetails: () => undefined, onHideBadgeDetails: () => undefined });
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
