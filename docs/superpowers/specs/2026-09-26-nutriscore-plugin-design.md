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

1. Editor: `cooklang.api.hasFeature`, `cooklang.api.nutrition`, badge outlet
   (`cooklang/recipePreview/badge` + rendering).
2. `cooklang.nutriscore` plugin in `../plugins/nutriscore`; publish 0.1.0 to
   plugins.cook.md.
3. cook.md backend: add `nutrition` to `features[]` of `/api/subscription` for
   Basic and Pro plans.

---

## 1. Editor

### 1.1 `cooklang.api.hasFeature(name: string): Promise<boolean>`

Registered in `cooklang-plugin-api-contribution.ts`. Delegates to
`SubscriptionFrontendService.hasFeature(name)`. Returns `false` when logged
out or when the subscription fetch failed.

No change event is exposed to plugins: on login, logout or plan change the
editor re-invokes all badge providers (1.3), which re-check the feature.

### 1.2 `cooklang.api.nutrition(args): Promise<NutritionResult>`

```ts
interface NutritionArgs { uri: string; scale?: number; categories?: string[] }
interface NutritionResult {
    ok: true;
    aggregate: AggregateResponse;          // verbatim from nutrition service
    categoryMassG?: number;               // grams of ingredients in any requested category
} | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'parse' | 'server'; message: string }
```

- Reads the recipe text (open editor model first, else `FileService`), and
  renders a fixed internal Jinja template through the existing
  `languageService.renderReport` with `ReportConfigService.buildConfigJson`
  (same token, `cooklang.nutrition.serviceUrl` and scale as reports). The
  template calls `aggregate_nutrition(ingredients)` and, per matched item and
  requested slug, `is_in_category(item.ingredient, slug)`, and prints
  `to_json({ aggregate, categoryIngredients })`. `categoryMassG` is summed in
  TS from `aggregate.items[].amount.mass_g`.
- Native change is only a generic `to_json(value)` template function
  (a `ConfigExtension` always registered in `render_report`), because the
  report engine has no `tojson` filter.
- The token never crosses into the plugin host.
- Error mapping from the render error text: `authentication required` →
  `unauthenticated`, subscription-required message / 402 / 403 → `forbidden`,
  `transport error` / `unavailable` → `network`, `server error` → `server`,
  anything else → `parse`. `category not found` → retry once without
  categories (share unknown).
- Results cached in memory keyed by `(text, scale, categories)`, 20 entries.

The plugin asks for `categories: ['fruit', 'vegetable', 'legume']`. If the
service has no such slug, the check fails for that slug only; the result
omits it and the plugin treats the share as unknown (0, disclosed).
**Verify slug names against nutrition.cook.md during implementation.**

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
interface PreviewBadge {
    kind: 'nutriscore';
    grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown';
    tooltipMarkdown: string;
}
```

- `kind` is a closed set; v1 has only `nutriscore`. The editor owns the
  visuals so they match the theme and cannot be abused to inject UI.
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

- `cooklang-plugin-api-contribution.spec.ts`: `hasFeature`, `nutrition`
  argument validation and delegation.
- `recipe-nutrition-service.spec.ts`: error mapping, category retry,
  category mass summation, cache.
- `cooklang-outlet-service.spec.ts`: badge collection drops invalid,
  `undefined` and throwing providers.
- `preview-badge.spec.tsx`: strip rendering and hover.
- Native: `to_json` renders JSON.

---

## 2. Plugin `cooklang.nutriscore` (`../plugins/nutriscore`)

Structure follows `../plugins/shopping-list` (VS Code extension, esbuild,
mocha). No webview.

### 2.1 Flow

`activate()` registers `cooklang.nutriscore.provideBadge` (contributed to
`cooklang/recipePreview/badge` in `package.json`). Requires `cooklang.apiVersion` ≥ the version that
introduces 1.1–1.3; otherwise does nothing and logs once.

`provideBadge(ctx)`:
1. `hasFeature('nutrition')` false → `undefined`.
2. `cooklang.api.nutrition({ uri, scale, categories })`; `ok: false` →
   `undefined` (network/server errors logged once per session).
3. Compute score (2.2) and tooltip (2.3); return. (Caching lives in the
   editor's nutrition command.)

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

`/api/subscription` returns `nutrition` in `features[]` for Basic and Pro
plans. Until then, `hasFeature('nutrition')` is false and no badge shows.
The nutrition service itself should enforce the same entitlement (403
otherwise), which the plugin already handles.
