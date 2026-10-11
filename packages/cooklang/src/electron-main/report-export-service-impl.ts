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
import {
    app,
    dialog,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    PrintToPDFOptions,
    SaveDialogOptions,
    SaveDialogReturnValue,
} from '@theia/electron/shared/electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fillPageRefs, hasPageRefs, pdfDestinationPages } from '../common/pdf-page-refs';
import { ReportExportPdfOptions, ReportExportResult, ReportExportService } from '../common/report-export-protocol';

@injectable()
export class ReportExportServiceImpl implements ReportExportService {

    /** Fixed logical content width (px) for offscreen rendering / PNG capture. */
    protected static readonly CONTENT_WIDTH = 820;

    /** In-memory session partition (no `persist:` prefix) for the hidden export windows. */
    protected static readonly PARTITION = 'report-export';

    /** Guard against a print callback that never fires, so cleanup always runs. */
    protected static readonly PRINT_TIMEOUT_MS = 60_000;

    async print(html: string): Promise<void> {
        await this.withWindow(html, { javascript: false }, win => new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Print timed out')),
                ReportExportServiceImpl.PRINT_TIMEOUT_MS
            );
            win.webContents.print({ printBackground: true }, (success, failureReason) => {
                clearTimeout(timer);
                // A user cancel reports "Print job canceled" (Chromium uses the American
                // single-l spelling); treat only known cancel wording as a quiet success.
                // A falsy reason is an unknown failure and is surfaced, not swallowed.
                const cancelled = typeof failureReason === 'string' && /cancel/i.test(failureReason);
                if (!success && !cancelled) {
                    reject(new Error(failureReason || 'Print failed'));
                } else {
                    resolve();
                }
            });
        }));
    }

    async exportPdf(html: string, defaultFileName: string, options: ReportExportPdfOptions = {}): Promise<ReportExportResult> {
        try {
            const printOptions: PrintToPDFOptions = { printBackground: true };
            if (options.pageSize) {
                printOptions.pageSize = options.pageSize;
            }
            if (options.pageNumbers) {
                Object.assign(printOptions, ReportExportServiceImpl.PAGE_NUMBER_FOOTER);
            }
            const data = await this.renderPdf(html, printOptions, options.pageNumbers === true);
            return await this.saveBuffer(data, defaultFileName, 'pdf', 'PDF Document');
        } catch (error) {
            return { saved: false, error: this.message(error) };
        }
    }

    /** Page number centred in the bottom margin (Chromium fills `.pageNumber`; no JavaScript involved). */
    protected static readonly PAGE_NUMBER_FOOTER: Partial<PrintToPDFOptions> = {
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;text-align:center;font-size:8pt;color:#6b6b66;'
            + 'font-family:-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif"><span class="pageNumber"></span></div>',
    };

    /**
     * Passes for filling page references: the first finds where each `id` landed, the
     * second prints the numbers. Filling them in can move content (an index entry gets
     * longer), so print again while the pages still change, up to this many times.
     */
    protected static readonly MAX_PAGE_REF_PASSES = 3;

    /**
     * Print `html`; with `fillRefs`, fill its `data-page-ref` placeholders from the
     * PDF's named destinations and print again until the numbers are stable.
     */
    protected async renderPdf(html: string, printOptions: PrintToPDFOptions, fillRefs: boolean): Promise<Uint8Array> {
        const print = (document: string): Promise<Uint8Array> =>
            this.withWindow(document, { javascript: false }, win => win.webContents.printToPDF(printOptions));
        let data = await print(html);
        if (!fillRefs || !hasPageRefs(html)) {
            return data;
        }
        let pages = pdfDestinationPages(data);
        for (let pass = 1; pass < ReportExportServiceImpl.MAX_PAGE_REF_PASSES && pages.size > 0; pass++) {
            data = await print(fillPageRefs(html, pages));
            const next = pdfDestinationPages(data);
            if (samePages(pages, next)) {
                break;
            }
            pages = next;
        }
        return data;
    }

    async exportPng(html: string, defaultFileName: string): Promise<ReportExportResult> {
        try {
            return await this.withWindow(html, { javascript: true }, async win => {
                const height = await win.webContents.executeJavaScript(
                    'Math.ceil(document.body.scrollHeight)'
                );
                win.setContentSize(ReportExportServiceImpl.CONTENT_WIDTH, Math.max(1, Number(height) || 1));
                // Wait for the resize reflow to actually paint before capturing: two
                // animation frames in the page absorb the unbounded layout time better
                // than a fixed timeout. capturePage() then waits for the next frame.
                await win.webContents.executeJavaScript(
                    'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'
                );
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
     *
     * `javascript` is off for print and PDF: report HTML is sanitised before it
     * is shown (DOMPurify strips scripts), Mermaid diagrams are exported as
     * pre-rendered SVG, and plugin HTML (`cooklang.api.exportPdf`) is static by
     * contract. PNG export keeps it on, because it measures the page and waits
     * for paint with `executeJavaScript`.
     */
    protected async withWindow<T>(
        html: string,
        options: { javascript: boolean },
        fn: (win: BrowserWindow) => Promise<T>
    ): Promise<T> {
        // A private folder per export: `mkdtemp` picks an unused name, the file
        // is owner-only and must not exist yet (`wx`), so nothing else on the
        // machine can read or swap the HTML the window loads.
        const tmpDir = await fs.promises.mkdtemp(path.join(this.tempRoot(), 'cooklang-report-'));
        let win: BrowserWindow | undefined;
        try {
            const tmpFile = path.join(tmpDir, 'report.html');
            await fs.promises.writeFile(tmpFile, html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            win = this.createWindow({
                show: false,
                paintWhenInitiallyHidden: true,
                width: ReportExportServiceImpl.CONTENT_WIDTH,
                height: 1024,
                // The window loads report HTML from a local file: keep the renderer
                // locked down (sandbox, isolation and no Node are the current Electron
                // defaults, stated explicitly for a security-sensitive operation).
                webPreferences: {
                    backgroundThrottling: false,
                    contextIsolation: true,
                    sandbox: true,
                    nodeIntegration: false,
                    javascript: options.javascript,
                    // Its own in-memory session: no cookies, cache or storage
                    // shared with the editor, and nothing kept on disk.
                    partition: ReportExportServiceImpl.PARTITION
                }
            });
            // The page is a static document: it may not navigate away (a link
            // or a meta refresh) or open windows of its own.
            win.webContents.on('will-navigate', event => event.preventDefault());
            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            await win.loadFile(tmpFile);
            return await fn(win);
        } finally {
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
            await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
        }
    }

    /** Where per-export temp folders are created; a seam for tests. */
    protected tempRoot(): string {
        return app?.getPath?.('temp') ?? os.tmpdir();
    }

    /** Seam for tests: the hidden export window. */
    protected createWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        return new BrowserWindow(options);
    }

    /** Seam for tests: the native save dialog. */
    protected showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
        return dialog.showSaveDialog(options);
    }

    protected async saveBuffer(
        data: Buffer | Uint8Array,
        defaultFileName: string,
        extension: string,
        filterName: string
    ): Promise<ReportExportResult> {
        const result = await this.showSaveDialog({
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

function samePages(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
    return a.size === b.size && [...a].every(([id, page]) => b.get(id) === page);
}
