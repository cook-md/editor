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

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';

/** Command id of Render Report, defined in packages/cooklang/src/browser/report-contribution.ts. */
export const RENDER_REPORT_COMMAND_ID = 'cooklang.renderReport';

const KEYS = {
    cookbotUsed: 'cook.firstRun.cookbotUsed',
    reportRendered: 'cook.firstRun.reportRendered',
    welcomeSeen: 'cook.firstRun.welcomeSeen',
} as const;

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Local, per-install flags. They never leave the machine.
 * Storage errors (blocked or full storage) fall back to an in-memory map for the session.
 */
export class FirstRunFlags {
    protected readonly memory = new Map<string, string>();

    constructor(protected readonly storage: FlagStorage) { }

    get cookbotUsed(): boolean { return this.get(KEYS.cookbotUsed) === '1'; }
    get reportRendered(): boolean { return this.get(KEYS.reportRendered) === '1'; }

    /** @returns true if this was the first CookBot message ever. */
    markCookbotUsed(): boolean { return this.mark(KEYS.cookbotUsed); }
    markReportRendered(): boolean { return this.mark(KEYS.reportRendered); }
    /** @returns true the first time the welcome page is ever shown. */
    takeFirstWelcome(): boolean { return this.mark(KEYS.welcomeSeen); }

    protected get(key: string): string | null {
        try {
            const value = this.storage.getItem(key);
            if (value !== null) { // eslint-disable-line no-null/no-null
                return value;
            }
        } catch {
            // fall through to memory
        }
        return this.memory.get(key) ?? null; // eslint-disable-line no-null/no-null
    }

    protected mark(key: string): boolean {
        if (this.get(key) === '1') {
            return false;
        }
        this.memory.set(key, '1');
        try {
            this.storage.setItem(key, '1');
        } catch {
            // kept in memory only
        }
        return true;
    }
}

/**
 * App-wide wrapper: fires onDidChange, and marks a report once Render Report runs.
 * Declared as a FrontendApplicationContribution (and bound to that token) only so it is
 * constructed at startup: its command listener must be live before any widget injects it.
 */
@injectable()
export class FirstRunState implements FrontendApplicationContribution, Disposable {

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    protected readonly toDispose = new DisposableCollection();
    protected _flags?: FirstRunFlags;

    /** Created lazily so importing this module never touches `window`. */
    get flags(): FirstRunFlags {
        return this._flags ??= new FirstRunFlags(this.storage());
    }

    /** Overridable in tests. Access can throw when site data is blocked; FirstRunFlags copes with that. */
    protected storage(): FlagStorage {
        return window.localStorage;
    }

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.toDispose.push(this.commands.onDidExecuteCommand(e => {
            if (e.commandId === RENDER_REPORT_COMMAND_ID && this.flags.markReportRendered()) {
                this.onDidChangeEmitter.fire();
            }
        }));
    }

    /** Nothing to do at start; constructing the instance is what installs the listener. */
    onStart(): void { }

    dispose(): void {
        this.toDispose.dispose();
    }

    /** @returns true if this was the first CookBot message ever. */
    markCookbotUsed(): boolean {
        const first = this.flags.markCookbotUsed();
        if (first) {
            this.onDidChangeEmitter.fire();
        }
        return first;
    }
}
