// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
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
