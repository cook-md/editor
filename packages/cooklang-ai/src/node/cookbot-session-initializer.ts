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

    /**
     * The recipe directory the current session was created against. Compared
     * on every call so a session made before the user opened a folder does not
     * keep serving an empty one for the rest of the process's life.
     */
    private initializedDir: string | undefined;

    async ensureInitialized(): Promise<void> {
        // The session carries recipes_dir to the server, where it decides both
        // the system prompt and whether the assistant believes it can write
        // files. Opening (or closing) a folder therefore invalidates it - and
        // that happens routinely, because the panel can be used before any
        // folder is open.
        if (this.initPromise) {
            const currentDir = await this.resolveRecipesDir();
            if (currentDir !== this.initializedDir) {
                console.info(
                    `[Cookbot] Recipe folder changed (${this.initializedDir || 'none'} -> ${currentDir || 'none'}), re-initializing the session`
                );
                this.initPromise = undefined;
            }
        }

        if (!this.initPromise) {
            // Drop a failed initialization so the next request can retry it,
            // instead of awaiting the same rejected promise forever. Capture
            // the promise locally and only clear the field if it is still the
            // current one - a `reset()` plus a newer in-flight init may have
            // replaced it by the time this stale promise settles, and
            // clobbering that newer promise would let a third caller start a
            // redundant, concurrent initialization.
            const promise: Promise<void> = this.doInitialize().catch(error => {
                if (this.initPromise === promise) {
                    this.initPromise = undefined;
                }
                throw error;
            });
            this.initPromise = promise;
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

    /**
     * The workspace root as a filesystem path, or `''` when no folder is open.
     *
     * `''` is meaningful, not a fallback: the server reads it as "no folder"
     * and tells the model it cannot write anything.
     */
    private async resolveRecipesDir(): Promise<string> {
        try {
            const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
            return workspaceUri ? FileUri.fsPath(workspaceUri) : '';
        } catch {
            // Workspace may not be set yet.
            return '';
        }
    }

    private async doInitialize(): Promise<void> {
        const recipesDir = await this.resolveRecipesDir();
        let customInstructions = '';
        if (recipesDir) {
            const cookMdPath = path.join(recipesDir, 'COOK.md');
            try {
                customInstructions = await fs.promises.readFile(cookMdPath, 'utf-8');
            } catch {
                // COOK.md not present, that's fine
            }
        }
        // Recorded before the call so a failed init still re-checks the folder
        // rather than comparing against a stale value.
        this.initializedDir = recipesDir;
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }
}
