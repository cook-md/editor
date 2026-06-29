# Report Export & Print — Design

**Date:** 2026-06-29
**Status:** Approved (pending implementation plan)

## Goal

Let users **Print**, **Export as PDF**, and **Export as PNG** a rendered Cooklang
report from the report tab. Exports/prints always use a clean, print-friendly
light document style (dark-on-white) regardless of the active editor theme.

## Context

Reports are rendered by `ReportWidget` (`packages/cooklang/src/browser/report-widget.tsx`),
a `ReactWidget` opened via the `Cooklang: Render Report...` command. The widget
renders one of three output formats into its DOM:

- `html` → sanitized HTML in `.theia-cooklang-report-content`
- `markdown` → `<Markdown>` component, also landing in `.theia-cooklang-report-content`
- `text` → a `<pre class="theia-cooklang-report-text">`

The on-screen report styling lives in `packages/cooklang/src/browser/style/report.css`
and is driven entirely by Theia theme variables (`var(--theia-*)`), so in a dark
theme the report has a dark background.

This is an **Electron-only** app, so we have native `webContents.print()`,
`webContents.printToPDF()`, and `webContents.capturePage()` available in the main
process. The project already exposes a main-process service over Theia RPC —
`UpdateService` (`common` protocol → `electron-main` impl + `RpcConnectionHandler`
→ `electron-browser` proxy → `browser` consumer). This feature mirrors that
exact pattern.

## Approach

Chosen: **Electron main-process export service driven by an offscreen
`BrowserWindow`.** The renderer serializes the report into a self-contained HTML
document (content + inlined light/print stylesheet) and hands it to the service,
which loads it offscreen and runs the native print / `printToPDF` / `capturePage`
operations. This yields a real selectable-text PDF, crisp PNG, and native print,
and fits the codebase's existing RPC patterns.

Rejected alternatives:

- **Pure-renderer libraries** (`html2canvas` + `jsPDF`, hidden iframe for print):
  adds bundle-heavy deps; PDF is a rasterized image (not selectable, large,
  blurry).
- **Print-only via iframe now**: doesn't satisfy the explicit ask for all three
  formats.

## Components

### 1. Standalone document builder — `src/browser/report-export-document.ts` (renderer)

Pure, monaco-free, unit-testable. Exports:

- `REPORT_EXPORT_CSS`: a TypeScript string constant holding the print/export
  stylesheet. It carries over the typographic rules from `report.css` but with
  **concrete dark-on-white colors** (no `var(--theia-*)`, which do not resolve in
  a bare `BrowserWindow`) plus `@page` margins for paper/PDF output.
- A builder function, e.g. `buildReportExportDocument({ contentHtml, title }): string`,
  returning a complete `<!doctype html>` document: `<meta charset>`, an inlined
  `<style>` block containing `REPORT_EXPORT_CSS`, an escaped `<title>`, and the
  content wrapped in `.theia-cooklang-report-content`.

Kept in its own file with **no Monaco imports** so its `*.spec.ts` does not pull
in `@theia/monaco` (a known harness gotcha: a browser spec that transitively
imports Monaco dies with a `.css` ESM "configuration is already set" error under
Node 20).

The `contentHtml` is sourced from the **live rendered DOM** by `ReportWidget`
(the `.theia-cooklang-report-content` `innerHTML`, or the `<pre>` for the text
format) so we export exactly what is on screen.

### 2. Export protocol — `src/common/report-export-protocol.ts` (common)

```ts
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

### 3. Export service — `src/electron-main/report-export-service-impl.ts` (electron-main)

Implements `ReportExportService`. A private helper renders the document in an
offscreen window and guarantees cleanup:

- Create `new BrowserWindow({ show: false, webPreferences: { ... } })`.
- Write `html` to a temp `.html` file in the app temp dir and `loadFile` it
  (avoids `data:` URL size/encoding limits); await `did-finish-load`.
- Run the format-specific operation, then destroy the window and remove the temp
  file in `finally`.

Operations:

- **print** → `webContents.print({ printBackground: true })`. Resolve on the
  callback; treat user cancellation as a quiet success (no error).
- **exportPdf** → `webContents.printToPDF({ printBackground: true })` → `Buffer`
  → `dialog.showSaveDialog` (default filename, `.pdf` filter) → write with `fs`.
- **exportPng** → measure full content height via `executeJavaScript`, size the
  window content to the full report, `capturePage()` → `NativeImage.toPNG()` →
  `dialog.showSaveDialog` (`.png` filter) → write.

A cancelled save dialog returns `{ saved: false }`. Any failure returns
`{ saved: false, error }`.

**Known limitation:** PNG capture of a very tall report is bounded by maximum
window dimensions; extremely long reports may be clipped. PDF (paginated) is the
recommended path for long reports.

### 4. Toolbar + commands — `src/browser/report-export-contribution.ts` (browser)

A new `@injectable()` class implementing `CommandContribution` +
`TabBarToolbarContribution` (mirroring `RecipePreviewContribution`). It:

- Registers commands `cooklang.report.print`, `cooklang.report.exportPdf`,
  `cooklang.report.exportPng`, each `isEnabled`/`isVisible` only when the target
  widget is a `ReportWidget`.
- Registers three corresponding tab-bar toolbar items (appropriate codicons,
  e.g. printer / file / camera) shown on the report tab, `isVisible: widget =>
  widget instanceof ReportWidget`.
- In each handler: obtain the active `ReportWidget` (toolbar passes it as the
  command argument), read the standalone document HTML and a default filename
  (`<recipe base> - <template label>`) from the widget, and call the
  `ReportExportService` proxy. On `result.error`, show a `MessageService` error.

`ReportWidget` gains a small public method, e.g.
`getExportDocument(): { html: string; defaultFileName: string } | undefined`,
that builds the standalone HTML from its live content node via
`buildReportExportDocument(...)` and derives the filename. Returns `undefined`
while the report is still loading or in an error state (commands disabled then).

### 5. Wiring

- `src/electron-main/cooklang-electron-main-module.ts`: bind
  `ReportExportServiceImpl` to self + to `ReportExportService`, and add an
  `ElectronConnectionHandler` `RpcConnectionHandler(ReportExportServicePath, …)`.
- `src/electron-browser/cooklang-electron-browser-module.ts`: bind
  `ReportExportService` via `ElectronIpcConnectionProvider.createProxy`.
- `src/browser/cooklang-frontend-module.ts`: bind `ReportExportContribution` to
  self + as `CommandContribution` and `TabBarToolbarContribution`.

The `browser` consumer injects the `ReportExportService` Symbol; the concrete
proxy binding is provided by the `electron-browser` module, which is always
loaded in this Electron-only app (same arrangement as `UpdateService`).

## Error handling

| Situation | Behavior |
| --- | --- |
| Save dialog cancelled | `{ saved: false }`; command does nothing further |
| `printToPDF` / `capturePage` / write fails | `{ saved: false, error }`; frontend shows `MessageService` error |
| Print dialog cancelled | `print()` resolves quietly |
| Report still loading / in error state | Export/print commands disabled (no export document) |

## Testing

- **Unit:** `src/browser/report-export-document.spec.ts` — asserts the builder
  emits a doctype, inlines `REPORT_EXPORT_CSS`, escapes the title, and embeds the
  supplied content. Monaco-free.
- **Manual / E2E:** the electron-main service needs the Electron runtime; verify
  print dialog, PDF save (selectable text, light background in dark theme), and
  PNG save by hand. Optionally extend the existing Electron-via-CDP E2E workflow.

## Out of scope

- Page-size / orientation / margin configuration UI (use sensible defaults).
- Batch export of multiple reports.
- Exporting non-report widgets (recipe/menu previews).
