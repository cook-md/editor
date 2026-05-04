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

export const UpdateServicePath = '/services/cooklang-update';

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';

export interface UpdateCheckResult {
    status: UpdateStatus;
    /** Version of the available/downloaded update. */
    version?: string;
    /** The currently running application version. */
    currentVersion?: string;
    /** Download progress in percent (0-100). */
    downloadProgress?: number;
    /** Human-readable error message when status is 'error'. */
    error?: string;
}

export const UpdateService = Symbol('UpdateService');
export interface UpdateService {
    /** Trigger a check and resolve once the updater reaches a terminal state. */
    checkForUpdates(): Promise<UpdateCheckResult>;
    /** Download the update that was reported available by the last check. */
    downloadUpdate(): Promise<UpdateCheckResult>;
    /** Quit the app and install the downloaded update. */
    quitAndInstall(): Promise<void>;
}
