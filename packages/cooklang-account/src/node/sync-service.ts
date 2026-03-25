import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { AuthService, AuthState } from '../common/auth-protocol';
import { SyncService, SyncStatus } from '../common/sync-protocol';

const STATUS_POLL_INTERVAL_MS = 5000; // 5 seconds
const SYNC_PREFS_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.json');
const SYNC_DB_PATH = path.join(os.homedir(), '.theia', 'cookcloud-sync.db');

@injectable()
export class SyncServiceImpl implements SyncService {

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private syncEnabled = false;
    private statusPollTimer: ReturnType<typeof setInterval> | undefined;
    private lastStatus: SyncStatus = { status: 'stopped', lastSyncedAt: null, error: null };

    private readonly onDidChangeSyncStatusEmitter = new Emitter<SyncStatus>();
    readonly onDidChangeSyncStatus: Event<SyncStatus> = this.onDidChangeSyncStatusEmitter.event;

    @postConstruct()
    protected init(): void {
        this.loadPreferences();
        this.authService.onDidChangeAuth(state => this.handleAuthChange(state));
    }

    async enableSync(): Promise<void> {
        this.syncEnabled = true;
        this.savePreferences();
        await this.startSyncIfReady();
    }

    async disableSync(): Promise<void> {
        this.syncEnabled = false;
        this.savePreferences();
        await this.stopSync();
    }

    async isSyncEnabled(): Promise<boolean> {
        return this.syncEnabled;
    }

    async getSyncStatus(): Promise<SyncStatus> {
        if (!this.syncEnabled) {
            return { status: 'stopped', lastSyncedAt: null, error: null };
        }
        try {
            const native = require('@theia/cooklang-native');
            const rawJson = native.getSyncStatus();
            const nativeStatus = JSON.parse(rawJson);
            return {
                status: nativeStatus.status,
                lastSyncedAt: nativeStatus.lastSynced ?? null,
                error: nativeStatus.lastError ?? null,
            };
        } catch {
            return this.lastStatus;
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
            const native = require('@theia/cooklang-native');
            native.startSync(
                recipesDir,
                SYNC_DB_PATH,
                syncEndpoint,
                token,
                namespaceId
            );
            this.startStatusPolling();
        } catch (err) {
            console.error('Failed to start sync:', err);
        }
    }

    private async stopSync(): Promise<void> {
        this.stopStatusPolling();
        try {
            const native = require('@theia/cooklang-native');
            native.stopSync();
        } catch {
            // Native module not available
        }
        this.lastStatus = { status: 'stopped', lastSyncedAt: null, error: null };
        this.onDidChangeSyncStatusEmitter.fire(this.lastStatus);
    }

    private startStatusPolling(): void {
        this.stopStatusPolling();
        this.statusPollTimer = setInterval(async () => {
            const status = await this.getSyncStatus();
            if (status.status !== this.lastStatus.status || status.error !== this.lastStatus.error) {
                this.lastStatus = status;
                this.onDidChangeSyncStatusEmitter.fire(status);
            }
        }, STATUS_POLL_INTERVAL_MS);
    }

    private stopStatusPolling(): void {
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = undefined;
        }
    }

    private async handleAuthChange(state: AuthState): Promise<void> {
        if (state.status === 'logged-out') {
            await this.stopSync();
        } else if (this.syncEnabled) {
            await this.startSyncIfReady();
        }
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

    private loadPreferences(): void {
        try {
            const content = fs.readFileSync(SYNC_PREFS_PATH, 'utf8');
            const prefs = JSON.parse(content);
            this.syncEnabled = prefs.enabled ?? false;
        } catch {
            this.syncEnabled = false;
        }
    }

    private savePreferences(): void {
        try {
            const dir = path.dirname(SYNC_PREFS_PATH);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SYNC_PREFS_PATH, JSON.stringify({ enabled: this.syncEnabled }, undefined, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save sync preferences:', err);
        }
    }

    private async getWorkspaceRoot(): Promise<string | undefined> {
        const uri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!uri) {
            return undefined;
        }
        try {
            return new URL(uri).pathname;
        } catch {
            return uri;
        }
    }
}
