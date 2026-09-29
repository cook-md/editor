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

const KEYS = {
    cookbotUsed: 'cook.firstRun.cookbotUsed',
    reportRendered: 'cook.firstRun.reportRendered',
    welcomeSeen: 'cook.firstRun.welcomeSeen',
} as const;

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Local, per-install flags. They never leave the machine. */
export class FirstRunFlags {
    constructor(protected readonly storage: FlagStorage) { }

    get cookbotUsed(): boolean { return this.storage.getItem(KEYS.cookbotUsed) === '1'; }
    get reportRendered(): boolean { return this.storage.getItem(KEYS.reportRendered) === '1'; }

    /** @returns true if this was the first CookBot message ever. */
    markCookbotUsed(): boolean { return this.mark(KEYS.cookbotUsed); }
    markReportRendered(): boolean { return this.mark(KEYS.reportRendered); }
    /** @returns true the first time the welcome page is ever shown. */
    takeFirstWelcome(): boolean { return this.mark(KEYS.welcomeSeen); }

    protected mark(key: string): boolean {
        if (this.storage.getItem(key) === '1') {
            return false;
        }
        this.storage.setItem(key, '1');
        return true;
    }
}

/** App-wide wrapper: fires onDidChange, and marks a report once Render Report runs. */
@injectable()
export class FirstRunState {

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    protected _flags?: FirstRunFlags;

    /** Created lazily so importing this module never touches `window`. */
    get flags(): FirstRunFlags {
        return this._flags ??= new FirstRunFlags(window.localStorage);
    }

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.commands.onDidExecuteCommand(e => {
            if (e.commandId === 'cooklang.renderReport' && this.flags.markReportRendered()) {
                this.onDidChangeEmitter.fire();
            }
        });
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
