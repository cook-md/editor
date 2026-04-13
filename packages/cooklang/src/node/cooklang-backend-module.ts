// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { CooklangLanguageService, CooklangLanguageServicePath } from '../common/cooklang-language-service';
import { CooklangLanguageServiceImpl } from './cooklang-language-service-impl';

export default new ContainerModule(bind => {
    bind(CooklangLanguageServiceImpl).toSelf().inSingletonScope();
    bind(CooklangLanguageService).toService(CooklangLanguageServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(CooklangLanguageServicePath, () =>
            ctx.container.get(CooklangLanguageService)
        )
    ).inSingletonScope();
});
