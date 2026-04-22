// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { CooklangBrandingContribution } from './cooklang-branding-contribution';
import { CooklangChatViewWidget } from './cooklang-chat-view-widget';
import { CookAboutDialog } from './cook-about-dialog';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(CooklangBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CooklangBrandingContribution);

    bind(CooklangChatViewWidget).toSelf();
    rebind(ChatViewWidget).toService(CooklangChatViewWidget);

    rebind(AboutDialog).to(CookAboutDialog).inSingletonScope();
});
