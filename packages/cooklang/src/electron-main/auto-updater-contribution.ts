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
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { MaybePromise } from '@theia/core/lib/common/types';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Notification } from '@theia/electron/shared/electron';
import { UpdateServiceImpl } from './update-service-impl';

@injectable()
export class AutoUpdaterContribution implements ElectronMainApplicationContribution {

    @inject(UpdateServiceImpl)
    protected readonly updateService: UpdateServiceImpl;

    onStart(application: ElectronMainApplication): MaybePromise<void> {
        // Delay startup check to avoid slowing down launch and to let the window settle.
        setTimeout(() => this.autoCheckAndDownload(), 10_000);
    }

    protected async autoCheckAndDownload(): Promise<void> {
        try {
            const check = await this.updateService.checkForUpdates();
            if (check.status !== 'available') {
                return;
            }
            const downloaded = await this.updateService.downloadUpdate();
            if (downloaded.status !== 'downloaded') {
                return;
            }
            if (Notification.isSupported()) {
                new Notification({
                    title: 'Cook Editor update ready',
                    body: `Version ${downloaded.version} has been downloaded. Restart the app to install.`
                }).show();
            }
        } catch (error) {
            // Startup checks must never crash the app (e.g., offline, rate-limited, misconfigured provider).
            console.warn('Auto-update check failed:', error);
        }
    }
}
