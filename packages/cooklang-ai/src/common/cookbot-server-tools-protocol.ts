// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
