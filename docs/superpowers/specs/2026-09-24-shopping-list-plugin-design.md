# Shopping list as a default plugin, plugin outlets, and plugin help

Date: 2026-09-24

## Problem

We want to showcase Cook Editor plugins and ship a few first-party ones. Today
the only plugin (`cooklang.meal-journal` in `cook-md/plugins`) is a plain VS
Code extension with no access to Cooklang functionality: there is no public
Cooklang API for plugins and no place in the Cooklang UI (recipe/menu previews,
reports) where a plugin can add buttons.

The shopping list is a good first extraction: it is self-contained, user-visible,
and exercises everything a serious plugin needs (native aggregation, file
formats, a side view, buttons in the previews, explorer/editor integration).

## Goals

- The shopping list becomes the VS Code extension `cooklang.shopping-list`,
  built and published exactly the way a third-party author would, and shipped
  as a default plugin.
- All current shopping-list functionality is kept: add recipe (with sub-recipe
  references), add menu, per-entry scale, remove, clear all, check/uncheck
  items, aisle grouping (`config/aisle.conf`), pantry subtraction
  (`config/pantry.conf`), live reload on external file changes, cart buttons in
  the recipe and menu previews, explorer context menu, editor-title button,
  Cookbot `generateShoppingList` tool (headless and `addToList`).
- Existing `.shopping-list` / `.shopping-checked` files keep working unchanged.
- The editor gains a small, versioned public **Cooklang plugin API** (commands)
  and **outlets** (menu contribution points) in the Cooklang UI that any plugin
  can use.
- Plugin users and authors get documentation in a new `/help/plugins` section
  on cook.md.

## Non-goals

- Changes to `@theia/plugin-ext` (custom menu ids already work, see below).
- Cookbot tools contributed by plugins — the `generateShoppingList` tool stays
  in the editor.
- Outlets beyond the five listed here.
- Changes to the `.shopping-list` format or the Rust aggregation.

## Key facts this design relies on

- `MenusContributionPointHandler.handle()` in
  `packages/plugin-ext/src/main/browser/menus/menus-contribution-handler.ts`
  maps any `contributes.menus` key that is not a known VS Code contribution
  point to the Theia menu path `[key]`. `PluginMenuCommandAdapter` uses the
  identity argument adapter for such paths, so arguments passed by the editor
  reach the plugin command unchanged (they must be JSON-serialisable).
- Default plugins are downloaded at build time from the root `package.json`
  `theiaPlugins` map into `plugins/`, then copied into `app/plugins`.
- Plugins publish to the OpenVSX-compatible registry at `plugins.cook.md`
  (namespace `cooklang`).
- VS Code extensions cannot place a view container on the right; the shopping
  list moves from the right panel to its own activity-bar container on the left
  (users can drag it back).

## Part 1 — Editor: Cooklang plugin API

New `CooklangPluginApiContribution` (`packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`),
a `CommandContribution` registering these commands. All arguments and results
are plain JSON; paths are workspace-relative strings (absolute `file://` URIs
inside the workspace are also accepted and normalised).

| Command | Arguments | Result |
|---|---|---|
| `cooklang.api.version` | — | `1` |
| `cooklang.api.generateShoppingList` | `{ recipes: Array<{ path: string; scale?: number }> }` | `ShoppingListResult` (categories in aisle order, `other`, `pantryItems`) |
| `cooklang.api.resolveRecipeReferences` | `{ path: string }` | `Array<{ path: string; scale: number }>` — `@recipe` references in a `.cook`/`.menu`, with `%servings` / yield units resolved |
| `cooklang.api.parseShoppingList` | `{ text: string }` | wire JSON of the `.shopping-list` |
| `cooklang.api.writeShoppingList` | `{ list: <wire JSON> }` | `.shopping-list` text |

Commands have no label, so they do not appear in the command palette.

Errors: commands reject with an `Error` whose message is user-presentable
(`No workspace is open.`, `Recipe not found: <path>`, `Path is outside the
workspace: <path>`, `Invalid arguments: …`). As today, recipes missing during
generation are skipped with a console warning rather than failing the list.

Refactor: `ShoppingListService.computeResult()` moves into a new injectable
`ShoppingListGenerator` (`shopping-list-generator.ts`): resolve each path with
`findRecipe`, read `config/aisle.conf` and `config/pantry.conf`, call native
`generateShoppingList`. Used by the API command and by
`GenerateShoppingListTool`. `RecipeReferenceResolver` and
`common/shopping-list-types.ts` stay in the editor (the types are the API's
result shape).

The editor sets the context key `cooklang.apiVersion` (= `1`) at startup so
plugins can use it in `when` clauses. A plugin checks compatibility on
activation by executing `cooklang.api.version`.

## Part 2 — Editor: outlets

### Contract

Each outlet is a Theia menu path exported from
`packages/cooklang/src/browser/cooklang-outlets.ts` (`CooklangOutlets`
namespace) and is public API. Every context object carries `version: 1`;
future changes only add optional fields.

| Outlet (menu path) | Rendered as | Context passed to the command |
|---|---|---|
| `cooklang/recipePreview/toolbar` | icon buttons in the recipe preview header | `{ version, uri, path, scale }` |
| `cooklang/menuPreview/toolbar` | icon buttons in the menu preview header | `{ version, uri, path, scale }` |
| `cooklang/recipePreview/ingredient/context` | right-click on an ingredient in the recipe preview | `{ version, uri, path, scale, ingredient: { name, quantity?, unit? } }` — quantity already scaled |
| `cooklang/menuPreview/recipe/context` | right-click on a recipe reference in the menu preview | `{ version, menuUri, menuPath, recipePath, scale }` — scale already resolved (menu scale × reference scale, units resolved) |
| `cooklang/report/toolbar` | icon buttons in the report view header | `{ version, templateUri, templatePath, outputKind }` |

`uri` values are `file://` URI strings; `path` values are workspace-relative.
`outputKind` is the report's output format as the report widget already
determines it (e.g. `markdown`, `yaml`).

Context keys available to `when` clauses of outlet items:
`cooklang.previewKind` (`recipe` | `menu`), `cooklang.isMarkdownRecipe`,
`cooklang.apiVersion`.

### Rendering

- `CooklangActionBar` (React component) takes an outlet path and a context
  object. It reads `MenuModelRegistry.getMenu(path)`, filters by visibility
  (`when` via the context key service, plus the command's `isVisible`), sorts
  by group then `order` (`group@order`), and renders icon buttons using the
  command's `iconClass` (plugin `$(codicon)` icons resolve to codicon classes)
  and label/tooltip. Clicking runs the command with the context object. It
  re-renders on menu registry changes and context key changes.
- Context-menu outlets use `ContextMenuRenderer.render({ menuPath, anchor,
  args: [context] })` from the ingredient / recipe-reference elements' `onContextMenu`.
  An outlet with no visible items shows no menu.
- A command that throws is logged and shown via `MessageService.error`; the
  preview is not affected.
- The built-in **Show Source** button moves onto the recipe/menu toolbar
  outlets (contributed by the editor through the same registry) so the outlet
  is exercised by first-party code.
- The hard-coded `onAddToShoppingList` props and cart buttons are removed from
  `RecipeView` and `MenuView`, along with `handleAddToShoppingList` in both
  preview widgets.

## Part 3 — Plugin `cooklang.shopping-list`

Location: `~/Cooklang/plugins/shopping-list` (repo `cook-md/plugins`),
structured like `meal-journal` (npm package, `engines.vscode ^1.100.0`,
`@types/vscode ~1.100.0`, mocha tests on pure logic, `npm run deploy` copies to
`editor/plugins/cooklang.shopping-list`). Built with esbuild (extension host
bundle + webview bundle).

### Modules

- `shopping-list-store.ts` — pure logic, no `vscode` import: list model
  (add recipe with children, add menu, remove, update scale, clear), flatten for
  generation (multipliers multiply down), checked log (append, last-write-wins,
  lowercase set), compaction of the checked log against present ingredients,
  regeneration sequencing (discard stale results). Ported from
  `ShoppingListService`.
- `command-args.ts` — normalises every invocation shape to
  `{ path, scale }`: outlet context object, `vscode.Uri` (explorer / editor
  title), or no argument (active editor).
- `extension.ts` — activation: check `cooklang.api.version`; register commands,
  the webview view provider and a `FileSystemWatcher` on `.shopping-list`,
  `.shopping-checked`, `config/aisle.conf`, `config/pantry.conf` (debounced
  reload, 100 ms). File I/O through `vscode.workspace.fs` at the first
  workspace folder; format parse/write through `cooklang.api.parseShoppingList`
  / `writeShoppingList`; aggregation through `cooklang.api.generateShoppingList`.
- `webview/` — the view UI, a plain-DOM port of `shopping-list-components.tsx`
  styled with `--vscode-*` theme variables: recipe entries with scale input and
  remove, clear all, aisle-grouped items with checkboxes, pantry note, empty /
  loading / error states. Communicates with the extension via `postMessage`.

### Contributions

- View container `shoppingList` in the activity bar (cart codicon) with webview
  view `shoppingList.view`.
- Commands: `shoppingList.toggle`, `shoppingList.addRecipe`,
  `shoppingList.addMenu`, `shoppingList.addRecipes` (programmatic; takes
  `{ recipes?: [{path, scale}], menu?: string }`, returns the current
  `ShoppingListResult`; used by Cookbot).
- Menus: `cooklang/recipePreview/toolbar` → `addRecipe`;
  `cooklang/menuPreview/toolbar` → `addMenu`; `explorer/context` → `addRecipe`
  when `resourceExtname == .cook`, `addMenu` when `resourceExtname == .menu`;
  `editor/title` → `addRecipe` when `editorLangId == cooklang`, `addMenu` when
  `resourceExtname == .menu`. `addRecipes` hidden from the palette.

### Behaviour

Adding a recipe: resolve sub-references via
`cooklang.api.resolveRecipeReferences`, store them as children, save, regenerate,
reveal the view. Adding a menu: resolve its references; a menu with no
references shows a warning and adds nothing. On an incompatible API version the
plugin shows one warning and registers nothing. Failed user actions surface via
`vscode.window.showErrorMessage`.

## Part 4 — Editor: remove the built-in shopping list

- Delete `shopping-list-service.ts` (+ spec), `shopping-list-widget.tsx`,
  `shopping-list-components.tsx`, `shopping-list-contribution.ts`,
  `style/shopping-list.css`, and their bindings in `cooklang-frontend-module.ts`.
  Keep `theia-shopping-cart-icon` only if still referenced.
- `GenerateShoppingListTool`: headless mode uses `ShoppingListGenerator`,
  unchanged output. `addToList: true` executes `shoppingList.addRecipes`; if that
  command is not registered it returns
  `{ error: "The Shopping List plugin is not installed or is disabled." }`.
- Root `package.json` `theiaPlugins` pins
  `cooklang.shopping-list` to its `0.1.0` `.vsix` on plugins.cook.md.
- `.shopping-list` / `.shopping-checked` at the workspace root keep their names
  and format.

## Part 5 — cook.md `/help/plugins`

Repo `~/Cooklang/cook.md/web`, mirroring `Help::TemplatesController`:

- `Help::PluginsController` with the `content_only` layout switch; views in
  `app/views/help/plugins/` with a `_page_navigation.html.erb` sidebar
  ("Plugins") and breadcrumbs; routes in the `namespace :help` block with
  `/help/plugins/overview` → 301 → `/help/plugins`; a "Plugins" card on the
  `/help` index after the Report Templates card.

| Route | Page | Audience |
|---|---|---|
| `/help/plugins` | Overview: what plugins are, installing/disabling from the Extensions view and plugins.cook.md, default plugins | users |
| `/help/plugins/shopping-list` | Shopping List: adding recipes/menus/sub-recipes, scale, checking off, `aisle.conf` / `pantry.conf`, the list files, moving the panel | users |
| `/help/plugins/getting-started` | Build your first plugin: VS Code extension basics, `cook-md/plugins`, meal-journal walkthrough, `npm run deploy`, reload | developers |
| `/help/plugins/api` | `cooklang.api.*` reference: args, results, errors, examples, version check | developers |
| `/help/plugins/outlets` | The five outlets, their contexts, context keys, a `contributes.menus` example per outlet, a screenshot of where each renders | developers |
| `/help/plugins/publishing` | Packaging, plugins.cook.md namespace and PAT, `publish:marketplace`, the `@types/vscode` ≤ `engines.vscode` gotcha | developers |

- Rewrite the shopping sections of `help/editor/features` and
  `help/editor/getting_started` (they currently describe a "select recipes and
  open the Shopping panel" flow that does not exist) to the real flow, linking
  to `/help/plugins/shopping-list`.
- Every command name, label, context field and path is verified against the
  finished editor and plugin code. Screenshots come from the E2E run.
- `spec/requests/help/plugins_spec.rb`: each route returns 200, the overview
  redirect, nav links present.
- The plugins repo's `docs/outlets.md` is a short pointer to
  `/help/plugins/outlets` (single source of truth).

## Testing

- Editor specs: `cooklang-plugin-api-contribution.spec.ts` (argument
  validation, path normalisation, delegation), `shopping-list-generator.spec.ts`
  (config reading, missing recipes skipped), `cooklang-action-bar.spec.ts`
  (renders items, `when` filtering, ordering, context passed, error surfaced),
  updated `generate-shopping-list-tool.spec.ts` (headless unchanged; `addToList`
  via command; missing-plugin error).
- Plugin mocha: `shopping-list-store.spec.ts` (ported from
  `shopping-list-service.spec.ts`), `command-args.spec.ts`.
- E2E over CDP in the Electron app with the plugin deployed: preview cart
  button, menu preview button, explorer context menu, editor-title button,
  scale change, check/uncheck, external edit of `.shopping-list` reloads,
  ingredient and recipe-reference context outlets show contributed items,
  disabling the plugin removes its buttons, Cookbot `addToList`.

## Sequencing

1. Editor (branch `feature/plugin-outlets`): API commands +
   `ShoppingListGenerator`, outlets + `CooklangActionBar`, Show Source on the
   outlet. Built-in shopping list still present.
2. Plugin: build against the local editor branch, E2E, publish
   `cooklang.shopping-list@0.1.0` (the user runs the `OVSX_PAT` publish).
3. Editor: remove the built-in shopping list, pin the `.vsix`, switch the
   Cookbot tool; open the PR.
4. cook.md: `/help/plugins` section and editor help fixes; merge before or
   together with the editor PR.
