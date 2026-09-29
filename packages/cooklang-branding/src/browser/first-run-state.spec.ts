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

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common';
import { CommandEvent } from '@theia/core/lib/common/command';
import { FirstRunFlags, FirstRunState, RENDER_REPORT_COMMAND_ID } from './first-run-state';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const m = new Map<string, string>();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; // eslint-disable-line no-null/no-null
}

describe('FirstRunFlags', () => {
    it('starts empty', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.cookbotUsed).to.equal(false);
        expect(flags.reportRendered).to.equal(false);
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

    it('says first_run exactly once for the welcome page', () => {
        const flags = new FirstRunFlags(memoryStorage());
        expect(flags.takeFirstWelcome()).to.equal(true);
        expect(flags.takeFirstWelcome()).to.equal(false);
    });
});

type Store = Pick<Storage, 'getItem' | 'setItem'>;

class TestState extends FirstRunState {
    constructor(commands: unknown, protected readonly store: Store) {
        super();
        (this as unknown as { commands: unknown }).commands = commands;
    }
    protected override storage(): Store { return this.store; }
    start(): void { this.init(); }
}

describe('FirstRunState', () => {
    function setup(store: Store = memoryStorage()): { state: TestState; exec: (id: string) => void; fired: () => number } {
        const emitter = new Emitter<CommandEvent>();
        const state = new TestState({ onDidExecuteCommand: emitter.event }, store);
        state.start();
        let n = 0;
        state.onDidChange(() => n++);
        return { state, exec: id => emitter.fire({ commandId: id, args: [] }), fired: () => n };
    }

    it('fires onDidChange once when Render Report first runs', () => {
        const { state, exec, fired } = setup();
        exec(RENDER_REPORT_COMMAND_ID);
        expect(fired()).to.equal(1);
        expect(state.flags.reportRendered).to.equal(true);
        exec(RENDER_REPORT_COMMAND_ID);
        expect(fired()).to.equal(1);
    });

    it('ignores unrelated commands', () => {
        const { state, exec, fired } = setup();
        exec('something.else');
        expect(fired()).to.equal(0);
        expect(state.flags.reportRendered).to.equal(false);
    });

    it('fires onDidChange on the first CookBot use only', () => {
        const { state, fired } = setup();
        expect(state.markCookbotUsed()).to.equal(true);
        expect(state.markCookbotUsed()).to.equal(false);
        expect(fired()).to.equal(1);
    });

    it('survives storage that throws and keeps flags in memory', () => {
        const broken: Store = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        };
        const { state, exec, fired } = setup(broken);
        exec(RENDER_REPORT_COMMAND_ID);
        expect(fired()).to.equal(1);
        expect(state.flags.reportRendered).to.equal(true);
        expect(state.flags.markReportRendered()).to.equal(false);
    });

    it('stops listening after dispose', () => {
        const { state, exec, fired } = setup();
        state.dispose();
        exec(RENDER_REPORT_COMMAND_ID);
        expect(fired()).to.equal(0);
    });
});
