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
 * Which directory entry is the user's COOK.md. An exact `COOK.md` wins; any
 * other casing (`cook.md`, `Cook.md`) is accepted, so the file is found on
 * case-sensitive filesystems too.
 */
export function pickCookMdName(names: string[]): string | undefined {
    if (names.includes('COOK.md')) {
        return 'COOK.md';
    }
    return names.find(name => name.toLowerCase() === 'cook.md');
}

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

    /**
     * The COOK.md text the current session was created with. `undefined`
     * while the first initialization is still reading it, so a concurrent
     * caller does not mistake "not read yet" for "changed".
     */
    private initializedInstructions: string | undefined;

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
            } else if (this.initializedInstructions !== undefined
                && await this.readCookMd(currentDir) !== this.initializedInstructions) {
                // COOK.md is only sent at Initialize, so a file added or edited
                // mid-session (including one the onboarding skill just staged)
                // was ignored until the editor restarted.
                console.info('[Cookbot] COOK.md changed, re-initializing the session');
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
        // Cleared first so a concurrent caller never compares COOK.md against
        // the previous session's text while this one is still reading it.
        this.initializedInstructions = undefined;
        const recipesDir = await this.resolveRecipesDir();
        // Recorded before the call so a failed init still re-checks the folder
        // rather than comparing against a stale value. Set before the COOK.md
        // read so concurrent callers see the folder as unchanged.
        this.initializedDir = recipesDir;
        const customInstructions = await this.readCookMd(recipesDir);
        this.initializedInstructions = customInstructions;
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }

    /** The COOK.md at the folder root, in any casing, or `''` when there is none. */
    private async readCookMd(recipesDir: string): Promise<string> {
        if (!recipesDir) {
            return '';
        }
        try {
            const name = pickCookMdName(await fs.promises.readdir(recipesDir));
            return name ? await fs.promises.readFile(path.join(recipesDir, name), 'utf-8') : '';
        } catch {
            // Folder unreadable or COOK.md vanished between listing and reading.
            return '';
        }
    }
}
