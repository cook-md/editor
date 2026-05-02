// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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

    private readonly onDidChangeSyncStatusEmitter = new Emitter<SyncStatus>();
    readonly onDidChangeSyncStatus: Event<SyncStatus> = this.onDidChangeSyncStatusEmitter.event;

    private callbackRegistered = false;

    @postConstruct()
    protected init(): void {
        // Must be synchronous for InversifyJS 6.x — async @postConstruct makes
        // the binding async, breaking synchronous Container.get() in RpcConnectionHandler.
        this.loadPreferences().then(() => {
            this.registerNativeCallback();
            this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
            if (this.syncEnabled) {
                this.startSyncIfReady();
            }
        });
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
        } catch (err) {
            console.error('Failed to start sync:', err);
        }
    }

    private async stopSync(): Promise<void> {
        try {
            const native = this.getNativeModule();
            native.stopSync();
        } catch {
            // Native module not available
        }
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
