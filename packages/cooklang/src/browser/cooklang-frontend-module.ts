// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    WidgetFactory,
    bindViewContribution,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import URI from '@theia/core/lib/common/uri';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';
import { CooklangLanguageClientContribution } from './cooklang-language-client-contribution';
import { CooklangLanguageService, CooklangLanguageServicePath } from '../common/cooklang-language-service';
import { RECIPE_PREVIEW_WIDGET_ID, createRecipePreviewWidget } from './recipe-preview-widget';
import { RecipePreviewContribution } from './recipe-preview-contribution';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListContribution } from './shopping-list-contribution';
import { MENU_PREVIEW_WIDGET_ID, createMenuPreviewWidget } from './menu-preview-widget';
import { MenuPreviewContribution } from './menu-preview-contribution';
import { bindCooklangPreferences } from '../common';

export default new ContainerModule(bind => {
    // TextMate grammar
    bind(CooklangGrammarContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(CooklangGrammarContribution);

    // RPC proxy to the backend LSP bridge service
    bind(CooklangLanguageService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<CooklangLanguageService>(ctx.container, CooklangLanguageServicePath)
    ).inSingletonScope();

    // Language client contribution (registers Monaco providers + document listeners)
    bind(CooklangLanguageClientContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CooklangLanguageClientContribution);

    // Recipe preview widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RECIPE_PREVIEW_WIDGET_ID,
        createWidget: (options: { uri: string }) =>
            createRecipePreviewWidget(ctx.container, new URI(options.uri)),
    })).inSingletonScope();

    // Recipe preview commands and keybindings
    bind(RecipePreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(RecipePreviewContribution);
    bind(KeybindingContribution).toService(RecipePreviewContribution);
    bind(OpenHandler).toService(RecipePreviewContribution);

    // Menu preview widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MENU_PREVIEW_WIDGET_ID,
        createWidget: (options: { uri: string }) =>
            createMenuPreviewWidget(ctx.container, new URI(options.uri)),
    })).inSingletonScope();

    // Menu preview commands and keybindings
    bind(MenuPreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MenuPreviewContribution);
    bind(KeybindingContribution).toService(MenuPreviewContribution);
    bind(OpenHandler).toService(MenuPreviewContribution);

    // Cooklang preferences
    bindCooklangPreferences(bind);

    // Shopping list
    bind(ShoppingListService).toSelf().inSingletonScope();

    bind(ShoppingListWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SHOPPING_LIST_WIDGET_ID,
        createWidget: () => ctx.container.get<ShoppingListWidget>(ShoppingListWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ShoppingListContribution);
    bind(FrontendApplicationContribution).toService(ShoppingListContribution);
    bind(TabBarToolbarContribution).toService(ShoppingListContribution);
});
