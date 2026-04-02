// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
