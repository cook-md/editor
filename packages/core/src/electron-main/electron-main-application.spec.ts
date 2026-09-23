// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
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

import { expect } from 'chai';
import { ElectronMainApplication } from './electron-main-application';
import { TheiaElectronWindow } from './theia-electron-window';

/**
 * Exposes the URL routing state of {@link ElectronMainApplication}. The real constructor needs a running
 * Electron `app` (portable-mode check, electron-store), so the tests build the object without running it.
 */
class TestElectronMainApplication extends ElectronMainApplication {
    declare windows: Map<number, TheiaElectronWindow>;
    declare activeWindowStack: number[];
    declare pendingUrls: string[];

    static create(): TestElectronMainApplication {
        const application = Object.create(TestElectronMainApplication.prototype) as TestElectronMainApplication;
        application.windows = new Map();
        application.activeWindowStack = [];
        application.pendingUrls = [];
        return application;
    }

    addWindow(id: number, window: FakeWindow): void {
        this.windows.set(id, window as unknown as TheiaElectronWindow);
        this.activeWindowStack.push(id);
    }

    flushPendingUrls(): Promise<void> {
        return this.openPendingUrls();
    }
}

class FakeWindow {
    readonly received: string[] = [];
    constructor(public isReady: boolean, protected readonly accepts: boolean = true) { }
    async openUrl(url: string): Promise<boolean> {
        this.received.push(url);
        return this.accepts;
    }
}

describe('ElectronMainApplication#openUrl', () => {

    it('keeps a URL that arrives before any window exists and opens it once a window is ready', async () => {
        const application = TestElectronMainApplication.create();
        await application.openUrl('cook://my/Dinner.cook');
        expect(application.pendingUrls).to.deep.equal(['cook://my/Dinner.cook']);

        const window = new FakeWindow(true);
        application.addWindow(1, window);
        await application.flushPendingUrls();
        expect(window.received).to.deep.equal(['cook://my/Dinner.cook']);
        expect(application.pendingUrls).to.be.empty;
    });

    it('does not send a URL to a window whose frontend is still starting', async () => {
        const application = TestElectronMainApplication.create();
        const window = new FakeWindow(false);
        application.addWindow(1, window);

        await application.openUrl('cook://my/Dinner.cook');
        expect(window.received).to.be.empty;
        expect(application.pendingUrls).to.deep.equal(['cook://my/Dinner.cook']);

        window.isReady = true;
        await application.flushPendingUrls();
        expect(window.received).to.deep.equal(['cook://my/Dinner.cook']);
    });

    it('opens pending URLs in arrival order, each exactly once', async () => {
        const application = TestElectronMainApplication.create();
        await application.openUrl('cook://my/a.cook');
        await application.openUrl('cook://my/b.cook');
        const window = new FakeWindow(true);
        application.addWindow(1, window);

        await application.flushPendingUrls();
        await application.flushPendingUrls();
        expect(window.received).to.deep.equal(['cook://my/a.cook', 'cook://my/b.cook']);
    });

    it('drops a URL that every ready window declines instead of retrying it', async () => {
        const application = TestElectronMainApplication.create();
        const window = new FakeWindow(true, false);
        application.addWindow(1, window);

        await application.openUrl('cook://unknown');
        expect(window.received).to.deep.equal(['cook://unknown']);
        expect(application.pendingUrls).to.be.empty;
    });

    it('stops at the first ready window that opens the URL', async () => {
        const application = TestElectronMainApplication.create();
        const starting = new FakeWindow(false);
        const declining = new FakeWindow(true, false);
        const accepting = new FakeWindow(true);
        const after = new FakeWindow(true);
        application.addWindow(1, starting);
        application.addWindow(2, declining);
        application.addWindow(3, accepting);
        application.addWindow(4, after);

        await application.openUrl('cook://my/Dinner.cook');
        expect(starting.received).to.be.empty;
        expect(declining.received).to.deep.equal(['cook://my/Dinner.cook']);
        expect(accepting.received).to.deep.equal(['cook://my/Dinner.cook']);
        expect(after.received).to.be.empty;
        expect(application.pendingUrls).to.be.empty;
    });
});
