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
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { CooklangElectronMainApplication } from './cooklang-electron-main-application';
import { CooklangBrandingElectronMainContribution } from './cooklang-branding-electron-main-contribution';

// Cook Editor installs plugins from the self-hosted marketplace. The backend
// process inherits this env var (read by @theia/vsx-registry's VSXEnvironment);
// an explicitly set VSX_REGISTRY_URL still wins for dev overrides.
process.env.VSX_REGISTRY_URL ??= 'https://plugins.cook.md';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(CooklangElectronMainApplication).toSelf().inSingletonScope();
    rebind(ElectronMainApplication).toService(CooklangElectronMainApplication);

    bind(CooklangBrandingElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(CooklangBrandingElectronMainContribution);
});
