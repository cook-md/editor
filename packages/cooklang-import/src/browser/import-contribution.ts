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
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { FILE_NAVIGATOR_ID } from '@theia/navigator/lib/browser/navigator-widget';
import { ImportWidget, IMPORT_WIDGET_ID } from './import-widget';

export namespace ImportCommands {
    export const OPEN: Command = Command.toLocalizedCommand({
        id: 'cooklang.import.open',
        label: 'Import Recipe…',
    }, 'theia/cooklang-import/openCommand');
    /** Toolbar variant shown on the Explorer's tab bar (visibility scoped to the navigator widget). */
    export const OPEN_FROM_NAVIGATOR: Command = {
        id: 'cooklang.import.openFromNavigator',
        iconClass: 'codicon codicon-cloud-download',
    };
}

@injectable()
export class ImportContribution extends AbstractViewContribution<ImportWidget> implements TabBarToolbarContribution {

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
        registry.registerCommand(ImportCommands.OPEN_FROM_NAVIGATOR, {
            execute: () => this.openView({ activate: true, reveal: true }),
            isEnabled: widget => this.isNavigator(widget),
            isVisible: widget => this.isNavigator(widget),
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        // Group id sorts after the '1_new'/'1_new_text' groups and before '2_open',
        // placing Import Recipe directly under the New-file entries.
        menus.registerMenuAction([...CommonMenus.FILE, '1z_import'], {
            commandId: ImportCommands.OPEN.id,
        });
    }

    override registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        // ctrlcmd+alt+i: ctrlcmd+shift+i is taken by devtools in Electron builds.
        keybindings.registerKeybinding({
            command: ImportCommands.OPEN.id,
            keybinding: 'ctrlcmd+alt+i',
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: ImportCommands.OPEN_FROM_NAVIGATOR.id,
            command: ImportCommands.OPEN_FROM_NAVIGATOR.id,
            tooltip: ImportCommands.OPEN.label,
            priority: 0,
        });
    }

    protected isNavigator(widget: Widget | undefined): boolean {
        return widget instanceof Widget && widget.id === FILE_NAVIGATOR_ID;
    }
}
