// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

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
