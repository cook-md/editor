# Plugin API: `exportPdf` and `recipeImages` — design

**Date:** 2026-10-10
**Status:** Approved
**Scope:** Two new public `cooklang.api.*` commands so the Cookbook plugin (`plugins/docs/superpowers/specs/2026-10-10-cookbook-plugin-design.md`) can export an HTML document as PDF and find recipe photos with the same rules as the preview. Additive; `cooklang.api.version` stays 1 (plugins feature-detect by command presence, as with `openReport` and `refreshBadges`).

## `cooklang.api.exportPdf`

`{ html: string, defaultFileName: string }` → `{ saved: boolean, path?: string, error?: string }`

- Delegates to the existing `ReportExportService.exportPdf(html, defaultFileName)` (electron-main: hidden window, `webContents.printToPDF({ printBackground: true })`, native save dialog). Same code path as the report tab's **Export PDF** button.
- Validation (strict, `Invalid arguments: …` like the other commands): `html` non-empty string, at most 100 MB in characters (photos are inlined as data URIs); `defaultFileName` non-empty, ≤ 200 characters, no path separators or control characters, `.pdf` appended when missing.
- Result: `saved: false` when the user cancels the dialog; `error` carries the service's error message. The editor shows nothing itself; the plugin reports success or failure.
- Security: the HTML is written to a temp file and loaded in the same hidden window the report export already uses (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`). That window currently allows JavaScript; add `javascript: false` to its `webPreferences` (report and cookbook HTML need none). A plugin already runs with Node in the extension host, so this is defence in depth, not a new trust boundary.
- Page size: the service's current default. If the plugin needs Letter, add an optional `pageSize: 'A4' | 'Letter'` passed through to `printToPDF` (`pageSize` option); default unchanged.

## `cooklang.api.recipeImages`

`{ uri: string }` → `{ title?: string, steps: Record<string, Record<string, string>> }` (absolute URIs; outer key = section index, inner key = step number, both as strings for JSON)

- `uri` must be an absolute `.cook` URI with a file system provider (reuse `reportRequest`'s URI checks).
- Implementation: the same lookup the preview uses — `napi_recipe_images(path)` for sibling files (`Recipe.jpg`, `Recipe.N.jpg`, `Recipe.S.N.jpg`) and `napi_recipe_images_from_content` for metadata `image`/`images`, merged with the preview's precedence (metadata wins for the title). Factor the merge out of `RecipeImageService` into a pure function so preview and API share it; the API returns URIs, not blob URLs (the plugin reads bytes itself with `workspace.fs`).
- Metadata `http(s)` image URLs are returned verbatim.

## Docs

Add both to `cooklang-plugin-api-contribution.ts`'s command doc block and to cook.md `/help/plugins/api` (Version section: "added in Cook Editor 0.1.0-alpha.N").

## Testing

Argument validation specs for both commands; `exportPdf` delegates and maps cancel / error; `recipeImages` merge function shared with the preview (existing preview specs keep passing, new spec for metadata-vs-sibling precedence and section step images).
