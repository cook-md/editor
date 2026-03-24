import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { MaybePromise } from '@theia/core/lib/common/types';
import { autoUpdater } from 'electron-updater';

@injectable()
export class AutoUpdaterContribution implements ElectronMainApplicationContribution {

    onStart(application: ElectronMainApplication): MaybePromise<void> {
        // Delay update check to avoid slowing down startup
        setTimeout(() => this.checkForUpdates(), 10_000);
    }

    protected async checkForUpdates(): Promise<void> {
        try {
            autoUpdater.autoDownload = false;
            autoUpdater.logger = console;
            await autoUpdater.checkForUpdatesAndNotify();
        } catch (error) {
            // Silently fail — don't crash the app if update check fails
            // (e.g., no internet, GitHub rate limit, dev builds with no publish config)
            console.warn('Auto-update check failed:', error);
        }
    }
}
