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
    /**
     * Search the cook.md curated recipe catalog. `criteria` is forwarded as JSON
     * (see CookbotSearchRecipeCatalogTool for the schema); resolves with the
     * server's parsed `{ recipes, hint }` body.
     */
    searchRecipeCatalog(criteria: object): Promise<unknown>;
    /** Fetch one catalog recipe (content + suggested workspace path) by id. */
    getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe>;
    /**
     * The preferences the user already gave cook.md - the kickstart quiz from
     * the website merged over their account profile.
     */
    getUserPreferences(): Promise<CookbotSavedPreferences>;
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

export interface CookbotSavedPreferences {
    hasPreferences: boolean;
    /** Which stores answered: 'kickstart_quiz' and/or 'profile'. */
    sources: string[];
    /**
     * The merged preferences object. Left untyped on purpose: its shape is
     * owned by the server and read by the model as prose, so mirroring it here
     * would only add a second place to keep in step.
     */
    preferences: Record<string, unknown>;
}

export interface CookbotCatalogRecipe {
    id: string;
    title: string;
    mealType: string;
    course: string;
    content: string;
    suggestedPath: string;
}
