import { Event } from '@theia/core/lib/common';

export const SyncServicePath = '/services/cookmd-sync';
export const SyncService = Symbol('SyncService');

export interface SyncStatus {
    status: 'idle' | 'syncing' | 'error' | 'stopped';
    lastSyncedAt: string | null;
    error: string | null;
}

export interface SyncService {
    enableSync(): Promise<void>;
    disableSync(): Promise<void>;
    isSyncEnabled(): Promise<boolean>;
    getSyncStatus(): Promise<SyncStatus>;
    readonly onDidChangeSyncStatus: Event<SyncStatus>;
}
