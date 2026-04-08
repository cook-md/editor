// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CooklangBrandingContribution } from './cooklang-branding-contribution';
import { CooklangChatViewWidget } from './cooklang-chat-view-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(CooklangBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CooklangBrandingContribution);

    bind(CooklangChatViewWidget).toSelf();
    rebind(ChatViewWidget).toService(CooklangChatViewWidget);
});
