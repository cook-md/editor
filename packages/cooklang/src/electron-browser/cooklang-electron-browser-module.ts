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
