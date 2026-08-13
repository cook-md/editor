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

export const telemetryDiagnosticsPath = '/services/cooklang-telemetry-diagnostics';

/**
 * Lets a maintainer confirm that error reporting actually reaches Sentry from a
 * packaged build.
 *
 * Without this there is no way to trigger a reportable failure in the backend
 * from outside the app: the obvious lever - pointing at an unreachable server -
 * produces UNAVAILABLE, which is classified as an expected outcome and
 * deliberately not reported.
 */
export const TelemetryDiagnostics = Symbol('TelemetryDiagnostics');
export interface TelemetryDiagnostics {
    /**
     * Report a deliberate error from the backend process, through the same path
     * real caught failures use.
     */
    triggerTestError(): Promise<void>;
}
