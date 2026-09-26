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
import { RecipeReferenceResolver } from './recipe-reference-resolver';
import { ShoppingListGenerator } from './shopping-list-generator';
import { CooklangPluginApiContribution } from './cooklang-plugin-api-contribution';
import { RecipeNavigator } from './recipe-navigator';
import { IMAGE_VIEWER_WIDGET_ID, ImageViewerWidget } from './image-viewer-widget';
import { ImageViewerContribution } from './image-viewer-contribution';
import { BinaryFileOpenHandler } from './binary-file-open-handler';
import { CookUrlOpenHandler } from './cook-url-open-handler';
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
import { PluginReportService } from './plugin-report-service';
import { ReportPresenter } from './report-presenter';
import { ReportTemplateFinder } from './report-template-finder';
import { ReportWidgetPresenter } from './report-widget-presenter';
import { MermaidRenderer } from './mermaid-renderer';
import { bindToolProvider } from '@theia/ai-core/lib/common';
import { RenderTemplateTool } from './render-template-tool';
import { ListReportTemplatesTool } from './list-report-templates-tool';
import { SearchRecipesTool } from './search-recipes-tool';
import { RecipeMetadataSource } from './recipe-metadata-source';
import { GetPantryTool, CheckPantryTool } from './pantry-tools';
import { GenerateShoppingListTool } from './generate-shopping-list-tool';
import { bindCooklangPreferences } from '../common';
import { EmptyFileDetector } from './empty-file-detector';
import { MarkdownRecipeDetector } from './markdown-recipe-detector';
import { MarkdownRecipeLanguageContribution } from './markdown-recipe-language-contribution';
import { PreviewTabManager } from './preview-tab-manager';
import { CooklangOutletService } from './cooklang-outlet-service';
import { CooklangOutletContribution } from './cooklang-outlet-contribution';
import { CooklangWorkspaceCommandContribution } from './cooklang-workspace-command-contribution';
import { createCooklangFileNavigatorWidget } from './cooklang-navigator-widget';
import { WorkspaceCommandContribution } from '@theia/workspace/lib/browser/workspace-commands';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // Shared by both preview open handlers: an empty file opens in the editor,
    // and a preview opened by a single click reuses one tab.
    bind(EmptyFileDetector).toSelf().inSingletonScope();
    bind(MarkdownRecipeDetector).toSelf().inSingletonScope();
    bind(PreviewTabManager).toSelf().inSingletonScope();

    // Reads what plugins (and the editor) contributed to a Cooklang outlet menu path.
    bind(CooklangOutletService).toSelf().inSingletonScope();

    // Editor's own Show Source entry in the preview toolbar outlets.
    bind(CooklangOutletContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CooklangOutletContribution);
    bind(MenuContribution).toService(CooklangOutletContribution);

    // Obsidian-style `.md` + `recipe: true` → Cooklang language id.
    bind(MarkdownRecipeLanguageContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MarkdownRecipeLanguageContribution);

    // `New File...` proposes `Untitled.cook` rather than upstream's `Untitled.txt`.
    rebind(WorkspaceCommandContribution).to(CooklangWorkspaceCommandContribution).inSingletonScope();

    // Explorer with `alt`/`option` click opening the source of a recipe.
    rebind(FileNavigatorWidget).toDynamicValue(ctx => createCooklangFileNavigatorWidget(ctx.container));

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

    // Images open in a viewer tab, other binaries in the system application;
    // neither belongs in the text editor.
    bind(ImageViewerWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: IMAGE_VIEWER_WIDGET_ID,
        createWidget: (options: { uri: string }) => {
            const widget = ctx.container.get(ImageViewerWidget);
            widget.setUri(new URI(options.uri));
            return widget;
        },
    })).inSingletonScope();
    bind(ImageViewerContribution).toSelf().inSingletonScope();
    bind(OpenHandler).toService(ImageViewerContribution);
    bind(BinaryFileOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(BinaryFileOpenHandler);

    // cook:// and cooklang:// links forwarded from the OS by Electron's open-url.
    bind(CookUrlOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(CookUrlOpenHandler);

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
    bind(PluginReportService).toSelf().inSingletonScope();
    bind(ReportTemplateFinder).toSelf().inSingletonScope();
    bind(ReportWidgetPresenter).toSelf().inSingletonScope();
    bind(ReportPresenter).toService(ReportWidgetPresenter);

    // Mermaid renderer for rendering diagrams in reports
    bind(MermaidRenderer).toSelf().inSingletonScope();

    // AI render tool (picked up by the cookbot agent via ToolInvocationRegistry)
    bindToolProvider(RenderTemplateTool, bind);
    bindToolProvider(ListReportTemplatesTool, bind);

    // Workspace tools for cookbot (issue #82): recipe search, pantry, shopping list
    bind(RecipeMetadataSource).toSelf().inSingletonScope();
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

    // Shopping-list aggregation (plugin API + Cookbot)
    bind(RecipeReferenceResolver).toSelf().inSingletonScope();
    bind(ShoppingListGenerator).toSelf().inSingletonScope();
    bind(RecipeNavigator).toSelf().inSingletonScope();

    // Public label-less `cooklang.api.*` commands for plugins.
    bind(CooklangPluginApiContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CooklangPluginApiContribution);
    bind(FrontendApplicationContribution).toService(CooklangPluginApiContribution);

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
