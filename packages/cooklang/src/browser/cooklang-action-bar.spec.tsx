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
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { CooklangActionBar } from './cooklang-action-bar';

const { act } = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('CooklangActionBar', () => {
    let host: HTMLElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('renders nothing without items', () => {
        act(() => root.render(<CooklangActionBar items={[]} onRun={() => undefined} />));
        expect(host.innerHTML).to.equal('');
    });

    it('renders an icon button per item with the label as tooltip, and runs it on click', () => {
        const ran: string[] = [];
        act(() => root.render(<CooklangActionBar
            items={[{ id: 'cart', label: 'Add to Shopping List', iconClass: 'codicon codicon-add' }, { id: 'plain', label: 'Plain' }]}
            onRun={id => ran.push(id)} />));
        const buttons = host.querySelectorAll('button');
        expect(buttons).to.have.length(2);
        expect(buttons[0].title).to.equal('Add to Shopping List');
        expect(buttons[0].querySelector('span')!.className).to.equal('codicon codicon-add');
        expect(buttons[1].textContent).to.equal('Plain');
        act(() => buttons[0].click());
        expect(ran).to.deep.equal(['cart']);
    });
});
