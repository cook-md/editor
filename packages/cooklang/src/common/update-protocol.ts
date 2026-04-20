// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
