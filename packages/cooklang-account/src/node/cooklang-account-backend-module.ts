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
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthServiceBackend, AuthServiceImpl } from './auth-service';
import { SubscriptionService, SubscriptionServicePath } from '../common/subscription-protocol';
import { SubscriptionServiceImpl } from './subscription-service';
import { SyncService, SyncServicePath } from '../common/sync-protocol';
import { SyncServiceImpl } from './sync-service';

export default new ContainerModule(bind => {
    bind(AuthServiceImpl).toSelf().inSingletonScope();
    bind(AuthService).toService(AuthServiceImpl);
    bind(AuthServiceBackend).toService(AuthServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(AuthServicePath, () =>
            ctx.container.get(AuthService)
        )
    ).inSingletonScope();

    bind(SubscriptionServiceImpl).toSelf().inSingletonScope();
    bind(SubscriptionService).toService(SubscriptionServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(SubscriptionServicePath, () =>
            ctx.container.get(SubscriptionService)
        )
    ).inSingletonScope();

    bind(SyncServiceImpl).toSelf().inSingletonScope();
    bind(SyncService).toService(SyncServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(SyncServicePath, () =>
            ctx.container.get(SyncService)
        )
    ).inSingletonScope();
});
