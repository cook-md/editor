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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import {
    CookbotServerToolsService,
    CookbotSearchResult,
    CookbotFetchResult,
    CookbotConvertResult,
} from '../common/cookbot-server-tools-protocol';

/**
 * Backend service that forwards server tool calls to the cookbot gRPC server.
 * Exposed to the browser via RPC.
 */
@injectable()
export class CookbotServerToolsServiceImpl implements CookbotServerToolsService {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    async searchWeb(query: string, maxResults?: number): Promise<CookbotSearchResult[]> {
        return this.grpcClient.searchWeb(query, maxResults);
    }

    async fetchUrl(url: string): Promise<CookbotFetchResult> {
        return this.grpcClient.fetchUrl(url);
    }

    async convertUrlToCooklang(url: string): Promise<CookbotConvertResult> {
        return this.grpcClient.convertUrlToCooklang(url);
    }

    async convertTextToCooklang(name: string, text: string): Promise<CookbotConvertResult> {
        return this.grpcClient.convertTextToCooklang(name, text);
    }
}
