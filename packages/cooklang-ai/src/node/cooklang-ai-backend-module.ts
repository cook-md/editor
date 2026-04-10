// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { LanguageModelProvider } from '@theia/ai-core/lib/common';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';
import { CookbotServerToolsPath } from '../common/cookbot-server-tools-protocol';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotLanguageModel } from './cookbot-language-model';
import { CookbotLanguageModelProvider } from './cookbot-language-model-provider';
import { CookbotServerToolsServiceImpl } from './cookbot-server-tools-service';

/**
 * Connection-scoped bindings for the Cookbot language model.
 * The LanguageModelProvider contribution must live inside a ConnectionContainerModule
 * so it is available in the per-connection child container where ai-core collects providers.
 */
const cookbotConnectionModule = ConnectionContainerModule.create(({ bind }) => {
    bind(CookbotGrpcClient).toSelf().inSingletonScope();
    bind(CookbotLanguageModel).toSelf().inSingletonScope();
    bind(CookbotLanguageModelProvider).toSelf().inSingletonScope();

    // Server tools service — exposed to browser via RPC
    bind(CookbotServerToolsServiceImpl).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(
            CookbotServerToolsPath,
            () => ctx.container.get(CookbotServerToolsServiceImpl)
        )
    ).inSingletonScope();

    bind(LanguageModelProvider).toDynamicValue(ctx => {
        const provider = ctx.container.get(CookbotLanguageModelProvider);
        return () => provider.getModels();
    }).inSingletonScope();

    bind(AuthService).toDynamicValue(ctx =>
        ctx.container.parent!.get(AuthService)
    ).inSingletonScope();
});

export default new ContainerModule(bind => {
    bind(ConnectionContainerModule).toConstantValue(cookbotConnectionModule);
});
