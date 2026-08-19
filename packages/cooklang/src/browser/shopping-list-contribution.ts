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
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { RecipeReferenceResolver } from './recipe-reference-resolver';
import { COOKLANG_LANGUAGE_ID, CooklangUri } from '../common';

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
    export const ADD_MENU_TO_LIST: Command = {
        id: 'cooklang.addMenuToShoppingList',
        label: 'Cooklang: Add Menu to Shopping List',
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

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(RecipeReferenceResolver)
    protected readonly referenceResolver: RecipeReferenceResolver;

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
        commands.registerCommand(ShoppingListCommands.ADD_MENU_TO_LIST, {
            execute: (...args: unknown[]) => this.addMenu(args),
            isEnabled: (...args: unknown[]) => this.canAddMenu(args),
            isVisible: (...args: unknown[]) => this.canAddMenu(args),
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
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: ShoppingListCommands.ADD_MENU_TO_LIST.id,
            label: 'Add Menu to Shopping List',
            when: 'resourceExtname == .menu',
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
        toolbar.registerItem({
            id: ShoppingListCommands.ADD_MENU_TO_LIST.id + '.editor',
            command: ShoppingListCommands.ADD_MENU_TO_LIST.id,
            tooltip: 'Add Menu to Shopping List',
            when: 'resourceExtname == .menu',
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
            if (CooklangUri.isRecipe(uri)) {
                return uri;
            }
        }

        // 2. Widget argument (toolbar passes the widget as first arg)
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (CooklangUri.isRecipe(uri)) {
                return uri;
            }
        }

        // 3. Navigator selection (right-click context menu)
        const selection = this.selectionService.selection;
        const selectedUri = UriSelection.getUri(selection);
        if (CooklangUri.isRecipe(selectedUri)) {
            return selectedUri;
        }

        // 4. Current widget via Navigatable interface (works for both
        //    restored editors and preview widgets)
        const currentWidget = this.shell?.currentWidget;
        if (NavigatableWidget.is(currentWidget)) {
            const uri = currentWidget.getResourceUri();
            if (CooklangUri.isRecipe(uri)) {
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
        if (!targetUri) { return; }

        const scale = this.resolveScale(args);
        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        if (!workspaceRoot) { return; }

        const relativePath =
            workspaceRoot.relative(targetUri)?.toString() ?? targetUri.path.base;

        // Parse the recipe for sub-recipe references so we can include their
        // ingredients in the shopping list with correctly scaled multipliers.
        let includedRefs: Array<{ path: string; scale: number }> | undefined;
        try {
            const content = await this.fileService.read(targetUri);
            includedRefs = await this.referenceResolver.resolve(
                content.value,
                workspaceRoot.path.fsPath(),
            );
        } catch (e) {
            console.warn('[shopping-list] Failed to read recipe for sub-refs:', e);
        }

        await this.shoppingListService.addRecipe(relativePath, scale, includedRefs);
        await this.openView({ activate: true });
    }

    protected resolveMenuUri(args: unknown[]): URI | undefined {
        if (args.length > 0 && args[0] instanceof URI) {
            const uri = args[0] as URI;
            if (CooklangUri.isMenu(uri)) { return uri; }
        }
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (CooklangUri.isMenu(uri)) { return uri; }
        }
        const selection = this.selectionService.selection;
        const selectedUri = UriSelection.getUri(selection);
        if (CooklangUri.isMenu(selectedUri)) { return selectedUri; }
        const currentWidget = this.shell?.currentWidget;
        if (NavigatableWidget.is(currentWidget)) {
            const uri = currentWidget.getResourceUri();
            if (CooklangUri.isMenu(uri)) { return uri; }
        }
        return undefined;
    }

    protected canAddMenu(args: unknown[] = []): boolean {
        return this.resolveMenuUri(args) !== undefined;
    }

    protected async addMenu(args: unknown[] = []): Promise<void> {
        const menuUri = this.resolveMenuUri(args);
        if (!menuUri) { return; }

        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(menuUri)?.toString() ?? menuUri.path.base
            : menuUri.path.base;

        // Parse the menu to enumerate referenced recipes.
        let menuContent: string;
        try {
            const root = this.shoppingListService.getWorkspaceRootUri();
            if (!root) { return; }
            const content = await this.fileService.read(root.resolve(relativePath));
            menuContent = content.value;
        } catch (e) {
            console.error('[shopping-list] Failed to read menu file:', e);
            return;
        }

        const baseDir = this.shoppingListService.getWorkspaceRootUri()?.path.fsPath();
        if (!baseDir) { return; }

        const recipes = await this.referenceResolver.resolve(menuContent, baseDir);
        if (recipes.length === 0) {
            console.warn('[shopping-list] Menu contained no recipe references:', relativePath);
            return;
        }

        await this.shoppingListService.addMenu(relativePath, this.resolveScale(args), recipes);
        await this.openView({ activate: true });
    }
}
