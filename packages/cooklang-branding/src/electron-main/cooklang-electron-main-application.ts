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

import { injectable } from '@theia/core/shared/inversify';
import { app, BrowserWindowConstructorOptions } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import * as path from 'path';

@injectable()
export class CooklangElectronMainApplication extends ElectronMainApplication {

    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const options = super.getDefaultOptions();
        const resolved = {
            ...options,
            ...this.resolveWindowOptions(this.config.electron?.windowOptions || {}),
        };
        return {
            ...resolved,
            webPreferences: {
                ...resolved.webPreferences,
                // Required by the recipe-import clipping browser (<webview> tag). Placed after the
                // config-derived spread so it cannot be disabled via windowOptions.
                webviewTag: true,
            },
        };
    }

    protected resolveWindowOptions(windowOptions: BrowserWindowConstructorOptions): BrowserWindowConstructorOptions {
        const resolved = { ...windowOptions };
        if (resolved.icon && typeof resolved.icon === 'string') {
            resolved.icon = path.resolve(this.globals.THEIA_APP_PROJECT_PATH, resolved.icon);
        }
        return resolved;
    }

    /**
     * Theia core does not register a macOS `open-file` handler, so double-clicking a
     * `.cook` / `.menu` file in Finder (or "Open With → Cook Editor") would otherwise do
     * nothing. Route the file through the same flow Theia uses for CLI/second-instance
     * file arguments, so double-click behaves like launching the app with the file path.
     */
    protected override hookApplicationEvents(): void {
        super.hookApplicationEvents();
        if (process.platform === 'darwin') {
            app.on('open-file', (event, filePath) => {
                event.preventDefault();
                this.handleMainCommand({
                    file: filePath,
                    cwd: path.dirname(filePath),
                    secondInstance: true
                }).catch(error => console.error('Failed to open file from Finder:', error));
            });
        }
    }
}
