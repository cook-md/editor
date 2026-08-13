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

export const ERROR_REPORTING_PREF = 'cooklang.telemetry.errorReporting.enabled';

export const TelemetryPreferencesSchema: PreferenceSchema = {
    properties: {
        [ERROR_REPORTING_PREF]: {
            type: 'boolean',
            title: nls.localize('theia/cooklang-telemetry/errorReporting/title', 'Send Error Reports'),
            description: nls.localize(
                'theia/cooklang-telemetry/errorReporting/description',
                'Send anonymous crash and error reports to help fix problems. '
                + 'Reports never include recipe content, chat messages, file contents or account details; '
                + 'file paths are stripped of your user name. Takes effect after restarting the application.'
            ),
            default: true
        }
    }
};
