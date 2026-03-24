import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { AutoUpdaterContribution } from './auto-updater-contribution';

export default new ContainerModule(bind => {
    bind(AutoUpdaterContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(AutoUpdaterContribution);
});
