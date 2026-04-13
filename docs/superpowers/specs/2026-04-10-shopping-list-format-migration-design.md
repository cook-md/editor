# Shopping List Format Migration

**Status:** Draft
**Date:** 2026-04-10
**Related:** [cooklang/cookcli#318](https://github.com/cooklang/cookcli/pull/318)

## Goal

Migrate the editor's shopping list from the legacy tab-delimited `.shopping_list.txt` format to the new `.shopping-list` format introduced in cooklang-rs 0.18.5, and add persistent checked-ingredient state via `.shopping-checked`. Full feature parity with cookcli PR #318 — excluding backward-compatibility migration, which is not required.

## Non-goals

- Migration from the legacy `.shopping_list.txt` format. Existing users will start fresh.
- File locking (`fs2`) — the editor is single-user, single-process.
- UI for editing `included_references` on existing entries.
- Treating `.shopping-list` as a first-class editable file with syntax highlighting.

## Architecture

Two files in the workspace root:

- **`.shopping-list`** — recipe references in cooklang shopping-list format. Top-level items represent single recipes or menus. Menu entries carry their constituent recipes as `children`. Each recipe entry may carry `included_references` children to selectively expand sub-recipes.
- **`.shopping-checked`** — append-only log of `+ name` / `- name` entries. Last-write-wins determines the checked set. Compacted on recipe removal to prune stale entries.

### Component boundaries

**Rust NAPI (`packages/cooklang-native`)** exposes stateless parse/serialize helpers — no direct filesystem access. Upgraded to `cooklang 0.18.5` with features `["aisle", "pantry", "shopping_list"]`.

**TypeScript `ShoppingListService` (`packages/cooklang/src/browser`)** owns all file I/O via Theia `FileService`, orchestrates Rust helpers, holds in-memory state, and fires `onDidChange`.

**Existing `generateShoppingList` RPC** stays intact. The service flattens `.shopping-list` entries into `RecipeInput[]` before calling it, applying any `included_references` and menu nesting.

Rust doing filesystem I/O directly would bypass Theia's workspace abstraction (remote workspaces, file watchers, virtual filesystems) — hence the thin-Rust / fat-TS split.

## Rust NAPI surface

Added to `packages/cooklang-native/src/lib.rs`:

```rust
#[napi] pub fn parse_shopping_list(text: String) -> Result<String>
#[napi] pub fn write_shopping_list(json: String) -> Result<String>
#[napi] pub fn parse_checked(text: String) -> Result<String>
#[napi] pub fn write_check_entry(entry_json: String) -> Result<String>
#[napi] pub fn checked_set(entries_json: String) -> Result<Vec<String>>
#[napi] pub fn compact_checked(entries_json: String, current_ingredients: Vec<String>) -> Result<String>
```

All helpers are stateless; JSON shapes mirror whatever serde tagging `cooklang::shopping_list` types use upstream — follow upstream rather than inventing. The TS side defines matching interfaces.

## TypeScript types

In `packages/cooklang/src/common/shopping-list-types.ts`:

```ts
export interface ShoppingListFile {
    items: ShoppingListRecipeItem[];
}

export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    multiplier?: number;         // undefined = 1
    children: ShoppingListRecipeItem[];
}

export type CheckEntry =
    | { type: 'checked';   name: string }
    | { type: 'unchecked'; name: string };
```

Existing `ShoppingListResult` (categories, `other`, `pantryItems`) is unchanged. The legacy `ShoppingListRecipe` interface is removed.

## `ShoppingListService` behavior

**State:**
- `list: ShoppingListFile`
- `checkedLog: CheckEntry[]`
- `checkedSet: Set<string>` (derived)
- `result: ShoppingListResult | undefined`

**Load:** read `.shopping-list` → `parseShoppingList`; read `.shopping-checked` → `parseChecked`; derive `checkedSet`.

**Save list:** `writeShoppingList(list)` → `fileService.write('.shopping-list')`.

**Append check:** `writeCheckEntry(entry)` → read current file + concat + write. Theia's `FileService` has no native append; single-user event-loop serialization makes read-modify-write safe.

**Compact:** `compactChecked(log, currentIngredientNames)` → write full file. Invoked after recipe removal, once `regenerate()` has provided the current ingredient set.

**Public API:**
- `addRecipe(path, scale, includedRefs?)` — top-level recipe item, optional sub-ref children
- `addMenu(menuPath, menuScale, recipes[])` — menu with nested recipe children (grandchildren for each recipe's sub-refs)
- `removeRecipe(index)` — drop top-level item, then `regenerate()` then compact
- `updateScale(index, scale)` — updates `multiplier`
- `clearAll()` — wipes both files
- `checkItem(name)` / `uncheckItem(name)` — append log entry, update `checkedSet`
- `isChecked(name)`
- `regenerate()` — flattens to `RecipeInput[]`, calls `generateShoppingList` RPC, stores result

**Compact policy:** on `removeRecipe`, attempt `regenerate()` first. If generation fails, skip compact (stale entries survive until next successful compact). Matches cookcli behavior.

## UI

**`ShoppingListWidget` / components:**
- `IngredientRow` checkbox calls `service.checkItem` / `uncheckItem`. No rendering changes.
- Checked state persists across restarts automatically via the new log.
- Menu entries (items with `children.length > 0` sourced from a `.menu`) render as a single row with a secondary line showing nested recipe count (e.g. "Weekday dinners (3 recipes)"). Removal/scale operates on the menu as a whole.
- After removal, trigger compact once `regenerate()` resolves.

**Menu bulk-add command:**
- `cooklang.addMenuToShoppingList` registered in editor title + explorer context menu with `when: resourceExtname == .menu`
- Handler: resolve URI → call existing `parseMenu()` → for each referenced recipe, optionally parse to extract sub-references → call `service.addMenu(menuPath, 1, recipes[])`

**Existing `cooklang.addToShoppingList`:** unchanged — adds a single recipe with no `includedRefs` (all sub-recipes expanded).

## Cooklang crate upgrade

- `cooklang-native/Cargo.toml`: bump `cooklang = "0.17"` → `"0.18.5"`, features `["aisle", "pantry", "shopping_list"]`.
- Verify `cooklang-language-server = "0.2.1"` (sibling local dep) is compatible. If it pins to 0.17, either bump the sibling or pin both. Determine during implementation.
- Audit existing `generateShoppingList` implementation against 0.18 API (`IngredientList`, `CooklangParser`, scaling, `aisle::parse`, `pantry::parse`). Fix signature breaks in place.

## Testing

**Rust unit tests** in `cooklang-native`:
- Round-trip parse/write for `.shopping-list`
- Round-trip parse/write for `.shopping-checked`
- `checked_set` reflects last-write-wins
- `compact_checked` drops entries whose name is absent from `current_ingredients`

**TypeScript unit tests** for `ShoppingListService`:
- Add/remove recipe updates file
- Add menu produces nested structure
- Check/uncheck appends log entries and updates `checkedSet`
- Recipe removal triggers compact with current ingredient names
- `clearAll` deletes both files

**Manual smoke test:**
- Add recipes via editor → check items → restart → verify persistence
- Add a `.menu` via new command → verify nested display + single-row removal
- Remove a recipe → verify stale checks disappear from log

## Risks

1. **`cooklang-language-server` coupling** may force a parallel upgrade. Isolate in a prep commit.
2. **Append via read-modify-write** is O(n) per check. Shopping lists are small; flagged as accepted.
3. **Compact-on-failure gap** — if aggregation fails after removal, log retains stale entries. Matches upstream.

## Out-of-scope (future work)

- UI to toggle individual `included_references` on a recipe entry already in the list
- Syntax highlighting + language support for `.shopping-list` files
- Legacy `.shopping_list.txt` migration path
