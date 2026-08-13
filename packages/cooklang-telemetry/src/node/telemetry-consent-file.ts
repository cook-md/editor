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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TELEMETRY_CONSENT_FILE_NAME, parseErrorReportingConsent } from '../common/telemetry-consent';

/**
 * Path of the consent file. Matches the existing convention for
 * `cookbot-auth.json` and `cookcloud-sync.json`.
 */
export function consentFilePath(): string {
    return path.join(os.homedir(), '.theia', TELEMETRY_CONSENT_FILE_NAME);
}

/**
 * Whether error reporting is enabled, read synchronously because Sentry has to
 * be initialized before anything else can throw.
 */
export function readErrorReportingConsent(): boolean {
    let raw: string | undefined;
    try {
        raw = fs.readFileSync(consentFilePath(), 'utf-8');
    } catch {
        raw = undefined;
    }
    return parseErrorReportingConsent(raw);
}

/** Persist the user's choice. Used by the frontend when the preference changes. */
export function writeErrorReportingConsent(enabled: boolean): void {
    const file = consentFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ errorReportingEnabled: enabled }, undefined, 2), 'utf-8');
}
