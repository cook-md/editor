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

export const telemetryConsentPath = '/services/cooklang-telemetry-consent';

/**
 * Persists the user's error-reporting choice. Declared as an interface plus a
 * symbol rather than a class because it is a remote service: the renderer has
 * no filesystem access, so the write happens in the backend process.
 */
export const TelemetryConsentServer = Symbol('TelemetryConsentServer');
export interface TelemetryConsentServer {
    setErrorReportingEnabled(enabled: boolean): Promise<void>;
}
