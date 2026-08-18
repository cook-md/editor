# CookBot tools: workspace search, pantry, shopping list, catalog

**Date:** 2026-08-18
**Issues:** cook-md/editor#82 (CookCLI operations as tools), cook-md/cook-md#293
(catalog search — server side is specced in
`cook.md/docs/superpowers/specs/2026-08-18-cookbot-catalog-search-design.md`)
**Packages:** `packages/cooklang-native`, `packages/cooklang`, `packages/cooklang-ai`

## Problem

CookBot re-reads and re-derives from files every turn: to answer "do I have
eggs?" it opens `config/pantry.conf`; to find "that salmon recipe" it globs and
reads `.cook` files; to build a shopping list it re-parses recipes in chat.
The equivalent deterministic operations already exist in the editor (or in the
Rust crates the editor bundles) but are not exposed as tools. And there is no
way for CookBot to reach the curated cook.md recipe catalog at all.

## Decisions (from brainstorming)

- Round 1 ships four workspace tools — `searchRecipes`, `getPantry`,
  `checkPantry`, `generateShoppingList` — and two catalog tools —
  `searchRecipeCatalog`, `addCatalogRecipe`.
- Workspace search is the real CLI operation: `cooklang_find::search`, the
  function behind `cook search`, exposed through the native addon. No
  persistent recipe index in v1.
- Catalog adds are **staged** through the changeset (same review/apply UX as
  `suggestFileContent`); the recipe body never round-trips through the model.
- Tools live next to the services they drive (`renderTemplate` precedent):
  workspace tools in `packages/cooklang`, catalog tools in
  `packages/cooklang-ai`. Registration is one `bindToolProvider` each; the
  cookbot agent already sends every registered `ToolProvider`.
- No integrated terminal (#82 part 2) — separate issue.

## 1. Native addon (`packages/cooklang-native`) + language service RPC

Three new `#[napi]` exports, each returning a JSON string, and three matching
methods on `CooklangLanguageService` (`common/cooklang-language-service.ts`,
implemented in `node/cooklang-language-service-impl.ts`):

| NAPI | RPC | Behaviour |
|---|---|---|
| `search_recipes(base_dir, query)` | `searchRecipes(baseDir, query): Promise<string>` | Non-blank query → `cooklang_find::search(base_dir, query)` (filename + content term scoring, `.cook` and `.menu`). Blank query → `cooklang_find::build_tree(base_dir).all_recipes()` (unscored, path order). Output `[{ "path": "<abs>", "name", "title", "tags": [], "isMenu", "servings": null|number }]`. Errors → `napi::Error`. |
| `parse_pantry(text)` | `parsePantry(text): Promise<string>` | `cooklang::pantry::parse_lenient(text).into_output()`. Output `{ "sections": [{ "name", "items": [{ "name", "quantity", "bought", "expire", "low", "isLow" }] }] }` (`null` for absent attributes; `isLow` from `PantryItem::is_low`). Unparseable → `napi::Error` with the diagnostic. |
| `check_pantry(text, names)` | `checkPantry(text, names: string[]): Promise<string>` | Parses as above, then `PantryConf::find_ingredient(name)` per name (case-insensitive index). Output `[{ "name", "inStock", "section": null|string, "quantity": null|string, "isLow": bool }]`. |

`cooklang-find` is pinned at `0.5.8`; if `search`/`build_tree` are missing
there, bump to `0.6.1` (already in the local registry). Rust unit tests cover
each export's JSON shape.

## 2. `packages/cooklang` — workspace tools

All four are `@injectable() … implements ToolProvider` classes in
`src/browser/`, registered with `bindToolProvider` in
`cooklang-frontend-module.ts` next to `RenderTemplateTool`. Each handler parses
its arg string, returns a JSON string, and returns `{ error }` (never throws)
on bad input or a missing workspace. Read-only tools auto-execute;
`generateShoppingList` with `addToList: true` mutates the shopping list and
gets `confirmAlwaysAllow` unset (default confirmation behaviour, same as
`suggestFileContent`).

### 2.1 `searchRecipes`

```json
{ "query": "string, optional — words matched against file names and contents (cook search)",
  "tag": "string, optional — keep only recipes whose tags include it (case-insensitive)",
  "limit": "integer, optional, default 20, max 100" }
```

Uses the first workspace root as `baseDir`, calls
`languageService.searchRecipes`, filters by `tag`, truncates to `limit`, and
returns:

```json
{ "recipes": [{ "path": "Dinner/Carbonara.cook", "name": "Carbonara", "title": "Spaghetti Carbonara",
                "tags": ["pasta"], "isMenu": false, "servings": 4 }],
  "total": 37 }
```

`path` is workspace-relative (fallback: absolute). Neither `query` nor `tag`
→ every recipe (still limited). No workspace → `{ error }`.
Description tells the model: prefer this over `findFilesByPattern` +
`getFileContent` for "which recipes…" questions; results are file paths it can
pass to `getFileContent`, `renderTemplate` or `generateShoppingList`.

### 2.2 `getPantry`

No arguments. Reads `config/pantry.conf` under the first workspace root via
`FileService`; returns the `parsePantry` output plus
`{ "path": "config/pantry.conf" }`. Missing file →
`{ "pantry": null, "message": "No config/pantry.conf in this workspace" }`
(not an error — a valid answer). Parse failure → `{ error }`.

### 2.3 `checkPantry`

```json
{ "ingredients": ["eggs", "olive oil"] }   // required, 1..100 names
```

Reads the same file, calls `checkPantry(text, names)`, returns
`{ "results": [...] }`. Missing pantry file → every entry `inStock: false`
plus `"message": "No config/pantry.conf …"`.

### 2.4 `generateShoppingList`

```json
{ "recipes": [{ "path": "Dinner/Carbonara.cook", "scale": 2 }],   // one of recipes / menu
  "menu": "Plans/This Week.menu",
  "addToList": false }
```

Exactly one of `recipes` / `menu`. Paths are workspace-relative (or absolute /
`file://`, resolved with `ReportConfigService.resolveWorkspaceUri`).

Headless path (default): resolve sub-recipe references (see refactor below),
compute the list, return the `ShoppingListResult`:

```json
{ "categories": [{ "name": "produce", "items": [{ "name": "garlic", "quantities": "3 cloves" }] }],
  "other": { "name": "other", "items": [] },
  "pantryItems": ["salt"],
  "recipes": [{ "path": "Dinner/Carbonara.cook", "scale": 2 }] }
```

`addToList: true`: additionally `ShoppingListService.addRecipe(path, scale,
includedRefs)` per recipe or `addMenu(menuPath, 1, recipes)`, then open the
Shopping List view (`cooklang.openShoppingList` command / `openView`), and
return the *whole* current list result (what the user now sees). Recipe not
found → `{ error: "Recipe not found: <path>" }` before anything is added.

**Refactor (pure moves, existing specs unchanged):**

- `ShoppingListContribution.collectResolvedRefs` / `resolveReferenceScale`
  move to a new injectable `RecipeReferenceResolver`
  (`src/browser/recipe-reference-resolver.ts`) with
  `resolve(content, baseDir): Promise<Array<{ path, scale }>>`. The
  contribution injects it.
- `ShoppingListService.regenerate()` is split: a new public
  `computeResult(items: Array<{ path, scale }>): Promise<ShoppingListResult>`
  does find → read aisle/pantry → `generateShoppingList`; `regenerate()` calls
  it with `flattenForGeneration()` and keeps the sequence guard.

## 3. `packages/cooklang-ai` — catalog tools

### 3.1 Transport

- `proto/cookbot.proto`: byte-for-byte copy of the cookbot server proto (adds
  `SearchRecipeCatalog`, `GetCatalogRecipe`).
- `node/cookbot-grpc-client.ts`: `searchRecipeCatalog(criteriaJson):
  Promise<string>` and `getCatalogRecipe(id): Promise<CookbotCatalogRecipe>`
  (both read `this.sessionId`, like the sibling methods).
- `common/cookbot-server-tools-protocol.ts`: `CookbotServerToolsService` gains
  `searchRecipeCatalog(criteria: object): Promise<unknown>` (parsed JSON) and
  `getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe>` where
  `CookbotCatalogRecipe = { id, title, mealType, course, content, suggestedPath }`.
  `node/cookbot-server-tools-service.ts` forwards to the gRPC client. gRPC
  status → thrown `Error` with the status message (as the existing four do).

### 3.2 `searchRecipeCatalog` (new file `catalog-recipe-tools.ts`, cooklang-ai)

Parameters (JSON Schema, enums inlined so the model sees the vocabulary):

| name | type | values |
|---|---|---|
| `dietary` | string[] | vegetarian, vegan, pescatarian, flexitarian, keto, paleo, gluten-free, dairy-free, halal, kosher, low-fodmap |
| `exclude_allergens` | string[] | tree-nuts, peanuts, shellfish, fish, eggs, soy, sesame (no `gluten` — Rails drops it; use `dietary: gluten-free`) |
| `dislikes` | string[] | free strings from the wizard list (documented, not enum-enforced) |
| `cuisines` | string[] | american, italian, french, spanish, greek, british, german, eastern_european, chinese, japanese, thai, indian, korean, vietnamese, mexican, middle-eastern, caribbean, african, mediterranean, fusion |
| `equipment` | string[] | instant-pot, slow-cooker, air-fryer, rice-cooker, stand-mixer, food-processor, blender, grill, sous-vide, bread-maker, pasta-maker, smoker, wok, cast-iron, dutch-oven |
| `max_skill_level` | integer 1–4 | |
| `meal_types` | string[] | breakfast, lunch, dinner, dessert, snack |
| `course` | string | main (default), side, drink, sauce, accompaniment, any |
| `cooking_methods` | string[] | one-pot, sheet-pan, no-cook, batch-cooking, slow-cooker, stir-fry, casseroles, soups-stews |
| `dish_categories` | string[] | pasta_noodles, soup_stew, salad, pizza_flatbread, meat_main, seafood, rice_grain_bowl, taco_burrito, sandwich_burger, casserole_bake, bread, baked_sweet, eggs, smoothie_drink, sauce_dip |
| `nutritional_focus` | string[] | high-protein, low-carb, whole-grains, anti-inflammatory, heart-healthy, gut-health, energy-boosting, pregnancy-safe, lower-sugar, lower-sodium, lower-glycemic, high-fiber |
| `max_cook_time_minutes` | integer | |
| `query` | string | title/dish keywords |
| `limit` | integer 1–20, default 5 | |
| `exclude_ids` | string[] | ids already shown |

No required fields. Handler forwards the parsed args as the criteria object and
returns the server JSON (`{ recipes, hint }`) verbatim; failures →
`{ error }`.

### 3.3 `addCatalogRecipe` (same file, `catalog-recipe-tools.ts`)

```json
{ "id": "string, required — id from searchRecipeCatalog",
  "path": "string, optional — workspace-relative target; default is the catalog's suggested path" }
```

Flow: `getCatalogRecipe(id)` → `path ?? suggestedPath` →
`WorkspaceFunctionScope.resolveRelativePath` (rejects paths outside the
workspace) → `ctx.request.session.changeSet.addElements(fileChangeFactory({
uri, type: exists ? 'modify' : 'add', state: 'pending', targetState: content,
requestId, chatSessionId }))` + `setTitle` via `FileChangeSetTitleProvider` —
identical to `SuggestFileContent`. Returns
`{ "proposedPath": "Dinner/Spaghetti Carbonara.cook", "title": "…", "message":
"Proposed adding … — the user will review and apply." }`. Missing/invalid id
→ `{ error }` from the server message; no chat context → `{ error }`.
`getArgumentsShortLabel` shows the path.

## 4. Prompts (server side, for reference)

`cook.md/cookbot/crates/server/prompts/core.txt` gains a `# Finding recipes`
section and a `recipe-discovery` skill; a `workspace-tools` note is added to
`core.txt` too: prefer `searchRecipes` / `getPantry` / `checkPantry` /
`generateShoppingList` over re-reading files for those questions. Specced in
the cook.md design doc.

## Tests

- Rust (`cooklang-native`): unit tests for `search_recipes` (query and blank
  query on a temp dir), `parse_pantry` (attributes + `isLow`), `check_pantry`
  (hit, miss, case-insensitivity).
- `packages/cooklang` mocha specs (fake collaborators assigned onto the
  instance, like `list-report-templates-tool.spec.ts`):
  `search-recipes-tool.spec.ts` (relative paths, tag filter, limit/total, no
  workspace), `pantry-tools.spec.ts` (`getPantry` shape, missing file message,
  `checkPantry` results), `generate-shopping-list-tool.spec.ts` (recipes vs
  menu, exactly-one rule, not-found error, `addToList` calls the service and
  opens the view), `recipe-reference-resolver.spec.ts` (moved logic),
  `shopping-list-service.spec.ts` (`computeResult` extracted; existing cases
  pass).
- `packages/cooklang-ai`: `catalog-recipe-tools.spec.ts` (`searchRecipeCatalog`
  forwards args and returns JSON; `addCatalogRecipe` stages with the default
  path, honours `path`, error on unknown id); gRPC client method mapping is
  covered by a small unit test on the request shape.
- Commands: `npx lerna run compile --scope @theia/cooklang --scope
  @theia/cooklang-ai`, `npx lerna run test --scope @theia/cooklang --scope
  @theia/cooklang-ai`, `npm run lint`, `cd packages/cooklang-native && npm run
  build && cargo test`.
- Manual (editor + local cookbot + Rails): "what's in my pantry", "do I have
  eggs and butter", "shopping list for Plans/This Week.menu", "which of my
  recipes use salmon", "find me a few quick vegetarian dinners" → "add the
  second one" (staged at `Dinner/<Title>.cook`, Accept writes it).

## Out of scope

- A persistent recipe index / metadata cache.
- Editing the pantry (`updatePantry`) — read-only in v1.
- The integrated terminal (#82 part 2).
- Sync-server-side "add to workspace".
