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
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';

/** Command id of Render Report, defined in packages/cooklang/src/browser/report-contribution.ts. */
export const RENDER_REPORT_COMMAND_ID = 'cooklang.renderReport';

/**
 * Widget factory id of the rendered report (REPORT_WIDGET_ID in packages/cooklang/src/browser/report-widget-types.ts;
 * not imported to avoid a dependency on @theia/cooklang). ReportWidgetPresenter creates it through the WidgetManager
 * only once a template was picked, so a cancelled picker does not count as a rendered report.
 */
export const REPORT_WIDGET_FACTORY_ID = 'cooklang-report-widget';

const KEYS = {
    cookbotUsed: 'cook.firstRun.cookbotUsed',
    reportRendered: 'cook.firstRun.reportRendered',
    welcomeSeen: 'cook.firstRun.welcomeSeen',
    reportedSteps: 'cook.firstRun.reportedSteps',
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

    /**
     * Checklist steps already reported as completed (JSON array of step ids), or undefined if
     * nothing was ever stored (or the value is corrupt). Monotonic: see reconcileReportedSteps.
     */
    get reportedSteps(): string[] | undefined {
        const raw = this.get(KEYS.reportedSteps);
        if (raw === null) { // eslint-disable-line no-null/no-null
            return undefined;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : undefined;
        } catch {
            return undefined;
        }
    }

    setReportedSteps(steps: readonly string[]): void {
        this.set(KEYS.reportedSteps, JSON.stringify(steps));
    }

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
        this.set(key, '1');
        return true;
    }

    protected set(key: string, value: string): void {
        this.memory.set(key, value);
        try {
            this.storage.setItem(key, value);
        } catch {
            // kept in memory only
        }
    }
}

/**
 * App-wide wrapper: fires onDidChange, and marks a report once a report widget is created.
 * Declared as a FrontendApplicationContribution (and bound to that token) only so it is
 * constructed at startup: its widget listener must be live before any widget injects it.
 */
@injectable()
export class FirstRunState implements FrontendApplicationContribution, Disposable {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    protected readonly toDispose = new DisposableCollection();
    protected _flags?: FirstRunFlags;

    /** Created lazily so importing this module never touches `window`. */
    get flags(): FirstRunFlags {
        return this._flags ??= new FirstRunFlags(this.storage());
    }

    /**
     * Overridable in tests. Even reading `window.localStorage` can throw (SecurityError when site
     * data is blocked); then a no-op storage is returned and FirstRunFlags keeps state in memory.
     */
    protected storage(): FlagStorage {
        try {
            return window.localStorage;
        } catch {
            return { getItem: () => null, setItem: () => undefined }; // eslint-disable-line no-null/no-null
        }
    }

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.toDispose.push(this.widgetManager.onDidCreateWidget(e => {
            if (e.factoryId === REPORT_WIDGET_FACTORY_ID && this.flags.markReportRendered()) {
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
