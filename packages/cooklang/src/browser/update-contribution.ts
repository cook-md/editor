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
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { UpdateCheckResult, UpdateService } from '../common/update-protocol';

export const CheckForUpdatesCommand: Command = {
    id: 'cook.checkForUpdates',
    category: 'Cook Editor',
    label: 'Check for Updates…',
};

@injectable()
export class UpdateContribution implements CommandContribution, MenuContribution {

    @inject(UpdateService)
    protected readonly updateService: UpdateService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CheckForUpdatesCommand, {
            execute: () => this.runManualCheck(),
        });
    }

    registerMenus(registry: MenuModelRegistry): void {
        registry.registerMenuAction(CommonMenus.HELP, {
            commandId: CheckForUpdatesCommand.id,
            label: CheckForUpdatesCommand.label,
            order: 'a',
        });
    }

    protected async runManualCheck(): Promise<void> {
        const progress = await this.messageService.showProgress({
            text: nls.localize('theia/cooklang/checkingForUpdates', 'Checking for updates…'),
        });
        let check: UpdateCheckResult;
        try {
            check = await this.updateService.checkForUpdates();
        } finally {
            progress.cancel();
        }

        if (check.status === 'error') {
            this.messageService.warn(
                nls.localize('theia/cooklang/updateCheckFailed', 'Update check failed: {0}', check.error ?? 'Unknown error')
            );
            return;
        }

        if (check.status === 'not-available') {
            const current = check.currentVersion ? ` (version ${check.currentVersion})` : '';
            this.messageService.info(
                nls.localize('theia/cooklang/updateNotAvailable', 'Cook Editor is up to date{0}.', current)
            );
            return;
        }

        if (check.status !== 'available' || !check.version) {
            return;
        }

        const downloadAction = nls.localizeByDefault('Download');
        const laterAction = nls.localizeByDefault('Later');
        const choice = await this.messageService.info(
            nls.localize('theia/cooklang/updateAvailable', 'Cook Editor {0} is available.', check.version),
            downloadAction,
            laterAction,
        );
        if (choice !== downloadAction) {
            return;
        }

        const downloadProgress = await this.messageService.showProgress({
            text: nls.localize('theia/cooklang/downloadingUpdate', 'Downloading Cook Editor {0}…', check.version),
        });
        let downloaded: UpdateCheckResult;
        try {
            downloaded = await this.updateService.downloadUpdate();
        } finally {
            downloadProgress.cancel();
        }

        if (downloaded.status === 'error') {
            this.messageService.warn(
                nls.localize('theia/cooklang/updateDownloadFailed', 'Update download failed: {0}', downloaded.error ?? 'Unknown error')
            );
            return;
        }

        if (downloaded.status !== 'downloaded') {
            return;
        }

        const restartAction = nls.localize('theia/cooklang/updateRestartNow', 'Restart Now');
        const restartLaterAction = nls.localizeByDefault('Later');
        const restartChoice = await this.messageService.info(
            nls.localize('theia/cooklang/updateReady', 'Cook Editor {0} has been downloaded. Restart to install.', downloaded.version ?? ''),
            restartAction,
            restartLaterAction,
        );
        if (restartChoice === restartAction) {
            await this.updateService.quitAndInstall();
        }
    }
}
