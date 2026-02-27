// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ChatAgent } from '@theia/ai-chat/lib/common';
import { Agent, bindToolProvider } from '@theia/ai-core/lib/common';
import { CookbotChatAgent } from './cookbot-chat-agent';
import { CookbotListFilesTool, CookbotReadFileTool, CookbotWriteFileTool } from './cookbot-tool-provider';

export default new ContainerModule(bind => {
    // Chat agent
    bind(CookbotChatAgent).toSelf().inSingletonScope();
    bind(Agent).toService(CookbotChatAgent);
    bind(ChatAgent).toService(CookbotChatAgent);

    // File tools
    bindToolProvider(CookbotListFilesTool, bind);
    bindToolProvider(CookbotReadFileTool, bind);
    bindToolProvider(CookbotWriteFileTool, bind);
});
