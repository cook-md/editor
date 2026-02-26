// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { UriSelection } from '@theia/core/lib/common/selection';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { EditorManager } from '@theia/editor/lib/browser';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { COOKLANG_LANGUAGE_ID } from '../common';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export namespace ShoppingListCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cooklang.toggleShoppingList',
        label: 'Cooklang: Toggle Shopping List',
    };
    export const ADD_TO_LIST: Command = {
        id: 'cooklang.addToShoppingList',
        label: 'Cooklang: Add to Shopping List',
        iconClass: 'theia-shopping-cart-icon',
    };
}

// ---------------------------------------------------------------------------
// ShoppingListContribution
// ---------------------------------------------------------------------------

@injectable()
export class ShoppingListContribution
    extends AbstractViewContribution<ShoppingListWidget>
    implements TabBarToolbarContribution, FrontendApplicationContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    constructor() {
        super({
            widgetId: SHOPPING_LIST_WIDGET_ID,
            widgetName: ShoppingListWidget.LABEL,
            defaultWidgetOptions: {
                area: 'right',
            },
            toggleCommandId: ShoppingListCommands.TOGGLE_VIEW.id,
        });
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.openView({ activate: false });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(ShoppingListCommands.ADD_TO_LIST, {
            execute: (...args: unknown[]) => this.addRecipe(args),
            isEnabled: (...args: unknown[]) => this.canAddRecipe(args),
            isVisible: (...args: unknown[]) => this.canAddRecipe(args),
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        // Explorer: right-click context menu on .cook files
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: ShoppingListCommands.ADD_TO_LIST.id,
            label: 'Add to Shopping List',
            when: 'resourceExtname == .cook',
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        // Editor title: action button when a .cook file is active
        toolbar.registerItem({
            id: ShoppingListCommands.ADD_TO_LIST.id + '.editor',
            command: ShoppingListCommands.ADD_TO_LIST.id,
            tooltip: 'Add to Shopping List',
            when: `editorLangId == ${COOKLANG_LANGUAGE_ID}`,
        });
    }

    // --- Helpers ---

    /**
     * Resolves the target .cook URI from command arguments, navigator selection,
     * or the currently active widget.
     */
    protected resolveTargetUri(args: unknown[]): URI | undefined {
        // 1. Direct URI argument (from context menu or programmatic invocation)
        if (args.length > 0 && args[0] instanceof URI) {
            const uri = args[0] as URI;
            if (uri.path.ext === '.cook') {
                return uri;
            }
        }

        // 2. Widget argument (toolbar passes the widget as first arg)
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (uri && uri.path.ext === '.cook') {
                return uri;
            }
        }

        // 3. Navigator selection (right-click context menu)
        const selection = this.selectionService.selection;
        const selectedUri = UriSelection.getUri(selection);
        if (selectedUri && selectedUri.path.ext === '.cook') {
            return selectedUri;
        }

        // 4. Current widget via Navigatable interface (works for both
        //    restored editors and preview widgets)
        const currentWidget = this.shell?.currentWidget;
        if (NavigatableWidget.is(currentWidget)) {
            const uri = currentWidget.getResourceUri();
            if (uri && uri.path.ext === '.cook') {
                return uri;
            }
        }

        return undefined;
    }

    protected canAddRecipe(args: unknown[] = []): boolean {
        return this.resolveTargetUri(args) !== undefined;
    }

    protected resolveScale(args: unknown[]): number {
        for (const arg of args) {
            if (typeof arg === 'number' && Number.isFinite(arg) && arg > 0) {
                return arg;
            }
        }
        return 1;
    }

    protected async addRecipe(args: unknown[] = []): Promise<void> {
        const targetUri = this.resolveTargetUri(args);
        if (!targetUri) {
            return;
        }

        const scale = this.resolveScale(args);
        const name = targetUri.path.base.replace(/\.cook$/i, '');
        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(targetUri)?.toString() ?? targetUri.path.base
            : targetUri.path.base;

        await this.shoppingListService.addRecipe(relativePath, name, scale);
        await this.openView({ activate: true });
    }
}
