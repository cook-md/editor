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
import { CookbotSessionInitializer } from './cookbot-session-initializer';
import { CookbotError } from '../common/cookbot-error';
import { CookbotUsageService, CookbotUsageStats } from '../common/cookbot-usage-protocol';

/**
 * Backend service reporting Cookbot AI usage to the browser via RPC.
 *
 * Every failure collapses to `undefined` rather than throwing: the quota
 * warning is advisory UI, and it must never become a source of user-visible
 * errors. Failures here are expected states (not logged in, offline, session
 * expired) and are deliberately not reported to error tracking, consistent
 * with CookbotError.isExpected on the chat path.
 */
@injectable()
export class CookbotUsageServiceImpl implements CookbotUsageService {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    @inject(CookbotSessionInitializer)
    protected readonly sessionInitializer: CookbotSessionInitializer;

    async getUsage(): Promise<CookbotUsageStats | undefined> {
        try {
            await this.sessionInitializer.ensureInitialized();
            return await this.queryWithSessionRetry();
        } catch (error) {
            console.info('[CookbotUsage] Usage unavailable:', error instanceof Error ? error.message : error);
            return undefined;
        }
    }

    /**
     * The server invalidates idle sessions; a usage query may be the first
     * call after a long idle, so retry once on a fresh session — the same
     * recovery the language model performs for chat requests.
     */
    private async queryWithSessionRetry(): Promise<CookbotUsageStats> {
        try {
            return await this.grpcClient.getUsage();
        } catch (error) {
            if (!CookbotError.isSessionExpired(error)) {
                throw error;
            }
            this.sessionInitializer.reset();
            await this.sessionInitializer.ensureInitialized();
            return this.grpcClient.getUsage();
        }
    }
}
