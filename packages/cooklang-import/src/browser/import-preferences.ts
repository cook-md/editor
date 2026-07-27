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

import { interfaces } from '@theia/core/shared/inversify';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

export const IMPORT_BROWSER_START_PAGE_PREF = 'cooklang.import.browserStartPage';
export const IMPORT_BROWSER_START_PAGE_DEFAULT = 'https://duckduckgo.com';

export const cooklangImportPreferencesSchema: PreferenceSchema = {
    'properties': {
        [IMPORT_BROWSER_START_PAGE_PREF]: {
            'type': 'string',
            'description': 'Web page opened by default in the recipe import browser tab.',
            'default': IMPORT_BROWSER_START_PAGE_DEFAULT
        }
    }
};

export function bindCooklangImportPreferences(bind: interfaces.Bind): void {
    bind(PreferenceContribution).toConstantValue({ schema: cooklangImportPreferencesSchema });
}
