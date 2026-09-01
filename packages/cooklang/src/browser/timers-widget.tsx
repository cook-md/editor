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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { CommandRegistry } from '@theia/core/lib/common/command';
import * as React from '@theia/core/shared/react';
import { TimerRecipeRef } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';
import { TimerRow } from './timer-components';

import '../../src/browser/style/timers.css';

export const TIMERS_WIDGET_ID = 'cooklang-timers';

/**
 * Lists every started timer across every recipe, so a timer stays visible after
 * you scroll past its step or close its preview. A port of the iOS app's
 * `TimersView`.
 */
@injectable()
export class TimersWidget extends ReactWidget {

    static readonly ID = TIMERS_WIDGET_ID;
    static readonly LABEL = 'Timers';

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @postConstruct()
    protected init(): void {
        this.id = TIMERS_WIDGET_ID;
        this.title.label = TimersWidget.LABEL;
        this.title.caption = TimersWidget.LABEL;
        this.title.iconClass = 'codicon codicon-watch';
        this.title.closable = true;
        this.addClass('theia-cooklang-timers');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.toDispose.push(this.timerService.onDidChangeTimers(() => this.update()));
        this.update();
    }

    protected handleToggle = (id: string): void => this.timerService.toggle(id);
    protected handleReset = (id: string): void => this.timerService.reset(id);
    protected handleAddTime = (id: string, seconds: number): void => this.timerService.addTime(id, seconds);
    protected handleRemove = (id: string): void => this.timerService.remove(id);
    protected handleRemoveFinished = (): void => this.timerService.removeFinished();

    protected handleRemoveAll = (): void => {
        this.confirmRemoveAll().catch(e => console.warn('Could not clear the timers', e));
    };

    /**
     * Clearing finished timers is harmless, but a running one represents
     * something actually cooking, so ask before throwing those away.
     */
    protected async confirmRemoveAll(): Promise<void> {
        // A paused timer is state the cook deliberately kept, so it deserves the
        // same protection as a running one. Only an all-finished list clears
        // without asking, because that throws nothing away.
        const unfinished = this.timerService.list().filter(timer => timer.state !== 'finished').length;
        if (unfinished > 0) {
            const confirmed = await new ConfirmDialog({
                title: 'Clear all timers',
                msg: unfinished === 1
                    ? 'One timer has not finished. Clearing it cannot be undone.'
                    : `${unfinished} timers have not finished. Clearing them cannot be undone.`,
                ok: 'Clear all',
                cancel: 'Cancel',
            }).open();
            if (!confirmed) {
                return;
            }
        }
        this.timerService.removeAll();
    }

    protected handleOpenRecipe = (ref: TimerRecipeRef): void => {
        this.commandRegistry.executeCommand('cooklang.openPreviewAtScale', ref.recipePath, ref.scale)
            .catch(e => console.warn('Could not open recipe from timer:', e));
    };

    protected render(): React.ReactNode {
        const timers = CookingTimerService.sortForDisplay(this.timerService.list());
        if (timers.length === 0) {
            return (
                <div className='timers-empty'>
                    No timers yet. Click a time in a recipe step to start one.
                </div>
            );
        }
        const hasFinished = timers.some(timer => timer.state === 'finished');
        const nowMs = this.timerService.nowMs();
        return (
            <div className='timers-body'>
                <div className='timers-header'>
                    {hasFinished && (
                        <button className='timers-header-action' onClick={this.handleRemoveFinished}>
                            Clear finished
                        </button>
                    )}
                    <button className='timers-header-action' onClick={this.handleRemoveAll}>
                        Clear all
                    </button>
                </div>
                {timers.map(timer => (
                    <TimerRow
                        key={timer.id}
                        timer={timer}
                        nowMs={nowMs}
                        onToggle={this.handleToggle}
                        onReset={this.handleReset}
                        onAddTime={this.handleAddTime}
                        onRemove={this.handleRemove}
                        onOpenRecipe={this.handleOpenRecipe}
                    />
                ))}
            </div>
        );
    }
}
