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

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TimersWidget, TIMERS_WIDGET_ID } from './timers-widget';
import { TimersCommands } from './timers-commands';

/**
 * Registers the Timers panel as a view, contributing the toggle command and
 * quick-open entry that `AbstractViewContribution` provides for free.
 */
@injectable()
export class TimersViewContribution extends AbstractViewContribution<TimersWidget> {

    constructor() {
        super({
            widgetId: TIMERS_WIDGET_ID,
            widgetName: TimersWidget.LABEL,
            defaultWidgetOptions: {
                area: 'right',
            },
            toggleCommandId: TimersCommands.TOGGLE_VIEW.id,
        });
    }
}
