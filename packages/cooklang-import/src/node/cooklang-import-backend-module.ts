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
import { RecipeImportService, RecipeImportServicePath } from '../common/recipe-import-protocol';
import { CookifyApiClient } from './cookify-api-client';

export default new ContainerModule(bind => {
    bind(CookifyApiClient).toSelf().inSingletonScope();
    bind(RecipeImportService).toService(CookifyApiClient);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(RecipeImportServicePath, () =>
            ctx.container.get(RecipeImportService)
        )
    ).inSingletonScope();
});
