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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { OSNotificationService } from '@theia/ai-core/lib/browser/os-notification-service';
import { ActiveTimer } from '../common/cooking-timer';
import { CooklangPreferences } from '../common/cooklang-preferences';
import { CookingTimerService } from './cooking-timer-service';
import { TimerChime } from './timer-chime';
import { TimersCommands } from './timers-commands';

/**
 * Turns a finished timer into something you notice from the other side of the
 * kitchen: a system notification (so it lands even when the window is in the
 * background) and a chime.
 */
@injectable()
export class TimerAlarmService implements FrontendApplicationContribution {

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    @inject(OSNotificationService)
    protected readonly notificationService: OSNotificationService;

    @inject(TimerChime)
    protected readonly chime: TimerChime;

    @inject(CooklangPreferences)
    protected readonly preferences: CooklangPreferences;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    protected permissionRequested = false;

    onStart(): void {
        this.timerService.onDidFinishTimer(timer => this.alarm(timer));
        // Ask for notification permission the first time the user deliberately
        // starts a timer — not at startup, and not when persisted timers merely
        // reload from storage — since that is the natural moment for it and
        // nobody wants a permission prompt for opening a recipe.
        this.timerService.onDidStartTimer(() => this.ensurePermission());
    }

    protected ensurePermission(): void {
        if (this.permissionRequested) {
            return;
        }
        this.permissionRequested = true;
        this.notificationService.requestPermission();
    }

    protected alarm(timer: ActiveTimer): void {
        if (this.preferences['cooklang.timers.sound']) {
            this.chime.play();
        }
        if (!this.preferences['cooklang.timers.notifications']) {
            return;
        }
        this.notificationService.showNotification(
            `${timer.title} — done`,
            {
                body: timer.recipeRef?.recipeName,
                requireInteraction: true,
                tag: `cooklang-timer-${timer.id}`,
                // The chime is our sound. When it is on, the OS notification
                // sound would just layer on top of it; when it is off, the
                // user wants silence. Either way, `silent: true` is right.
                silent: true,
            },
            () => {
                this.commands.executeCommand(TimersCommands.TOGGLE_VIEW.id)
                    .catch(e => console.warn('Could not reveal the Timers view', e));
            }
        );
    }
}
