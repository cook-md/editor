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
});
