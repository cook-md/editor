// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { PreviewOutletContext } from '../common/cooklang-outlet-context';
import { CooklangOutlets } from './cooklang-outlets';
import { RecipeNavigator } from './recipe-navigator';

export namespace CooklangOutletCommands {
    export const SHOW_SOURCE: Command = Command.toLocalizedCommand({
        id: 'cooklang.outlet.showSource',
        label: 'Show Source',
        iconClass: 'codicon codicon-go-to-file',
    }, 'theia/cooklang/outletShowSource');
}

/**
 * The editor's own entries in the Cooklang outlets. Show Source lives here so
 * the outlet path is exercised by first-party code, not only by plugins.
 */
@injectable()
export class CooklangOutletContribution implements CommandContribution, MenuContribution {

    @inject(RecipeNavigator)
    protected readonly navigator: RecipeNavigator;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangOutletCommands.SHOW_SOURCE, {
            execute: (context: unknown) => PreviewOutletContext.is(context) ? this.navigator.openSource(new URI(context.uri)) : undefined,
            // Outlet-only: hidden from the command palette, which passes no context.
            isVisible: (context: unknown) => PreviewOutletContext.is(context),
            isEnabled: (context: unknown) => PreviewOutletContext.is(context),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        for (const outlet of [CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, CooklangOutlets.MENU_PREVIEW_TOOLBAR]) {
            menus.registerMenuAction([...outlet, 'navigation'], {
                commandId: CooklangOutletCommands.SHOW_SOURCE.id,
                order: '90',
            });
        }
    }
}
