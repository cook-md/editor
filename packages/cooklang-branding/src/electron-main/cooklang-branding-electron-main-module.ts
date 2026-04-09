// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { CooklangElectronMainApplication } from './cooklang-electron-main-application';
import { CooklangBrandingElectronMainContribution } from './cooklang-branding-electron-main-contribution';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(CooklangElectronMainApplication).toSelf().inSingletonScope();
    rebind(ElectronMainApplication).toService(CooklangElectronMainApplication);

    bind(CooklangBrandingElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(CooklangBrandingElectronMainContribution);
});
