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
import { PreviewBadgeView } from './preview-badge';

const { act } = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PreviewBadgeView', () => {
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

    it('renders the A–E strip with the grade selected and an accessible label', () => {
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'nutriscore', grade: 'B', tooltipMarkdown: 'x' }}
            onShowDetails={() => undefined} onHideDetails={() => undefined} />));
        const badge = host.querySelector('.cooklang-nutriscore')!;
        expect(badge.getAttribute('aria-label')).to.equal('Nutri-Score B');
        expect(badge.getAttribute('tabindex')).to.equal('0');
        const cells = [...host.querySelectorAll('.cooklang-nutriscore-cell')];
        expect(cells.map(cell => cell.textContent)).to.deep.equal(['A', 'B', 'C', 'D', 'E']);
        expect(cells.filter(cell => cell.classList.contains('selected')).map(cell => cell.textContent)).to.deep.equal(['B']);
    });

    it('greys the strip and shows a question mark for an unknown grade', () => {
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x' }}
            onShowDetails={() => undefined} onHideDetails={() => undefined} />));
        const badge = host.querySelector('.cooklang-nutriscore')!;
        expect(badge.classList.contains('unknown')).to.equal(true);
        expect(badge.getAttribute('aria-label')).to.equal('Nutri-Score unknown');
        expect(host.querySelector('.cooklang-nutriscore-cell.selected')!.textContent).to.equal('?');
    });

    it('asks for details on hover and focus, and hides them on blur', () => {
        const events: string[] = [];
        const badge = { kind: 'nutriscore' as const, grade: 'A' as const, tooltipMarkdown: 'x' };
        act(() => root.render(<PreviewBadgeView badge={badge}
            onShowDetails={(shown, target, immediate) =>
                events.push(`show:${shown.kind === 'nutriscore' ? shown.grade : ''}:${target.className.split(' ')[0]}:${immediate}`)}
            onHideDetails={() => events.push('hide')} />));
        const element = host.querySelector('.cooklang-nutriscore') as HTMLElement;
        act(() => { element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        act(() => { element.focus(); });
        act(() => { element.blur(); });
        expect(events).to.deep.equal(['show:A:cooklang-nutriscore:false', 'show:A:cooklang-nutriscore:true', 'hide']);
    });

    it('renders a pill with its text, tone and the same hover behaviour', () => {
        const events: string[] = [];
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'pill', text: '540 kcal', tone: 'warning', tooltipMarkdown: 'x' }}
            onShowDetails={(shown, _target, immediate) => events.push(`show:${shown.kind}:${immediate}`)}
            onHideDetails={() => events.push('hide')} />));
        const pill = host.querySelector('.cooklang-badge-pill') as HTMLElement;
        expect(pill.textContent).to.equal('540 kcal');
        expect(pill.classList.contains('warning')).to.equal(true);
        expect(pill.getAttribute('tabindex')).to.equal('0');
        expect(host.querySelector('.cooklang-nutriscore')).to.equal(null); // eslint-disable-line no-null/no-null
        act(() => { pill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        act(() => { pill.focus(); });
        act(() => { pill.blur(); });
        expect(events).to.deep.equal(['show:pill:false', 'show:pill:true', 'hide']);
    });
});
