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
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { ImportWidget, IMPORT_WIDGET_ID } from './import-widget';

export namespace ImportCommands {
    export const OPEN: Command = Command.toLocalizedCommand({
        id: 'cooklang.import.open',
        label: 'Import Recipe…',
    }, 'theia/cooklang-import/openCommand');
}

@injectable()
export class ImportContribution extends AbstractViewContribution<ImportWidget> {

    constructor() {
        super({
            widgetId: IMPORT_WIDGET_ID,
            widgetName: ImportWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(ImportCommands.OPEN, {
            execute: () => this.openView({ activate: true, reveal: true }),
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: ImportCommands.OPEN.id,
            order: 'z10',
        });
    }
}
