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

export const CookbotServerToolsPath = '/services/cookbot-server-tools';
export const CookbotServerToolsService = Symbol('CookbotServerToolsService');

export interface CookbotServerToolsService {
    searchWeb(query: string, maxResults?: number): Promise<CookbotSearchResult[]>;
    fetchUrl(url: string): Promise<CookbotFetchResult>;
    convertUrlToCooklang(url: string): Promise<CookbotConvertResult>;
    convertTextToCooklang(name: string, text: string): Promise<CookbotConvertResult>;
}

export interface CookbotSearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface CookbotFetchResult {
    content: string;
    title: string;
}

export interface CookbotConvertResult {
    cooklangContent: string;
    recipeName: string;
}
