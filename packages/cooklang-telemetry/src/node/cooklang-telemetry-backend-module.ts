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

import * as os from 'os';
import * as Sentry from '@sentry/node';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { DEV_OVERRIDE_ENV_VAR, buildOptions, shouldInitialize } from '../common/telemetry-options';
import { TelemetryConsentServer, telemetryConsentPath } from '../common/telemetry-consent-server';
import { readErrorReportingConsent } from './telemetry-consent-file';
import { TelemetryConsentServerImpl } from './telemetry-consent-server-impl';

// Initialized at module load, before any container binding runs, so that an
// error thrown during backend startup is still captured. The forked backend is
// a plain Node process - @sentry/electron does not apply here.
// `resourcesPath` and `defaultApp` are injected by Electron and absent from
// @types/node, so this mirrors the cast CookbotGrpcClient already uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const packaged = !!(process as any).resourcesPath && !(process as any).defaultApp;

if (shouldInitialize({
    consented: readErrorReportingConsent(),
    packaged,
    devOverride: process.env[DEV_OVERRIDE_ENV_VAR] === '1'
})) {
    const options = buildOptions({
        release: process.env.THEIA_APP_VERSION ?? 'unknown',
        packaged,
        homeDir: os.homedir()
    });
    Sentry.init({
        dsn: options.dsn,
        release: options.release,
        environment: options.environment,
        sendDefaultPii: options.sendDefaultPii,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeSend: event => options.beforeSend(event as any) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeBreadcrumb: breadcrumb => options.beforeBreadcrumb(breadcrumb as any) as any
    });
    Sentry.setTag('processType', 'backend');
}

export default new ContainerModule(bind => {
    bind(TelemetryConsentServerImpl).toSelf().inSingletonScope();
    bind(TelemetryConsentServer).toService(TelemetryConsentServerImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new RpcConnectionHandler(telemetryConsentPath, () => context.container.get(TelemetryConsentServer))
    ).inSingletonScope();
});
