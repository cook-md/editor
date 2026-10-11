// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
    BrowserWindow,
    BrowserWindowConstructorOptions,
    PrintToPDFOptions,
    SaveDialogOptions,
    SaveDialogReturnValue,
} from '@theia/electron/shared/electron';
import { skiaLikePdf } from '../common/pdf-page-refs.spec';
import { ReportExportServiceImpl } from './report-export-service-impl';

/** The slice of `BrowserWindow` the export service uses. */
class FakeWindow {
    destroyed = false;
    pdfError: Error | undefined = undefined;
    pdfOutput: (html: string) => Buffer = () => Buffer.from('%PDF-1.7');
    readonly loaded: string[] = [];
    readonly loadedFiles: Array<{ file: string; mode: number }> = [];
    readonly pdfOptions: PrintToPDFOptions[] = [];
    readonly webContents = {
        printToPDF: async (options: PrintToPDFOptions): Promise<Buffer> => {
            this.pdfOptions.push(options);
            if (this.pdfError) {
                throw this.pdfError;
            }
            return this.pdfOutput(this.loaded[this.loaded.length - 1] ?? '');
        },
        print: (_options: unknown, callback: (success: boolean, reason: string) => void): void => callback(true, ''),
        executeJavaScript: async (): Promise<number> => 100,
        capturePage: async (): Promise<{ toPNG: () => Buffer }> => ({ toPNG: () => Buffer.from('png') }),
        on: (event: string, listener: (...args: unknown[]) => void): void => {
            (this.listeners[event] ??= []).push(listener);
        },
        setWindowOpenHandler: (handler: (details: unknown) => unknown): void => {
            this.openHandlers.push(handler);
        },
    };
    readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    readonly openHandlers: Array<(details: unknown) => unknown> = [];
    lockedAtLoad = false;

    async loadFile(file: string): Promise<void> {
        this.loaded.push(fs.readFileSync(file, 'utf8'));
        this.loadedFiles.push({ file, mode: fs.statSync(file).mode & 0o777 });
        this.lockedAtLoad = (this.listeners['will-navigate']?.length ?? 0) > 0 && this.openHandlers.length > 0;
    }

    setContentSize(): void { /* no layout in tests */ }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    destroy(): void {
        this.destroyed = true;
    }
}

/** Each service's temp root, removed after the suite. */
const tempRoots: string[] = [];

function createTempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cooklang-export-spec-'));
    tempRoots.push(dir);
    return dir;
}

class TestExportService extends ReportExportServiceImpl {
    readonly windows: Array<{ options: BrowserWindowConstructorOptions; window: FakeWindow }> = [];
    readonly dialogs: SaveDialogOptions[] = [];
    dialogResult: SaveDialogReturnValue = { canceled: true, filePath: '' };
    pdfError: Error | undefined = undefined;
    pdfOutput: ((html: string) => Buffer) | undefined = undefined;
    readonly tempDir = createTempRoot();

    protected override tempRoot(): string {
        return this.tempDir;
    }

    protected override createWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        const window = new FakeWindow();
        window.pdfError = this.pdfError;
        if (this.pdfOutput) {
            window.pdfOutput = this.pdfOutput;
        }
        this.windows.push({ options, window });
        return window as unknown as BrowserWindow;
    }

    protected override async showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
        this.dialogs.push(options);
        return this.dialogResult;
    }
}

const HTML = '<!doctype html><p>Soup</p>';

describe('ReportExportServiceImpl', () => {

    after(() => {
        for (const dir of tempRoots.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('renders PDFs in a sandboxed window with JavaScript disabled, then destroys it', async () => {
        const service = new TestExportService();
        await service.exportPdf(HTML, 'Book');
        expect(service.windows).to.have.length(1);
        const { options, window } = service.windows[0];
        expect(options.show).to.equal(false);
        expect(options.webPreferences).to.include({ javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
        expect(window.loaded).to.deep.equal([HTML]);
        expect(window.destroyed).to.equal(true);
    });

    it('prints with JavaScript disabled', async () => {
        const service = new TestExportService();
        await service.print(HTML);
        expect(service.windows[0].options.webPreferences).to.include({ javascript: false });
    });

    it('keeps JavaScript for PNG export, which measures the page with executeJavaScript', async () => {
        const service = new TestExportService();
        await service.exportPng(HTML, 'Book');
        expect(service.windows[0].options.webPreferences).to.include({ javascript: true, sandbox: true });
    });

    it("uses Chromium's default page size unless one is given", async () => {
        const service = new TestExportService();
        await service.exportPdf(HTML, 'Book');
        await service.exportPdf(HTML, 'Book', { pageSize: 'A4' });
        await service.exportPdf(HTML, 'Book', { pageSize: 'Letter' });
        expect(service.windows.map(entry => entry.window.pdfOptions[0])).to.deep.equal([
            { printBackground: true },
            { printBackground: true, pageSize: 'A4' },
            { printBackground: true, pageSize: 'Letter' },
        ]);
    });

    describe('page numbers', () => {
        const REFS = '<a href="#r-1">Soup <span data-page-ref="r-1"></span></a><a href="#index">Index <span data-page-ref="index"></span></a>';

        it('adds a page-number footer only when asked', async () => {
            const service = new TestExportService();
            await service.exportPdf(HTML, 'Book');
            await service.exportPdf(HTML, 'Book', { pageNumbers: true });
            expect(service.windows[0].window.pdfOptions[0]).to.not.have.property('displayHeaderFooter');
            const numbered = service.windows[1].window.pdfOptions[0];
            expect(numbered).to.include({ printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>' });
            expect(numbered.footerTemplate).to.contain('<span class="pageNumber"></span>');
        });

        it('renders once when the document has no page references', async () => {
            const service = new TestExportService();
            service.pdfOutput = () => skiaLikePdf({ 'r-1': 2 });
            await service.exportPdf(HTML, 'Book', { pageNumbers: true });
            expect(service.windows).to.have.length(1);
        });

        it('fills page references from the first pass and prints again with them', async () => {
            const service = new TestExportService();
            service.pdfOutput = () => skiaLikePdf({ 'r-1': 3, index: 5 });
            const target = path.join(os.tmpdir(), `cooklang-export-spec-refs-${Date.now()}.pdf`);
            service.dialogResult = { canceled: false, filePath: target };
            try {
                await service.exportPdf(REFS, 'Book', { pageNumbers: true });
                expect(service.windows.map(entry => entry.window.loaded[0])).to.deep.equal([
                    REFS,
                    '<a href="#r-1">Soup <span data-page-ref="r-1">3</span></a><a href="#index">Index <span data-page-ref="index">5</span></a>',
                ]);
                expect(service.windows.every(entry => entry.window.destroyed)).to.equal(true);
                // The saved file is the last pass.
                expect(fs.readFileSync(target)).to.deep.equal(skiaLikePdf({ 'r-1': 3, index: 5 }));
            } finally {
                fs.rmSync(target, { force: true });
            }
        });

        it('prints again while filling the numbers moves pages, at most three times', async () => {
            const service = new TestExportService();
            let pass = 0;
            service.pdfOutput = () => skiaLikePdf({ 'r-1': 3, index: 4 + pass++ });
            await service.exportPdf(REFS, 'Book', { pageNumbers: true });
            expect(service.windows).to.have.length(3);
            expect(service.windows[2].window.loaded[0]).to.contain('<span data-page-ref="index">5</span>');
        });

        it('stops after one pass when the PDF has no destinations', async () => {
            const service = new TestExportService();
            await service.exportPdf(REFS, 'Book', { pageNumbers: true });
            expect(service.windows).to.have.length(1);
        });
    });

    it('reports a cancelled save dialog as not saved and suggests <name>.pdf', async () => {
        const service = new TestExportService();
        expect(await service.exportPdf(HTML, 'Family Book')).to.deep.equal({ saved: false });
        expect(service.dialogs[0].defaultPath).to.equal('Family Book.pdf');
        expect(service.dialogs[0].filters).to.deep.equal([{ name: 'PDF Document', extensions: ['pdf'] }]);
    });

    it('writes the PDF where the user chose', async () => {
        const service = new TestExportService();
        const target = path.join(os.tmpdir(), `cooklang-export-spec-${Date.now()}.pdf`);
        service.dialogResult = { canceled: false, filePath: target };
        try {
            expect(await service.exportPdf(HTML, 'Book')).to.deep.equal({ saved: true, filePath: target });
            expect(fs.readFileSync(target, 'utf8')).to.equal('%PDF-1.7');
        } finally {
            fs.rmSync(target, { force: true });
        }
    });

    it('turns a rendering failure into an error result and still destroys the window', async () => {
        const service = new TestExportService();
        service.pdfError = new Error('GPU process crashed');
        expect(await service.exportPdf(HTML, 'Book')).to.deep.equal({ saved: false, error: 'GPU process crashed' });
        expect(service.windows[0].window.destroyed).to.equal(true);
        expect(service.dialogs).to.deep.equal([]);
    });
    describe('temp files', () => {
        it('loads the HTML from an owner-only file in its own folder, and removes both after an export', async () => {
            const service = new TestExportService();
            await service.exportPdf(HTML, 'Book');
            const [{ file, mode }] = service.windows[0].window.loadedFiles;
            expect(path.dirname(path.dirname(file))).to.equal(service.tempDir);
            if (process.platform !== 'win32') {
                expect(mode).to.equal(0o600);
            }
            expect(fs.existsSync(file)).to.equal(false);
            expect(fs.readdirSync(service.tempDir)).to.deep.equal([]);
        });

        it('removes the temp file and folder when printToPDF throws', async () => {
            const service = new TestExportService();
            service.pdfError = new Error('GPU process crashed');
            expect(await service.exportPdf(HTML, 'Book')).to.deep.equal({ saved: false, error: 'GPU process crashed' });
            expect(service.windows[0].window.loadedFiles).to.have.length(1);
            expect(fs.readdirSync(service.tempDir)).to.deep.equal([]);
        });

        it('gives concurrent exports separate folders', async () => {
            const service = new TestExportService();
            await Promise.all([service.exportPdf(HTML, 'A'), service.exportPdf(HTML, 'B')]);
            const dirs = service.windows.map(entry => path.dirname(entry.window.loadedFiles[0].file));
            expect(new Set(dirs).size).to.equal(2);
            expect(fs.readdirSync(service.tempDir)).to.deep.equal([]);
        });
    });
    describe('window lock-down', () => {
        for (const [name, run] of [
            ['PDF', (service: TestExportService) => service.exportPdf(HTML, 'Book')],
            ['print', (service: TestExportService) => service.print(HTML)],
            ['PNG', (service: TestExportService) => service.exportPng(HTML, 'Book')],
        ] as const) {
            it(`${name}: uses its own in-memory session, and blocks navigation and new windows before loading`, async () => {
                const service = new TestExportService();
                await run(service);
                const { options, window } = service.windows[0];
                expect(options.webPreferences?.partition).to.equal('report-export');
                expect(window.lockedAtLoad).to.equal(true);
                expect(window.listeners['will-navigate']).to.have.length(1);
                let prevented = false;
                window.listeners['will-navigate'][0]({ preventDefault: () => { prevented = true; } }, 'https://evil.example/');
                expect(prevented).to.equal(true);
                expect(window.openHandlers).to.have.length(1);
                expect(window.openHandlers[0]({ url: 'https://evil.example/' })).to.deep.equal({ action: 'deny' });
            });
        }
    });
});
