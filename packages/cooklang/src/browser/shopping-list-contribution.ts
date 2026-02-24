// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { COOKLANG_LANGUAGE_ID } from '../common';
import { RecipePreviewWidget } from './recipe-preview-widget';

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
        iconClass: 'codicon codicon-add',
    };
}

// ---------------------------------------------------------------------------
// ShoppingListContribution
// ---------------------------------------------------------------------------

@injectable()
export class ShoppingListContribution
    extends AbstractViewContribution<ShoppingListWidget>
    implements TabBarToolbarContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    constructor() {
        super({
            widgetId: SHOPPING_LIST_WIDGET_ID,
            widgetName: ShoppingListWidget.LABEL,
            defaultWidgetOptions: {
                area: 'bottom',
            },
            toggleCommandId: ShoppingListCommands.TOGGLE_VIEW.id,
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(ShoppingListCommands.ADD_TO_LIST, {
            execute: () => this.addCurrentRecipe(),
            isEnabled: () => this.canAddRecipe(),
            isVisible: () => this.canAddRecipe(),
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: ShoppingListCommands.ADD_TO_LIST.id,
            command: ShoppingListCommands.ADD_TO_LIST.id,
            tooltip: 'Add to Shopping List',
        });
    }

    // --- Helpers ---

    protected canAddRecipe(): boolean {
        return this.getActiveCookUri() !== undefined;
    }

    protected async addCurrentRecipe(): Promise<void> {
        const targetUri = this.getActiveCookUri();
        if (!targetUri) {
            return;
        }

        const name = targetUri.path.base.replace(/\.cook$/i, '');
        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(targetUri)?.toString() ?? targetUri.path.base
            : targetUri.path.base;

        await this.shoppingListService.addRecipe(relativePath, name);
        await this.openView({ activate: true });
    }

    protected getActiveCookUri(): URI | undefined {
        // Check if current widget is a recipe preview
        const currentWidget = this.shell?.currentWidget;
        if (currentWidget instanceof RecipePreviewWidget) {
            return currentWidget.getResourceUri();
        }

        // Check active editor
        const editor = this.editorManager.currentEditor;
        if (editor && editor.editor.document.languageId === COOKLANG_LANGUAGE_ID) {
            return new URI(editor.editor.document.uri);
        }
        return undefined;
    }
}
