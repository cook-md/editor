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
