# Nutri-Score plugin — design

**Date:** 2026-09-26
**Status:** Approved (brainstorming)
**Repos touched:** `editor`, `plugins`, cook.md backend (one config change)

## Goal

An optional plugin that shows a Nutri-Score badge (A–E) in the recipe preview
header, computed from the cook.md nutrition API. Hovering the badge shows how
trustworthy the score is: ingredient match rate, per-ingredient confidence,
data sources, unmatched/estimated ingredients and the estimated
fruit/vegetable/legume share. Available only to users whose plan includes the
nutrition API (Basic and Pro).

The editor side is deliberately general: plugins render their own report
templates (`cooklang.api.renderReport`) and return badges (Nutri-Score strip
or a generic pill), so later plugins — calories, cost, allergens — need no
editor changes.

## Non-goals

- Menus. A Nutri-Score for a whole menu is not meaningful and per-recipe
  badges in the menu preview need another outlet. Recipes only for v1.
- Beverages, cheese, fats/oils/nuts categories of the Nutri-Score algorithm.
  v1 always uses the general-foods table.
- Bundling the plugin by default. It is installed from the Extensions view
  (plugins.cook.md), like recipe-hub.
- Any client-side knowledge of plan names. Gating is by feature flag only.

## Work order

Three pieces. 2 depends on 1; 3 is independent but needed for anyone to see
the badge.

1. Editor: cooklang-reports 0.5.2 (`tojson` filter), `cooklang.api.hasFeature`,
   `cooklang.api.renderReport`, badge outlet (`cooklang/recipePreview/badge`
   + rendering of `nutriscore` and `pill` badges).
2. `cooklang.nutriscore` plugin in `../plugins/nutriscore`; publish 0.1.0 to
   plugins.cook.md.
3. cook.md backend: nothing to do — `/api/subscription` already returns the
   `nutrition_api` feature for Cook Basic and Pro (cook.md web ≥ 0.23.40), and
   the nutrition service enforces the same feature (cook-md/db cda5007).

---

## 1. Editor

### 1.1 `cooklang.api.hasFeature(name: string): Promise<boolean>`

Registered in `cooklang-plugin-api-contribution.ts`. Delegates to
`SubscriptionFrontendService.hasFeature(name)`. Returns `false` when logged
out or when the subscription fetch failed.

No change event is exposed to plugins: on login, logout or plan change the
editor re-invokes all badge providers (1.3), which re-check the feature.

### 1.2 `cooklang.api.renderReport(args): Promise<PluginReportResult>`

A general way for plugins to use the Reports engine. The editor knows nothing
about nutrition: the plugin ships its own Jinja template, and the editor
renders it against a recipe or menu exactly as it renders a report.

```ts
interface RenderReportArgs { uri: string; template: string; scale?: number }
type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };
```

- `uri`: absolute URI of a `.cook` or `.menu` file, any scheme. The text is
  the open editor model if there is one (unsaved edits count), else the file.
- `template`: Jinja source, at most 64 K characters. It has every function a report
  template has (`aggregate_nutrition`, `is_in_category`, `db`, pantry,
  aisle, …) including the `tojson` filter for returning structured data.
- Rendering goes through the existing `languageService.renderReport` with
  `ReportConfigService.buildConfigJson(scale, uri)`: same login token,
  `cooklang.nutrition.serviceUrl`, pantry, aisle, datastore and menu
  expansion as the Reports feature. The token never crosses into the plugin
  host.
- Quota: templates call the nutrition service with the signed-in user's
  token, so any installed plugin can make authenticated nutrition-service
  calls on the user's behalf (counting against their quota) without ever
  seeing the token.
- Rendering runs off the backend's main thread: the backend calls the
  addon's `renderReportAsync`, which renders on the libuv threadpool (the
  nutrition client uses `reqwest::blocking`, fine on a plain worker thread),
  so badge refreshes never stall the Node event loop. The sync
  `renderReport` export stays for compatibility. The addon keeps one
  process-wide nutrition client, built with `.cached()` and keyed by
  (service URL, token): category membership and per-ingredient lookups are
  memoised for the process lifetime and dropped when the URL or token
  changes. Measured on a 16-ingredient recipe with the Nutri-Score
  template: the first render takes ~2 s (the event loop keeps ticking
  throughout), a repeat render ~0.1 s.
- No nutrition-specific native code. The only library change is upstream:
  cooklang-reports 0.5.2 enables minijinja's built-in `tojson` filter (it
  escapes `<`, `>`, `&`, `'`, so it is safe in HTML reports too), available
  to user report templates as well.
- Error mapping from the render error text: `authentication required` →
  `unauthenticated`; subscription-required / 402 / 403 → `forbidden`;
  `transport error` / `unavailable` → `network`; `server error` → `server`;
  anything else (syntax errors, unknown functions, `category not found`) →
  `template`, with the first line of the engine's message.
- Known pre-existing gap (not introduced here): a template can pass a
  crafted recipe reference to `get_ingredient_list`, and `cooklang-find`
  joins it to the base path without a containment check, so templates can
  read `.cook` files outside the workspace. Same exposure already exists via
  the AI `renderTemplate` tool, and plugins can read any file through
  `vscode.workspace.fs`, so `renderReport` adds no new capability. Fix
  belongs upstream in `cooklang-find` (tracked separately).
- Successful results are cached in memory keyed by
  `(uri, text, template, scale)`, 20 entries, so repeated badge refreshes
  for unchanged recipes cost nothing.

### 1.3 Badge outlet

New outlet: `CooklangOutlets.RECIPE_PREVIEW_BADGE`
(`cooklang/recipePreview/badge`). Plugins cannot render into the preview, so
badges are data-driven. A plugin contributes a command to the outlet in its
manifest, like the toolbar outlets (`when` clauses apply):

```json
"menus": { "cooklang/recipePreview/badge": [{ "command": "cooklang.nutriscore.provideBadge" }] }
```

The editor executes each visible command with the `PreviewOutletContext` and
expects a `PreviewBadge` (or `undefined`) back:

```ts
type PreviewBadge =
    | { kind: 'nutriscore'; grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown'; tooltipMarkdown: string }
    | { kind: 'pill'; text: string; tone: 'neutral' | 'good' | 'warning' | 'bad'; tooltipMarkdown: string };
```

- `kind` is a closed set, extended additively. The editor owns the visuals
  so they match the theme and cannot be abused to inject UI. `pill`: short
  text (≤ 24 chars, no control characters) with a border and text tinted by
  `tone` (`charts.green/yellow/red`, neutral uses `badge.background`).
- Rendering (`recipe-preview-components.tsx`): right side of the preview
  header. Official-style Nutri-Score strip: five letter cells A–E in the
  standard palette, the selected cell enlarged with a rounded outline;
  `unknown` renders the strip greyed with a "?" in place of the grade.
  Colors registered through `ColorContribution`
  (`cooklang.nutriscoreA` … `E`), not hard-coded in CSS.
- The strip itself shows no text besides letters. All detail is in the hover
  card only: rendered with `MarkdownRenderer` from `tooltipMarkdown`
  (sanitized; `command:` links disabled — see
  feedback on notification markdown injection), shown via Theia's
  `HoverService` on mouse enter / keyboard focus. The badge is focusable and
  has an `aria-label` of "Nutri-Score {grade}".
- The editor invokes the provider when the preview opens, when the recipe
  content or scale changes (debounced 500 ms), and when the subscription
  state changes. A provider returning `undefined` or throwing hides the badge.
  Stale responses (older than the latest request) are dropped.
- One badge per contributed command, in outlet order.

### 1.4 Tests (editor)

- `cooklang-plugin-api-contribution.spec.ts`: `hasFeature`, `renderReport`
  argument validation and delegation.
- `plugin-report-service.spec.ts`: editor text vs file, error mapping,
  cache.
- `cooklang-outlet-service.spec.ts`: badge collection drops invalid,
  `undefined` and throwing providers.
- `preview-badge.spec.tsx`: strip and pill rendering, hover.
- Native: a report template can return JSON via `tojson`.

---

## 2. Plugin `cooklang.nutriscore` (`../plugins/nutriscore`)

Structure follows `../plugins/shopping-list` (VS Code extension, esbuild,
mocha). No webview.

### 2.1 Flow

`activate()` registers `cooklang.nutriscore.provideBadge` (contributed to
`cooklang/recipePreview/badge` in `package.json`). Requires `cooklang.apiVersion` ≥ the version that
introduces 1.1–1.3; otherwise does nothing and logs once.

`provideBadge(ctx)`:
1. `hasFeature('nutrition_api')` false → `undefined`.
2. `cooklang.api.renderReport({ uri, scale, template })` with the plugin's
   nutrition template (`aggregate_nutrition`, `is_in_category` for the
   fruit/vegetable/legume slugs, `| tojson`). If it fails with `template` /
   `category not found`, render again without categories (share unknown).
   Other failures → `undefined`, each reason logged once per session.
3. Parse the output (aggregate + category ingredients → `categoryMassG`),
   compute score (2.2) and tooltip (2.3); return. (Caching lives in the
   editor's `renderReport`.)

### 2.2 Scoring (`nutriscore.ts`, pure)

2023 Nutri-Score algorithm, general foods table.

- Per-100 g values from `totals` divided by `totals.mass_g / 100`.
  Salt = `sodium_mg × 2.5 / 1000`.
- Negative points: energy (kJ = kcal × 4.184), sugars, saturated fat, salt.
- Positive points: protein, fibre, fruit/veg/legume % =
  `categoryMassG / totals.mass_g × 100`.
- Protein counts only when negative points < 11 (2023 rule; the 2017
  fruit/veg exception is gone).
- Grade thresholds: A ≤ 0, B 1–2, C 3–10, D 11–18, E ≥ 19.
- `grade = 'unknown'` if `totals.mass_g` is 0/missing, or more than 30 % of
  the ingredients are unmatched (by count: the service reports no mass for
  unmatched ingredients).

### 2.3 Trust summary (hover markdown)

```
**Nutri-Score B** · 1 point (neg 7, pos 6)
Confidence: **High** (mass-weighted)
Matched: 9 of 10 ingredients
Not matched: pinch of salt
Estimated: vanilla extract (partial)
Sources: USDA (8), OFF (1)
Fruit/veg/legumes: ~35 % (estimated from categories)

_Estimate from recipe ingredients, not a certified label._
```

- Confidence rollup: `confirmed` = 1, `partial` = 0.6, `estimated` = 0.3,
  weighted by `mass_g`; ≥ 0.8 High, ≥ 0.5 Medium, else Low.
- For `unknown`, the first line explains why ("Only 6 of 10 ingredients
  could be matched").
- Ingredient names are escaped for markdown.

### 2.4 Tests (plugin)

- `nutriscore.spec.ts`: reference cases from the published 2023
  specification tables; boundary grades; protein cap; salt from sodium.
- `trust.spec.ts`: confidence rollup, unknown-grade threshold, markdown
  escaping.
- `provider.spec.ts`: feature off → undefined; API error → undefined.

### 2.5 Release

Publish `cooklang.nutriscore` 0.1.0 to plugins.cook.md via `ovsx`. Not added
to the editor's `theiaPlugins`.

---

## 3. Backend

Already in place: `/api/subscription` returns `nutrition_api` in
`features[]` for Cook Basic and Pro (not grandfathered free-sync accounts),
and the nutrition service rejects tokens without it (403
`subscription_required`).

Open data-quality issue affecting scores: cook-md/db#54 (plain names match
dried/powdered records; missing sugars reported as 0 with `confirmed`
confidence).