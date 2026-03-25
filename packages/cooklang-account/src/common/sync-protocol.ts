// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { Event } from '@theia/core/lib/common';

export const SyncServicePath = '/services/cookmd-sync';
export const SyncService = Symbol('SyncService');

export interface SyncStatus {
    status: 'idle' | 'syncing' | 'error' | 'stopped';
    lastSyncedAt: string | undefined;
    error: string | undefined;
}

export interface SyncService {
    enableSync(): Promise<void>;
    disableSync(): Promise<void>;
    isSyncEnabled(): Promise<boolean>;
    getSyncStatus(): Promise<SyncStatus>;
    readonly onDidChangeSyncStatus: Event<SyncStatus>;
}
