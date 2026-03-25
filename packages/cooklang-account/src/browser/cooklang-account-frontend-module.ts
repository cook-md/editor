import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthContribution } from './auth-contribution';
import { SubscriptionService, SubscriptionServicePath } from '../common/subscription-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from './subscription-frontend-service';

export default new ContainerModule(bind => {
    // Auth service RPC proxy
    bind(AuthService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<AuthService>(ctx.container, AuthServicePath)
    ).inSingletonScope();

    // Auth contribution (commands + status bar)
    bind(AuthContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AuthContribution);
    bind(CommandContribution).toService(AuthContribution);

    // Subscription service RPC proxy
    bind(SubscriptionService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<SubscriptionService>(ctx.container, SubscriptionServicePath)
    ).inSingletonScope();

    // Subscription frontend service (caches state for synchronous access)
    bind(SubscriptionFrontendServiceImpl).toSelf().inSingletonScope();
    bind(SubscriptionFrontendService).toService(SubscriptionFrontendServiceImpl);
});
