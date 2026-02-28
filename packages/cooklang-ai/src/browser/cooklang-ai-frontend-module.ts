// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ChatAgent, DefaultChatAgentId } from '@theia/ai-chat/lib/common';
import { Agent, bindToolProvider } from '@theia/ai-core/lib/common';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CookbotAuthService, CookbotAuthServicePath } from '../common/cookbot-auth-protocol';
import { CookbotChatAgent } from './cookbot-chat-agent';
import { CookbotAuthContribution } from './cookbot-auth-contribution';
import { CookbotListFilesTool, CookbotReadFileTool, CookbotWriteFileTool } from './cookbot-tool-provider';

export default new ContainerModule(bind => {
    // Chat agent
    bind(CookbotChatAgent).toSelf().inSingletonScope();
    bind(Agent).toService(CookbotChatAgent);
    bind(ChatAgent).toService(CookbotChatAgent);
    bind(DefaultChatAgentId).toConstantValue({ id: 'cookbot' });

    // File tools
    bindToolProvider(CookbotListFilesTool, bind);
    bindToolProvider(CookbotReadFileTool, bind);
    bindToolProvider(CookbotWriteFileTool, bind);

    // Auth service RPC proxy
    bind(CookbotAuthService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<CookbotAuthService>(ctx.container, CookbotAuthServicePath)
    ).inSingletonScope();

    // Auth contribution (commands + status bar)
    bind(CookbotAuthContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CookbotAuthContribution);
    bind(CommandContribution).toService(CookbotAuthContribution);
});
