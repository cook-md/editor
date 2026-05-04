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
