// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { BrowserWindowConstructorOptions } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import * as path from 'path';

@injectable()
export class CooklangElectronMainApplication extends ElectronMainApplication {

    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const options = super.getDefaultOptions();
        return {
            ...options,
            ...this.resolveWindowOptions(this.config.electron?.windowOptions || {}),
        };
    }

    protected resolveWindowOptions(windowOptions: BrowserWindowConstructorOptions): BrowserWindowConstructorOptions {
        const resolved = { ...windowOptions };
        if (resolved.icon && typeof resolved.icon === 'string') {
            resolved.icon = path.resolve(this.globals.THEIA_APP_PROJECT_PATH, resolved.icon);
        }
        return resolved;
    }
}
