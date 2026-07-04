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

import * as fs from 'fs';
import * as path from 'path';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { CooklangElectronMainApplication } from './cooklang-electron-main-application';
import { CooklangBrandingElectronMainContribution } from './cooklang-branding-electron-main-contribution';

// Cook Editor installs plugins from the self-hosted marketplace. The backend
// process inherits this env var (read by @theia/vsx-registry's VSXEnvironment);
// an explicitly set VSX_REGISTRY_URL still wins for dev overrides.
process.env.VSX_REGISTRY_URL ??= 'https://plugins.cook.md';

// Load the built-in VS Code plugins we bundle in `plugins/`. Without this the
// packaged backend is forked with no `--plugins` argument, so it only deploys
// marketplace/drop-in plugins and every bundled language plugin (YAML, Jinja,
// Markdown, ...) silently provides no grammar/highlighting in the release.
//
// The plugins live in different places in dev vs the packaged app, so probe
// both (most-specific first) and use whichever exists:
//   - packaged: electron-builder ships them via extraResources to
//     `<resourcesPath>/app/plugins`, OUTSIDE app.asar. THEIA_APP_PROJECT_PATH
//     resolves INSIDE app.asar, so it would miss them.
//   - dev: `<THEIA_APP_PROJECT_PATH>/plugins` (i.e. app/plugins, populated by
//     the `copy:plugins` script). In dev `resourcesPath` points at Electron's
//     own resources dir, which has no app/plugins, so the probe falls through.
// The forked backend inherits THEIA_DEFAULT_PLUGINS.
const bundledPluginsDir = [
    process.resourcesPath && path.join(process.resourcesPath, 'app', 'plugins'),
    process.env.THEIA_APP_PROJECT_PATH && path.resolve(process.env.THEIA_APP_PROJECT_PATH, 'plugins')
].find((dir): dir is string => !!dir && fs.existsSync(dir));
if (bundledPluginsDir) {
    process.env.THEIA_DEFAULT_PLUGINS ??= `local-dir:${bundledPluginsDir}`;
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(CooklangElectronMainApplication).toSelf().inSingletonScope();
    rebind(ElectronMainApplication).toService(CooklangElectronMainApplication);

    bind(CooklangBrandingElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(CooklangBrandingElectronMainContribution);
});
