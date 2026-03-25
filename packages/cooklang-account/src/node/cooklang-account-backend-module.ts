import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthServiceImpl } from './auth-service';

export default new ContainerModule(bind => {
    bind(AuthServiceImpl).toSelf().inSingletonScope();
    bind(AuthService).toService(AuthServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(AuthServicePath, () =>
            ctx.container.get(AuthService)
        )
    ).inSingletonScope();
});
