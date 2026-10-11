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
import { ReportExportServiceImpl } from './report-export-service-impl';

/** The slice of `BrowserWindow` the export service uses. */
class FakeWindow {
    destroyed = false;
    pdfError: Error | undefined = undefined;
    readonly loaded: string[] = [];
    readonly pdfOptions: PrintToPDFOptions[] = [];
    readonly webContents = {
        printToPDF: async (options: PrintToPDFOptions): Promise<Buffer> => {
            this.pdfOptions.push(options);
            if (this.pdfError) {
                throw this.pdfError;
            }
            return Buffer.from('%PDF-1.7');
        },
        print: (_options: unknown, callback: (success: boolean, reason: string) => void): void => callback(true, ''),
        executeJavaScript: async (): Promise<number> => 100,
        capturePage: async (): Promise<{ toPNG: () => Buffer }> => ({ toPNG: () => Buffer.from('png') }),
    };

    async loadFile(file: string): Promise<void> {
        this.loaded.push(fs.readFileSync(file, 'utf8'));
    }

    setContentSize(): void { /* no layout in tests */ }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    destroy(): void {
        this.destroyed = true;
    }
}

class TestExportService extends ReportExportServiceImpl {
    readonly windows: Array<{ options: BrowserWindowConstructorOptions; window: FakeWindow }> = [];
    readonly dialogs: SaveDialogOptions[] = [];
    dialogResult: SaveDialogReturnValue = { canceled: true, filePath: '' };
    pdfError: Error | undefined = undefined;

    protected override createWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        const window = new FakeWindow();
        window.pdfError = this.pdfError;
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
});
