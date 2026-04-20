// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { UpdateService, UpdateServicePath } from '../common/update-protocol';
import { UpdateContribution } from '../browser/update-contribution';

export default new ContainerModule(bind => {
    bind(UpdateService).toDynamicValue(ctx =>
        ElectronIpcConnectionProvider.createProxy<UpdateService>(ctx.container, UpdateServicePath)
    ).inSingletonScope();

    bind(UpdateContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(UpdateContribution);
    bind(MenuContribution).toService(UpdateContribution);
});
