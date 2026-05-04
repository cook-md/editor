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
import { COOKLANG_LANGUAGE_ID } from '../common';
import { CooklangLanguageService } from '../common/cooklang-language-service';

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

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

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
            includedRefs = await this.collectResolvedRefs(
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
            if (uri.path.ext === '.menu') { return uri; }
        }
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (uri && uri.path.ext === '.menu') { return uri; }
        }
        const selection = this.selectionService.selection;
        const selectedUri = UriSelection.getUri(selection);
        if (selectedUri && selectedUri.path.ext === '.menu') { return selectedUri; }
        const currentWidget = this.shell?.currentWidget;
        if (NavigatableWidget.is(currentWidget)) {
            const uri = currentWidget.getResourceUri();
            if (uri && uri.path.ext === '.menu') { return uri; }
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

        const recipes = await this.collectResolvedRefs(menuContent, baseDir);
        if (recipes.length === 0) {
            console.warn('[shopping-list] Menu contained no recipe references:', relativePath);
            return;
        }

        await this.shoppingListService.addMenu(relativePath, this.resolveScale(args), recipes);
        await this.openView({ activate: true });
    }

    /**
     * Parse `content` for `@recipe` sub-references and resolve each to a
     * concrete multiplier, since the `.shopping-list` format only stores
     * a numeric multiplier.
     *
     * Per spec/conventions.md:
     *   {2}            → plain multiplier
     *   {4%servings}   → target / recipe.servings
     *   {150%ml}       → target / recipe.yield (when units match)
     *
     * Unresolvable units fall back to treating the raw number as a
     * multiplier — same as when no metadata is present on the target.
     */
    protected async collectResolvedRefs(
        content: string,
        baseDir: string,
    ): Promise<Array<{ path: string; scale: number }>> {
        let parsed: {
            sections?: Array<{
                lines?: Array<Array<{ type?: string; name?: string; scale?: number; unit?: string }>>;
            }>;
        };
        try {
            parsed = JSON.parse(await this.languageService.parseMenu(content, 1));
        } catch (e) {
            console.error('[shopping-list] Failed to parse content for refs:', e);
            return [];
        }

        const refs: Array<{ path: string; scale: number; unit?: string }> = [];
        for (const section of parsed.sections ?? []) {
            for (const line of section.lines ?? []) {
                for (const item of line) {
                    if (item.type !== 'recipeReference') { continue; }
                    if (!item.name) { continue; }
                    refs.push({
                        path: item.name.replace(/^\.\//, ''),
                        scale: typeof item.scale === 'number' && item.scale > 0 ? item.scale : 1,
                        unit: item.unit,
                    });
                }
            }
        }

        const out: Array<{ path: string; scale: number }> = [];
        for (const r of refs) {
            let scale = r.scale;
            if (r.unit && r.scale > 0) {
                const resolved = await this.resolveReferenceScale(baseDir, r.path, r.scale, r.unit);
                if (resolved !== undefined) {
                    scale = resolved;
                }
            }
            out.push({ path: r.path, scale });
        }
        return out;
    }

    /**
     * Compute the multiplier that, when applied to the referenced recipe,
     * yields the requested target.
     *
     * - `%servings` / `%serves` → reads the recipe's `servings` metadata.
     * - any other unit          → reads the recipe's `yield` metadata and
     *                             only resolves when the units match.
     *
     * Returns `undefined` when the recipe can't be found, the relevant
     * metadata is missing/unparseable, or the unit doesn't match — callers
     * fall back to treating the raw number as a plain multiplier.
     */
    protected async resolveReferenceScale(
        baseDir: string,
        recipePath: string,
        target: number,
        unit: string,
    ): Promise<number | undefined> {
        let content: string | undefined;
        try {
            content = await this.languageService.findRecipe(baseDir, recipePath);
        } catch (e) {
            console.warn(`[shopping-list] findRecipe failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!content) { return undefined; }

        let metadata: { servings?: string; yield?: string } | undefined;
        try {
            const menu = JSON.parse(await this.languageService.parseMenu(content, 1));
            metadata = menu?.metadata;
        } catch (e) {
            console.warn(`[shopping-list] parseMenu failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!metadata) { return undefined; }

        const normalisedUnit = unit.toLowerCase();
        const isServings = normalisedUnit === 'servings' || normalisedUnit === 'serves';
        const raw = isServings ? metadata.servings : metadata.yield;
        if (!raw) { return undefined; }

        const parsed = parseNumberAndUnit(raw);
        if (!parsed || parsed.amount <= 0) { return undefined; }

        // For yield, the reference unit must match the recipe's yield unit.
        // For servings, the `%servings`/`%serves` label is the unit — any
        // trailing text in the metadata value (`"15 cups worth"`) is ignored.
        if (!isServings) {
            if (!parsed.unit || parsed.unit.toLowerCase() !== normalisedUnit) {
                return undefined;
            }
        }

        return target / parsed.amount;
    }
}

/**
 * Extract a leading positive number and optional unit from a metadata string.
 * Handles cooklang quantity syntax (`500%ml`), space-separated (`2 cups`), and
 * bare numbers (`2`).
 */
function parseNumberAndUnit(value: string): { amount: number; unit?: string } | undefined {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*%?\s*([^\s]*)/);
    if (!match) { return undefined; }
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount)) { return undefined; }
    const unit = match[2] ? match[2] : undefined;
    return { amount, unit };
}
