# Cooklang Report Rendering — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Add a "Cooklang: Render Report…" command to the editor that renders a
[Cooklang report](https://cooklang.org/docs/use-cases/reports/) (a Jinja2
template applied to a recipe) for the currently open `.cook` file and shows
the result in a new main-area tab. Feature parity target is `cook report`
from cookcli, which delegates to the `cooklang-reports` crate (minijinja).

## Scope

- **In:** single recipes (`.cook`), template discovery from the workspace,
  built-in fallback templates, rendered-markdown output tab with live
  re-render, workspace-convention config wiring (aisle/pantry/datastore).
- **Out (v1):** `.menu` files (upstream `cooklang-reports` does not support
  menus; the command shows a friendly "not supported for menus yet" message),
  recipe scaling UI (scale fixed at 1), template editing aids.

## Architecture

Rendering happens in Rust via the `cooklang-reports` crate, exposed through
the existing NAPI-RS addon and `CooklangLanguageService` RPC — the same
pipeline used by `parse` and `generateShoppingList`. This guarantees the
same template engine, filters (`db()`, `aisled()`, `excluding_pantry()`,
number formatters, …) and behavior as cookcli.

### 1. cooklang-native (Rust)

- Add `cooklang-reports` to `packages/cooklang-native/Cargo.toml`. Use the
  latest published crates.io version; if crates.io lags behind 0.5.x, use a
  git dependency on `cooklang/cooklang-reports`.
- New NAPI function:

  ```rust
  #[napi]
  pub fn render_report(recipe: String, template: String, config_json: String) -> String
  ```

  `config_json` carries optional `scale`, `basePath`, `aislePath`,
  `pantryPath`, `datastorePath` (all filesystem paths, already converted by
  the backend). Maps onto `cooklang_reports::Config` and calls
  `render_template_with_config(&recipe, &template, &config)`.
- Returns JSON: `{ "output": "..." }` on success, `{ "error": "..." }` on
  failure (minijinja errors formatted with source context where available).

### 2. Backend RPC (packages/cooklang/src/node)

- New method on `CooklangLanguageService` (common interface +
  `CooklangLanguageServiceImpl`):

  ```ts
  renderReport(recipeContent: string, templateContent: string, configJson: string): Promise<string>;
  ```

- The frontend sends path-like config entries as URI strings; the backend
  converts them with `FileUri.fsPath` before building the native config
  (URIs cross the wire, never raw paths).
- Errors from the native call are caught and returned as `{ error }` JSON,
  mirroring the `parse` error-handling pattern.

### 3. Frontend command (packages/cooklang/src/browser)

New `report-contribution.ts` registering `cooklang.renderReport`
("Cooklang: Render Report…"):

- Available in the command palette and the editor context menu; enabled when
  the active editor is a `.cook` file. For `.menu` files the command shows an
  info message that menu reports are not yet supported.
- Flow on invocation:
  1. **Template discovery:** scan `config/reports/` in the workspace for
     `*.jinja`, `*.j2`, `*.jinja2` via `FileService`; show a QuickPick of
     found templates plus built-in templates ("Ingredients List",
     "Shopping List") bundled with the package as string constants.
  2. **Config wiring:** if present in the workspace, pass
     `config/aisle.conf`, `config/pantry.conf`, `db/` (datastore) and the
     workspace root as base path. Missing files are simply omitted.
  3. **Content:** recipe content is read from the open editor document (so
     unsaved changes render); the template is read via `FileService` (or
     taken from the built-in constant).
  4. Open/reveal the `ReportWidget` for (recipe URI, template) in the main
     area.

### 4. ReportWidget (packages/cooklang/src/browser)

- `ReactWidget` + `Navigatable`, modeled on `RecipePreviewWidget`.
- Widget id derived from recipe URI + template identifier, so re-running the
  same combination reuses the existing tab; a different template for the
  same recipe opens a separate tab.
- Renders the report output as markdown → HTML via Theia's
  `MarkdownRenderer` (sanitized).
- Subscribes to the source document and re-renders on change, debounced
  (same approach as the recipe preview).
- Render/template errors are displayed inside the widget as a preformatted
  error block — no popups.
- Styling via CSS classes in `style/` (no inline styles); colors via
  `--theia-*` variables only.

## Error handling

- Native panic safety: `render_report` catches errors from
  `cooklang-reports` and returns them as `{ error }` — no process crashes.
- Backend catches `require`/invocation failures and returns `{ error }`.
- Widget displays `{ error }` content in-place; the QuickPick step surfaces
  filesystem problems (unreadable template) via `MessageService`.

## Testing

- **Rust:** unit test for `render_report` with a small recipe fixture and an
  ingredients template; one test for the error path (bad template syntax).
- **Backend:** `cooklang-language-service-impl.spec.ts` addition with the
  native module stubbed.
- **Frontend:** template-discovery logic extracted into a monaco-free file
  with its own spec (avoids the known monaco-css spec-harness failure).
- Manual: render built-in template on a sample recipe; verify live
  re-render and error display.

## Conventions

- All user-facing strings localized with `nls.localize`
  (`theia/cooklang/...` keys).
- Property injection, `@postConstruct` (sync), `inSingletonScope` bindings.
- 4-space indent, single quotes, explicit return types.
