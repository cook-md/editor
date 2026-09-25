# Recipe Hub plugin — design

**Date:** 2026-09-25
**Status:** Approved (brainstorming)
**Repos touched:** `federation` (recipes.cooklang.org), `editor`, `plugins`

## Goal

Let Cook Editor users search the public recipe index at recipes.cooklang.org
from inside the editor, with structured filters, preview any result in the
normal recipe preview, and save it into their collection's `Drafts/` folder.

## Non-goals

- Publishing recipes to the federation from the editor.
- Offline search or a local mirror of the index.
- Resolving `@./recipe` references inside remote recipes.
- Auth / personalised results (the API stays public and read-only).

## Work order

Three PRs, one per repo. 1 and 2 can go in parallel; 3 depends on both.

1. Federation API changes, deployed.
2. Editor: `cooklang.api.saveDraft`, non-`file` preview support, remote image
   fallback, `cooklangPreviewScheme` context key.
3. `cooklang.recipe-hub` plugin; then shipped by default in `app/plugins`.

---

## 1. Federation API (`../federation`)

### 1.1 Structured filters on `GET /api/search`

All optional, combined with `q` and with each other as `Must` clauses (same
mechanism as today's `locale`). The `q` field syntax keeps working unchanged.

| Param | Example | Semantics |
|---|---|---|
| `tags` | `tags=vegan,dessert` | Recipe has **all** listed tags |
| `include_ingredients` | `include_ingredients=garlic,lemon` | Recipe uses **all** listed ingredients |
| `exclude_ingredients` | `exclude_ingredients=peanut` | Recipe uses **none** of them (`MustNot`) |
| `max_time` | `max_time=30` | `total_time` ≤ value (minutes) |
| `min_servings`, `max_servings` | `min_servings=2&max_servings=6` | Inclusive range on `servings` |
| `difficulty` | `difficulty=easy` | Exact match (normalised lowercase) |
| `feed_id` | `feed_id=12` | Only recipes from that feed |
| `sort` | `relevance` (default) \| `newest` | `newest` orders by `indexed_at` desc |

Comma-separated list values are trimmed; empty items are ignored. Tag and
ingredient terms go through the same tokenizer/stemmer as their fields so
`tags=Desserts` matches `dessert`. Invalid numeric values → `400` with a
message, like invalid `q` today.

Schema changes (`src/indexer/schema.rs`):

- `total_time`, `servings`: add `INDEXED` so range queries work.
- New `feed_id: i64 (FAST | INDEXED | STORED)`.
- New `indexed_at: i64 (FAST | STORED)` — unix seconds, for `sort=newest`.
- New stored-only fields for richer cards: `image_url`, `feed_title`.

Changing the schema requires a full reindex; the existing reindex CLI
command is used, and it is documented in the release notes.

### 1.2 Richer result cards

`RecipeCard` gains (all optional, all from stored index fields — no DB round
trip per hit):

```json
{
  "id": 1, "title": "...", "summary": "...", "tags": ["..."], "locale": "en",
  "total_time_minutes": 25, "servings": 4, "difficulty": "easy",
  "image_url": "https://...", "feed": { "id": 12, "title": "..." }
}
```

### 1.3 `GET /api/facets`

```json
{
  "tags": [{ "name": "dessert", "count": 123 }],
  "locales": [{ "code": "en", "name": "English", "count": 900 }],
  "difficulties": [{ "name": "easy", "count": 40 }]
}
```

- `tags`: top N by recipe count from the DB tag tables (`?tag_limit=`, default
  200, max 1000).
- `locales`: reuse the query behind the website's language dropdown
  (`src/web/handlers.rs`).
- Cached in memory for 5 minutes. Under the same `/api` rate limit.

### 1.4 Fixes

- **Index tags.** Every `index_recipe` call site (`github/indexer.rs`,
  `cli/commands.rs`, crawler) passes the recipe's DB tags. Remove the no-op
  `add_recipe_tags` / `add_recipe_ingredients` placeholders. Regression test:
  a recipe indexed with tags is found by `tags:` and by `tags=`.
- **Rate-limit key.** Serve with `into_make_service_with_connect_info` and key
  on `ConnectInfo<SocketAddr>`, preferring the first `X-Forwarded-For` hop
  when behind the proxy, so clients stop sharing one global bucket.
- **About page API docs** rewritten to match the real endpoints and shapes,
  including the new params and `/api/facets`.
- **Website search form** gains the same structured filters, sending the same
  params, so site and plugin stay in step.

### 1.5 Compatibility

All changes are additive: an old plugin works against the new server, and the
plugin tolerates missing card fields (renders without them).

---

## 2. Editor changes

### 2.1 `cooklang.api.saveDraft` (`packages/cooklang-import`)

Label-less command registered next to `DraftSaver` (the package that owns it).

```ts
interface SaveDraftArgs {
    version: 1;
    content: string;                       // cooklang text
    title?: string;                        // fallback when content has no title
    frontmatter?: Record<string, string>;  // added only for keys not already present
}
// returns the saved file URI as a string
```

- Validates the argument shape; rejects with a clear error otherwise.
- Delegates to `DraftSaver` (`Drafts/<Title>.cook`, unique name, `title:`
  frontmatter, opens the file). A new `DraftName.mergeFrontmatter` adds the
  extra keys to YAML frontmatter (never the deprecated `>>` syntax).
- No workspace open → rejects with the existing
  `theia/cooklang-import/noWorkspace` message.
- Bumps `CooklangPluginApi.VERSION` minor.

### 2.2 Preview for non-`file` URIs (`packages/cooklang`)

The recipe preview reads through `FileService`, and Theia bridges plugin
`FileSystemProvider`s into it, so `cooklang-hub:` URIs load without a new
widget. Audit and fix `file`-only assumptions in:

- `recipe-preview-widget.tsx` / `recipe-preview-contribution.ts`
- `PreviewOutletContext` — `path` is `''` for resources outside the workspace;
  `uri` carries the real scheme (doc comment updated).
- `RecipeImageService` — no sibling-image lookup for non-`file` URIs.
- Recipe references render as plain text when they cannot be resolved.

### 2.3 Remote image fallback

When a recipe has no local image and its frontmatter `image:` / `images:` is
an `https:` URL, the preview shows it. The preview's CSP allows `https:`
images.

### 2.4 `cooklangPreviewScheme` context key

Set on the recipe preview element to the source URI's scheme, so outlet
`when` clauses can target (or exclude) remote previews.

---

## 3. Plugin: `cooklang.recipe-hub` (`~/Cooklang/plugins/recipe-hub/`)

Same layout and tooling as `shopping-list` (tsc + esbuild webview bundle,
mocha, `deploy.js`, vsce/ovsx publishing).

### 3.1 Modules

| File | Responsibility | Depends on `vscode`? |
|---|---|---|
| `hub-client.ts` | Typed client: `search`, `facets`, `recipe`, `download`. `fetch` with timeout; maps HTTP errors to typed `HubError` (`network`, `badQuery`, `rateLimited`, `server`, `notFound`). | No |
| `search-query.ts` | Webview filter state → URL params. | No |
| `recipe-draft.ts` | Builds `saveDraft` args (adds `source:` frontmatter from `source_url`). | No |
| `hub-file-system.ts` | Read-only `FileSystemProvider` for `cooklang-hub:`. URI `cooklang-hub:/recipes/<id>/<Title>.cook`. `readFile` = download (fallback `enclosure_url`); LRU cache of 50. Writes/renames/deletes throw `NoPermissions`. | Yes |
| `search-view-provider.ts` | `WebviewViewProvider`; message protocol with the webview; runs searches, holds request sequence. | Yes |
| `webview/main.ts` | Panel UI. | No (DOM) |
| `extension.ts` | `activate()`: register provider, FS, commands; check `cooklang.api.version`. | Yes |

### 3.2 Manifest

- `viewsContainers.activitybar`: `recipeHub` ("Recipe Hub"), with a webview
  view `recipeHub.view`.
- Setting `recipeHub.serverUrl` (default `https://recipes.cooklang.org`).
- Commands:
  - `recipeHub.search` — focus the panel.
  - `recipeHub.saveToDrafts` — in `cooklang/recipePreview/toolbar`, `when:
    cooklangPreviewScheme == cooklang-hub`.
  - `recipeHub.openSource` — same outlet and `when`; opens `source_url`
    externally.

### 3.3 Panel UI

1. Search box (accepts full `q` syntax).
2. Collapsible **Filters**: tags multi-select (from facets, with counts),
   include / exclude ingredient chips, max time presets (15 / 30 / 60 / any),
   difficulty, servings range, language (defaults to the editor display
   language, with "Any"), sort (Relevance / Newest). "Clear filters" link.
3. Result count, then cards: thumbnail, title, summary, time, servings, feed
   name, up to 3 tags.
4. "Load more" (20 per page).
5. States: loading, empty, network error with Retry, bad query (server
   message inline), rate limited ("Too many searches — try again shortly").

Searches are debounced 300 ms; responses carrying an older sequence number are
dropped. Filter state persists via `webview.setState`. Remote thumbnails need
the webview CSP to allow `img-src https:`.

### 3.4 Flow

1. Click a card → `cooklang.openPreview` on the `cooklang-hub:` URI; the
   standard recipe preview renders it.
2. **Save to Drafts** (preview toolbar) → read content via the FS provider →
   `cooklang.api.saveDraft({ version: 1, content, title, frontmatter: { source } })`
   → `Drafts/<Title>.cook` opens.
3. Editor API older than required → error "Update Cook Editor to save drafts".

### 3.5 Other preview-toolbar actions on hub recipes

"Add to shopping list" stays available on hub previews only if the
`shopping-list` plugin resolves recipes via `workspace.fs` by URI; otherwise
it is hidden with `cooklangPreviewScheme == file`. Decided during
implementation of PR 3 after checking the shopping-list code.

---

## 4. Testing

- **Federation (Rust):** each structured filter; filters combined with `q` and
  `locale`; `exclude_ingredients`; `sort=newest`; invalid numbers → 400;
  `/api/facets` counts and cache; card fields populated; tags regression;
  rate-limit key extraction.
- **Plugin (mocha):** `hub-client` against a stubbed `fetch` (success, each
  error kind, missing optional fields); `search-query`; `recipe-draft`
  frontmatter; FS provider cache and read-only errors.
- **Editor (mocha):** `cooklang.api.saveDraft` (shape validation, frontmatter
  merge without overwriting, no-workspace); `DraftName.mergeFrontmatter`;
  preview outlet context for a non-`file` URI; context key value.
- **E2E (manual, Electron via CDP):** search → filter → open preview → Save to
  Drafts → file exists in `Drafts/` with `title:` and `source:` frontmatter.

---

## Corrections found while planning

These supersede the sections above; the plans in `docs/superpowers/plans/2026-09-25-recipe-hub-*.md` follow them.

- **No API version bump.** `CooklangPluginApi.VERSION` is the integer `1` and shopping-list disables itself on any other value. It stays `1`; recipe-hub detects `cooklang.api.saveDraft` / `cooklang.api.openPreview` via `commands.getCommands(true)`.
- **`cooklang.api.saveDraft` lives in a `CooklangImportApi` namespace** in `cooklang-import` (which does not depend on `@theia/cooklang`).
- **New `cooklang.api.openPreview({ uri })`.** No preview-opening command existed; the preview open handler stays `file`-only.
- **No CSP change.** The recipe preview is not a webview; `image: https://…` already renders. Non-`file` recipes get images via a new native `recipeImagesFromContent`.
- **§3.5 decided:** shopping-list's preview-toolbar entry gets `when: cooklangPreviewScheme == file` (0.1.2) — it resolves recipes by workspace path.
- **Federation:** invalid `q` returned 500 (now 400); full rebuild is `rm -rf <INDEX_PATH> && federation backfill-locales --force`; the crawler never indexed feed recipes (fixed); `indexed_at` is never set so `sort=newest` uses `created_at`; the rate limiter was one global bucket with an inverted rate (fixed).
- **Known gap:** the GitHub indexer does not record servings / time / difficulty, so those filters match only feed recipes that carry the metadata.
