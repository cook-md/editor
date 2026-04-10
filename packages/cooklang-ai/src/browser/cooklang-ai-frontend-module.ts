// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ChatAgent, DefaultChatAgentId } from '@theia/ai-chat/lib/common';
import { Agent, bindToolProvider } from '@theia/ai-core/lib/common';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CookbotServerToolsPath, CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';
import { CookbotChatAgent } from './cookbot-chat-agent';
import {
    CookbotListFilesTool, CookbotReadFileTool, CookbotWriteFileTool, CookbotEditFileTool,
    CookbotSearchWebTool, CookbotFetchUrlTool, CookbotConvertUrlTool, CookbotConvertTextTool,
} from './cookbot-server-tools';

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

    // File tools (execute locally via Theia FileService)
    bindToolProvider(CookbotListFilesTool, bind);
    bindToolProvider(CookbotReadFileTool, bind);
    bindToolProvider(CookbotWriteFileTool, bind);
    bindToolProvider(CookbotEditFileTool, bind);

    // Server-side tool providers (execute via gRPC)
    bindToolProvider(CookbotSearchWebTool, bind);
    bindToolProvider(CookbotFetchUrlTool, bind);
    bindToolProvider(CookbotConvertUrlTool, bind);
    bindToolProvider(CookbotConvertTextTool, bind);
});
