# Shopping List Format Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `.shopping_list.txt` shopping list with the new cooklang `.shopping-list` format and add persistent checked-ingredient state via `.shopping-checked`, matching [cookcli PR #318](https://github.com/cooklang/cookcli/pull/318) feature set.

**Architecture:** Thin stateless Rust NAPI helpers (`parse_shopping_list`, `write_shopping_list`, `parse_checked`, `write_check_entry`, `checked_set`, `compact_checked`) exposed via the existing Theia RPC service. The TypeScript `ShoppingListService` owns all file I/O via Theia `FileService` and orchestrates the helpers.

**Tech Stack:** Rust (NAPI-RS, `cooklang` 0.18.5 with `shopping_list` feature), TypeScript, Theia `FileService`, InversifyJS, React.

**Reference:** `docs/superpowers/specs/2026-04-10-shopping-list-format-migration-design.md`

**Scope notes:**
- No migration from `.shopping_list.txt` — existing users start fresh.
- No file locking (single-user editor).
- Testing: Rust via `cargo test`; TypeScript via Mocha + Chai (pattern already used in `packages/ai-chat-ui/src/browser/**/*.spec.ts`).

---

## File map

**Created:**
- `packages/cooklang-native/src/shopping_list.rs` — pure Rust helpers + unit tests (new module)
- `packages/cooklang/src/browser/shopping-list-service.spec.ts` — TS unit tests

**Modified:**
- `packages/cooklang-native/Cargo.toml` — bump cooklang crate
- `packages/cooklang-native/src/lib.rs` — new NAPI wrappers, wire module, audit `generate_shopping_list` for 0.18 API
- `packages/cooklang-native/index.d.ts`, `index.js` — regenerated bindings
- `packages/cooklang/src/common/shopping-list-types.ts` — replace types
- `packages/cooklang/src/common/cooklang-language-service.ts` — add 6 RPC methods
- `packages/cooklang/src/node/cooklang-language-service-impl.ts` — add 6 RPC implementations
- `packages/cooklang/src/browser/shopping-list-service.ts` — rewrite
- `packages/cooklang/src/browser/shopping-list-widget.tsx` — hook async check/uncheck
- `packages/cooklang/src/browser/shopping-list-components.tsx` — menu row rendering, new prop shape
- `packages/cooklang/src/browser/shopping-list-contribution.ts` — new `addMenuToShoppingList` command

---

## Task 1: Upgrade `cooklang` crate to 0.18.5 and verify existing code still compiles

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Modify (as needed): `packages/cooklang-native/src/lib.rs` (existing `generate_shopping_list` for API changes)

- [ ] **Step 1: Update Cargo.toml**

Change line `cooklang = { version = "0.17", features = ["pantry"] }` to:

```toml
cooklang = { version = "0.18.5", features = ["aisle", "pantry", "shopping_list"] }
```

- [ ] **Step 2: Attempt to compile**

```
cd packages/cooklang-native && cargo build --release 2>&1 | tee /tmp/cooklang-build.log
```

Expected: may fail with API changes in 0.17→0.18.5. Common breakages:
- `CooklangParser::new(Extensions, Converter)` signature
- `IngredientList::add_recipe(&recipe, converter, bool)` — may have new `include_sub_references` arg
- `aisle::parse_lenient` / `pantry::parse_lenient` return types
- `recipe.scale(factor, converter)` signature

- [ ] **Step 3: Fix any signature breaks in `generate_shopping_list`**

Read error messages and update call sites in `packages/cooklang-native/src/lib.rs` lines 222-300. Do the MINIMUM change to restore the original behavior. If a new arg is required (e.g. "include sub-references"), pass `true` or `None` (permissive default) to preserve current behavior.

- [ ] **Step 4: Check cooklang-language-server sibling compatibility**

```
grep -n "cooklang" ../../../cooklang-language-server/Cargo.toml
```

If that crate pins `cooklang = "0.17"`, bump it to `0.18.5` in the sibling repo (same features it previously used). Rebuild:

```
cd packages/cooklang-native && cargo build --release
```

If a breaking API appears in `cooklang-language-server` itself, report it and pause — that's an upstream decision the user must make.

- [ ] **Step 5: Verify build succeeds**

Run: `cd packages/cooklang-native && cargo build --release`
Expected: clean build, `target/release/libcooklang_native.*` produced.

- [ ] **Step 6: Run existing tests (if any) and manual smoke test via editor**

Run: `cd packages/cooklang-native && cargo test`
Expected: PASS (or no tests).

Then rebuild NAPI bindings and the electron app; open an existing `.cook` file in the editor — syntax highlighting + hover still works.

```
cd packages/cooklang-native && npm run build
cd ../../examples/electron && npm run bundle
```

- [ ] **Step 7: Commit**

```
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/lib.rs
git commit -m "chore: bump cooklang crate to 0.18.5 and enable shopping_list feature"
```

---

## Task 2: Add Rust helpers for `.shopping-list` parse/write with unit tests

**Files:**
- Create: `packages/cooklang-native/src/shopping_list.rs`
- Modify: `packages/cooklang-native/src/lib.rs` (add `mod shopping_list;`)

- [ ] **Step 1: Create the module with a failing test**

Create `packages/cooklang-native/src/shopping_list.rs`:

```rust
//! Pure helpers around cooklang::shopping_list. No NAPI, no filesystem.

use cooklang::shopping_list::{self, ShoppingList};

/// Parse `.shopping-list` text → `ShoppingList`.
pub fn parse_list(text: &str) -> Result<ShoppingList, String> {
    shopping_list::parse(text).map_err(|e| e.to_string())
}

/// Serialize `ShoppingList` → `.shopping-list` text.
pub fn write_list(list: &ShoppingList) -> Result<String, String> {
    let mut buf = Vec::new();
    shopping_list::write(list, &mut buf).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_single_recipe() {
        let text = "pasta\n";
        let list = parse_list(text).expect("parse");
        assert_eq!(list.items.len(), 1);
        let out = write_list(&list).expect("write");
        assert_eq!(out.trim(), "pasta");
    }

    #[test]
    fn round_trips_recipe_with_multiplier() {
        let text = "pasta *2\n";
        let list = parse_list(text).expect("parse");
        let out = write_list(&list).expect("write");
        // Multiplier should round-trip
        assert!(out.contains("pasta"));
        assert!(out.contains("2"));
    }

    #[test]
    fn round_trips_nested_children() {
        // Menu-style entry with nested children (exact syntax per cooklang-rs 0.18.5)
        let text = "menu/weekday\n  pasta\n  salad\n";
        let list = parse_list(text).expect("parse");
        assert_eq!(list.items.len(), 1);
        // Reparse what we wrote and confirm structure preserved
        let out = write_list(&list).expect("write");
        let reparsed = parse_list(&out).expect("reparse");
        assert_eq!(reparsed.items.len(), 1);
    }

    #[test]
    fn empty_input_yields_empty_list() {
        let list = parse_list("").expect("parse");
        assert!(list.items.is_empty());
    }
}
```

> Note: the exact multiplier / nested-child syntax in `.shopping-list` files is defined by cooklang-rs 0.18.5. If the "pasta *2" or indent-based nested syntax differs, adjust the test inputs to match what `write` emits — run the `write` side first on a hand-constructed `ShoppingList` to see the canonical format, then use that as the parse test input.

- [ ] **Step 2: Wire the module**

Modify `packages/cooklang-native/src/lib.rs` — add near top (after other `use` statements):

```rust
mod shopping_list;
```

- [ ] **Step 3: Run the tests and verify they fail meaningfully first**

Run: `cd packages/cooklang-native && cargo test --lib shopping_list::tests`

If any test's assertion about exact text output is off because the writer uses different syntax, adjust the test to match. The goal is behavioral correctness (round-trip preserves structure), not string-exact matches beyond what the format guarantees.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cooklang-native && cargo test --lib shopping_list`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```
git add packages/cooklang-native/src/shopping_list.rs packages/cooklang-native/src/lib.rs
git commit -m "feat(cooklang-native): add parse_list/write_list helpers for .shopping-list"
```

---

## Task 3: Add Rust helpers for `.shopping-checked` parse/write/append with unit tests

**Files:**
- Modify: `packages/cooklang-native/src/shopping_list.rs`

- [ ] **Step 1: Extend the module with failing tests**

Append to `packages/cooklang-native/src/shopping_list.rs`:

```rust
use cooklang::shopping_list::CheckEntry;
use std::collections::HashSet;

/// Parse `.shopping-checked` text → list of log entries.
pub fn parse_checked_log(text: &str) -> Vec<CheckEntry> {
    shopping_list::parse_checked(text)
}

/// Serialize a single check entry to the line form used in `.shopping-checked`.
pub fn write_checked_entry(entry: &CheckEntry) -> Result<String, String> {
    let mut buf = Vec::new();
    shopping_list::write_check_entry(entry, &mut buf).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// Derive the set of currently-checked ingredient names (lowercased) from a log.
pub fn checked_set_from_log(entries: &[CheckEntry]) -> HashSet<String> {
    shopping_list::checked_set(entries)
}

#[cfg(test)]
mod checked_tests {
    use super::*;

    #[test]
    fn last_write_wins_for_same_ingredient() {
        let log_text = "+ flour\n- flour\n+ flour\n";
        let entries = parse_checked_log(log_text);
        let set = checked_set_from_log(&entries);
        assert!(set.contains("flour"));

        let log_text = "+ flour\n- flour\n";
        let entries = parse_checked_log(log_text);
        let set = checked_set_from_log(&entries);
        assert!(!set.contains("flour"));
    }

    #[test]
    fn entry_write_produces_parseable_line() {
        let entry = CheckEntry::Checked("flour".into());
        let line = write_checked_entry(&entry).unwrap();
        // Should round-trip through parse_checked
        let parsed = parse_checked_log(&line);
        assert_eq!(parsed.len(), 1);
        let set = checked_set_from_log(&parsed);
        assert!(set.contains("flour"));
    }

    #[test]
    fn checked_set_is_case_insensitive_lowercase() {
        // cooklang-rs normalizes to lowercase per cookcli PR #318 comments
        let entries = parse_checked_log("+ Flour\n");
        let set = checked_set_from_log(&entries);
        assert!(set.contains("flour"));
    }

    #[test]
    fn empty_log_yields_empty_set() {
        let entries = parse_checked_log("");
        assert!(entries.is_empty());
        assert!(checked_set_from_log(&entries).is_empty());
    }
}
```

> If `CheckEntry` variant names differ in cooklang-rs 0.18.5 (e.g. `Check` vs `Checked`), adjust accordingly. The docstring of `cooklang::shopping_list::CheckEntry` in the compiled crate is authoritative — run `cargo doc --open` if unsure.

- [ ] **Step 2: Run tests**

Run: `cd packages/cooklang-native && cargo test --lib shopping_list::checked_tests`
Expected: 4 tests PASS.

- [ ] **Step 3: Commit**

```
git add packages/cooklang-native/src/shopping_list.rs
git commit -m "feat(cooklang-native): add checked-log parse/write/set helpers"
```

---

## Task 4: Add `compact_checked` helper with unit tests

**Files:**
- Modify: `packages/cooklang-native/src/shopping_list.rs`

- [ ] **Step 1: Extend with failing tests**

Append to `packages/cooklang-native/src/shopping_list.rs`:

```rust
/// Return a compacted log: entries whose name is in `current_ingredients`
/// (case-insensitive) are kept, others are dropped.
///
/// Delegates to cooklang-rs's `compact_checked`.
pub fn compact_checked_log<'a, I>(
    entries: &[CheckEntry],
    current_ingredients: I,
) -> Vec<CheckEntry>
where
    I: IntoIterator<Item = &'a str>,
{
    shopping_list::compact_checked(entries, current_ingredients)
}

#[cfg(test)]
mod compact_tests {
    use super::*;

    #[test]
    fn drops_entries_for_missing_ingredients() {
        let entries = parse_checked_log("+ flour\n+ sugar\n+ milk\n");
        let compacted = compact_checked_log(&entries, ["flour", "sugar"]);
        let set = checked_set_from_log(&compacted);
        assert!(set.contains("flour"));
        assert!(set.contains("sugar"));
        assert!(!set.contains("milk"));
    }

    #[test]
    fn keeps_all_when_all_ingredients_present() {
        let entries = parse_checked_log("+ flour\n+ sugar\n");
        let compacted = compact_checked_log(&entries, ["flour", "sugar"]);
        assert_eq!(compacted.len(), 2);
    }

    #[test]
    fn empty_ingredients_drops_everything() {
        let entries = parse_checked_log("+ flour\n");
        let compacted = compact_checked_log(&entries, Vec::<&str>::new());
        assert!(compacted.is_empty());
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/cooklang-native && cargo test --lib shopping_list`
Expected: all 11 tests across the 3 `mod` blocks PASS.

- [ ] **Step 3: Commit**

```
git add packages/cooklang-native/src/shopping_list.rs
git commit -m "feat(cooklang-native): add compact_checked helper"
```

---

## Task 5: Expose NAPI wrappers for all shopping-list helpers

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs`
- Regenerated: `packages/cooklang-native/index.d.ts`, `packages/cooklang-native/index.js`

- [ ] **Step 1: Add NAPI functions at the end of `lib.rs`**

Append to `packages/cooklang-native/src/lib.rs`:

```rust
// ── Shopping list format (NAPI wrappers) ─────────────────────────────────────
// Thin JSON-bridge wrappers around helpers in `shopping_list` module.
// All functions are stateless; file I/O is performed by the TypeScript caller.

#[napi(js_name = "parseShoppingList")]
pub fn napi_parse_shopping_list(text: String) -> napi::Result<String> {
    let list = shopping_list::parse_list(&text)
        .map_err(|e| napi::Error::from_reason(format!("parse_shopping_list: {e}")))?;
    serde_json::to_string(&list)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "writeShoppingList")]
pub fn napi_write_shopping_list(json: String) -> napi::Result<String> {
    let list: cooklang::shopping_list::ShoppingList = serde_json::from_str(&json)
        .map_err(|e| napi::Error::from_reason(format!("writeShoppingList parse json: {e}")))?;
    shopping_list::write_list(&list)
        .map_err(|e| napi::Error::from_reason(format!("writeShoppingList: {e}")))
}

#[napi(js_name = "parseChecked")]
pub fn napi_parse_checked(text: String) -> napi::Result<String> {
    let entries = shopping_list::parse_checked_log(&text);
    serde_json::to_string(&entries)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "writeCheckEntry")]
pub fn napi_write_check_entry(entry_json: String) -> napi::Result<String> {
    let entry: cooklang::shopping_list::CheckEntry = serde_json::from_str(&entry_json)
        .map_err(|e| napi::Error::from_reason(format!("writeCheckEntry parse json: {e}")))?;
    shopping_list::write_checked_entry(&entry)
        .map_err(|e| napi::Error::from_reason(format!("writeCheckEntry: {e}")))
}

#[napi(js_name = "checkedSet")]
pub fn napi_checked_set(entries_json: String) -> napi::Result<Vec<String>> {
    let entries: Vec<cooklang::shopping_list::CheckEntry> = serde_json::from_str(&entries_json)
        .map_err(|e| napi::Error::from_reason(format!("checkedSet parse json: {e}")))?;
    let set = shopping_list::checked_set_from_log(&entries);
    Ok(set.into_iter().collect())
}

#[napi(js_name = "compactChecked")]
pub fn napi_compact_checked(
    entries_json: String,
    current_ingredients: Vec<String>,
) -> napi::Result<String> {
    let entries: Vec<cooklang::shopping_list::CheckEntry> = serde_json::from_str(&entries_json)
        .map_err(|e| napi::Error::from_reason(format!("compactChecked parse json: {e}")))?;
    let refs: Vec<&str> = current_ingredients.iter().map(|s| s.as_str()).collect();
    let compacted = shopping_list::compact_checked_log(&entries, refs);
    serde_json::to_string(&compacted)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}
```

> Confirm that `cooklang::shopping_list::{ShoppingList, CheckEntry}` implement `Serialize` + `Deserialize`. If they do not (the upstream crate may only expose the parser / writer, not serde), fall back to: define our own DTO types in `shopping_list.rs` that mirror the public fields and a `From<ShoppingList>` / `Into<ShoppingList>` pair, serialize those instead. The TS side sees the DTO shape either way.

- [ ] **Step 2: Build NAPI bindings**

```
cd packages/cooklang-native && npm run build
```

Expected: regenerates `index.d.ts` and `index.js` with new exported functions. Verify by:

```
grep -n "parseShoppingList\|writeShoppingList\|parseChecked\|writeCheckEntry\|checkedSet\|compactChecked" packages/cooklang-native/index.d.ts
```

Expected: 6 matches.

- [ ] **Step 3: Quick node-level smoke test**

Run:

```
cd packages/cooklang-native && node -e "const n = require('./'); console.log(n.parseShoppingList('pasta\n'))"
```

Expected: prints JSON like `{"items":[{"type":"recipe","path":"pasta","multiplier":null,"children":[]}]}` (exact field names per serde output — may differ).

**Note the exact shape output here — it determines the TypeScript interface in Task 7.**

- [ ] **Step 4: Commit**

```
git add packages/cooklang-native/src/lib.rs packages/cooklang-native/index.d.ts packages/cooklang-native/index.js packages/cooklang-native/cooklang-native.*.node
git commit -m "feat(cooklang-native): expose shopping-list NAPI wrappers"
```

---

## Task 6: Add RPC methods on `CooklangLanguageService`

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

- [ ] **Step 1: Add 6 RPC method signatures to the interface**

Modify `packages/cooklang/src/common/cooklang-language-service.ts`. In the `CooklangLanguageService` interface, after the existing `generateShoppingList` line, add:

```ts
    // Shopping list format (new in 2026-04)
    parseShoppingList(text: string): Promise<string>;
    writeShoppingList(json: string): Promise<string>;
    parseChecked(text: string): Promise<string>;
    writeCheckEntry(entryJson: string): Promise<string>;
    checkedSet(entriesJson: string): Promise<string[]>;
    compactChecked(entriesJson: string, currentIngredients: string[]): Promise<string>;
```

- [ ] **Step 2: Add implementations in the backend**

Modify `packages/cooklang/src/node/cooklang-language-service-impl.ts`. After the existing `generateShoppingList` method in the class body, add:

```ts
    async parseShoppingList(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parseShoppingList(text);
    }

    async writeShoppingList(json: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.writeShoppingList(json);
    }

    async parseChecked(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parseChecked(text);
    }

    async writeCheckEntry(entryJson: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.writeCheckEntry(entryJson);
    }

    async checkedSet(entriesJson: string): Promise<string[]> {
        const native = require('@theia/cooklang-native');
        return native.checkedSet(entriesJson);
    }

    async compactChecked(entriesJson: string, currentIngredients: string[]): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.compactChecked(entriesJson, currentIngredients);
    }
```

Unlike the existing `generateShoppingList` method which swallows errors into a default value, **these throw** on native errors — the `ShoppingListService` needs to know when a write fails.

- [ ] **Step 3: Compile the package**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): expose shopping-list RPC methods"
```

---

## Task 7: Replace TypeScript shopping-list types

**Files:**
- Modify: `packages/cooklang/src/common/shopping-list-types.ts`

- [ ] **Step 1: Read the current file**

```
cat packages/cooklang/src/common/shopping-list-types.ts
```

- [ ] **Step 2: Replace the file contents**

Overwrite `packages/cooklang/src/common/shopping-list-types.ts` with:

```ts
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

/**
 * Persisted shopping list format — mirrors the JSON produced by the Rust
 * `parseShoppingList` NAPI wrapper. This matches `cooklang::shopping_list::ShoppingList`.
 */
export interface ShoppingListFile {
    items: ShoppingListRecipeItem[];
}

/**
 * A recipe entry. A bare entry (empty `children`) represents a single recipe.
 * An entry with children represents either a menu (children are recipes) or a
 * recipe with selected sub-references (children are sub-recipe paths).
 *
 * `multiplier` is `undefined` when the `.shopping-list` serializes without an
 * explicit multiplier (equivalent to 1).
 */
export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    multiplier?: number;
    children: ShoppingListRecipeItem[];
}

/** Single entry in the `.shopping-checked` log. */
export type CheckEntry =
    | { type: 'checked'; name: string }
    | { type: 'unchecked'; name: string };

/** Aggregated shopping-list result returned by `generateShoppingList`. Unchanged. */
export interface ShoppingListResult {
    categories: ShoppingListCategory[];
    other: ShoppingListCategory;
    pantryItems: string[];
}

export interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

export interface ShoppingListItem {
    name: string;
    quantities: string;
}
```

> If the serde JSON discovered in Task 5 Step 3 uses different field names (e.g. `multiplier` serialized as `mult`, or tag field named `kind` instead of `type`), update this interface to match. The Rust shape is authoritative.

- [ ] **Step 3: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: compile errors in `shopping-list-service.ts`, `shopping-list-components.tsx`, `shopping-list-contribution.ts` because the old `ShoppingListRecipe` type is gone. That's fine — subsequent tasks fix those files.

- [ ] **Step 4: Commit**

```
git add packages/cooklang/src/common/shopping-list-types.ts
git commit -m "feat(cooklang): replace shopping-list types with new format"
```

---

## Task 8: Rewrite `ShoppingListService` — load/save core

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`

- [ ] **Step 1: Replace the service with the new core**

Overwrite `packages/cooklang/src/browser/shopping-list-service.ts` with:

```ts
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import {
    ShoppingListFile,
    ShoppingListRecipeItem,
    CheckEntry,
    ShoppingListResult,
} from '../common/shopping-list-types';

const LIST_FILE = '.shopping-list';
const CHECKED_FILE = '.shopping-checked';

/**
 * Manages the shopping list using the new cooklang `.shopping-list` format
 * plus a `.shopping-checked` append-only log.
 *
 * All format parse/serialize is delegated to the Rust NAPI backend via
 * CooklangLanguageService RPC. File I/O uses Theia FileService so remote /
 * virtual workspaces work transparently.
 */
@injectable()
export class ShoppingListService implements Disposable {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();
    protected list: ShoppingListFile = { items: [] };
    protected checkedLog: CheckEntry[] = [];
    protected checkedSet = new Set<string>();
    protected result: ShoppingListResult | undefined;
    protected regenerationSeq = 0;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.workspaceService.roots.then(() => this.loadFromDisk());
    }

    // -- Public getters --

    getItems(): readonly ShoppingListRecipeItem[] {
        return this.list.items;
    }

    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    isChecked(ingredientName: string): boolean {
        // cooklang-rs normalizes to lowercase for the checked set
        return this.checkedSet.has(ingredientName.toLowerCase());
    }

    getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    // -- Load / save --

    protected async loadFromDisk(): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }

        // Load recipe list
        try {
            const content = await this.fileService.read(root.resolve(LIST_FILE));
            const json = await this.languageService.parseShoppingList(content.value);
            this.list = JSON.parse(json);
        } catch {
            this.list = { items: [] };
        }

        // Load checked log
        try {
            const content = await this.fileService.read(root.resolve(CHECKED_FILE));
            const json = await this.languageService.parseChecked(content.value);
            this.checkedLog = JSON.parse(json);
            const set = await this.languageService.checkedSet(json);
            this.checkedSet = new Set(set.map(s => s.toLowerCase()));
        } catch {
            this.checkedLog = [];
            this.checkedSet = new Set();
        }

        if (this.list.items.length > 0) {
            await this.regenerate();
        } else {
            this.onDidChangeEmitter.fire();
        }
    }

    protected async saveList(): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        const text = await this.languageService.writeShoppingList(JSON.stringify(this.list));
        await this.fileService.write(root.resolve(LIST_FILE), text);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    // Stubs — implemented in subsequent tasks.
    async regenerate(): Promise<void> { /* Task 9 */ }
}
```

- [ ] **Step 2: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: still broken — `shopping-list-widget.tsx` and `-contribution.ts` reference removed methods (`getRecipes`, `toggleChecked`, `addRecipe(path, name, scale)`, etc.). Leave those broken for now; Task 9–12 fix them.

- [ ] **Step 3: Commit**

```
git add packages/cooklang/src/browser/shopping-list-service.ts
git commit -m "refactor(cooklang): ShoppingListService load/save core for new format"
```

---

## Task 9: `ShoppingListService` — regenerate, add/remove/scale/clear

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`

- [ ] **Step 1: Add helper to flatten the list into RecipeInput[]**

Inside the `ShoppingListService` class in `packages/cooklang/src/browser/shopping-list-service.ts`, replace the `regenerate` stub and add the new methods:

```ts
    /**
     * Flattens nested items into a list of `{ path, scale }` pairs that the
     * existing `generateShoppingList` RPC expects.
     *
     * Flattening rules:
     * - A top-level item with no children contributes itself.
     * - A top-level item with children contributes: itself (for its own
     *   ingredients) AND each child (for expanded references / nested recipes).
     * - Multipliers multiply down: a child under a menu scaled *2 is effectively *2.
     */
    protected flattenForGeneration(): Array<{ path: string; scale: number }> {
        const out: Array<{ path: string; scale: number }> = [];
        const walk = (item: ShoppingListRecipeItem, parentScale: number): void => {
            const scale = (item.multiplier ?? 1) * parentScale;
            out.push({ path: item.path, scale });
            for (const child of item.children) {
                walk(child, scale);
            }
        };
        for (const item of this.list.items) {
            walk(item, 1);
        }
        return out;
    }

    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;

        if (this.list.items.length === 0) {
            this.result = undefined;
            this.onDidChangeEmitter.fire();
            return;
        }

        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }

        const flat = this.flattenForGeneration();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of flat) {
            try {
                const content = await this.fileService.read(root.resolve(path));
                recipeInputs.push({ content: content.value, scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${path}:`, e);
            }
        }
        if (seq !== this.regenerationSeq) { return; }

        const aisleConf = await this.readConfigFile(root, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(root, 'config/pantry.conf');
        if (seq !== this.regenerationSeq) { return; }

        try {
            const json = await this.languageService.generateShoppingList(
                JSON.stringify(recipeInputs),
                aisleConf,
                pantryConf,
            );
            if (seq !== this.regenerationSeq) { return; }
            this.result = JSON.parse(json);
        } catch (e) {
            console.error('[shopping-list] Failed to generate shopping list:', e);
            this.result = undefined;
        }
        this.onDidChangeEmitter.fire();
    }

    async addRecipe(path: string, scale = 1, includedRefs?: string[]): Promise<void> {
        const children: ShoppingListRecipeItem[] = includedRefs
            ? includedRefs.map(p => ({
                  type: 'recipe',
                  path: p.replace(/^\.\//, ''),
                  multiplier: undefined,
                  children: [],
              }))
            : [];
        this.list.items.push({
            type: 'recipe',
            path,
            multiplier: scale === 1 ? undefined : scale,
            children,
        });
        await this.saveList();
        await this.regenerate();
    }

    async removeRecipe(index: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items.splice(index, 1);
        await this.saveList();
        await this.regenerate();
        // Compact the checked log against the now-current ingredient set.
        await this.compactCheckedLog();
    }

    async updateScale(index: number, scale: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items[index].multiplier = scale === 1 ? undefined : scale;
        await this.saveList();
        await this.regenerate();
    }

    async clearAll(): Promise<void> {
        this.list = { items: [] };
        this.checkedLog = [];
        this.checkedSet.clear();
        this.result = undefined;
        const root = this.getWorkspaceRootUri();
        if (root) {
            try { await this.fileService.delete(root.resolve(LIST_FILE)); } catch { /* already gone */ }
            try { await this.fileService.delete(root.resolve(CHECKED_FILE)); } catch { /* already gone */ }
        }
        this.onDidChangeEmitter.fire();
    }

    protected async readConfigFile(root: URI, relativePath: string): Promise<string | null> {
        try {
            const content = await this.fileService.read(root.resolve(relativePath));
            return content.value;
        } catch {
            return null;
        }
    }

    // Stubs — implemented in Task 10 and 11.
    async checkItem(_name: string): Promise<void> { /* Task 10 */ }
    async uncheckItem(_name: string): Promise<void> { /* Task 10 */ }
    async addMenu(
        _menuPath: string,
        _menuScale: number,
        _recipes: Array<{ path: string; scale: number; includedRefs?: string[] }>,
    ): Promise<void> { /* Task 11 */ }
    protected async compactCheckedLog(): Promise<void> { /* Task 10 */ }
```

- [ ] **Step 2: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: still compile errors in widget/components/contribution (they call old API). Leave for Task 12–13.

- [ ] **Step 3: Commit**

```
git add packages/cooklang/src/browser/shopping-list-service.ts
git commit -m "feat(cooklang): ShoppingListService regenerate + CRUD methods"
```

---

## Task 10: `ShoppingListService` — check/uncheck/compact

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`

- [ ] **Step 1: Replace the stubs for check/uncheck/compact**

In `packages/cooklang/src/browser/shopping-list-service.ts`, replace `checkItem`, `uncheckItem`, and `compactCheckedLog` stubs with:

```ts
    async checkItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'checked', name });
    }

    async uncheckItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'unchecked', name });
    }

    protected async appendCheckEntry(entry: CheckEntry): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) { return; }

        const line = await this.languageService.writeCheckEntry(JSON.stringify(entry));

        // Read-modify-write. FileService has no native append; single-user
        // event-loop serialization keeps this safe.
        let existing = '';
        try {
            const content = await this.fileService.read(root.resolve(CHECKED_FILE));
            existing = content.value;
        } catch {
            existing = '';
        }
        const next = existing + (existing.endsWith('\n') || existing.length === 0 ? '' : '\n') + line;
        await this.fileService.write(root.resolve(CHECKED_FILE), next);

        // Update in-memory state
        this.checkedLog.push(entry);
        const setArr = await this.languageService.checkedSet(JSON.stringify(this.checkedLog));
        this.checkedSet = new Set(setArr.map(s => s.toLowerCase()));
        this.onDidChangeEmitter.fire();
    }

    /**
     * Rewrite `.shopping-checked` keeping only entries whose ingredient name
     * is still present in the current aggregated result. If `this.result` is
     * missing (regeneration failed), skip — matches cookcli policy.
     */
    protected async compactCheckedLog(): Promise<void> {
        if (!this.result) { return; }
        const root = this.getWorkspaceRootUri();
        if (!root) { return; }

        const names: string[] = [];
        for (const c of this.result.categories) {
            for (const it of c.items) { names.push(it.name); }
        }
        for (const it of this.result.other.items) { names.push(it.name); }

        const compactedJson = await this.languageService.compactChecked(
            JSON.stringify(this.checkedLog),
            names,
        );
        const compacted: CheckEntry[] = JSON.parse(compactedJson);

        // If nothing changed, skip the write.
        if (compacted.length === this.checkedLog.length) { return; }
        this.checkedLog = compacted;

        // Serialize each entry back to a line, join, write.
        const lines: string[] = [];
        for (const entry of compacted) {
            lines.push(await this.languageService.writeCheckEntry(JSON.stringify(entry)));
        }
        const text = lines.length > 0 ? lines.join('') : '';
        if (text.length === 0) {
            try { await this.fileService.delete(root.resolve(CHECKED_FILE)); } catch { /* already gone */ }
        } else {
            // writeCheckEntry already emits a trailing newline per entry; if it
            // doesn't, ensure separation:
            const needsNewlines = !lines.every(l => l.endsWith('\n'));
            const joined = needsNewlines ? lines.join('\n') + '\n' : text;
            await this.fileService.write(root.resolve(CHECKED_FILE), joined);
        }

        // Rebuild in-memory set
        const setArr = await this.languageService.checkedSet(compactedJson);
        this.checkedSet = new Set(setArr.map(s => s.toLowerCase()));
    }
```

- [ ] **Step 2: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: widget/components/contribution still broken — fixed in later tasks.

- [ ] **Step 3: Commit**

```
git add packages/cooklang/src/browser/shopping-list-service.ts
git commit -m "feat(cooklang): persist checked state via append + compact"
```

---

## Task 11: `ShoppingListService` — addMenu with nested children

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`

- [ ] **Step 1: Replace the `addMenu` stub**

In `packages/cooklang/src/browser/shopping-list-service.ts`, replace the `addMenu` stub:

```ts
    /**
     * Adds a menu as a single top-level item with nested recipe children.
     * Each child recipe may itself have sub-recipe references as grandchildren.
     */
    async addMenu(
        menuPath: string,
        menuScale: number,
        recipes: Array<{ path: string; scale: number; includedRefs?: string[] }>,
    ): Promise<void> {
        const children: ShoppingListRecipeItem[] = recipes.map(r => ({
            type: 'recipe',
            path: r.path,
            multiplier: r.scale === 1 ? undefined : r.scale,
            children: (r.includedRefs ?? []).map(p => ({
                type: 'recipe',
                path: p.replace(/^\.\//, ''),
                multiplier: undefined,
                children: [],
            })),
        }));
        this.list.items.push({
            type: 'recipe',
            path: menuPath,
            multiplier: menuScale === 1 ? undefined : menuScale,
            children,
        });
        await this.saveList();
        await this.regenerate();
    }
```

- [ ] **Step 2: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: errors only in `shopping-list-widget.tsx`, `shopping-list-components.tsx`, `shopping-list-contribution.ts`.

- [ ] **Step 3: Commit**

```
git add packages/cooklang/src/browser/shopping-list-service.ts
git commit -m "feat(cooklang): ShoppingListService.addMenu for menu bulk-add"
```

---

## Task 12: Update widget + components for new service API

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-widget.tsx`
- Modify: `packages/cooklang/src/browser/shopping-list-components.tsx`

- [ ] **Step 1: Update the widget**

Overwrite `packages/cooklang/src/browser/shopping-list-widget.tsx` render/handlers portion with:

Replace the render method body:

```tsx
    protected render(): React.ReactNode {
        const items = this.shoppingListService.getItems();
        const result = this.shoppingListService.getResult();

        const checkedItems = new Set<string>();
        if (result) {
            const allItems = [
                ...result.categories.flatMap(c => c.items),
                ...result.other.items,
            ];
            for (const item of allItems) {
                if (this.shoppingListService.isChecked(item.name)) {
                    checkedItems.add(item.name);
                }
            }
        }

        return (
            <ShoppingListView
                items={items}
                result={result}
                checkedItems={checkedItems}
                onRemoveRecipe={this.handleRemoveRecipe}
                onScaleChange={this.handleScaleChange}
                onClearAll={this.handleClearAll}
                onToggleItem={this.handleToggleItem}
            />
        );
    }

    protected handleRemoveRecipe = (index: number): void => {
        void this.shoppingListService.removeRecipe(index);
    };

    protected handleScaleChange = (index: number, scale: number): void => {
        void this.shoppingListService.updateScale(index, scale);
    };

    protected handleClearAll = (): void => {
        void this.shoppingListService.clearAll();
    };

    protected handleToggleItem = (name: string): void => {
        if (this.shoppingListService.isChecked(name)) {
            void this.shoppingListService.uncheckItem(name);
        } else {
            void this.shoppingListService.checkItem(name);
        }
    };
```

- [ ] **Step 2: Update components for new item shape and menu row**

Overwrite `packages/cooklang/src/browser/shopping-list-components.tsx` with:

```tsx
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import * as React from '@theia/core/shared/react';
import {
    ShoppingListRecipeItem,
    ShoppingListResult,
    ShoppingListCategory,
    ShoppingListItem,
} from '../common/shopping-list-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a human-friendly display name from a recipe path. */
function displayNameFromPath(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.(cook|menu)$/i, '');
}

// ---------------------------------------------------------------------------
// RecipeListPanel
// ---------------------------------------------------------------------------

interface RecipeListPanelProps {
    items: readonly ShoppingListRecipeItem[];
    onRemove: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
}

export const RecipeListPanel = ({
    items,
    onRemove,
    onScaleChange,
    onClearAll,
}: RecipeListPanelProps): React.ReactElement => {
    if (items.length === 0) {
        return (
            <div className='shopping-list-empty-recipes'>
                No recipes selected. Add recipes from the preview or explorer.
            </div>
        );
    }

    return (
        <div className='shopping-list-recipes'>
            <div className='shopping-list-recipes-header'>
                <span className='shopping-list-recipes-title'>Selected Recipes</span>
                <button className='shopping-list-clear-btn' onClick={onClearAll}>
                    Clear All
                </button>
            </div>
            {items.map((item, idx) => {
                const name = displayNameFromPath(item.path);
                const isMenu = item.children.length > 0 && item.path.toLowerCase().endsWith('.menu');
                const scale = item.multiplier ?? 1;
                return (
                    <div key={`${item.path}-${idx}`} className='shopping-list-recipe-row'>
                        <div className='shopping-list-recipe-main'>
                            <span className='shopping-list-recipe-name'>{name}</span>
                            {isMenu && (
                                <span className='shopping-list-recipe-sub'>
                                    menu ({item.children.length} recipes)
                                </span>
                            )}
                        </div>
                        <input
                            className='shopping-list-scale-input'
                            type='number'
                            min='0.5'
                            max='100'
                            step='0.5'
                            defaultValue={scale}
                            onBlur={e => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val > 0) {
                                    onScaleChange(idx, val);
                                }
                            }}
                            title='Scale factor'
                        />
                        <button
                            className='shopping-list-remove-btn'
                            onClick={() => onRemove(idx)}
                            title='Remove from shopping list'
                        >
                            x
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

// ---------------------------------------------------------------------------
// IngredientRow
// ---------------------------------------------------------------------------

interface IngredientRowProps {
    item: ShoppingListItem;
    checked: boolean;
    onToggle: () => void;
}

const IngredientRow = ({ item, checked, onToggle }: IngredientRowProps): React.ReactElement => (
    <div className={'shopping-list-ingredient' + (checked ? ' checked' : '')}>
        <label className='shopping-list-ingredient-label'>
            <input
                type='checkbox'
                checked={checked}
                onChange={onToggle}
            />
            <span className='shopping-list-ingredient-name'>{item.name}</span>
            {item.quantities && (
                <span className='shopping-list-ingredient-qty'>{item.quantities}</span>
            )}
        </label>
    </div>
);

// ---------------------------------------------------------------------------
// CategorySection
// ---------------------------------------------------------------------------

interface CategorySectionProps {
    category: ShoppingListCategory;
    checkedItems: Set<string>;
    onToggle: (name: string) => void;
}

export const CategorySection = ({
    category,
    checkedItems,
    onToggle,
}: CategorySectionProps): React.ReactElement | null => {
    if (category.items.length === 0) { return null; }
    return (
        <div className='shopping-list-category'>
            <h3 className='shopping-list-category-header'>{category.name}</h3>
            {category.items.map(item => (
                <IngredientRow
                    key={item.name}
                    item={item}
                    checked={checkedItems.has(item.name)}
                    onToggle={() => onToggle(item.name)}
                />
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// PantrySection (unchanged)
// ---------------------------------------------------------------------------

interface PantrySectionProps {
    pantryItems: string[];
}

export const PantrySection = ({ pantryItems }: PantrySectionProps): React.ReactElement | null => {
    const [expanded, setExpanded] = React.useState(false);
    if (pantryItems.length === 0) { return null; }
    return (
        <div className='shopping-list-pantry'>
            <button
                className='shopping-list-pantry-toggle'
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? '\u25BC' : '\u25B6'} In Pantry ({pantryItems.length})
            </button>
            {expanded && (
                <ul className='shopping-list-pantry-list'>
                    {pantryItems.map(name => (
                        <li key={name} className='shopping-list-pantry-item'>{name}</li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// ShoppingListView (top-level)
// ---------------------------------------------------------------------------

export interface ShoppingListViewProps {
    items: readonly ShoppingListRecipeItem[];
    result: ShoppingListResult | undefined;
    checkedItems: Set<string>;
    onRemoveRecipe: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
    onToggleItem: (name: string) => void;
}

export const ShoppingListView = ({
    items,
    result,
    checkedItems,
    onRemoveRecipe,
    onScaleChange,
    onClearAll,
    onToggleItem,
}: ShoppingListViewProps): React.ReactElement => (
    <div className='shopping-list-content'>
        <RecipeListPanel
            items={items}
            onRemove={onRemoveRecipe}
            onScaleChange={onScaleChange}
            onClearAll={onClearAll}
        />
        {result && (
            <>
                {result.categories.map(category => (
                    <CategorySection
                        key={category.name}
                        category={category}
                        checkedItems={checkedItems}
                        onToggle={onToggleItem}
                    />
                ))}
                {result.other.items.length > 0 && (
                    <CategorySection
                        key='other'
                        category={result.other}
                        checkedItems={checkedItems}
                        onToggle={onToggleItem}
                    />
                )}
                <PantrySection pantryItems={result.pantryItems} />
            </>
        )}
    </div>
);
```

- [ ] **Step 3: Add menu sub-label CSS**

Append to `packages/cooklang/src/browser/style/shopping-list.css`:

```css
.shopping-list-recipe-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.shopping-list-recipe-sub {
    font-size: 0.85em;
    color: var(--theia-descriptionForeground);
}
```

- [ ] **Step 4: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: only `shopping-list-contribution.ts` still broken (calls `addRecipe(path, name, scale)` signature that no longer exists).

- [ ] **Step 5: Commit**

```
git add packages/cooklang/src/browser/shopping-list-widget.tsx packages/cooklang/src/browser/shopping-list-components.tsx packages/cooklang/src/browser/style/shopping-list.css
git commit -m "feat(cooklang): UI for new shopping list shape with menu rows"
```

---

## Task 13: Update `addToShoppingList` command and add `addMenuToShoppingList`

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-contribution.ts`

- [ ] **Step 1: Update addRecipe call site + add menu command**

In `packages/cooklang/src/browser/shopping-list-contribution.ts`:

1. Replace `addRecipe` method body — drop the `name` param (now derived from path):

```ts
    protected async addRecipe(args: unknown[] = []): Promise<void> {
        const targetUri = this.resolveTargetUri(args);
        if (!targetUri) { return; }

        const scale = this.resolveScale(args);
        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(targetUri)?.toString() ?? targetUri.path.base
            : targetUri.path.base;

        await this.shoppingListService.addRecipe(relativePath, scale);
        await this.openView({ activate: true });
    }
```

2. Add the new menu command in the `ShoppingListCommands` namespace:

```ts
    export const ADD_MENU_TO_LIST: Command = {
        id: 'cooklang.addMenuToShoppingList',
        label: 'Cooklang: Add Menu to Shopping List',
        iconClass: 'theia-shopping-cart-icon',
    };
```

3. In `registerCommands`, after the existing `ADD_TO_LIST` registration, add:

```ts
        commands.registerCommand(ShoppingListCommands.ADD_MENU_TO_LIST, {
            execute: (...args: unknown[]) => this.addMenu(args),
            isEnabled: (...args: unknown[]) => this.canAddMenu(args),
            isVisible: (...args: unknown[]) => this.canAddMenu(args),
        });
```

4. In `registerMenus`, after the existing ADD_TO_LIST menu action, add:

```ts
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: ShoppingListCommands.ADD_MENU_TO_LIST.id,
            label: 'Add Menu to Shopping List',
            when: 'resourceExtname == .menu',
        });
```

5. In `registerToolbarItems`, after the existing entry, add:

```ts
        toolbar.registerItem({
            id: ShoppingListCommands.ADD_MENU_TO_LIST.id + '.editor',
            command: ShoppingListCommands.ADD_MENU_TO_LIST.id,
            tooltip: 'Add Menu to Shopping List',
            when: `resourceExtname == .menu`,
        });
```

6. Add helper methods at the bottom of the class:

```ts
    protected resolveMenuUri(args: unknown[]): URI | undefined {
        if (args.length > 0 && args[0] instanceof URI) {
            const uri = args[0] as URI;
            if (uri.path.ext === '.menu') { return uri; }
        }
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (uri && uri.path.ext === '.menu') { return uri; }
        }
        const selection = this.selectionService.selection;
        const selectedUri = UriSelection.getUri(selection);
        if (selectedUri && selectedUri.path.ext === '.menu') { return selectedUri; }
        const currentWidget = this.shell?.currentWidget;
        if (NavigatableWidget.is(currentWidget)) {
            const uri = currentWidget.getResourceUri();
            if (uri && uri.path.ext === '.menu') { return uri; }
        }
        return undefined;
    }

    protected canAddMenu(args: unknown[] = []): boolean {
        return this.resolveMenuUri(args) !== undefined;
    }

    protected async addMenu(args: unknown[] = []): Promise<void> {
        const menuUri = this.resolveMenuUri(args);
        if (!menuUri) { return; }

        const workspaceRoot = this.shoppingListService.getWorkspaceRootUri();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(menuUri)?.toString() ?? menuUri.path.base
            : menuUri.path.base;

        // Parse the menu to enumerate referenced recipes.
        let menuContent: string;
        try {
            const root = this.shoppingListService.getWorkspaceRootUri();
            if (!root) { return; }
            const content = await this.fileService.read(root.resolve(relativePath));
            menuContent = content.value;
        } catch (e) {
            console.error('[shopping-list] Failed to read menu file:', e);
            return;
        }

        let parsed: { sections?: Array<{ lines?: Array<Array<{ kind?: string; name?: string; path?: string; scale?: number }>> }> };
        try {
            parsed = JSON.parse(await this.languageService.parseMenu(menuContent, 1));
        } catch (e) {
            console.error('[shopping-list] Failed to parse menu:', e);
            return;
        }

        const recipes: Array<{ path: string; scale: number; includedRefs?: string[] }> = [];
        for (const section of parsed.sections ?? []) {
            for (const line of section.lines ?? []) {
                for (const item of line) {
                    // Shape of recipe-reference items: see `MenuRecipeReferenceItem` in
                    // packages/cooklang/src/common/menu-types.ts. Heuristic: has `path` or
                    // has a recipe-reference `kind`. Adjust by inspecting the actual
                    // shape in node REPL during implementation.
                    const refPath = item.path ?? item.name;
                    if (!refPath) { continue; }
                    if (item.kind && item.kind !== 'recipe-reference' && item.kind !== 'recipeReference') { continue; }
                    recipes.push({
                        path: refPath.replace(/^\.\//, ''),
                        scale: typeof item.scale === 'number' && item.scale > 0 ? item.scale : 1,
                    });
                }
            }
        }

        if (recipes.length === 0) {
            console.warn('[shopping-list] Menu contained no recipe references:', relativePath);
            return;
        }

        await this.shoppingListService.addMenu(relativePath, 1, recipes);
        await this.openView({ activate: true });
    }
```

7. Add `FileService` and `CooklangLanguageService` imports + property injections at the top of the class:

```ts
    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;
```

And the imports at the top of the file:

```ts
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CooklangLanguageService } from '../common/cooklang-language-service';
```

- [ ] **Step 2: Compile**

```
npx lerna run compile --scope @theia/cooklang
```

Expected: clean compile across the whole package.

- [ ] **Step 3: Full electron build**

```
cd examples/electron && npm run bundle
```

Expected: clean bundle.

- [ ] **Step 4: Manual smoke test**

Start the editor, open a workspace with at least one `.cook` and one `.menu` file.

Test script:
1. Right-click a `.cook` → "Add to Shopping List" → shopping list widget opens with ingredients grouped.
2. Check a few items.
3. Restart the editor. Verify checked state persists.
4. Right-click a `.menu` → "Add Menu to Shopping List" → a single row appears labeled "menu (N recipes)".
5. Change scale on the menu row → ingredients scale.
6. Remove a recipe → stale checks are pruned from `.shopping-checked`.
7. Clear All → both files are deleted.

Verify on disk: `.shopping-list` contains readable text, `.shopping-checked` contains `+ name` / `- name` lines.

- [ ] **Step 5: Commit**

```
git add packages/cooklang/src/browser/shopping-list-contribution.ts
git commit -m "feat(cooklang): addMenuToShoppingList command for .menu files"
```

---

## Task 14: TypeScript unit tests for `ShoppingListService`

**Files:**
- Create: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

- [ ] **Step 1: Check test harness prerequisites**

Run: `cat packages/cooklang/package.json | grep -A2 scripts`

Verify `"test": "theiaext test"`. If the `test` script is absent, add `"test": "theiaext test"` to `scripts`. (The pattern is the same as every other Theia package.)

- [ ] **Step 2: Write the spec file**

Create `packages/cooklang/src/browser/shopping-list-service.spec.ts`:

```ts
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { expect } from 'chai';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListRecipeItem, CheckEntry } from '../common/shopping-list-types';

/** Minimal in-memory FileService stub — only the methods we call. */
class FakeFileService {
    files = new Map<string, string>();
    async read(uri: { toString(): string }): Promise<{ value: string }> {
        const key = uri.toString();
        if (!this.files.has(key)) { throw new Error('ENOENT'); }
        return { value: this.files.get(key)! };
    }
    async write(uri: { toString(): string }, content: string): Promise<void> {
        this.files.set(uri.toString(), content);
    }
    async delete(uri: { toString(): string }): Promise<void> {
        this.files.delete(uri.toString());
    }
}

/** FakeWorkspaceService with a single root. */
class FakeWorkspaceService {
    roots = Promise.resolve([{ resource: { toString: () => 'file:///ws' } }]);
    tryGetRoots(): Array<{ resource: { toString: () => string } }> {
        return [{ resource: { toString: () => 'file:///ws' } }];
    }
}

/** FakeCooklangLanguageService — only the methods the service calls. */
class FakeLanguageService {
    // Mirrors cooklang-rs' serde JSON output shape.
    async parseShoppingList(text: string): Promise<string> {
        // Tests can override by pre-stuffing state; for now, do a trivial parse:
        // one recipe per non-empty line.
        const items = text.split('\n').filter(l => l.trim().length > 0).map(l => ({
            type: 'recipe', path: l.trim(), multiplier: undefined, children: [],
        }));
        return JSON.stringify({ items });
    }
    async writeShoppingList(json: string): Promise<string> {
        const list: { items: Array<{ path: string }> } = JSON.parse(json);
        return list.items.map(i => i.path).join('\n') + (list.items.length > 0 ? '\n' : '');
    }
    async parseChecked(text: string): Promise<string> {
        const entries: CheckEntry[] = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('+ ')) { entries.push({ type: 'checked', name: trimmed.slice(2) }); }
            else if (trimmed.startsWith('- ')) { entries.push({ type: 'unchecked', name: trimmed.slice(2) }); }
        }
        return JSON.stringify(entries);
    }
    async writeCheckEntry(entryJson: string): Promise<string> {
        const entry: CheckEntry = JSON.parse(entryJson);
        return (entry.type === 'checked' ? '+ ' : '- ') + entry.name + '\n';
    }
    async checkedSet(entriesJson: string): Promise<string[]> {
        const entries: CheckEntry[] = JSON.parse(entriesJson);
        const set = new Set<string>();
        for (const e of entries) {
            if (e.type === 'checked') { set.add(e.name.toLowerCase()); }
            else { set.delete(e.name.toLowerCase()); }
        }
        return [...set];
    }
    async compactChecked(entriesJson: string, names: string[]): Promise<string> {
        const entries: CheckEntry[] = JSON.parse(entriesJson);
        const lc = new Set(names.map(n => n.toLowerCase()));
        return JSON.stringify(entries.filter(e => lc.has(e.name.toLowerCase())));
    }
    // Unused in tests but part of the interface — recipes are not physically read.
    async generateShoppingList(_recipes: string, _a: string | null, _p: string | null): Promise<string> {
        return JSON.stringify({
            categories: [],
            other: { name: 'other', items: [{ name: 'flour', quantities: '' }] },
            pantryItems: [],
        });
    }
    async parse(_c: string): Promise<string> { return '{}'; }
    async parseMenu(_c: string, _s: number): Promise<string> { return '{}'; }
}

/**
 * Construct a ShoppingListService with injected fakes. We bypass Inversify and
 * set protected fields directly — simpler than wiring a test container.
 */
function makeService(): { svc: ShoppingListService; fs: FakeFileService; ls: FakeLanguageService } {
    const fs = new FakeFileService();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    const svc = new ShoppingListService();
    (svc as any).fileService = fs;
    (svc as any).languageService = ls;
    (svc as any).workspaceService = ws;
    (svc as any).toDispose = { push: (): void => {} };
    return { svc, fs, ls };
}

describe('ShoppingListService', () => {
    it('addRecipe appends to list and persists', async () => {
        const { svc, fs } = makeService();
        await svc.addRecipe('pasta.cook', 1);
        expect(svc.getItems().length).to.equal(1);
        expect(fs.files.get('file:///ws/.shopping-list')).to.contain('pasta.cook');
    });

    it('addMenu creates a nested structure', async () => {
        const { svc } = makeService();
        await svc.addMenu('weekday.menu', 1, [
            { path: 'pasta.cook', scale: 1 },
            { path: 'salad.cook', scale: 2 },
        ]);
        const items = svc.getItems() as readonly ShoppingListRecipeItem[];
        expect(items.length).to.equal(1);
        expect(items[0].children.length).to.equal(2);
        expect(items[0].children[1].multiplier).to.equal(2);
    });

    it('checkItem appends to .shopping-checked and updates the set', async () => {
        const { svc, fs } = makeService();
        await svc.checkItem('Flour');
        expect(svc.isChecked('flour')).to.equal(true);
        expect(fs.files.get('file:///ws/.shopping-checked')).to.contain('+ Flour');
    });

    it('uncheckItem reverses a prior check', async () => {
        const { svc } = makeService();
        await svc.checkItem('flour');
        await svc.uncheckItem('flour');
        expect(svc.isChecked('flour')).to.equal(false);
    });

    it('clearAll deletes both files', async () => {
        const { svc, fs } = makeService();
        await svc.addRecipe('pasta.cook', 1);
        await svc.checkItem('flour');
        await svc.clearAll();
        expect(fs.files.has('file:///ws/.shopping-list')).to.equal(false);
        expect(fs.files.has('file:///ws/.shopping-checked')).to.equal(false);
        expect(svc.getItems().length).to.equal(0);
    });

    it('removeRecipe compacts stale checks', async () => {
        const { svc, fs, ls } = makeService();
        // Make the fake generateShoppingList return "milk" while pasta is in the list,
        // but return nothing once the list is empty.
        let callCount = 0;
        ls.generateShoppingList = async () => {
            callCount++;
            return JSON.stringify({
                categories: [],
                other: {
                    name: 'other',
                    items: callCount === 1
                        ? [{ name: 'flour', quantities: '' }, { name: 'milk', quantities: '' }]
                        : [{ name: 'flour', quantities: '' }],
                },
                pantryItems: [],
            });
        };

        await svc.addRecipe('pasta.cook', 1);
        await svc.checkItem('milk');
        expect(svc.isChecked('milk')).to.equal(true);

        await svc.removeRecipe(0);
        // milk is no longer in the ingredient list → compact should drop it.
        // The compacted file no longer contains "milk".
        const checkedContent = fs.files.get('file:///ws/.shopping-checked') ?? '';
        expect(checkedContent.includes('milk')).to.equal(false);
    });
});
```

- [ ] **Step 3: Run the tests**

```
npx lerna run test --scope @theia/cooklang
```

Expected: 6 tests PASS.

> If the Theia test runner does not discover `.spec.ts` files under `src/browser`, inspect `packages/cooklang/.mocharc.js` (or equivalent). Packages in this repo use the `theiaext` tool which should auto-discover; if not, check pattern in `packages/ai-chat-ui` for reference.

- [ ] **Step 4: Commit**

```
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): unit tests for ShoppingListService behavior"
```

---

## Task 15: Final cleanup + smoke test + gitignore

**Files:**
- Modify: `.gitignore` (workspace root)
- Verify: no references to `.shopping_list.txt` remain

- [ ] **Step 1: Grep for stale references**

Run: `grep -rn "shopping_list\\.txt\\|ShoppingListRecipe\\b\\|toggleChecked" packages/cooklang/src/ packages/cooklang/data/`

Expected: no matches. If any remain, remove / update them.

- [ ] **Step 2: Add the new files to `.gitignore`**

If `.gitignore` exists at workspace root, add:

```
.shopping-list
.shopping-checked
```

(Only if the repo was previously ignoring `.shopping_list.txt`; otherwise the user's workspace `.gitignore` is their responsibility — flag but don't modify user workspace files.)

- [ ] **Step 3: Full end-to-end smoke test**

Start the editor on a fresh workspace. Run each of the following in sequence and verify behavior:

1. Add `.cook` recipe → widget shows items.
2. Check an ingredient → `.shopping-checked` has `+ name`.
3. Uncheck → `.shopping-checked` has `+ name\n- name\n`.
4. Restart editor → checked state restored.
5. Add `.menu` → single row "menu (N recipes)", ingredients aggregate all referenced recipes.
6. Scale the menu row → ingredients scale proportionally.
7. Remove menu → ingredients from all referenced recipes disappear, stale checks pruned.
8. Clear All → both files deleted.

- [ ] **Step 4: Commit any .gitignore change**

```
git add .gitignore
git commit -m "chore: gitignore new shopping-list format files"
```

(Skip if nothing changed.)

---

## Self-review checklist

- [x] **Spec coverage:** All sections in the spec map to tasks — Rust surface (Tasks 2–5), RPC (Task 6), TS types (Task 7), service (Tasks 8–11), UI (Tasks 12–13), tests (Tasks 2–4, 14), crate upgrade (Task 1).
- [x] **No placeholders:** Each code step shows the actual code.
- [x] **Type consistency:** `ShoppingListRecipeItem` used consistently across types, service, components. `addRecipe(path, scale, includedRefs?)` signature in service matches call site in contribution. `addMenu(menuPath, menuScale, recipes)` matches call site.
- [x] **Known uncertainties called out inline:** Serde field names in Task 5 Step 3 determine Task 7 interface. Menu JSON shape in Task 13 depends on `MenuRecipeReferenceItem`. Both have inspection steps with fallback guidance.

## Known risks

- **Serde shape discovery (Task 5):** The exact JSON that `cooklang::shopping_list::ShoppingList` produces (field names, optional tagging) isn't known without running the NAPI. Task 5 Step 3 captures it, Task 7 uses it. If the shape diverges from the plan's draft interface, update Task 7's types accordingly — the rest of the code treats the shape as opaque JSON transit.
- **`cooklang-language-server` sibling bump** may cascade. Task 1 Step 4 detects it.
- **`CheckEntry` serde variants:** if `cooklang-rs` uses `Check` / `Uncheck` instead of `Checked` / `Unchecked`, adjust `CheckEntry` union in Task 7 and the fakes in Task 14.
