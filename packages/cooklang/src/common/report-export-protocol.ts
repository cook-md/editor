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

export const ReportExportServicePath = '/services/cooklang-report-export';

export interface ReportExportResult {
    /** False when the user cancelled the save dialog. */
    saved: boolean;
    /** Absolute path of the written file when saved. */
    filePath?: string;
    /** Human-readable error message when the operation failed. */
    error?: string;
}

/** Paper sizes plugins may ask for; Electron's `printToPDF` default (`Letter`) applies when absent. */
export type ReportPageSize = 'A4' | 'Letter';

export interface ReportExportPdfOptions {
    /**
     * Paper size passed to `printToPDF`. CSS `@page { size }` is ignored by the
     * export (Electron's `preferCSSPageSize` is off), so this is the only way to
     * pick one.
     */
    pageSize?: ReportPageSize;
}

export const ReportExportService = Symbol('ReportExportService');
export interface ReportExportService {
    /** Open the native print dialog for the given standalone HTML document. */
    print(html: string): Promise<void>;
    /** Render the HTML to PDF and prompt for a save location. */
    exportPdf(html: string, defaultFileName: string, options?: ReportExportPdfOptions): Promise<ReportExportResult>;
    /** Capture the HTML to PNG and prompt for a save location. */
    exportPng(html: string, defaultFileName: string): Promise<ReportExportResult>;
}
