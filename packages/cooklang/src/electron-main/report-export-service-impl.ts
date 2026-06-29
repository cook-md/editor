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

import { injectable } from '@theia/core/shared/inversify';
// eslint-disable-next-line import/no-extraneous-dependencies
import { app, dialog, BrowserWindow } from '@theia/electron/shared/electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportExportResult, ReportExportService } from '../common/report-export-protocol';

@injectable()
export class ReportExportServiceImpl implements ReportExportService {

    /** Fixed logical content width (px) for offscreen rendering / PNG capture. */
    protected static readonly CONTENT_WIDTH = 820;

    async print(html: string): Promise<void> {
        await this.withWindow(html, win => new Promise<void>((resolve, reject) => {
            win.webContents.print({ printBackground: true }, (success, failureReason) => {
                // `success` is false when the user cancels the dialog — treat as quiet success.
                if (!success && failureReason && failureReason !== 'cancelled') {
                    reject(new Error(failureReason));
                } else {
                    resolve();
                }
            });
        }));
    }

    async exportPdf(html: string, defaultFileName: string): Promise<ReportExportResult> {
        try {
            return await this.withWindow(html, async win => {
                const data = await win.webContents.printToPDF({ printBackground: true });
                return this.saveBuffer(data, defaultFileName, 'pdf', 'PDF Document');
            });
        } catch (error) {
            return { saved: false, error: this.message(error) };
        }
    }

    async exportPng(html: string, defaultFileName: string): Promise<ReportExportResult> {
        try {
            return await this.withWindow(html, async win => {
                const height = await win.webContents.executeJavaScript(
                    'Math.ceil(document.body.scrollHeight)'
                );
                win.setContentSize(ReportExportServiceImpl.CONTENT_WIDTH, Math.max(1, Number(height) || 1));
                // Give the compositor a moment to paint the resized page.
                await new Promise(resolve => setTimeout(resolve, 150));
                const image = await win.webContents.capturePage();
                return this.saveBuffer(image.toPNG(), defaultFileName, 'png', 'PNG Image');
            });
        } catch (error) {
            return { saved: false, error: this.message(error) };
        }
    }

    /**
     * Render `html` in a hidden, offscreen-painting BrowserWindow, run `fn`,
     * and always destroy the window and remove the temp file afterwards.
     */
    protected async withWindow<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
        const tmpFile = path.join(
            app?.getPath?.('temp') ?? os.tmpdir(),
            `cooklang-report-${Date.now()}-${Math.floor(Math.random() * 1e6)}.html`
        );
        fs.writeFileSync(tmpFile, html, 'utf8');
        const win = new BrowserWindow({
            show: false,
            paintWhenInitiallyHidden: true,
            width: ReportExportServiceImpl.CONTENT_WIDTH,
            height: 1024,
            webPreferences: { backgroundThrottling: false }
        });
        try {
            await win.loadFile(tmpFile);
            return await fn(win);
        } finally {
            if (!win.isDestroyed()) {
                win.destroy();
            }
            fs.promises.unlink(tmpFile).catch(() => { /* best effort */ });
        }
    }

    protected async saveBuffer(
        data: Buffer | Uint8Array,
        defaultFileName: string,
        extension: string,
        filterName: string
    ): Promise<ReportExportResult> {
        const result = await dialog.showSaveDialog({
            defaultPath: `${this.sanitize(defaultFileName)}.${extension}`,
            filters: [{ name: filterName, extensions: [extension] }]
        });
        if (result.canceled || !result.filePath) {
            return { saved: false };
        }
        await fs.promises.writeFile(result.filePath, data);
        return { saved: true, filePath: result.filePath };
    }

    /** Strip characters that are invalid in file names on common platforms. */
    protected sanitize(name: string): string {
        return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'report';
    }

    protected message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
