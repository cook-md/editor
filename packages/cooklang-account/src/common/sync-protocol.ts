// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

export const SyncServicePath = '/services/cooked-sync';
export const SyncService = Symbol('SyncService');

export interface SyncStatus {
    status: 'idle' | 'syncing' | 'indexing' | 'downloading' | 'uploading' | 'error' | 'stopped';
    lastSyncedAt: string | undefined;
    error: string | undefined;
}

/**
 * RPC-safe interface — no Event properties (see auth-protocol.ts for why).
 */
export interface SyncService {
    enableSync(): Promise<void>;
    disableSync(): Promise<void>;
    isSyncEnabled(): Promise<boolean>;
    getSyncStatus(): Promise<SyncStatus>;
}
