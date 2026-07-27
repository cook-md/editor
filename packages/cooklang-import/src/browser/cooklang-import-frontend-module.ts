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
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { RecipeImportService, RecipeImportServicePath } from '../common/recipe-import-protocol';
import { DraftSaver } from './draft-saver';
import { ImportWidget, IMPORT_WIDGET_ID } from './import-widget';
import { ImportContribution } from './import-contribution';

export default new ContainerModule(bind => {
    bind(RecipeImportService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<RecipeImportService>(ctx.container, RecipeImportServicePath)
    ).inSingletonScope();

    bind(DraftSaver).toSelf().inSingletonScope();

    // Deliberately NOT inSingletonScope: the widget is closable and gets disposed on
    // close. WidgetManager caches live instances itself; a singleton binding would
    // hand back the same disposed instance on reopen, which never renders again.
    bind(ImportWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: IMPORT_WIDGET_ID,
        createWidget: () => ctx.container.get(ImportWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ImportContribution);
    bind(TabBarToolbarContribution).toService(ImportContribution);
});
