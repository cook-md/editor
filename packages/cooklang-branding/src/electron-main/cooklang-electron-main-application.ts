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
import { app, BrowserWindowConstructorOptions, Event as ElectronEvent, session, WebContents } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import * as path from 'path';

/**
 * Session partition of the recipe-import clipping browser `<webview>`.
 * Must match the `partition` attribute in
 * `packages/cooklang-import/src/browser/import-browser-tab.tsx`.
 *
 * The name carries no `persist:` prefix, so the session is in-memory:
 * site logins made inside the clipping browser do not survive an app
 * restart. This is a deliberate privacy default.
 */
const IMPORT_BROWSER_PARTITION = 'import-browser';

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

    /**
     * Core's handler preventDefaults every `will-navigate` for all web contents,
     * which would also freeze the clipping browser `<webview>`: no link inside a
     * clipped page could be followed. Give that webview its own navigation policy
     * (plain web browsing only) and keep core's hardening for everything else.
     */
    protected override onWebContentsCreated(event: ElectronEvent, webContents: WebContents): void {
        if (this.isImportBrowserWebview(webContents)) {
            // (a) Allow ordinary http/https browsing inside the clipping webview, nothing else
            // (no file:, no custom schemes that could reach into the app or the OS).
            webContents.on('will-navigate', evt => {
                if (!this.isWebUrl(evt.url)) {
                    evt.preventDefault();
                }
            });
            // (b) Never let clipped pages spawn windows or reach the OS handler:
            // open http/https popups/new-tab links in the webview itself, drop the rest.
            webContents.setWindowOpenHandler(details => {
                if (this.isWebUrl(details.url)) {
                    webContents.loadURL(details.url)
                        .catch(error => console.warn('Import browser failed to open popup URL in place:', error));
                }
                return { action: 'deny' };
            });
            return;
        }
        super.onWebContentsCreated(event, webContents);
        // Verify webview options before creation, per the Electron security checklist
        // (https://www.electronjs.org/docs/latest/tutorial/security#12-verify-webview-options-before-creation):
        // strip preload scripts and node capabilities, and reject any <webview> that
        // is not the recipe-import clipping browser.
        webContents.on('will-attach-webview', (evt, webPreferences, params) => {
            delete webPreferences.preload;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (webPreferences as any).preloadURL;
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            if (params.partition !== IMPORT_BROWSER_PARTITION) {
                evt.preventDefault();
            }
        });
    }

    protected isImportBrowserWebview(webContents: WebContents): boolean {
        return webContents.getType() === 'webview'
            && webContents.session === session.fromPartition(IMPORT_BROWSER_PARTITION);
    }

    protected isWebUrl(url: string): boolean {
        return /^https?:/i.test(url);
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
