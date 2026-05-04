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
