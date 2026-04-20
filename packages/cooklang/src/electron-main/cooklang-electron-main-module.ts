// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AutoUpdaterContribution } from './auto-updater-contribution';
import { UpdateService, UpdateServicePath } from '../common/update-protocol';
import { UpdateServiceImpl } from './update-service-impl';

export default new ContainerModule(bind => {
    bind(UpdateServiceImpl).toSelf().inSingletonScope();
    bind(UpdateService).toService(UpdateServiceImpl);

    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(UpdateServicePath, () => ctx.container.get<UpdateService>(UpdateService))
    ).inSingletonScope();

    bind(AutoUpdaterContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AutoUpdaterContribution);
});
