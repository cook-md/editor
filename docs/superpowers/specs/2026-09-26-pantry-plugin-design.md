# Pantry plugin — design

**Date:** 2026-09-26
**Status:** Approved (brainstorming)
**Repos touched:** `editor`, `plugins`

## Goal

Give Cook Editor users a pantry panel equivalent to the cookcli web server's
pantry page (`../cookcli/templates/pantry.html`): browse `config/pantry.conf`
by section, see stock status, and add / edit / remove items without touching
TOML by hand. Beyond cookcli parity, v1 adds search and an "expiring soon"
filter.

## Non-goals

- Adding low-stock items to the shopping list. `.shopping-list` files hold
  recipe references only; free-form items need a format change in cooklang-rs,
  the editor API and the shopping-list plugin. Separate spec.
- Consumption tracking (decrementing stock when a recipe is cooked).
- Quantity arithmetic (e.g. "+500 g") in the edit form.
- Pantry files other than `config/pantry.conf` in the first workspace folder.

## Work order

Two PRs, one per repo. 2 depends on 1.

1. Editor: native `editPantry`, richer `parsePantry`, `cooklang.api.parsePantry`
   and `cooklang.api.editPantry`.
2. `cooklang.pantry` plugin in `../plugins/pantry`; publish 0.1.0 to
   plugins.cook.md; ship by default via `theiaPlugins` (follow-up editor
   commit).

---

## 1. Editor

### 1.1 Native addon (`packages/cooklang-native`)

**New dependency:** `toml_edit` 0.22 (already in the lock file via `cooklang`; the editing code is ported from cookcli-core).

**`editPantry(text: string, editJson: string): string`** (`#[napi(js_name = "editPantry")]`)

Applies one edit to the pantry TOML and returns the new file text. Implemented
with `toml_edit::DocumentMut`, modelled on
`../cookcli/crates/core/src/pantry/edit.rs`, so comments, key order and
formatting of untouched entries survive.

Edit shapes (JSON, `op` discriminated):

| op | Fields | Semantics |
|---|---|---|
| `add` | `section`, `name`, `quantity?`, `bought?`, `expire?`, `low?` | Appends item to section, creating the section at the end of the file if missing. No attributes → simple entry; otherwise inline table of the given attributes. Error if an item with the same name (case-insensitive) already exists in that section. |
| `update` | `section`, `name`, `fields: { quantity?, bought?, expire?, low? }` | A present non-empty field sets the attribute; a present empty string removes it; an absent field is left unchanged. A simple entry is promoted to an inline table when needed. An item left with no attributes is written as a simple entry. |
| `remove` | `section`, `name` | Removes the item. Removes the section if it becomes empty. |

Errors (rejected promise, message surfaced to the user): TOML that does not
parse; unknown section; unknown item (for `update`/`remove`); duplicate item
(for `add`); empty `section` or `name`. Unlike cookcli, update/remove of a
missing item is an error, not a silent success.

The "simple entry" representation must match what cooklang-rs's pantry parser
accepts; the implementation copies cookcli-core's choices rather than
inventing new ones.

**`parsePantry` output gains per-item fields:**

- `isOutOfStock: boolean` — the item has a quantity whose parsed value is 0.
  Items with no quantity are *not* out of stock (cooklang-rs treats them as
  "have it", matching shopping-list subtraction). Replaces cookcli's
  browser-side string list (`0`, `0%g`, …).
- `expireDate: string | null` — `expire` normalised to `YYYY-MM-DD`, or
  `null` if absent or unparseable.
- `boughtDate: string | null` — same for `bought`.

Date parsing accepts cookcli's formats, tried in order: `%Y-%m-%d`,
`%d.%m.%Y`, `%d/%m/%Y`, `%m/%d/%Y`, `%Y.%m.%d`, `%d-%m-%Y`. The raw strings
stay in `expire` / `bought` for display and round-tripping.

Existing consumers (`GetPantryTool`, `CheckPantryTool`, language service types)
keep working; the new fields are additive. Update the `PantryItem` type in
`cooklang-language-service.ts` and `index.d.ts`.

### 1.2 Language service (`packages/cooklang`)

Add `editPantry(text, editJson)` to the language-service interface and node
impl, next to `parsePantry`.

### 1.3 Plugin API (`cooklang-plugin-api-contribution.ts`)

Additive; `cooklang.api.version` stays `1`.

| Command | Args | Returns |
|---|---|---|
| `cooklang.api.parsePantry` | `{ text: string }` | `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow, isOutOfStock, expireDate, boughtDate }] }] }` |
| `cooklang.api.editPantry` | `{ text: string, edit: PantryEdit }` | `string` (new file text) |

Pure text in / text out, like `parseShoppingList` / `writeShoppingList`. The
plugin owns file I/O. Invalid argument shapes reject with
`Invalid arguments: …`; native errors propagate with their message.

### 1.4 Tests

- Rust: `editPantry` preserves comments and unrelated formatting; add to new
  and existing section; duplicate add errors; update sets / clears fields;
  clearing the last attribute yields a simple entry; remove last item drops
  section; unknown section/item errors. Date normalisation for each format and
  for garbage input. `isOutOfStock` for `0%g`, `0`, `500%g`, no quantity.
- TS: `cooklang-plugin-api-contribution.spec.ts` cases for both new commands
  (valid args delegate; invalid args reject).

---

## 2. Plugin (`../plugins/pantry`, id `cooklang.pantry`)

### 2.1 Package

Mirrors `../plugins/shopping-list`: `engines.vscode ^1.100.0`,
`activationEvents: ["onStartupFinished"]`, no runtime dependencies, esbuild
bundle for the webview, mocha specs, `scripts/deploy.js`, `vsce` / `ovsx`
publish scripts.

Contributes:

- `viewsContainers.right`: `{ id: "pantry", title: "Pantry", icon: "media/pantry.svg" }`.
- `views.pantry`: one webview view `pantry.view`.
- Commands: `pantry.show`, `pantry.addItem` (reveals the view and opens the
  add form), `pantry.openFile` (opens `config/pantry.conf` in the text editor).
  `pantry.addItem` and `pantry.openFile` also appear in the view's title bar.

### 2.2 Source layout

| File | Responsibility |
|---|---|
| `src/extension.ts` | Activation; constructs controller. |
| `src/pantry-controller.ts` | `WebviewViewProvider`: HTML + CSP nonce, message routing, file watcher, command registration, confirmation modals. |
| `src/pantry-store.ts` | Loads/saves `config/pantry.conf` via an injected file interface; serialises edits through a promise queue; exposes current state + change event. |
| `src/cooklang-api.ts` | Typed wrapper over `executeCommand` (no `vscode` import); checks API version and that the pantry commands exist. |
| `src/view-model.ts` | Pure functions: status per item, search, filters, expiry maths (`daysUntil(expireDate, today)`), section counts. |
| `src/protocol.ts` | Webview ↔ extension message types. |
| `src/webview/main.ts` | Plain-DOM rendering, no framework. |
| `media/pantry.css` | Styles; colours only from `--vscode-*` variables. |

### 2.3 Data flow

1. Store reads `config/pantry.conf` (first workspace folder) with
   `workspace.fs`, calls `cooklang.api.parsePantry`, publishes state:
   `noWorkspace | noFile | parseError(message) | loaded(sections)`.
2. Controller posts state to the webview; webview holds UI-only state
   (search text, active filter, expanded sections, open edit form).
3. An edit from the webview → controller → store queue: re-read file text,
   `cooklang.api.editPantry`, `workspace.fs.writeFile`, re-parse, publish.
4. A `FileSystemWatcher` on `config/pantry.conf` triggers a debounced reload,
   so manual edits and cookbot changes appear live. (The shopping-list plugin
   already reloads on the same file.)

Because every edit re-reads the file and addresses items by section + name, an
external change between render and edit is merged naturally. If the target
item has vanished, the native error ("item 'x' not found in section 'y'") is
shown in the banner and the view reloads.

### 2.4 UI

- **Toolbar:** search box (filters by item name, case-insensitive); filter
  chips *All · Low · Out of stock · Expiring (≤ 7 days, includes expired)*;
  *Add* button.
- **Sections:** collapsible, header shows name and item count (filtered /
  total). Sections with no matching items are hidden while a search or filter
  is active.
- **Item row:** status dot (ok / low / out / expired-or-expiring, worst wins),
  name, quantity (`500%g` displayed as `500 g`), expiry badge ("in 3 d",
  "today", "expired 2 d ago") when `expireDate` is set.
- **Edit:** clicking a row expands an inline form: quantity, low, bought,
  expire (`<input type="date">`, prefilled from the normalised date; written
  back as ISO), *Save* / *Cancel* / *Delete*. Enter saves, Escape cancels.
  Only changed fields are sent; a field emptied by the user is sent as `""`
  (clears it). Quantity inputs accept `500 g` and are written as `500%g`.
- **Add form:** section combo (existing sections, or fridge/pantry/freezer
  when there are none; free text creates a new one), name, quantity, low,
  bought, expire. Items in `general` (above the first header) can only hold a
  quantity; the editor rejects other attributes there with a clear message.
- **Delete:** confirmation via `vscode.window.showWarningMessage(..., { modal: true })`
  from the extension side — never a webview `confirm()`.
- **Empty / error states:**
  - No workspace: "Open a folder to use the pantry."
  - No `pantry.conf`: explanation + *Create pantry* button, which writes a
    comment-only starter file explaining the format (the parser drops empty
    sections, so there is no point writing them).
  - Parse error: the message + *Open file* button.
- **Errors from edits** show in a dismissible banner in the view.

### 2.5 Tests

- `view-model.spec.ts`: status precedence, search, each filter, `daysUntil`
  around today / past / missing, quantity display/input conversion.
- `pantry-store.spec.ts` (fake file interface + fake API): load states; edit
  queue ordering; missing-file create; vanished-item error path.
- `cooklang-api.spec.ts`: argument shapes, missing-command detection.
- Manual E2E in the running editor: add, edit (incl. clearing a field),
  delete, external edit reload, comment preservation in the file.

### 2.6 Shipping

1. Publish `cooklang.pantry` 0.1.0 to plugins.cook.md.
2. Editor: add `"cooklang.pantry": "https://plugins.cook.md/api/cooklang/pantry/0.1.0/file/cooklang.pantry-0.1.0.vsix"`
   to `theiaPlugins` in the root `package.json`.
3. Plugin `README.md`; add pantry to `../plugins/README.md`. The user guide
   page (cook.md/help/plugins/pantry) lives in the cook.md site repo and is
   out of scope for these plans.

The plugin requires an editor with the new API commands. `cooklang-api.ts`
detects their absence and the view shows "This version of Cook Editor does not
support the pantry plugin — please update."
