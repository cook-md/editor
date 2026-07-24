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

import * as http from 'http';
import * as https from 'https';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';
import { ConvertResult, ImportErrorCode, RecipeImportService } from '../common/recipe-import-protocol';

export interface HttpResponse {
    status: number;
    body: string;
}

/**
 * REST client for the cook.md cookify API. Mirrors the contract used by the
 * iOS app: POST /api/cookify/{url,text,images}; Bearer token optional for
 * url/text, required for images; 401/422/429 map to typed error codes.
 */
@injectable()
export class CookifyApiClient implements RecipeImportService {

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    protected get baseUrl(): string {
        return process.env.WEB_BASE_URL || 'https://cook.md';
    }

    convertUrl(url: string): Promise<ConvertResult> {
        return this.post('/api/cookify/url', { url }, false);
    }

    convertText(text: string): Promise<ConvertResult> {
        return this.post('/api/cookify/text', { text }, false);
    }

    convertImages(imagesBase64: string[]): Promise<ConvertResult> {
        return this.post('/api/cookify/images', { images: imagesBase64 }, true);
    }

    protected async post(path: string, payload: object, requireAuth: boolean): Promise<ConvertResult> {
        const token = await this.authService.getToken();
        if (requireAuth && !token) {
            return { error: 'unauthorized' };
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Client-Version': `editor/${await this.clientVersion()}`,
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        let response: HttpResponse;
        try {
            response = await this.httpPost(new URL(path, this.baseUrl), JSON.stringify(payload), headers);
        } catch (err) {
            console.warn('cookify request failed:', err instanceof Error ? err.message : String(err));
            return { error: 'network' };
        }
        if (response.status >= 200 && response.status < 300) {
            try {
                const data = JSON.parse(response.body);
                if (typeof data.cooklang !== 'string') {
                    return { error: 'conversion-failed' };
                }
                return { cooklang: data.cooklang, name: typeof data.name === 'string' ? data.name : undefined };
            } catch {
                return { error: 'conversion-failed' };
            }
        }
        return { error: this.errorForStatus(response.status) };
    }

    protected errorForStatus(status: number): ImportErrorCode {
        switch (status) {
            case 401: return 'unauthorized';
            case 422: return 'conversion-failed';
            case 429: return 'rate-limited';
            default: return 'network';
        }
    }

    protected async clientVersion(): Promise<string> {
        try {
            const info = await this.applicationServer.getApplicationInfo();
            return info?.version ?? 'dev';
        } catch {
            return 'dev';
        }
    }

    protected httpPost(url: URL, body: string, headers: Record<string, string>): Promise<HttpResponse> {
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, { method: 'POST', headers }, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }
}
