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
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import * as fs from 'fs';
import * as path from 'path';
import { CookbotGrpcClient } from './cookbot-grpc-client';

/**
 * Creates the cookbot session on demand and shares it between every consumer
 * of the connection-scoped gRPC client (language model, usage service):
 * whichever caller runs first creates the session, the others reuse it.
 */
@injectable()
export class CookbotSessionInitializer {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private initPromise: Promise<void> | undefined;

    async ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            // Drop a failed initialization so the next request can retry it,
            // instead of awaiting the same rejected promise forever.
            this.initPromise = this.doInitialize().catch(error => {
                this.initPromise = undefined;
                throw error;
            });
        }
        await this.initPromise;
    }

    /**
     * Forget the current session so the next call re-initializes. Used when
     * the server invalidates an idle session (UNAUTHENTICATED).
     */
    reset(): void {
        this.initPromise = undefined;
    }

    private async doInitialize(): Promise<void> {
        let recipesDir = '';
        let customInstructions = '';
        try {
            const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
            if (workspaceUri) {
                recipesDir = FileUri.fsPath(workspaceUri);
                const cookMdPath = path.join(recipesDir, 'COOK.md');
                try {
                    customInstructions = await fs.promises.readFile(cookMdPath, 'utf-8');
                } catch {
                    // COOK.md not present, that's fine
                }
            }
        } catch {
            // Workspace may not be set yet
        }
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }
}
