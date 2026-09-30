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

import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { UsageEventName, UsageEventProperties, UsageEventsService } from '../common/usage-events-protocol';
import { USAGE_EVENTS_PREF } from './usage-preferences';

@injectable()
export class UsageEventsFrontend {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(UsageEventsService)
    protected readonly service: UsageEventsService;

    @inject(ApplicationServer)
    protected readonly appServer: ApplicationServer;

    protected appVersionPromise: Promise<string> | undefined;
    protected userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    protected getAppVersion(): Promise<string> {
        return this.appVersionPromise ??= this.appServer.getApplicationInfo()
            .then(info => info?.version || 'unknown')
            .catch(() => 'unknown');
    }

    async track(name: UsageEventName, properties: UsageEventProperties): Promise<void> {
        try {
            await this.preferenceService.ready;
        } catch {
            return;
        }
        if (!this.preferenceService.get<boolean>(USAGE_EVENTS_PREF, true)) {
            return;
        }
        const appVersion = await this.getAppVersion();
        const os = isOSX ? 'mac' : isWindows ? 'windows' : 'linux';
        try {
            await this.service.track(
                { name, properties: { ...properties, surface: 'editor', app_version: appVersion, os }, time: new Date().toISOString() },
                { userAgent: this.userAgent, appVersion },
            );
        } catch {
            // analytics must never break the editor
        }
    }
}
