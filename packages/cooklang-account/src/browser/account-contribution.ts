// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AccountWidget, ACCOUNT_WIDGET_ID } from './account-widget';

export namespace AccountCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cookmd.toggleAccount',
        label: 'Cook.md: Toggle Account',
    };
    export const OPEN_VIEW: Command = {
        id: 'cookmd.openAccount',
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
