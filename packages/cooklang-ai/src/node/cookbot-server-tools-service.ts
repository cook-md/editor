// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
