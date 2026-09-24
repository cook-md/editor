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

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import { CooklangOutletService } from './cooklang-outlet-service';

after(() => disableJSDOM());

const PATH: MenuPath = ['cooklang/recipePreview/toolbar'];

interface Run { id: string; args: unknown[] }

class Fixture {
    runs: Run[] = [];
    rendered: unknown[] = [];
    errors: string[] = [];
    menuChanged = new Emitter<void>();
    commandsChanged = new Emitter<void>();
    root: { children: unknown[] } | undefined = { children: [] };

    command(id: string, sortString: string, options: { icon?: string; visible?: (ctx: unknown) => boolean; fail?: boolean } = {}): object {
        const runs = this.runs;
        return {
            id, label: `Label ${id}`, icon: options.icon, sortString,
            isVisible: (_path: MenuPath, _matcher: unknown, _ctx: unknown, ...args: unknown[]) => options.visible ? options.visible(args[0]) : true,
            isEnabled: () => true,
            isToggled: () => false,
            run: async (_path: MenuPath, ...args: unknown[]) => {
                runs.push({ id, args });
                if (options.fail) { throw new Error('boom'); }
            },
        };
    }

    group(id: string, sortString: string, children: object[]): object {
        return { id, sortString, children, isVisible: () => true, isEmpty: () => children.length === 0 };
    }

    create(): CooklangOutletService {
        const service = new CooklangOutletService();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (service as any).menus = { getMenu: (path: MenuPath) => path[0] === PATH[0] ? this.root : undefined, onDidChange: this.menuChanged.event };
        (service as any).commands = { onCommandsChanged: this.commandsChanged.event };
        (service as any).contextKeys = { match: () => true };
        (service as any).contextMenuRenderer = { render: (options: unknown) => { this.rendered.push(options); } };
        (service as any).messages = { error: (message: string) => { this.errors.push(message); } };
        (service as any).workspaceService = { tryGetRoots: () => [{ resource: new URI('file:///ws') }] };
        (service as any).init();
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return service;
    }
}

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };

describe('CooklangOutletService', () => {
    it('returns no items when nothing was contributed to the outlet', () => {
        const fixture = new Fixture();
        fixture.root = undefined;
        expect(fixture.create().getItems(PATH, CONTEXT)).to.deep.equal([]);
    });

    it('lists the navigation group first, then other groups, each sorted by order', () => {
        const fixture = new Fixture();
        fixture.root!.children = [
            fixture.group('z-extra', 'z-extra', [fixture.command('extra', '1')]),
            fixture.command('loose', '5'),
            fixture.group('navigation', 'navigation', [fixture.command('late', '90'), fixture.command('early', '10', { icon: 'codicon codicon-add' })]),
        ];
        const items = fixture.create().getItems(PATH, CONTEXT);
        expect(items.map(item => item.id)).to.deep.equal(['early', 'late', 'loose', 'extra']);
        expect(items[0]).to.deep.equal({ id: 'early', label: 'Label early', iconClass: 'codicon codicon-add' });
    });

    it('asks every node whether it is visible for the context', () => {
        const fixture = new Fixture();
        fixture.root!.children = [
            fixture.command('menus-only', '1', { visible: ctx => (ctx as { path: string }).path.endsWith('.menu') }),
            fixture.command('always', '2'),
        ];
        expect(fixture.create().getItems(PATH, CONTEXT).map(item => item.id)).to.deep.equal(['always']);
    });

    it('runs an item with the context as its only argument', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('cart', '1')];
        await fixture.create().run(PATH, 'cart', CONTEXT);
        expect(fixture.runs).to.deep.equal([{ id: 'cart', args: [CONTEXT] }]);
    });

    it('ignores an id that is not (or no longer) in the outlet', async () => {
        const fixture = new Fixture();
        await fixture.create().run(PATH, 'gone', CONTEXT);
        expect(fixture.runs).to.deep.equal([]);
    });

    it('reports a failing command instead of throwing', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('cart', '1', { fail: true })];
        await fixture.create().run(PATH, 'cart', CONTEXT);
        expect(fixture.errors).to.have.length(1);
        expect(fixture.errors[0]).to.contain('Label cart').and.to.contain('boom');
    });

    it('shows a context menu with the context and without the anchor argument', () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('lookup', '1')];
        let prevented = false;
        const target = document.createElement('div');
        const event = { clientX: 10, clientY: 20, currentTarget: target, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined };
        fixture.create().showContextMenu(PATH, CONTEXT, event);
        expect(prevented).to.equal(true);
        expect(fixture.rendered).to.deep.equal([{ menuPath: PATH, anchor: { x: 10, y: 20 }, args: [CONTEXT], includeAnchorArg: false, context: target }]);
    });

    it('leaves the default context menu alone when the outlet is empty', () => {
        const fixture = new Fixture();
        let prevented = false;
        fixture.create().showContextMenu(PATH, CONTEXT,
            { clientX: 0, clientY: 0, currentTarget: null, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined }); // eslint-disable-line no-null/no-null
        expect(prevented).to.equal(false);
        expect(fixture.rendered).to.deep.equal([]);
    });

    it('fires onDidChange when menus or commands change', () => {
        const fixture = new Fixture();
        const service = fixture.create();
        let fired = 0;
        service.onDidChange(() => { fired += 1; });
        fixture.menuChanged.fire();
        fixture.commandsChanged.fire();
        expect(fired).to.equal(2);
    });

    it('describes a resource with its URI and workspace-relative path', () => {
        const service = new Fixture().create();
        expect(service.describe(new URI('file:///ws/Dinner/Soup.cook'))).to.deep.equal({ uri: 'file:///ws/Dinner/Soup.cook', path: 'Dinner/Soup.cook' });
        expect(service.describe(new URI('file:///elsewhere/Cake.cook'))).to.deep.equal({ uri: 'file:///elsewhere/Cake.cook', path: 'Cake.cook' });
    });
});
