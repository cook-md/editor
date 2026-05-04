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
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AccountWidget, ACCOUNT_WIDGET_ID } from './account-widget';

export namespace AccountCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cooked.toggleAccount',
        label: 'Cook.md: Toggle Account',
    };
    export const OPEN_VIEW: Command = {
        id: 'cooked.openAccount',
    };
}

@injectable()
export class AccountContribution
    extends AbstractViewContribution<AccountWidget>
    implements FrontendApplicationContribution {

    constructor() {
        super({
            widgetId: ACCOUNT_WIDGET_ID,
            widgetName: AccountWidget.LABEL,
            defaultWidgetOptions: { area: 'right' },
            toggleCommandId: AccountCommands.TOGGLE_VIEW.id,
        });
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.openView({ activate: false });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(AccountCommands.OPEN_VIEW, {
            execute: () => this.openView({ activate: true, reveal: true }),
        });
    }
}
