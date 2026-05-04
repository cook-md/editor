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

export const COOKLANG_LANGUAGE_ID = 'cooklang';
export const COOKLANG_TEXTMATE_SCOPE = 'source.cooklang';
export const AISLE_CONF_LANGUAGE_ID = 'aisle-conf';
export const AISLE_CONF_TEXTMATE_SCOPE = 'source.aisle-conf';
export { CooklangLanguageService, CooklangLanguageServicePath } from './cooklang-language-service';
export * from './recipe-types';
export { CooklangPreferences, bindCooklangPreferences } from './cooklang-preferences';
export * from './shopping-list-types';
export * from './menu-types';
