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
import { ChatAgent, DefaultChatAgentId } from '@theia/ai-chat/lib/common';
import { Agent, bindToolProvider } from '@theia/ai-core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CookbotServerToolsPath, CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';
import { CookbotUsagePath, CookbotUsageService } from '../common/cookbot-usage-protocol';
import { CookbotChatAgent } from './cookbot-chat-agent';
import {
    CookbotSearchWebTool, CookbotFetchUrlTool, CookbotConvertUrlTool, CookbotConvertTextTool,
    CookbotGetServerPreferencesTool,
} from './cookbot-server-tools';
import { CookbotSearchRecipeCatalogTool, CookbotAddCatalogRecipeTool } from './catalog-recipe-tools';
import { WorkspaceFunctionScope } from './file-tools/workspace-function-scope';
import { WorkspacePreferencesSchema } from './file-tools/workspace-preferences';
import { GetWorkspaceDirectoryStructure } from './file-tools/get-workspace-directory-structure';
import { OpenRecipeFolder } from './file-tools/open-recipe-folder';
import {
    FileContentFunction,
    GetWorkspaceFileList,
    FindFilesByPattern,
} from './file-tools/workspace-functions';
import {
    SuggestFileContent,
    SuggestFileReplacements,
    ReplaceContentInFileFunctionHelper,
    ReplaceContentInFileFunctionHelperV2,
    FileChangeSetTitleProvider,
    DefaultFileChangeSetTitleProvider,
    ClearFileChanges,
    GetProposedFileState,
} from './file-tools/file-changeset-functions';

export default new ContainerModule(bind => {
    // Chat agent
    bind(CookbotChatAgent).toSelf().inSingletonScope();
    bind(Agent).toService(CookbotChatAgent);
    bind(ChatAgent).toService(CookbotChatAgent);
    bind(DefaultChatAgentId).toConstantValue({ id: 'cookbot' });

    // Server tools — RPC proxy to backend
    bind(CookbotServerToolsService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy(ctx.container, CookbotServerToolsPath)
    ).inSingletonScope();

    // Usage — RPC proxy to backend (consumed by the chat quota banner)
    bind(CookbotUsageService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy(ctx.container, CookbotUsagePath)
    ).inSingletonScope();

    // Workspace function scope (shared helper for all file tools)
    bind(WorkspaceFunctionScope).toSelf().inSingletonScope();

    // Preferences
    bind(PreferenceContribution).toConstantValue({ schema: WorkspacePreferencesSchema });

    // File tools — workspace exploration
    bindToolProvider(GetWorkspaceFileList, bind);
    bindToolProvider(FileContentFunction, bind);
    bindToolProvider(GetWorkspaceDirectoryStructure, bind);
    bindToolProvider(FindFilesByPattern, bind);

    // Recovery when nothing is open: lets the assistant offer the folder picker
    // instead of only reporting that every file tool failed.
    bindToolProvider(OpenRecipeFolder, bind);

    // File tools — changeset infrastructure
    bind(ReplaceContentInFileFunctionHelper).toSelf().inSingletonScope();
    bind(ReplaceContentInFileFunctionHelperV2).toSelf().inSingletonScope();
    bind(FileChangeSetTitleProvider).to(DefaultFileChangeSetTitleProvider).inSingletonScope();

    // File tools — suggest & replace (user reviews before applying)
    bindToolProvider(SuggestFileContent, bind);
    bindToolProvider(SuggestFileReplacements, bind);
    bindToolProvider(ClearFileChanges, bind);
    bindToolProvider(GetProposedFileState, bind);

    // Server-side tool providers (execute via gRPC)
    bindToolProvider(CookbotSearchWebTool, bind);
    bindToolProvider(CookbotFetchUrlTool, bind);
    bindToolProvider(CookbotConvertUrlTool, bind);
    bindToolProvider(CookbotConvertTextTool, bind);

    // Saved cook.md preferences, so onboarding confirms rather than re-asks
    bindToolProvider(CookbotGetServerPreferencesTool, bind);

    // cook.md catalog tools (issue cook-md#293)
    bindToolProvider(CookbotSearchRecipeCatalogTool, bind);
    bindToolProvider(CookbotAddCatalogRecipeTool, bind);
});
