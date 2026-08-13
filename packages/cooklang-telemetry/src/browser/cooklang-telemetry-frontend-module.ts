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

import * as Sentry from '@sentry/electron/renderer';
import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { TelemetryConsentServer, telemetryConsentPath } from '../common/telemetry-consent-server';
import { TelemetryConsentWriter } from './telemetry-consent-writer';
import { TelemetryPreferencesSchema } from './telemetry-preferences';

// No DSN and no consent check here on purpose: the renderer forwards events
// over IPC to the Electron main process, which holds the DSN and has already
// applied the consent decision. If main did not initialize, these events are
// dropped there.
Sentry.init({});

export default new ContainerModule(bind => {
    bind(PreferenceContribution).toConstantValue({ schema: TelemetryPreferencesSchema });
    bind(TelemetryConsentServer).toDynamicValue(context =>
        context.container.get(WebSocketConnectionProvider).createProxy<TelemetryConsentServer>(telemetryConsentPath)
    ).inSingletonScope();
    bind(TelemetryConsentWriter).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TelemetryConsentWriter);
});
