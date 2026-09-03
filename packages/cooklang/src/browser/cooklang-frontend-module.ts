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

import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    WidgetFactory,
    bindViewContribution,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { MenuContribution } from '@theia/core/lib/common/menu';
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
import { CookingTimerService } from './cooking-timer-service';
import { RecipePreviewContribution } from './recipe-preview-contribution';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { RecipeReferenceResolver } from './recipe-reference-resolver';
import { RecipeNavigator } from './recipe-navigator';
import { ShoppingListContribution } from './shopping-list-contribution';
import { TimerChime } from './timer-chime';
import { TimerAlarmService } from './timer-alarm-service';
import { TimersWidget, TIMERS_WIDGET_ID } from './timers-widget';
import { TimersViewContribution } from './timers-view-contribution';
import { MENU_PREVIEW_WIDGET_ID, createMenuPreviewWidget } from './menu-preview-widget';
import { MenuPreviewContribution } from './menu-preview-contribution';
import { REPORT_WIDGET_ID, ReportWidgetOptions, createReportWidget } from './report-widget';
import { ReportContribution } from './report-contribution';
import { ReportExportContribution } from './report-export-contribution';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';
import { ReportTemplateFinder } from './report-template-finder';
import { ReportWidgetPresenter } from './report-widget-presenter';
import { MermaidRenderer } from './mermaid-renderer';
import { bindToolProvider } from '@theia/ai-core/lib/common';
import { RenderTemplateTool } from './render-template-tool';
import { ListReportTemplatesTool } from './list-report-templates-tool';
import { SearchRecipesTool } from './search-recipes-tool';
import { GetPantryTool, CheckPantryTool } from './pantry-tools';
import { GenerateShoppingListTool } from './generate-shopping-list-tool';
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

    // Cooking timer state, shared by the recipe preview's timer badges and the
    // Timers panel. Bound here rather than with the other timer bindings below
    // because the preview widget injects it, and a preview cannot open without.
    bind(CookingTimerService).toSelf().inSingletonScope();

    // Recipe preview commands, keybindings, toolbar, and context menu
    bind(RecipePreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(RecipePreviewContribution);
    bind(KeybindingContribution).toService(RecipePreviewContribution);
    bind(OpenHandler).toService(RecipePreviewContribution);
    bind(TabBarToolbarContribution).toService(RecipePreviewContribution);
    bind(MenuContribution).toService(RecipePreviewContribution);

    // Menu preview widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MENU_PREVIEW_WIDGET_ID,
        createWidget: (options: { uri: string }) =>
            createMenuPreviewWidget(ctx.container, new URI(options.uri)),
    })).inSingletonScope();

    // Menu preview commands, keybindings, toolbar, and context menu
    bind(MenuPreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MenuPreviewContribution);
    bind(KeybindingContribution).toService(MenuPreviewContribution);
    bind(OpenHandler).toService(MenuPreviewContribution);
    bind(TabBarToolbarContribution).toService(MenuPreviewContribution);
    bind(MenuContribution).toService(MenuPreviewContribution);

    // Report widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: REPORT_WIDGET_ID,
        createWidget: (options: ReportWidgetOptions) =>
            createReportWidget(ctx.container, options),
    })).inSingletonScope();

    // Report config + presenter (shared by the command and the AI render tool)
    bind(ReportConfigService).toSelf().inSingletonScope();
    bind(ReportTemplateFinder).toSelf().inSingletonScope();
    bind(ReportWidgetPresenter).toSelf().inSingletonScope();
    bind(ReportPresenter).toService(ReportWidgetPresenter);

    // Mermaid renderer for rendering diagrams in reports
    bind(MermaidRenderer).toSelf().inSingletonScope();

    // AI render tool (picked up by the cookbot agent via ToolInvocationRegistry)
    bindToolProvider(RenderTemplateTool, bind);
    bindToolProvider(ListReportTemplatesTool, bind);

    // Workspace tools for cookbot (issue #82): recipe search, pantry, shopping list
    bindToolProvider(SearchRecipesTool, bind);
    bindToolProvider(GetPantryTool, bind);
    bindToolProvider(CheckPantryTool, bind);
    bindToolProvider(GenerateShoppingListTool, bind);

    // Report command and context menu
    bind(ReportContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ReportContribution);
    bind(MenuContribution).toService(ReportContribution);

    // Report print/export commands + toolbar
    bind(ReportExportContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ReportExportContribution);
    bind(TabBarToolbarContribution).toService(ReportExportContribution);

    // Cooklang preferences
    bindCooklangPreferences(bind);

    // Shopping list
    bind(RecipeReferenceResolver).toSelf().inSingletonScope();
    bind(RecipeNavigator).toSelf().inSingletonScope();
    bind(ShoppingListService).toSelf().inSingletonScope();

    bind(ShoppingListWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SHOPPING_LIST_WIDGET_ID,
        createWidget: () => ctx.container.get<ShoppingListWidget>(ShoppingListWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ShoppingListContribution);
    bind(FrontendApplicationContribution).toService(ShoppingListContribution);
    bind(TabBarToolbarContribution).toService(ShoppingListContribution);

    // --- Timers --- (CookingTimerService is bound above, with the preview.)
    bind(TimerChime).toSelf().inSingletonScope();
    bind(TimerAlarmService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TimerAlarmService);

    bind(TimersWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: TIMERS_WIDGET_ID,
        createWidget: () => ctx.container.get<TimersWidget>(TimersWidget),
    })).inSingletonScope();

    bindViewContribution(bind, TimersViewContribution);
});
