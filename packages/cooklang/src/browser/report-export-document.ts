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

/**
 * Print/export stylesheet for rendered reports. Mirrors the on-screen
 * typography in `style/report.css` but uses concrete dark-on-white colours
 * (Theia `var(--theia-*)` variables do not resolve inside the bare offscreen
 * BrowserWindow used for export) and adds `@page` margins for paper/PDF.
 */
export const REPORT_EXPORT_CSS = `
@page { margin: 18mm 16mm; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body {
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
}
.theia-cooklang-report-content {
    --report-rule: rgba(0, 0, 0, 0.16);
    --report-rule-strong: rgba(0, 0, 0, 0.32);
    --report-faint: rgba(0, 0, 0, 0.05);
    --report-muted: #6a6a6a;
    max-width: 62rem;
    margin: 0 auto;
    padding: 24px;
    font-size: 13px;
    line-height: 1.65;
    font-variant-numeric: tabular-nums lining-nums;
    font-feature-settings: 'tnum' 1, 'lnum' 1;
}
.theia-cooklang-report-content > :first-child { margin-top: 0; }
.theia-cooklang-report-content h1 {
    font-size: 1.95em; line-height: 1.12; font-weight: 700;
    letter-spacing: -0.02em; margin: 0 0 0.15em;
}
.theia-cooklang-report-content h2 {
    font-size: 1.28em; line-height: 1.2; font-weight: 650; letter-spacing: -0.01em;
    margin: 2.6em 0 0.85em; padding-top: 1.15em; border-top: 1px solid var(--report-rule);
}
.theia-cooklang-report-content h3 {
    font-size: 0.96em; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--report-muted); margin: 1.9em 0 0.7em;
}
.theia-cooklang-report-content h1 + p {
    font-size: 1.06em; line-height: 1.5; color: var(--report-muted);
    max-width: 48rem; margin: 0 0 0.4em;
}
.theia-cooklang-report-content h1 + p em { font-style: normal; }
.theia-cooklang-report-content h1 + p strong { color: #1a1a1a; font-weight: 650; }
.theia-cooklang-report-content p, .theia-cooklang-report-content li { max-width: 48rem; }
.theia-cooklang-report-content p { margin: 0.65em 0; }
.theia-cooklang-report-content ul { margin: 0.7em 0; padding-left: 1.3em; }
.theia-cooklang-report-content li { margin: 0.25em 0; }
.theia-cooklang-report-content em { color: var(--report-muted); }
.theia-cooklang-report-content table {
    border-collapse: collapse; width: auto; max-width: 100%;
    margin: 0.5em 0 0.3em; font-variant-numeric: tabular-nums lining-nums;
}
.theia-cooklang-report-content th, .theia-cooklang-report-content td {
    padding: 0.42em 1.4em 0.42em 0; text-align: left; vertical-align: baseline; white-space: nowrap;
}
.theia-cooklang-report-content th:last-child, .theia-cooklang-report-content td:last-child { padding-right: 0.2em; }
.theia-cooklang-report-content thead th {
    font-size: 0.8em; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--report-muted); padding-bottom: 0.55em; border-bottom: 1px solid var(--report-rule-strong);
}
.theia-cooklang-report-content tbody td { border-bottom: 1px solid var(--report-rule); }
.theia-cooklang-report-content tbody tr:last-child td { border-bottom: none; }
.theia-cooklang-report-content code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.88em; padding: 0.08em 0.36em; border-radius: 3px; background: var(--report-faint);
}
.theia-cooklang-report-content hr { border: none; border-top: 1px solid var(--report-rule-strong); margin: 2.6em 0; }
.theia-cooklang-report-text {
    white-space: pre-wrap;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px; padding: 24px; color: #1a1a1a;
}
.theia-cooklang-mermaid {
    margin: 1.4em 0;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
}
.theia-cooklang-mermaid svg { max-width: 100%; height: auto; }
.theia-cooklang-mermaid-error {
    text-align: left;
    color: #b00020;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.85em;
    white-space: pre-wrap;
}
`;

export interface ReportExportDocumentOptions {
    /** The rendered report content HTML (inner HTML of the report node). */
    contentHtml: string;
    /** Human-readable document title (used for the <title> element). */
    title: string;
}

/** Escape a string for safe insertion into HTML text or attribute content. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Build a self-contained HTML document for a rendered report, suitable for
 * loading into an offscreen BrowserWindow for print / PDF / PNG export.
 */
export function buildReportExportDocument(options: ReportExportDocumentOptions): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<style>${REPORT_EXPORT_CSS}</style>
</head>
<body>
${options.contentHtml}
</body>
</html>`;
}
