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
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AutoUpdaterContribution } from './auto-updater-contribution';
import { UpdateService, UpdateServicePath } from '../common/update-protocol';
import { UpdateServiceImpl } from './update-service-impl';
import { ReportExportService, ReportExportServicePath } from '../common/report-export-protocol';
import { ReportExportServiceImpl } from './report-export-service-impl';

export default new ContainerModule(bind => {
    bind(UpdateServiceImpl).toSelf().inSingletonScope();
    bind(UpdateService).toService(UpdateServiceImpl);

    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(UpdateServicePath, () => ctx.container.get<UpdateService>(UpdateService))
    ).inSingletonScope();

    bind(ReportExportServiceImpl).toSelf().inSingletonScope();
    bind(ReportExportService).toService(ReportExportServiceImpl);

    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(ReportExportServicePath, () => ctx.container.get<ReportExportService>(ReportExportService))
    ).inSingletonScope();

    bind(AutoUpdaterContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AutoUpdaterContribution);
});
