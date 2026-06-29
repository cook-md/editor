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

export const ReportExportService = Symbol('ReportExportService');
export interface ReportExportService {
    /** Open the native print dialog for the given standalone HTML document. */
    print(html: string): Promise<void>;
    /** Render the HTML to PDF and prompt for a save location. */
    exportPdf(html: string, defaultFileName: string): Promise<ReportExportResult>;
    /** Capture the HTML to PNG and prompt for a save location. */
    exportPng(html: string, defaultFileName: string): Promise<ReportExportResult>;
}
