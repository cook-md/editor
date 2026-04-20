// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
// eslint-disable-next-line import/no-extraneous-dependencies
import { app } from '@theia/electron/shared/electron';
// eslint-disable-next-line import/no-extraneous-dependencies
import { autoUpdater } from 'electron-updater';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { UpdateCheckResult, UpdateService, UpdateStatus } from '../common/update-protocol';

type TerminalStatus = Extract<UpdateStatus, 'available' | 'not-available' | 'downloaded' | 'error'>;

@injectable()
export class UpdateServiceImpl implements UpdateService {

    protected state: UpdateCheckResult = { status: 'idle' };
    /** Promises awaiting terminal states from the next updater cycle. */
    protected readonly pending = new Map<TerminalStatus, Deferred<UpdateCheckResult>[]>();

    @postConstruct()
    protected init(): void {
        autoUpdater.autoDownload = false;
        autoUpdater.logger = console;
        this.state = { status: 'idle', currentVersion: app.getVersion() };

        autoUpdater.on('checking-for-update', () => {
            this.state = { ...this.state, status: 'checking', error: undefined };
        });
        autoUpdater.on('update-available', info => {
            this.state = { ...this.state, status: 'available', version: info.version, error: undefined };
            this.resolveTerminal('available');
        });
        autoUpdater.on('update-not-available', info => {
            this.state = { ...this.state, status: 'not-available', version: info.version, error: undefined };
            this.resolveTerminal('not-available');
        });
        autoUpdater.on('download-progress', progress => {
            this.state = { ...this.state, status: 'downloading', downloadProgress: progress.percent };
        });
        autoUpdater.on('update-downloaded', info => {
            this.state = { ...this.state, status: 'downloaded', version: info.version, error: undefined };
            this.resolveTerminal('downloaded');
        });
        autoUpdater.on('error', err => {
            this.state = { ...this.state, status: 'error', error: err?.message ?? String(err) };
            this.resolveTerminal('error');
        });
    }

    async checkForUpdates(): Promise<UpdateCheckResult> {
        const available = this.awaitTerminal('available');
        const notAvailable = this.awaitTerminal('not-available');
        const error = this.awaitTerminal('error');
        try {
            await autoUpdater.checkForUpdates();
        } catch (e) {
            // Synchronous throws (e.g. misconfigured provider) are also reported via 'error' event.
            // If not, surface them here.
            if (this.state.status !== 'error') {
                this.state = { ...this.state, status: 'error', error: e instanceof Error ? e.message : String(e) };
                this.resolveTerminal('error');
            }
        }
        return Promise.race([available, notAvailable, error]);
    }

    async downloadUpdate(): Promise<UpdateCheckResult> {
        const downloaded = this.awaitTerminal('downloaded');
        const error = this.awaitTerminal('error');
        try {
            await autoUpdater.downloadUpdate();
        } catch (e) {
            if (this.state.status !== 'error') {
                this.state = { ...this.state, status: 'error', error: e instanceof Error ? e.message : String(e) };
                this.resolveTerminal('error');
            }
        }
        return Promise.race([downloaded, error]);
    }

    async quitAndInstall(): Promise<void> {
        autoUpdater.quitAndInstall();
    }

    protected awaitTerminal(status: TerminalStatus): Promise<UpdateCheckResult> {
        const deferred = new Deferred<UpdateCheckResult>();
        const list = this.pending.get(status) ?? [];
        list.push(deferred);
        this.pending.set(status, list);
        return deferred.promise;
    }

    protected resolveTerminal(status: TerminalStatus): void {
        const list = this.pending.get(status);
        if (!list) {
            return;
        }
        this.pending.delete(status);
        const snapshot = this.state;
        for (const d of list) {
            d.resolve(snapshot);
        }
    }
}
