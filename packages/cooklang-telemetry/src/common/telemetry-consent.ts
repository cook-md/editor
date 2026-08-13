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

/** Name of the consent file inside the Theia config directory. */
export const TELEMETRY_CONSENT_FILE_NAME = 'cook-telemetry.json';

/** Shape persisted to the consent file. */
export interface TelemetryConsent {
    errorReportingEnabled: boolean;
}

/**
 * Whether error reporting is enabled, given the raw contents of the consent
 * file. Reporting is opt-out, so an absent, empty or unparseable file means
 * enabled - the user has not chosen to turn it off.
 *
 * Only a literal `false`, or the string `'false'`, disables it. A malformed
 * value is treated as a disable rather than coerced, because silently
 * re-enabling reporting is the worse way to be wrong.
 */
export function parseErrorReportingConsent(raw: string | undefined): boolean {
    if (!raw) {
        return true;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return true;
    }
    if (!parsed || typeof parsed !== 'object' || !('errorReportingEnabled' in parsed)) {
        return true;
    }
    const value = (parsed as { errorReportingEnabled: unknown }).errorReportingEnabled;
    if (typeof value === 'boolean') {
        return value;
    }
    return String(value) !== 'false';
}
