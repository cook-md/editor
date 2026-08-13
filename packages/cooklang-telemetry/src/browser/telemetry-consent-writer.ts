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

import { PreferenceChange, PreferenceService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TelemetryConsentServer } from '../common/telemetry-consent-server';
import { ERROR_REPORTING_PREF } from './telemetry-preferences';

/**
 * Mirrors the preference into the consent file, which is the copy the Electron
 * main and backend processes read at startup - they have no preference service.
 */
@injectable()
export class TelemetryConsentWriter implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(TelemetryConsentServer)
    protected readonly server: TelemetryConsentServer;

    async onStart(): Promise<void> {
        await this.preferences.ready;
        this.writeCurrentValue();
        this.preferences.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === ERROR_REPORTING_PREF) {
                // `PreferenceChange` omits `newValue`; re-reading also resolves
                // the value across scopes rather than trusting a single change.
                this.writeCurrentValue();
            }
        });
    }

    protected writeCurrentValue(): void {
        this.write(this.preferences.get<boolean>(ERROR_REPORTING_PREF, true));
    }

    protected write(enabled: boolean): void {
        this.server.setErrorReportingEnabled(enabled)
            .catch(error => console.warn('[Telemetry] Failed to persist the error reporting preference:', error));
    }
}
