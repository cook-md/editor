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

export const RecipeImportServicePath = '/services/cooklang-import';
export const RecipeImportService = Symbol('RecipeImportService');

export type ImportErrorCode = 'unauthorized' | 'rate-limited' | 'conversion-failed' | 'network';

// Conversion failures are returned as a result union rather than thrown: Theia's RPC proxy
// does not preserve custom fields on thrown Errors, so a typed `error` code in the return
// value is the reliable way to get the failure kind across the wire.

export interface ConvertSuccess {
    cooklang: string;
    name?: string;
    error?: undefined;
}

export interface ConvertFailure {
    error: ImportErrorCode;
    cooklang?: undefined;
    name?: undefined;
}

export type ConvertResult = ConvertSuccess | ConvertFailure;

/**
 * Converts recipes to Cooklang via the cook.md cookify REST API.
 * Remote service: interface + symbol (used from both frontend and backend).
 */
export interface RecipeImportService {
    convertUrl(url: string): Promise<ConvertResult>;
    convertText(text: string): Promise<ConvertResult>;
    /** Base64-encoded JPEGs, max 5. Requires a signed-in user. */
    convertImages(imagesBase64: string[]): Promise<ConvertResult>;
}
