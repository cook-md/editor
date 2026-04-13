// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { AutoUpdaterContribution } from './auto-updater-contribution';

export default new ContainerModule(bind => {
    bind(AutoUpdaterContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AutoUpdaterContribution);
});
