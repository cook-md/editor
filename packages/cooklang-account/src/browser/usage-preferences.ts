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

import { nls } from '@theia/core';
import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

/** Sits under the same `cooklang.telemetry` prefix as "Send Error Reports", so Settings shows them together. */
export const USAGE_EVENTS_PREF = 'cooklang.telemetry.usageStatistics.enabled';

export const UsagePreferencesSchema: PreferenceSchema = {
    properties: {
        [USAGE_EVENTS_PREF]: {
            type: 'boolean',
            title: nls.localize('theia/cooklang-account/usageStatistics/title', 'Send Usage Statistics'),
            description: nls.localize('theia/cooklang-account/usageStatistics/description',
                'Send a few usage events (welcome checklist steps, CookBot sign-in and trial prompts) to cook.md '
                + 'so we can see where new users get stuck. When you\'re signed in they are linked to your cook.md account. Never includes recipe content, file or folder names, '
                + 'or what you type to CookBot.'),
            default: true,
        },
    },
};
