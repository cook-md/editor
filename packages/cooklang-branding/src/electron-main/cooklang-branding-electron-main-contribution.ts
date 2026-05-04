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

import { inject, injectable } from '@theia/core/shared/inversify';
import { app } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronMainApplicationGlobals } from '@theia/core/lib/electron-main/electron-main-constants';
import { isOSX } from '@theia/core/lib/common';
import * as path from 'path';
import * as fs from 'fs';

@injectable()
export class CooklangBrandingElectronMainContribution implements ElectronMainApplicationContribution {

    @inject(ElectronMainApplicationGlobals)
    protected readonly globals: ElectronMainApplicationGlobals;

    onStart(application: ElectronMainApplication): void {
        const config = application.config;

        if (config.applicationName) {
            app.setName(config.applicationName);
        }

        const iconPath = config.electron?.windowOptions?.icon;
        if (iconPath && typeof iconPath === 'string' && isOSX && app.dock) {
            const icnsPath = path.resolve(this.globals.THEIA_APP_PROJECT_PATH, path.dirname(iconPath), 'icon.icns');
            const resolvedIcon = path.resolve(this.globals.THEIA_APP_PROJECT_PATH, iconPath);
            try {
                app.dock.setIcon(fs.existsSync(icnsPath) ? icnsPath : resolvedIcon);
            } catch (err) {
                console.warn('Failed to set dock icon:', err);
            }
        }
    }
}
