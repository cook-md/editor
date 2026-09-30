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

import { UsageEvent } from './usage-events-protocol';

export function buildVisitBody(visitToken: string, visitorToken: string, appVersion: string): Record<string, string> {
    return { visit_token: visitToken, visitor_token: visitorToken, platform: 'Editor', app_version: appVersion };
}

export function buildEventsBody(visitToken: string, visitorToken: string, events: UsageEvent[]): Record<string, unknown> {
    return {
        visit_token: visitToken,
        visitor_token: visitorToken,
        events: events.map(e => ({ name: e.name, properties: e.properties, time: e.time })),
    };
}
