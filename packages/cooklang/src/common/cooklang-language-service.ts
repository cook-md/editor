// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

export const CooklangLanguageServicePath = '/services/cooklang-language';
export const CooklangLanguageService = Symbol('CooklangLanguageService');

export interface CooklangLanguageService {
    initialize(rootUri: string | null): Promise<void>;
    shutdown(): Promise<void>;
}
