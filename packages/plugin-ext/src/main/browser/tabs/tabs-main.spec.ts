// *****************************************************************************
// Copyright (C) 2017 Ericsson and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { interfaces } from '@theia/core/shared/inversify';
import { Signal } from '@theia/core/shared/@lumino/signaling';
import { TabBar, Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { TabsExt } from '../../../common/plugin-api-rpc';
import { RPCProtocol } from '../../../common/rpc-protocol';
import { TabsExtImpl } from '../../../plugin/tabs';
import { TabsMainImpl } from './tabs-main';

/**
 * The slice of the main dock panel `TabsMainImpl` observes: one tab bar, and the
 * two signals `TheiaDockPanel` emits after Lumino has already changed the bar.
 */
class FakeMainPanel {
    readonly widgetAdded = new Signal<this, Widget>(this);
    readonly widgetRemoved = new Signal<this, Widget>(this);
    constructor(readonly tabBar: TabBar<Widget>) { }
    tabBars(): TabBar<Widget>[] {
        return [this.tabBar];
    }
    findTabBar(title: Title<Widget>): TabBar<Widget> | undefined {
        return this.tabBar.titles.includes(title) ? this.tabBar : undefined;
    }
    get currentTitle(): Title<Widget> | null {
        return this.tabBar.currentTitle;
    }
}

class FakeShell {
    readonly tabBar = new TabBar<Widget>();
    readonly mainPanel = new FakeMainPanel(this.tabBar);
    readonly mainPanelRenderer = { onDidCreateTabBar: () => ({ dispose: () => { } }) };
    get mainAreaTabBars(): TabBar<Widget>[] {
        return [this.tabBar];
    }
}

interface Harness {
    shell: FakeShell;
    /** The real plugin-host side, fed the DTO copies the RPC layer would deliver. */
    ext: TabsExtImpl;
    /** What the plugin host threw back at the main side. */
    errors: Error[];
    widgets: Map<string, Widget>;
}

function widget(id: string): Widget {
    const w = new Widget();
    w.id = id;
    w.title.label = id;
    return w;
}

function harness(...ids: string[]): Harness {
    const shell = new FakeShell();
    const widgets = new Map<string, Widget>();
    for (const id of ids) {
        const w = widget(id);
        widgets.set(id, w);
        shell.tabBar.addTab(w.title);
    }
    shell.tabBar.currentIndex = 0;
    const ext = new TabsExtImpl({ getProxy: () => ({}) } as unknown as RPCProtocol);
    const errors: Error[] = [];
    // RPC serializes DTOs, so the ext must never alias the main side's arrays.
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const proxy: TabsExt = {
        $acceptEditorTabModel: groups => ext.$acceptEditorTabModel(clone(groups)),
        $acceptTabGroupUpdate: group => ext.$acceptTabGroupUpdate(clone(group)),
        $acceptTabOperation: operation => {
            try {
                ext.$acceptTabOperation(clone(operation));
            } catch (e) {
                errors.push(e as Error);
            }
        }
    };
    const rpc = { getProxy: () => proxy } as unknown as RPCProtocol;
    const container = { get: () => shell } as unknown as interfaces.Container;
    new TabsMainImpl(rpc, container);
    return { shell, ext, errors, widgets };
}

function extOrder(ext: TabsExtImpl): string[] {
    return ext.tabGroups.all[0].tabs.map(tab => tab.label);
}

function shellOrder(shell: FakeShell): string[] {
    return shell.tabBar.titles.map(title => title.label);
}

/** Lumino removes the tab from the bar before `TheiaDockPanel` announces the removal. */
function close(h: Harness, id: string): void {
    const w = h.widgets.get(id)!;
    h.shell.tabBar.removeTab(w.title);
    h.shell.mainPanel.widgetRemoved.emit(w);
}

describe('TabsMainImpl', () => {

    it('mirrors the initial tab bar into the plugin host', () => {
        const { shell, ext, errors } = harness('A', 'B');
        expect(errors).to.deep.equal([]);
        expect(extOrder(ext)).to.deep.equal(shellOrder(shell));
    });

    it('keeps the plugin host in step when a tab opens between others and a later one closes', () => {
        // Sentry EDITOR-8: the default insertion is after the current tab, so every
        // open shifts its right-hand neighbours; a close by a stale index then removes
        // the wrong tab on the plugin host, and the next update for the survivor is
        // rejected as `INVALID tab`.
        const h = harness('A', 'B');
        const c = widget('C');
        h.shell.tabBar.insertTab(1, c.title);
        h.shell.mainPanel.widgetAdded.emit(c);

        close(h, 'B');
        c.title.className = 'theia-mod-pinned';

        expect(h.errors).to.deep.equal([]);
        expect(extOrder(h.ext)).to.deep.equal(shellOrder(h.shell));
    });

    it('reports the move when addWidget on an attached widget puts its tab next to the current one', () => {
        // `shell.addWidget` on a widget that is already open: Lumino moves the existing
        // tab after the current one without a `tabMoved` signal, then the dock panel
        // announces the widget a second time.
        const h = harness('A', 'B', 'C');
        const c = h.widgets.get('C')!;
        h.shell.tabBar.insertTab(1, c.title);
        h.shell.mainPanel.widgetAdded.emit(c);

        expect(h.errors).to.deep.equal([]);
        expect(shellOrder(h.shell)).to.deep.equal(['A', 'C', 'B']);
        expect(extOrder(h.ext)).to.deep.equal(['A', 'C', 'B']);
    });

    it('keeps the plugin host in step after a tab is dragged to the front', () => {
        const h = harness('A', 'B', 'C');
        const c = h.widgets.get('C')!;
        // A drag: Lumino reorders its titles, then emits `tabMoved`.
        h.shell.tabBar.insertTab(0, c.title);
        (h.shell.tabBar.tabMoved as Signal<TabBar<Widget>, TabBar.ITabMovedArgs<Widget>>)
            .emit({ fromIndex: 2, toIndex: 0, title: c.title });

        close(h, 'A');
        c.title.className = 'theia-mod-pinned';
        h.widgets.get('B')!.title.className = 'theia-mod-pinned';

        expect(h.errors).to.deep.equal([]);
        expect(extOrder(h.ext)).to.deep.equal(shellOrder(h.shell));
    });
});
