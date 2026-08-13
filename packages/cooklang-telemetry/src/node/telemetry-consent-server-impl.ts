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

import { injectable } from '@theia/core/shared/inversify';
import { TelemetryConsentServer } from '../common/telemetry-consent-server';
import { writeErrorReportingConsent } from './telemetry-consent-file';

@injectable()
export class TelemetryConsentServerImpl implements TelemetryConsentServer {
    async setErrorReportingEnabled(enabled: boolean): Promise<void> {
        writeErrorReportingConsent(enabled);
    }
}
