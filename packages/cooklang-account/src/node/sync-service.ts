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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { AuthState } from '../common/auth-protocol';
import { AuthServiceBackend } from './auth-service';
import { SyncService, SyncStatus } from '../common/sync-protocol';

const SYNC_PREFS_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.json');
const SYNC_DB_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.db');

@injectable()
export class SyncServiceImpl implements SyncService {

    @inject(AuthServiceBackend)
    protected readonly authService: AuthServiceBackend;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private syncEnabled = false;
    private lastStatus: SyncStatus = { status: 'stopped', lastSyncedAt: undefined, error: undefined };
    private nativeModule: typeof import('@theia/cooklang-native') | undefined;

    /**
     * The token the currently-running native sync task was started with, or
     * `undefined` when sync isn't running. Lets us detect a stale token
     * locally (equality check) without asking the native side.
     */
    private syncStartedWithToken: string | undefined;
    private restartingSync = false;

    private readonly onDidChangeSyncStatusEmitter = new Emitter<SyncStatus>();
    readonly onDidChangeSyncStatus: Event<SyncStatus> = this.onDidChangeSyncStatusEmitter.event;

    private callbackRegistered = false;

    @postConstruct()
    protected init(): void {
        // Must be synchronous for InversifyJS 6.x — async @postConstruct makes
        // the binding async, breaking synchronous Container.get() in RpcConnectionHandler.
        this.loadPreferences().then(() => {
            this.registerNativeCallback();
            this.registerAuthListeners();
            if (this.syncEnabled) {
                this.startSyncIfReady();
            }
        });
    }

    private registerAuthListeners(): void {
        this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
        this.authService.onDidRenewToken(token => this.handleTokenRenewed(token));
    }

    async enableSync(): Promise<void> {
        this.syncEnabled = true;
        this.lastStatus = { status: 'idle', lastSyncedAt: undefined, error: undefined };
        this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
        await this.savePreferences();
        await this.startSyncIfReady();
    }

    async disableSync(): Promise<void> {
        this.syncEnabled = false;
        await this.savePreferences();
        await this.stopSync();
    }

    async isSyncEnabled(): Promise<boolean> {
        return this.syncEnabled;
    }

    async getSyncStatus(): Promise<SyncStatus> {
        if (!this.syncEnabled) {
            return { status: 'stopped', lastSyncedAt: undefined, error: undefined };
        }
        return this.lastStatus;
    }

    private registerNativeCallback(): void {
        if (this.callbackRegistered) {
            return;
        }
        try {
            const native = this.getNativeModule();
            native.onSyncStatusChanged((statusJson: string) => {
                if (!this.syncEnabled) {
                    return;
                }
                try {
                    const parsed = JSON.parse(statusJson);
                    this.lastStatus = {
                        status: parsed.status,
                        lastSyncedAt: parsed.lastSynced ?? undefined,
                        error: parsed.lastError ?? undefined,
                    };
                    this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
                } catch {
                    // Ignore malformed status JSON
                }
            });
            this.callbackRegistered = true;
        } catch {
            // Native module not available
        }
    }

    private async startSyncIfReady(): Promise<void> {
        if (!this.syncEnabled) {
            return;
        }
        const token = await this.authService.getToken();
        if (!token) {
            return;
        }

        const namespaceId = this.extractUserId(token);
        if (namespaceId === undefined) {
            return;
        }

        const recipesDir = await this.getWorkspaceRoot();
        if (!recipesDir) {
            console.warn('No workspace root found, cannot start sync');
            return;
        }

        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        const syncEndpoint = `${webBaseUrl}/api`;

        try {
            const native = this.getNativeModule();
            native.startSync(
                recipesDir,
                SYNC_DB_PATH,
                syncEndpoint,
                token,
                namespaceId
            );
            this.syncStartedWithToken = token;
        } catch (err) {
            console.error('Failed to start sync:', err);
            return;
        }

        // A renewal can fire while this start was still in flight (most notably
        // the initial start on app boot, which awaits the workspace lookup above)
        // — `handleTokenRenewed` would have found `syncStartedWithToken` still
        // undefined at that moment and treated sync as "not running yet", so it
        // no-ops rather than restarting. Reconcile once against whatever token is
        // current now that the start has landed, so that race doesn't leave the
        // task on a token that's already stale. If another renewal lands during
        // the resulting restart's own start, that start performs this same
        // one-pass reconcile — it converges once no further renewal is racing it.
        const currentToken = await this.authService.getToken();
        if (currentToken && currentToken !== token) {
            await this.restartSyncWithFreshToken();
        }
    }

    private async stopSync(): Promise<void> {
        try {
            const native = this.getNativeModule();
            native.stopSync();
        } catch {
            // Native module not available
        }
        this.syncStartedWithToken = undefined;
        this.lastStatus = { status: 'stopped', lastSyncedAt: undefined, error: undefined };
        this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-out') {
            await this.stopSync();
        } else if (this.syncEnabled) {
            await this.startSyncIfReady();
        }
    }

    /**
     * Reacts to a successful session-token renewal from auth-service. The
     * running native sync task captures its token at start time and keeps
     * using it for the process lifetime, so a long-lived editor session
     * otherwise ends up presenting a stale (eventually claimless, eventually
     * expired) token to the sync server. No-ops when sync isn't running,
     * when the renewed token is unchanged, or (implicitly) when renewal
     * failed — auth-service only fires this event on success.
     */
    private async handleTokenRenewed(token: string): Promise<void> {
        if (!this.syncEnabled || this.syncStartedWithToken === undefined) {
            return;
        }
        if (token === this.syncStartedWithToken) {
            return;
        }
        await this.restartSyncWithFreshToken();
    }

    private async restartSyncWithFreshToken(): Promise<void> {
        if (this.restartingSync) {
            // Guard against overlapping restarts — at most one restart per renewal event.
            return;
        }
        this.restartingSync = true;
        try {
            // Reuse the same stop/start path the sync toggle uses so a normal
            // restart only ever passes through existing statuses ('stopped'
            // then whatever the native side reports next) — never a synthetic
            // 'error'.
            await this.stopSync();
            await this.startSyncIfReady();
            if (this.syncEnabled && this.syncStartedWithToken === undefined) {
                // The restart's start failed outright (native threw) or bailed
                // out early (missing workspace/namespace) — don't leave the
                // widget showing a silent 'stopped' while the toggle is still
                // on and the user has no running sync and no explanation.
                this.lastStatus = { status: 'error', lastSyncedAt: this.lastStatus.lastSyncedAt, error: 'Failed to restart sync after token renewal' };
                this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
            }
        } finally {
            this.restartingSync = false;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getNativeModule(): any {
        if (!this.nativeModule) {
            this.nativeModule = require('@theia/cooklang-native');
        }
        return this.nativeModule;
    }

    private extractUserId(token: string): number | undefined {
        try {
            const payload = token.split('.')[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            const data = JSON.parse(decoded);
            return data.uid;
        } catch {
            return undefined;
        }
    }

    private async loadPreferences(): Promise<void> {
        try {
            const content = await fs.promises.readFile(SYNC_PREFS_PATH, 'utf8');
            const prefs = JSON.parse(content);
            this.syncEnabled = prefs.enabled ?? false;
        } catch {
            this.syncEnabled = false;
        }
    }

    private async savePreferences(): Promise<void> {
        try {
            const dir = path.dirname(SYNC_PREFS_PATH);
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(SYNC_PREFS_PATH, JSON.stringify({ enabled: this.syncEnabled }, undefined, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save sync preferences:', err);
        }
    }

    private async getWorkspaceRoot(): Promise<string | undefined> {
        const uri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!uri) {
            return undefined;
        }
        return FileUri.fsPath(uri);
    }
}
