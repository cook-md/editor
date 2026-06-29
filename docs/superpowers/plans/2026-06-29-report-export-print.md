# Report Export & Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Print, Export-as-PDF, and Export-as-PNG actions to the Cooklang report tab, producing print-friendly (light) output regardless of editor theme.

**Architecture:** The renderer serializes the live report DOM into a self-contained HTML document (content + inlined light stylesheet). A new `electron-main` `ReportExportService` (exposed over Theia RPC, mirroring `UpdateService`) loads that HTML in an offscreen `BrowserWindow` and runs native `print()` / `printToPDF()` / `capturePage()`. Three toolbar buttons on the report tab drive it.

**Tech Stack:** TypeScript, Theia (InversifyJS DI, RPC connection handlers), Electron (`BrowserWindow`, `dialog`, `webContents`), React (ReactWidget).

---

## File Structure

- `packages/cooklang/src/common/report-export-protocol.ts` — **Create.** RPC path, `ReportExportService` symbol+interface, `ReportExportResult`.
- `packages/cooklang/src/browser/report-export-document.ts` — **Create.** Pure, monaco-free builder + `REPORT_EXPORT_CSS`.
- `packages/cooklang/src/browser/report-export-document.spec.ts` — **Create.** Unit tests for the builder.
- `packages/cooklang/src/browser/report-widget.tsx` — **Modify.** Add `getExportDocument()`.
- `packages/cooklang/src/electron-main/report-export-service-impl.ts` — **Create.** Offscreen-window export service.
- `packages/cooklang/src/electron-main/cooklang-electron-main-module.ts` — **Modify.** Bind impl + RPC handler.
- `packages/cooklang/src/electron-browser/cooklang-electron-browser-module.ts` — **Modify.** Bind proxy.
- `packages/cooklang/src/browser/report-export-contribution.ts` — **Create.** Commands + toolbar items.
- `packages/cooklang/src/browser/cooklang-frontend-module.ts` — **Modify.** Bind contribution.

All commands run from `packages/cooklang/`.

---

### Task 1: Export protocol (common)

**Files:**
- Create: `packages/cooklang/src/common/report-export-protocol.ts`

- [ ] **Step 1: Create the protocol file**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cooklang/tsconfig.json` (from repo root) — or just rely on the package compile in a later task.
Expected: no errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/common/report-export-protocol.ts
git commit -m "feat(cooklang): add report export RPC protocol"
```

---

### Task 2: Standalone document builder + export stylesheet (browser, pure)

**Files:**
- Create: `packages/cooklang/src/browser/report-export-document.ts`
- Test: `packages/cooklang/src/browser/report-export-document.spec.ts`

This file must NOT import Monaco, React, or any widget — keep it pure so the spec stays Monaco-free.

- [ ] **Step 1: Write the failing test**

```ts
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

import { expect } from 'chai';
import { buildReportExportDocument, REPORT_EXPORT_CSS } from './report-export-document';

describe('buildReportExportDocument', () => {
    it('emits a standalone HTML document with a doctype', () => {
        const doc = buildReportExportDocument({ contentHtml: '<p>hi</p>', title: 'Pancakes' });
        expect(doc.trimStart().toLowerCase()).to.match(/^<!doctype html>/);
    });

    it('inlines the export stylesheet', () => {
        const doc = buildReportExportDocument({ contentHtml: '<p>hi</p>', title: 'Pancakes' });
        expect(doc).to.include('<style>');
        expect(doc).to.include(REPORT_EXPORT_CSS);
    });

    it('embeds the supplied content verbatim', () => {
        // The widget passes content already wrapped in `.theia-cooklang-report-content`;
        // the builder embeds it as-is.
        const doc = buildReportExportDocument({
            contentHtml: '<div class="theia-cooklang-report-content"><p>hi</p></div>',
            title: 'Pancakes'
        });
        expect(doc).to.include('theia-cooklang-report-content');
        expect(doc).to.include('<p>hi</p>');
    });

    it('escapes the title to avoid breaking out of the title element', () => {
        const doc = buildReportExportDocument({ contentHtml: '', title: 'A & B <x>' });
        expect(doc).to.include('<title>A &amp; B &lt;x&gt;</title>');
        expect(doc).to.not.include('<title>A & B <x></title>');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang` then `npx lerna run test --scope @theia/cooklang`
Expected: FAIL — `Cannot find module './report-export-document'`.

- [ ] **Step 3: Write the implementation**

```ts
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
`;

export interface ReportExportDocumentOptions {
    /** The rendered report content HTML (inner HTML of the report node). */
    contentHtml: string;
    /** Human-readable document title (used for the <title> element). */
    title: string;
}

/** Escape a string for safe insertion into HTML text/attribute content. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
```

The builder embeds `contentHtml` verbatim; the report node's wrapper element
(`.theia-cooklang-report-content` or the `.theia-cooklang-report-text` `<pre>`)
is supplied by the widget via `outerHTML` (Task 3), so the builder stays simple.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: PASS (4 passing for `buildReportExportDocument`).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/report-export-document.ts packages/cooklang/src/browser/report-export-document.spec.ts
git commit -m "feat(cooklang): add standalone report export document builder"
```

---

### Task 3: ReportWidget.getExportDocument() (browser)

**Files:**
- Modify: `packages/cooklang/src/browser/report-widget.tsx`

- [ ] **Step 1: Add the import**

At the top of `report-widget.tsx`, alongside the existing local imports, add:

```ts
import { buildReportExportDocument } from './report-export-document';
```

- [ ] **Step 2: Add the public method**

Insert this method into the `ReportWidget` class, after `getResourceUri()` /
`createMoveToUri()` (the Navigatable section) and before `// --- Report rendering ---`:

```ts
// --- Export ---

/**
 * Build a self-contained, print-friendly HTML document from the currently
 * rendered report, plus a sensible default file name. Returns `undefined`
 * while the report is still loading or in an error state.
 */
getExportDocument(): { html: string; defaultFileName: string } | undefined {
    if (this.errorMessage !== undefined || this.output === undefined) {
        return undefined;
    }
    const contentNode = this.node.querySelector(
        '.theia-cooklang-report-content, .theia-cooklang-report-text'
    );
    if (!contentNode) {
        return undefined;
    }
    const html = buildReportExportDocument({
        contentHtml: contentNode.outerHTML,
        title: this.title.label,
    });
    const defaultFileName = `${this.uri.path.name} - ${this.options.templateLabel}`;
    return { html, defaultFileName };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/report-widget.tsx
git commit -m "feat(cooklang): expose export document from report widget"
```

---

### Task 4: Export service implementation (electron-main)

**Files:**
- Create: `packages/cooklang/src/electron-main/report-export-service-impl.ts`

- [ ] **Step 1: Create the service**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/electron-main/report-export-service-impl.ts
git commit -m "feat(cooklang): add electron-main report export service"
```

---

### Task 5: Wire the service into the electron-main module

**Files:**
- Modify: `packages/cooklang/src/electron-main/cooklang-electron-main-module.ts`

- [ ] **Step 1: Add imports**

Add these import lines near the existing imports:

```ts
import { ReportExportService, ReportExportServicePath } from '../common/report-export-protocol';
import { ReportExportServiceImpl } from './report-export-service-impl';
```

- [ ] **Step 2: Add bindings**

Inside the `ContainerModule(bind => { ... })` body, after the existing
`RpcConnectionHandler(UpdateServicePath, …)` binding, add:

```ts
    bind(ReportExportServiceImpl).toSelf().inSingletonScope();
    bind(ReportExportService).toService(ReportExportServiceImpl);

    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(ReportExportServicePath, () => ctx.container.get<ReportExportService>(ReportExportService))
    ).inSingletonScope();
```

- [ ] **Step 3: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/electron-main/cooklang-electron-main-module.ts
git commit -m "feat(cooklang): register report export RPC handler"
```

---

### Task 6: Wire the proxy into the electron-browser module

**Files:**
- Modify: `packages/cooklang/src/electron-browser/cooklang-electron-browser-module.ts`

- [ ] **Step 1: Add import**

```ts
import { ReportExportService, ReportExportServicePath } from '../common/report-export-protocol';
```

- [ ] **Step 2: Add the proxy binding**

Inside the `ContainerModule(bind => { ... })` body, after the `UpdateService`
proxy binding, add:

```ts
    bind(ReportExportService).toDynamicValue(ctx =>
        ElectronIpcConnectionProvider.createProxy<ReportExportService>(ctx.container, ReportExportServicePath)
    ).inSingletonScope();
```

- [ ] **Step 3: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/electron-browser/cooklang-electron-browser-module.ts
git commit -m "feat(cooklang): bind report export service proxy"
```

---

### Task 7: Export commands + toolbar contribution (browser)

**Files:**
- Create: `packages/cooklang/src/browser/report-export-contribution.ts`

- [ ] **Step 1: Create the contribution**

```ts
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ReportWidget } from './report-widget';
import { ReportExportService, ReportExportResult } from '../common/report-export-protocol';

export namespace CooklangReportExportCommands {
    export const PRINT: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.print',
        label: 'Cooklang: Print Report',
        iconClass: 'codicon codicon-printer'
    }, 'theia/cooklang/printReport');
    export const EXPORT_PDF: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.exportPdf',
        label: 'Cooklang: Export Report as PDF',
        iconClass: 'codicon codicon-file-pdf'
    }, 'theia/cooklang/exportReportPdf');
    export const EXPORT_PNG: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.exportPng',
        label: 'Cooklang: Export Report as PNG',
        iconClass: 'codicon codicon-device-camera'
    }, 'theia/cooklang/exportReportPng');
}

@injectable()
export class ReportExportContribution implements CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(ReportExportService)
    protected readonly exportService: ReportExportService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportExportCommands.PRINT, {
            execute: (arg?: unknown) => this.print(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
        commands.registerCommand(CooklangReportExportCommands.EXPORT_PDF, {
            execute: (arg?: unknown) => this.exportPdf(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
        commands.registerCommand(CooklangReportExportCommands.EXPORT_PNG, {
            execute: (arg?: unknown) => this.exportPng(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: CooklangReportExportCommands.PRINT.id + '.toolbar',
            command: CooklangReportExportCommands.PRINT.id,
            tooltip: nls.localize('theia/cooklang/printReport', 'Print Report'),
            isVisible: widget => widget instanceof ReportWidget,
        });
        toolbar.registerItem({
            id: CooklangReportExportCommands.EXPORT_PDF.id + '.toolbar',
            command: CooklangReportExportCommands.EXPORT_PDF.id,
            tooltip: nls.localize('theia/cooklang/exportReportPdf', 'Export Report as PDF'),
            isVisible: widget => widget instanceof ReportWidget,
        });
        toolbar.registerItem({
            id: CooklangReportExportCommands.EXPORT_PNG.id + '.toolbar',
            command: CooklangReportExportCommands.EXPORT_PNG.id,
            tooltip: nls.localize('theia/cooklang/exportReportPng', 'Export Report as PNG'),
            isVisible: widget => widget instanceof ReportWidget,
        });
    }

    protected getReportWidget(arg?: unknown): ReportWidget | undefined {
        if (arg instanceof ReportWidget) {
            return arg;
        }
        const current: Widget | undefined = this.shell.getCurrentWidget('main');
        return current instanceof ReportWidget ? current : undefined;
    }

    protected async print(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        try {
            await this.exportService.print(document.html);
        } catch (error) {
            this.showError(error);
        }
    }

    protected async exportPdf(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        this.report(await this.exportService.exportPdf(document.html, document.defaultFileName));
    }

    protected async exportPng(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        this.report(await this.exportService.exportPng(document.html, document.defaultFileName));
    }

    protected report(result: ReportExportResult): void {
        if (result.error) {
            this.messageService.error(
                nls.localize('theia/cooklang/exportReportFailed', 'Report export failed: {0}', result.error)
            );
        }
    }

    protected showError(error: unknown): void {
        this.messageService.error(
            nls.localize('theia/cooklang/exportReportFailed', 'Report export failed: {0}',
                error instanceof Error ? error.message : String(error))
        );
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS. (If `codicon-file-pdf` is not a valid codicon in this Theia
version, substitute `codicon-export` — this only affects the icon glyph, not
behavior.)

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/report-export-contribution.ts
git commit -m "feat(cooklang): add report print/export commands and toolbar"
```

---

### Task 8: Wire the contribution into the frontend module

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Add import**

Add near the other local imports:

```ts
import { ReportExportContribution } from './report-export-contribution';
```

- [ ] **Step 2: Add bindings**

Inside the `ContainerModule(bind => { ... })` body, directly after the existing
report bindings (`bind(MenuContribution).toService(ReportContribution);`), add:

```ts
    // Report print/export commands + toolbar
    bind(ReportExportContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ReportExportContribution);
    bind(TabBarToolbarContribution).toService(ReportExportContribution);
```

(`CommandContribution` and `TabBarToolbarContribution` are already imported in
this file.)

- [ ] **Step 3: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): register report export contribution"
```

---

### Task 9: Full build, lint, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Lint the package**

Run: `npx lerna run lint --scope @theia/cooklang`
Expected: no errors in the new/modified files.

- [ ] **Step 2: Rebuild the Electron app**

Run: `cd app && npm run bundle`
Expected: bundle completes; `src-gen/` regenerated without errors.

- [ ] **Step 3: Launch and manually verify**

Run: `npm run start:electron`

Then:
1. Open a `.cook` recipe, run `Cooklang: Render Report...`, pick a template (e.g. a nutrition/markdown report).
2. Confirm three icons appear in the report tab's top-right toolbar (print, PDF, PNG).
3. Switch the editor to a **dark** theme. Click **Export PDF** → choose a path → open the PDF and confirm: **light background, dark text, selectable text**.
4. Click **Export PNG** → choose a path → confirm a light-background image of the full report.
5. Click **Print** → confirm the native print dialog opens showing the light report.
6. Cancel each save/print dialog once → confirm no error toast appears.

Expected: all three actions work; output is always light regardless of theme; cancelling is silent.

- [ ] **Step 4: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix(cooklang): report export verification fixes"
```

(Skip if no fixes were needed.)

---

## Self-Review Notes

- **Spec coverage:** document builder (Task 2) ✓; export protocol (Task 1) ✓; electron-main service with print/PDF/PNG + offscreen window + temp file + save dialog + error handling (Task 4) ✓; toolbar + commands with `ReportWidget`-gated visibility (Task 7) ✓; all three wiring points — electron-main (Task 5), electron-browser (Task 6), browser (Task 8) ✓; unit test for builder (Task 2) ✓; manual/E2E verification (Task 9) ✓.
- **Type consistency:** `ReportExportService` methods `print`/`exportPdf`/`exportPng` and `ReportExportResult { saved, filePath?, error? }` are used identically across Tasks 1, 4, 6, 7. `getExportDocument()` returns `{ html, defaultFileName }` in Task 3 and is consumed with those exact keys in Task 7.
- **Known limitation (from spec):** very tall reports may exceed max window dimensions for PNG; PDF is the recommended path for long reports. Not separately tested.
