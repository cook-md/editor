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

import '../../src/browser/style/index.css';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { AuthService, AuthServicePath } from '../common/auth-protocol';
import { AuthContribution } from './auth-contribution';
import { SubscriptionService, SubscriptionServicePath } from '../common/subscription-protocol';
import { SyncService, SyncServicePath } from '../common/sync-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from './subscription-frontend-service';
import { AccountWidget, ACCOUNT_WIDGET_ID } from './account-widget';
import { AccountContribution } from './account-contribution';

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

    // Sync service RPC proxy
    bind(SyncService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<SyncService>(ctx.container, SyncServicePath)
    ).inSingletonScope();

    // Subscription frontend service (caches state for synchronous access)
    bind(SubscriptionFrontendServiceImpl).toSelf().inSingletonScope();
    bind(SubscriptionFrontendService).toService(SubscriptionFrontendServiceImpl);

    // Account widget
    bind(AccountWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ACCOUNT_WIDGET_ID,
        createWidget: () => ctx.container.get(AccountWidget),
    })).inSingletonScope();

    // Account view contribution
    bindViewContribution(bind, AccountContribution);
    bind(FrontendApplicationContribution).toService(AccountContribution);
});
