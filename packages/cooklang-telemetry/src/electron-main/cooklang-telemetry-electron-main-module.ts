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
import * as Sentry from '@sentry/electron/main';
import { app } from '@theia/core/electron-shared/electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DEV_OVERRIDE_ENV_VAR, buildOptions, shouldInitialize } from '../common/telemetry-options';
import { readErrorReportingConsent } from '../node/telemetry-consent-file';

// The forked backend inherits this and uses it as the Sentry release, so it
// must be set whether or not reporting is enabled here.
process.env.THEIA_APP_VERSION ??= app.getVersion();

if (shouldInitialize({
    consented: readErrorReportingConsent(),
    packaged: app.isPackaged,
    devOverride: process.env[DEV_OVERRIDE_ENV_VAR] === '1'
})) {
    const options = buildOptions({
        release: app.getVersion(),
        packaged: app.isPackaged,
        homeDir: os.homedir()
    });
    Sentry.init({
        dsn: options.dsn,
        release: options.release,
        environment: options.environment,
        sendDefaultPii: options.sendDefaultPii,
        // Sentry drops an event when `beforeSend` returns null; internally we use
        // undefined for "no event", so translate at the boundary.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-null/no-null
        beforeSend: event => (options.beforeSend(event as any) ?? null) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeBreadcrumb: breadcrumb => options.beforeBreadcrumb(breadcrumb as any) as any
    });
    Sentry.setTag('processType', 'electron-main');
}

export default new ContainerModule(() => {
    // No bindings: initialization above is the whole contribution.
});
