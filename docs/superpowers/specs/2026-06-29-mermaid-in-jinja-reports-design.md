# Mermaid Diagrams in Jinja Reports

**Date:** 2026-06-29
**Status:** Implemented (with a mid-flight correction — see below)
**Package:** `packages/cooklang`

> **Implementation correction (2026-06-30).** This design assumed Theia's
> markdown renderer emits `<pre><code class="language-mermaid">` nodes that a
> post-render DOM scan could replace. Running the real app showed that the
> bound renderer is Monaco's `MarkdownRendererService`, which surfaces fenced
> code blocks through a `codeBlockRenderer(languageId, value)` callback and
> emits empty `<div data-code>` placeholders otherwise. The shipped
> implementation therefore renders report markdown imperatively (the core
> `Markdown` component does not forward render options) via a dedicated
> `MermaidMarkdown` component that supplies a `codeBlockRenderer`: it delegates
> `mermaid` blocks to `MermaidRenderer.renderDiagram(source, theme)` and falls
> back to `<pre><code>` for other languages. The `MermaidRenderer.renderExport`
> light re-theme for print, the lazy import, and the theme-follow behaviour are
> all unchanged from this design.

## Goal

Render [Mermaid](https://mermaid.js.org/) diagrams that appear inside the
**markdown** output of Jinja reports. A report template that emits a fenced
` ```mermaid ` code block should display the rendered diagram both in the live
report widget and in exported PDF/PNG/print output.

## Scope

- **In scope:** markdown-format report output only.
- **Out of scope:** `html` and `text` report output formats (untouched);
  diagram editing/authoring UI; mermaid support anywhere outside the report
  widget.

## Background

Report rendering lives in `packages/cooklang/src/browser/report-widget.tsx`:

- The Jinja output string is rendered by Theia's `Markdown` React component
  using `MarkdownRenderer` (`report-widget.tsx:233`).
- A ` ```mermaid ` fence becomes `<pre><code class="language-mermaid">…</code></pre>`
  in the rendered DOM — inert by default.
- Export (`getExportDocument`, `report-widget.tsx:123`) grabs the rendered
  content node's `outerHTML` and hands it to an offscreen BrowserWindow
  (`report-export-document.ts` → `buildReportExportDocument`) for PDF/PNG/print.
- `mermaid` already exists in the repo, but only bundled inside the sandboxed
  `app/plugins/vscode.mermaid-chat-features` webview — **not** reusable from the
  cooklang package.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Render targets | Live preview **and** export | Consistent output; export works because the rendered SVG is captured in the DOM. |
| Library loading | **Lazy** `import('mermaid')`, memoized | Mermaid is ~3MB; only pay the cost when a report actually contains a diagram. Webpack splits the dynamic import into its own chunk. |
| Live theme | **Follow editor theme** | Dark editor → mermaid `dark` theme; otherwise `default`. Re-render on theme change. |
| Export theme | **Always `default` (light)** | Print-friendly on white paper regardless of editor theme. |

## Architecture

Approach: **post-render DOM pass**. Let `MarkdownRenderer` produce its normal
output, then replace mermaid code blocks with rendered SVG immediately after the
markdown mounts/updates.

Rejected alternatives:
- **Pre-process the markdown string** (substitute inline SVG before
  `MarkdownRenderer`): fights the renderer's sanitization and async rendering.
- **Server/native render**: mermaid requires a browser DOM; cannot run in the
  Rust layer.

### Components

#### New: `packages/cooklang/src/browser/mermaid-renderer.ts`

Kept free of any `@theia/monaco` import so it can be unit-tested without the
"configuration is already set" monaco/CSS failure (see project memory
`feedback_spec_monaco_css_harness`).

- `@injectable() class MermaidRenderer`
  - `protected async load(): Promise<typeof import('mermaid')>` — lazy,
    memoized dynamic import.
  - `async renderInto(container: HTMLElement, theme: MermaidTheme): Promise<void>`
    - Find all mermaid code blocks in `container`.
    - For each: call `mermaid.render(uniqueId, source)`; on success replace the
      enclosing `<pre>` with
      `<div class="theia-cooklang-mermaid" data-mermaid-src="<source>">` wrapping
      the produced SVG.
    - Per-block `try/catch`: a failing diagram renders an inline error node and
      does **not** abort the remaining blocks or the report.
    - Initialize mermaid with `startOnLoad: false` and the requested `theme`
      before rendering.
  - `async renderSource(source: string, theme: MermaidTheme, id: string): Promise<string>`
    — render a single source string to SVG markup (used by the export path).
- Exported pure helper(s) for the spec to test without a DOM-heavy import, e.g.
  `findMermaidBlocks(container)` and/or a source-extraction function.
- `type MermaidTheme = 'default' | 'dark'` and a `themeTypeToMermaidTheme(...)`
  mapping helper.

#### Changed: `report-widget.tsx`

- Inject `MermaidRenderer` and `ThemeService`
  (`@theia/core/lib/browser/theming`).
- Extract a small functional component `MermaidMarkdown` that:
  - renders `<Markdown markdown=… markdownRenderer=… className='theia-cooklang-report-content'/>`
    inside a container with a `ref`.
  - in a `useEffect` keyed on `[output, themeType]`, calls
    `mermaidRenderer.renderInto(ref.current, theme)`.
  - guards against races (ignore the effect result if a newer render started /
    the node unmounted).
- The markdown branch of `render()` returns `<MermaidMarkdown … />` instead of
  the bare `<Markdown>`.
- Subscribe to `themeService.onDidColorThemeChange` in `init()` →
  `this.update()` so diagrams re-theme live. Dispose the listener with
  `this.toDispose`.

#### Changed: export path

- `getExportDocument()` becomes `async` (returns a `Promise`).
  - Clone the rendered content node.
  - For each `.theia-cooklang-mermaid[data-mermaid-src]` in the clone, re-render
    the stored source with the **`default`** (light) theme and swap in the
    light SVG.
  - Serialize the clone's `outerHTML` into `buildReportExportDocument`.
  - Continue to return `undefined` while loading or in an error state.
- `report-export-contribution.ts`: update the 3 call sites (`print`,
  `exportPdf`, `exportPng`) to `await getReportWidget(arg)?.getExportDocument()`.
  All three are already `async` methods.
- `report-export-document.ts`: add `.theia-cooklang-mermaid` rules to
  `REPORT_EXPORT_CSS` (centered, `max-width: 100%`, page-break avoidance,
  neutral background).

#### Changed: styling

- `packages/cooklang/src/browser/style/report.css`: add
  `.theia-cooklang-mermaid` rules — centered block, constrained width, and an
  error style for failed diagrams.

#### Changed: packaging

- Add `"mermaid"` to `dependencies` in `packages/cooklang/package.json`. Pin to
  the same major version already vendored by
  `app/plugins/vscode.mermaid-chat-features` where practical, to avoid pulling a
  second major.

## Data flow

```
Jinja output (markdown string)
  → MarkdownRenderer  → DOM: <pre><code class="language-mermaid">…</code></pre>
  → MermaidMarkdown useEffect → MermaidRenderer.renderInto(node, liveTheme)
      → mermaid.render() → <div.theia-cooklang-mermaid data-mermaid-src> + <svg>
  (live preview shows themed SVG)

Export:
  getExportDocument() → clone content node
    → re-render each data-mermaid-src with default(light) theme
    → buildReportExportDocument(outerHTML) → offscreen BrowserWindow → PDF/PNG/print
```

## Error handling

- A malformed mermaid diagram renders an inline, styled error block in place of
  that diagram; other diagrams and the surrounding report render normally.
- If the lazy `import('mermaid')` fails, `renderInto` leaves the raw code block
  in place (graceful degradation) and logs via `console`.
- Export with diagrams still loading: `getExportDocument` operates on the
  current DOM clone; any block whose source is unavailable falls back to the
  current node content rather than throwing.

## Testing

- `packages/cooklang/src/browser/mermaid-renderer.spec.ts` (monaco-free):
  - `findMermaidBlocks` / source-extraction over a sample DOM fragment
    (built with `jsdom`-style fixtures or a parsed string) returns the expected
    mermaid sources and ignores non-mermaid code blocks.
  - `themeTypeToMermaidTheme` mapping for light/dark/hc theme types.
- Manual verification (per `/run`): a report template emitting a mermaid block
  renders a diagram in the widget; toggling editor theme re-themes it; PDF/PNG
  export shows the diagram in light theme.

## Risks & notes

- **Bundle size:** mitigated by lazy import; verify the dynamic import lands in
  its own webpack chunk after `cd app && npm run bundle`.
- **Monaco/CSS spec trap:** keep all unit-tested logic in `mermaid-renderer.ts`,
  which must not transitively import `@theia/monaco`.
- **mermaid major alignment:** two majors of mermaid in the tree is acceptable
  (the plugin copy is sandboxed in its own webview), but prefer matching majors
  to limit install weight.
