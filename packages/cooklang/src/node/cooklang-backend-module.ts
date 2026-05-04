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
