# CookBot Workspace + Catalog Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CookBot six deterministic tools — `searchRecipes`, `getPantry`, `checkPantry`, `generateShoppingList` (workspace, issue #82) and `searchRecipeCatalog`, `addCatalogRecipe` (cook.md catalog, issue cook-md#293) — so it stops re-reading files and can pull from the curated catalog.

**Architecture:** Workspace operations come from the Rust crates the editor already bundles (`cooklang-find::search` = `cook search`, `cooklang::pantry`) exposed through three new NAPI exports and `CooklangLanguageService` RPCs; the tools are `ToolProvider`s in `packages/cooklang` that reuse `ShoppingListService`. Catalog tools live in `packages/cooklang-ai`, call two new gRPC RPCs through the existing `CookbotServerToolsService` proxy, and stage the recipe file through the chat changeset exactly like `suggestFileContent`. Registration is one `bindToolProvider` per tool — the cookbot agent already sends every registered tool.

**Tech Stack:** Rust + NAPI-RS (`packages/cooklang-native`), TypeScript / InversifyJS / Theia (`packages/cooklang`, `packages/cooklang-ai`), mocha + chai specs, gRPC (`@grpc/grpc-js` + proto-loader).

**Spec:** `docs/superpowers/specs/2026-08-18-cookbot-workspace-and-catalog-tools-design.md`

**Environment notes:**
- Node 22 is required for tests: `export PATH=$HOME/.local/bin:$PATH` before any `npx`/`npm` command (the nix node is broken).
- Run a single compiled spec with `cd packages/<pkg> && npx mocha --config ../../configs/mocharc.yml ./lib/browser/<name>.spec.js` after `npx lerna run compile --scope @theia/<pkg>` (specs are compiled to `lib/`). `npx lerna run test --scope @theia/<pkg>` runs them all.
- The native addon build (`cd packages/cooklang-native && npm run build`) regenerates `index.d.ts`/`index.js` and the `.node` binary; `cargo test` runs the Rust unit tests without needing the addon build.
- Work on branch `cookbot-workspace-catalog-tools` (already created; the spec is committed there).

---

## File structure

**Create**
- `packages/cooklang/src/browser/recipe-reference-resolver.ts` — `RecipeReferenceResolver` (moved `collectResolvedRefs`/`resolveReferenceScale`)
- `packages/cooklang/src/browser/recipe-reference-resolver.spec.ts`
- `packages/cooklang/src/browser/search-recipes-tool.ts` + `.spec.ts`
- `packages/cooklang/src/browser/pantry-tools.ts` (`GetPantryTool`, `CheckPantryTool`) + `pantry-tools.spec.ts`
- `packages/cooklang/src/browser/generate-shopping-list-tool.ts` + `.spec.ts`
- `packages/cooklang-ai/src/browser/catalog-recipe-tools.ts` (`CookbotSearchRecipeCatalogTool`, `CookbotAddCatalogRecipeTool`) + `catalog-recipe-tools.spec.ts`

**Modify**
- `packages/cooklang-native/Cargo.toml` — bump `cooklang-find` to `0.6.1`
- `packages/cooklang-native/src/lib.rs` — `search_recipes`, `parse_pantry`, `check_pantry` + tests
- `packages/cooklang/src/common/cooklang-language-service.ts`, `src/node/cooklang-language-service-impl.ts` — three RPC methods
- `packages/cooklang/src/browser/shopping-list-service.ts` — extract `computeResult(items)`
- `packages/cooklang/src/browser/shopping-list-contribution.ts` — use `RecipeReferenceResolver`
- `packages/cooklang/src/browser/cooklang-frontend-module.ts` — bind resolver + 4 tools
- `packages/cooklang-ai/proto/cookbot.proto` — copy from cook.md
- `packages/cooklang-ai/src/common/cookbot-server-tools-protocol.ts`, `src/node/cookbot-grpc-client.ts`, `src/node/cookbot-server-tools-service.ts` — 2 RPCs
- `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts` — bind 2 tools

---

### Task 1: Native exports — `search_recipes`, `parse_pantry`, `check_pantry`

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml:13`
- Modify: `packages/cooklang-native/src/lib.rs` (append after `napi_compact_checked`, ~line 903, and add a test module at the end)

- [ ] **Step 1: Bump `cooklang-find`**

`cooklang-find 0.5.8` is not in the local cargo registry (only `0.6.1` is) and `0.6.1` exports `search` and `build_tree` (`src/lib.rs:64-65`), keeps `get_recipe`, and `fetcher::FetchError::InvalidPath` — the API `napi_find_recipe` uses. In `packages/cooklang-native/Cargo.toml` change:

```toml
cooklang-find = "0.6.1"
```

Run: `cd packages/cooklang-native && cargo update -p cooklang-find && cargo build`
Expected: builds cleanly (Cargo.lock now says `cooklang-find 0.6.1`).

- [ ] **Step 2: Write the failing Rust tests**

Append to `packages/cooklang-native/src/lib.rs`:

```rust
#[cfg(test)]
mod workspace_tools_tests {
    use super::*;

    fn temp_workspace() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cooklang-native-ws-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("Dinner")).unwrap();
        std::fs::write(
            dir.join("Dinner/Salmon Bowl.cook"),
            "---\ntitle: Salmon Rice Bowl\ntags: [fish, quick]\nservings: 2\n---\nBake @salmon{200%g} and serve on @rice{1%cup}.\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("Pancakes.cook"),
            "---\ntags: breakfast, sweet\n---\nMix @flour{200%g} and @milk{300%ml}.\n",
        )
        .unwrap();
        std::fs::write(dir.join("Week.menu"), "= Monday\n@./Pancakes{2}\n").unwrap();
        dir
    }

    #[test]
    fn search_recipes_ranks_query_matches_and_reports_metadata() {
        let dir = temp_workspace();
        let json = search_recipes(dir.to_string_lossy().to_string(), "salmon".to_string()).unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert!(!entries.is_empty());
        let first = &entries[0];
        assert!(first["path"].as_str().unwrap().ends_with("Dinner/Salmon Bowl.cook"));
        assert_eq!(first["name"], "Salmon Rice Bowl");
        assert_eq!(first["title"], "Salmon Rice Bowl");
        assert_eq!(first["tags"], serde_json::json!(["fish", "quick"]));
        assert_eq!(first["isMenu"], false);
        assert_eq!(first["servings"], 2);
        assert!(entries.iter().all(|e| !e["path"].as_str().unwrap().ends_with("Pancakes.cook")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn search_recipes_blank_query_lists_everything() {
        let dir = temp_workspace();
        let json = search_recipes(dir.to_string_lossy().to_string(), "   ".to_string()).unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e["path"].as_str().unwrap()).collect();
        assert_eq!(paths.len(), 3, "{paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("Pancakes.cook")));
        assert!(paths.iter().any(|p| p.ends_with("Week.menu")));
        let menu = entries.iter().find(|e| e["path"].as_str().unwrap().ends_with("Week.menu")).unwrap();
        assert_eq!(menu["isMenu"], true);
        assert_eq!(menu["title"], serde_json::Value::Null);
        std::fs::remove_dir_all(dir).ok();
    }

    const PANTRY: &str = r#"
[fridge]
milk = { expire = "10.05.2026", quantity = "1%L" }
eggs = "6"

[pantry]
flour = { quantity = "300%g", low = "500%g" }
salt = {}
"#;

    #[test]
    fn parse_pantry_reports_sections_items_and_low_stock() {
        let json = parse_pantry(PANTRY.to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let sections = v["sections"].as_array().unwrap();
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0]["name"], "fridge");
        let milk = &sections[0]["items"][0];
        assert_eq!(milk["name"], "milk");
        assert_eq!(milk["quantity"], "1%L");
        assert_eq!(milk["expire"], "10.05.2026");
        assert_eq!(milk["bought"], serde_json::Value::Null);
        assert_eq!(milk["isLow"], false);
        let flour = &sections[1]["items"][0];
        assert_eq!(flour["low"], "500%g");
        assert_eq!(flour["isLow"], true);
        assert_eq!(v["lowStock"], serde_json::json!([{ "name": "flour", "section": "pantry", "quantity": "300%g", "low": "500%g" }]));
    }

    #[test]
    fn parse_pantry_rejects_invalid_toml() {
        assert!(parse_pantry("[fridge\nmilk = ".to_string()).is_err());
    }

    #[test]
    fn check_pantry_is_case_insensitive_and_reports_misses() {
        let json = check_pantry(PANTRY.to_string(), vec!["Eggs".to_string(), "butter".to_string(), "flour".to_string()]).unwrap();
        let v: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(v[0], serde_json::json!({ "name": "Eggs", "inStock": true, "section": "fridge", "quantity": "6", "isLow": false }));
        assert_eq!(v[1], serde_json::json!({ "name": "butter", "inStock": false, "section": null, "quantity": null, "isLow": false }));
        assert_eq!(v[2]["inStock"], true);
        assert_eq!(v[2]["isLow"], true);
    }
}
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd packages/cooklang-native && cargo test workspace_tools_tests`
Expected: compile error — `search_recipes`, `parse_pantry`, `check_pantry` not found.

- [ ] **Step 4: Implement the exports**

Insert into `packages/cooklang-native/src/lib.rs` directly after `napi_compact_checked` (before the `ReportConfig` struct):

```rust
// ── Workspace tools (cookbot) ────────────────────────────────────────────────

/// One entry in the `search_recipes` result.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipeSearchEntry {
    path: String,
    name: Option<String>,
    title: Option<String>,
    tags: Vec<String>,
    is_menu: bool,
    servings: Option<i64>,
}

impl RecipeSearchEntry {
    fn from_entry(entry: &cooklang_find::RecipeEntry) -> Option<Self> {
        let path = entry.path()?.to_string();
        Some(Self {
            path,
            name: entry.name().clone(),
            title: entry.metadata().title().map(str::to_string),
            tags: entry.tags(),
            is_menu: entry.is_menu(),
            servings: entry.metadata().servings(),
        })
    }
}

/// Depth-first walk of a `RecipeTree`, collecting recipe entries in a stable
/// (path-sorted) order so a blank-query listing is deterministic.
fn collect_tree_recipes(tree: &cooklang_find::RecipeTree, out: &mut Vec<RecipeSearchEntry>) {
    if let Some(recipe) = &tree.recipe {
        if let Some(entry) = RecipeSearchEntry::from_entry(recipe) {
            out.push(entry);
        }
    }
    let mut children: Vec<&cooklang_find::RecipeTree> = tree.children.values().collect();
    children.sort_by(|a, b| a.path.cmp(&b.path));
    for child in children {
        collect_tree_recipes(child, out);
    }
}

/// Search recipes under `base_dir` the way `cook search` does
/// (`cooklang_find::search`: filename + content term scoring over `.cook` and
/// `.menu`). A blank query lists every recipe via `cooklang_find::build_tree`.
///
/// Returns JSON: `[{ path, name, title, tags, isMenu, servings }]`, best match first.
#[napi(js_name = "searchRecipes")]
pub fn search_recipes(base_dir: String, query: String) -> napi::Result<String> {
    let base = Utf8PathBuf::from(base_dir);
    let mut entries: Vec<RecipeSearchEntry> = Vec::new();
    if query.trim().is_empty() {
        let tree = cooklang_find::build_tree(&base)
            .map_err(|e| napi::Error::from_reason(format!("searchRecipes tree: {e}")))?;
        collect_tree_recipes(&tree, &mut entries);
    } else {
        let found = cooklang_find::search(&base, query.trim())
            .map_err(|e| napi::Error::from_reason(format!("searchRecipes: {e}")))?;
        entries.extend(found.iter().filter_map(RecipeSearchEntry::from_entry));
    }
    serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PantryItemJson {
    name: String,
    quantity: Option<String>,
    bought: Option<String>,
    expire: Option<String>,
    low: Option<String>,
    is_low: bool,
}

impl PantryItemJson {
    fn from_item(item: &cooklang::pantry::PantryItem) -> Self {
        Self {
            name: item.name().to_string(),
            quantity: item.quantity().map(str::to_string),
            bought: item.bought().map(str::to_string),
            expire: item.expire().map(str::to_string),
            low: item.low().map(str::to_string),
            is_low: item.is_low(),
        }
    }
}

fn parse_pantry_conf(text: &str) -> napi::Result<cooklang::pantry::PantryConf> {
    let result = cooklang::pantry::parse_lenient(text);
    let errors: Vec<String> = result.report().errors().map(|e| e.message.to_string()).collect();
    match result.into_output() {
        Some(conf) => Ok(conf),
        None => Err(napi::Error::from_reason(format!(
            "parsePantry: {}",
            if errors.is_empty() { "invalid pantry file".to_string() } else { errors.join("; ") }
        ))),
    }
}

/// Parse a `config/pantry.conf` (TOML) and return its sections and items.
///
/// Returns JSON: `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow }] }],
///                  lowStock: [{ name, section, quantity, low }] }`.
#[napi(js_name = "parsePantry")]
pub fn parse_pantry(text: String) -> napi::Result<String> {
    let conf = parse_pantry_conf(&text)?;
    let mut low_stock = Vec::new();
    let sections: Vec<serde_json::Value> = conf
        .sections
        .iter()
        .map(|(section, items)| {
            let items_json: Vec<PantryItemJson> = items
                .iter()
                .map(|item| {
                    let json = PantryItemJson::from_item(item);
                    if json.is_low {
                        low_stock.push(serde_json::json!({
                            "name": json.name,
                            "section": section,
                            "quantity": json.quantity,
                            "low": json.low,
                        }));
                    }
                    json
                })
                .collect();
            serde_json::json!({ "name": section, "items": items_json })
        })
        .collect();
    serde_json::to_string(&serde_json::json!({ "sections": sections, "lowStock": low_stock }))
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Check which of `names` are in the pantry (case-insensitive, via
/// `PantryConf::find_ingredient`).
///
/// Returns JSON: `[{ name, inStock, section, quantity, isLow }]` in input order.
#[napi(js_name = "checkPantry")]
pub fn check_pantry(text: String, names: Vec<String>) -> napi::Result<String> {
    let conf = parse_pantry_conf(&text)?;
    let results: Vec<serde_json::Value> = names
        .iter()
        .map(|name| match conf.find_ingredient(name) {
            Some((section, item)) => serde_json::json!({
                "name": name,
                "inStock": true,
                "section": section,
                "quantity": item.quantity(),
                "isLow": item.is_low(),
            }),
            None => serde_json::json!({
                "name": name,
                "inStock": false,
                "section": null,
                "quantity": null,
                "isLow": false,
            }),
        })
        .collect();
    serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
}
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/cooklang-native && cargo test workspace_tools_tests`
Expected: `test result: ok. 5 passed`. If `search_recipes_ranks_query_matches_and_reports_metadata` fails on `name`, check `cooklang_find::RecipeEntry::name()` — it prefers `title` metadata over the file stem (0.6.1 `model/recipe_entry.rs:221`); adjust only the assertion if the crate differs.

- [ ] **Step 6: Build the addon so `index.d.ts` gains the three functions**

Run: `cd packages/cooklang-native && npm run build`
Expected: `index.d.ts` now declares `searchRecipes(baseDir: string, query: string): string`, `parsePantry(text: string): string`, `checkPantry(text: string, names: Array<string>): string`. Verify: `grep -n "searchRecipes\|parsePantry\|checkPantry" index.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/lib.rs packages/cooklang-native/index.d.ts packages/cooklang-native/index.js
git commit -m "feat(native): searchRecipes, parsePantry, checkPantry exports for cookbot tools"
```

---

### Task 2: Language service RPC methods

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts:60-68` (after `findRecipe`)
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts:272-276` (after `findRecipe`)

- [ ] **Step 1: Add the interface methods**

In `packages/cooklang/src/common/cooklang-language-service.ts`, after the `findRecipe` declaration:

```ts
    /**
     * Search recipes under `baseDir` like `cook search` (cooklang-find: filename
     * + content term scoring over `.cook` and `.menu`). A blank query lists every
     * recipe. Same disk-access caveat as `findRecipe` (OS path, Electron-only).
     *
     * Returns JSON: `[{ path, name, title, tags, isMenu, servings }]`, best first.
     */
    searchRecipes(baseDir: string, query: string): Promise<string>;

    /**
     * Parse a `pantry.conf` (TOML). Returns JSON
     * `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow }] }], lowStock: [...] }`.
     * Rejects on an unparseable file.
     */
    parsePantry(text: string): Promise<string>;

    /**
     * Check which `names` are in the pantry (case-insensitive). Returns JSON
     * `[{ name, inStock, section, quantity, isLow }]` in input order.
     */
    checkPantry(text: string, names: string[]): Promise<string>;
```

- [ ] **Step 2: Implement them**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`, after `findRecipe`:

```ts
    async searchRecipes(baseDir: string, query: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.searchRecipes(baseDir, query);
    }

    async parsePantry(text: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.parsePantry(text);
    }

    async checkPantry(text: string, names: string[]): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.checkPantry(text, names);
    }
```

- [ ] **Step 3: Compile**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang`
Expected: success. (Any fake language service in existing specs is a structural class, not `implements CooklangLanguageService`, so nothing else needs the new methods — verify with `grep -rn "implements CooklangLanguageService" packages/cooklang/src` → only the impl.)

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): searchRecipes/parsePantry/checkPantry language-service RPCs"
```

---

### Task 3: Extract `RecipeReferenceResolver` and `ShoppingListService.computeResult`

Pure moves so the new tool and the existing commands share one implementation.

**Files:**
- Create: `packages/cooklang/src/browser/recipe-reference-resolver.ts`
- Create: `packages/cooklang/src/browser/recipe-reference-resolver.spec.ts`
- Modify: `packages/cooklang/src/browser/shopping-list-contribution.ts` (remove `collectResolvedRefs`, `resolveReferenceScale`, `parseNumberAndUnit`; inject the resolver)
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts:189-241`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts:129`

- [ ] **Step 1: Write the resolver spec**

`packages/cooklang/src/browser/recipe-reference-resolver.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { expect } from 'chai';
import { RecipeReferenceResolver } from './recipe-reference-resolver';

class FakeLanguageService {
    recipes = new Map<string, string>();
    async parseMenu(content: string, _scale: number): Promise<string> {
        // Content lines like "@./Pancakes{2}" or "@Cake{4%servings}"; metadata line "servings: 4".
        const lines: Array<Array<{ type: string; name?: string; scale?: number; unit?: string }>> = [];
        for (const line of content.split('\n')) {
            const m = line.match(/^@([^{]+)\{(\d+(?:\.\d+)?)(?:%([a-z]+))?\}$/);
            if (m) {
                lines.push([{ type: 'recipeReference', name: m[1], scale: parseFloat(m[2]), unit: m[3] }]);
            }
        }
        const servings = content.match(/servings:\s*(\S+)/)?.[1];
        const yieldValue = content.match(/yield:\s*(.+)/)?.[1];
        return JSON.stringify({ sections: [{ lines }], metadata: { servings, yield: yieldValue } });
    }
    async findRecipe(_baseDir: string, name: string): Promise<string | undefined> {
        return this.recipes.get(name);
    }
}

function createResolver(): { resolver: RecipeReferenceResolver; ls: FakeLanguageService } {
    const resolver = new RecipeReferenceResolver();
    const ls = new FakeLanguageService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resolver as any).languageService = ls;
    return { resolver, ls };
}

describe('RecipeReferenceResolver', () => {

    it('returns plain multipliers as-is and strips ./', async () => {
        const { resolver } = createResolver();
        const refs = await resolver.resolve('@./Pancakes{2}\n@Soup{1}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
    });

    it('resolves %servings against the referenced recipe metadata', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Cake', 'servings: 4');
        const refs = await resolver.resolve('@Cake{8%servings}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Cake', scale: 2 }]);
    });

    it('resolves a yield unit only when the units match', async () => {
        const { resolver, ls } = createResolver();
        ls.recipes.set('Stock', 'yield: 500%ml');
        ls.recipes.set('Dough', 'yield: 2%kg');
        const refs = await resolver.resolve('@Stock{1000%ml}\n@Dough{500%g}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Stock', scale: 2 }, { path: 'Dough', scale: 500 }]);
    });

    it('falls back to the raw number when the recipe cannot be found', async () => {
        const { resolver } = createResolver();
        const refs = await resolver.resolve('@Missing{3%servings}', '/ws');
        expect(refs).to.deep.equal([{ path: 'Missing', scale: 3 }]);
    });

    it('returns [] when parsing fails', async () => {
        const { resolver, ls } = createResolver();
        ls.parseMenu = async () => { throw new Error('boom'); };
        expect(await resolver.resolve('anything', '/ws')).to.deep.equal([]);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang`
Expected: compile error — `./recipe-reference-resolver` not found.

- [ ] **Step 3: Create the resolver (moved code)**

`packages/cooklang/src/browser/recipe-reference-resolver.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { CooklangLanguageService } from '../common/cooklang-language-service';

/** A `@recipe{…}` reference resolved to a concrete multiplier. */
export interface ResolvedRecipeReference {
    path: string;
    scale: number;
}

/**
 * Resolves `@recipe` sub-references in a `.cook`/`.menu` to `{ path, scale }`
 * pairs, since the `.shopping-list` format only stores a numeric multiplier.
 * Shared by the shopping-list commands and the `generateShoppingList` AI tool.
 *
 * Per spec/conventions.md:
 *   {2}            → plain multiplier
 *   {4%servings}   → target / recipe.servings
 *   {150%ml}       → target / recipe.yield (when units match)
 *
 * Unresolvable units fall back to treating the raw number as a multiplier —
 * same as when no metadata is present on the target.
 */
@injectable()
export class RecipeReferenceResolver {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    async resolve(content: string, baseDir: string): Promise<ResolvedRecipeReference[]> {
        let parsed: {
            sections?: Array<{
                lines?: Array<Array<{ type?: string; name?: string; scale?: number; unit?: string }>>;
            }>;
        };
        try {
            parsed = JSON.parse(await this.languageService.parseMenu(content, 1));
        } catch (e) {
            console.error('[shopping-list] Failed to parse content for refs:', e);
            return [];
        }

        const refs: Array<{ path: string; scale: number; unit?: string }> = [];
        for (const section of parsed.sections ?? []) {
            for (const line of section.lines ?? []) {
                for (const item of line) {
                    if (item.type !== 'recipeReference') { continue; }
                    if (!item.name) { continue; }
                    refs.push({
                        path: item.name.replace(/^\.\//, ''),
                        scale: typeof item.scale === 'number' && item.scale > 0 ? item.scale : 1,
                        unit: item.unit,
                    });
                }
            }
        }

        const out: ResolvedRecipeReference[] = [];
        for (const r of refs) {
            let scale = r.scale;
            if (r.unit && r.scale > 0) {
                const resolved = await this.resolveReferenceScale(baseDir, r.path, r.scale, r.unit);
                if (resolved !== undefined) {
                    scale = resolved;
                }
            }
            out.push({ path: r.path, scale });
        }
        return out;
    }

    /**
     * Compute the multiplier that, when applied to the referenced recipe,
     * yields the requested target.
     *
     * - `%servings` / `%serves` → reads the recipe's `servings` metadata.
     * - any other unit          → reads the recipe's `yield` metadata and
     *                             only resolves when the units match.
     *
     * Returns `undefined` when the recipe can't be found, the relevant
     * metadata is missing/unparseable, or the unit doesn't match.
     */
    protected async resolveReferenceScale(
        baseDir: string,
        recipePath: string,
        target: number,
        unit: string,
    ): Promise<number | undefined> {
        let content: string | undefined;
        try {
            content = await this.languageService.findRecipe(baseDir, recipePath);
        } catch (e) {
            console.warn(`[shopping-list] findRecipe failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!content) { return undefined; }

        let metadata: { servings?: string; yield?: string } | undefined;
        try {
            const menu = JSON.parse(await this.languageService.parseMenu(content, 1));
            metadata = menu?.metadata;
        } catch (e) {
            console.warn(`[shopping-list] parseMenu failed for ${recipePath}:`, e);
            return undefined;
        }
        if (!metadata) { return undefined; }

        const normalisedUnit = unit.toLowerCase();
        const isServings = normalisedUnit === 'servings' || normalisedUnit === 'serves';
        const raw = isServings ? metadata.servings : metadata.yield;
        if (!raw) { return undefined; }

        const parsed = parseNumberAndUnit(raw);
        if (!parsed || parsed.amount <= 0) { return undefined; }

        // For yield, the reference unit must match the recipe's yield unit.
        // For servings, the `%servings`/`%serves` label is the unit — any
        // trailing text in the metadata value (`"15 cups worth"`) is ignored.
        if (!isServings) {
            if (!parsed.unit || parsed.unit.toLowerCase() !== normalisedUnit) {
                return undefined;
            }
        }

        return target / parsed.amount;
    }
}

/**
 * Extract a leading positive number and optional unit from a metadata string.
 * Handles cooklang quantity syntax (`500%ml`), space-separated (`2 cups`), and
 * bare numbers (`2`).
 */
export function parseNumberAndUnit(value: string): { amount: number; unit?: string } | undefined {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*%?\s*([^\s]*)/);
    if (!match) { return undefined; }
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount)) { return undefined; }
    const unit = match[2] ? match[2] : undefined;
    return { amount, unit };
}
```

- [ ] **Step 4: Switch the contribution to the resolver**

In `packages/cooklang/src/browser/shopping-list-contribution.ts`:

1. Add the import: `import { RecipeReferenceResolver } from './recipe-reference-resolver';`
2. Add an injection next to the others (after `languageService`):
   ```ts
       @inject(RecipeReferenceResolver)
       protected readonly referenceResolver: RecipeReferenceResolver;
   ```
3. In `addRecipe` replace `includedRefs = await this.collectResolvedRefs(content.value, workspaceRoot.path.fsPath());` with `includedRefs = await this.referenceResolver.resolve(content.value, workspaceRoot.path.fsPath());`
4. In `addMenu` replace `const recipes = await this.collectResolvedRefs(menuContent, baseDir);` with `const recipes = await this.referenceResolver.resolve(menuContent, baseDir);`
5. Delete the `collectResolvedRefs` and `resolveReferenceScale` methods and the module-level `parseNumberAndUnit` function (with their doc comments). If `CooklangLanguageService`/`languageService` is now unused in the file, remove the import and injection; otherwise leave them.

- [ ] **Step 5: Extract `computeResult` in the service**

In `packages/cooklang/src/browser/shopping-list-service.ts` replace `regenerate()` (lines 189–241) with:

```ts
    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;

        if (this.list.items.length === 0) {
            this.result = undefined;
            this.onDidChangeEmitter.fire();
            return;
        }

        if (!this.getWorkspaceRootUri()) {
            return;
        }

        let result: ShoppingListResult | undefined;
        try {
            result = await this.computeResult(this.flattenForGeneration());
        } catch (e) {
            if (seq !== this.regenerationSeq) { return; }
            console.error('[shopping-list] Failed to generate shopping list:', e);
            result = undefined;
        }
        if (seq !== this.regenerationSeq) { return; }
        this.result = result;
        this.onDidChangeEmitter.fire();
    }

    /**
     * Headless aggregation: resolve each `{ path, scale }` through cooklang-find,
     * read `config/aisle.conf` + `config/pantry.conf`, and run the native
     * `generateShoppingList`. Does not touch the persisted list or `result`.
     * Missing recipes are skipped with a warning (as before). Throws when no
     * workspace is open or the native call fails.
     */
    async computeResult(items: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open');
        }
        const baseDir = root.path.fsPath();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of items) {
            try {
                // Use cooklang-find via RPC: auto-resolves `.cook`/`.menu` extensions
                // when paths from menu references are stored without one.
                const content = await this.languageService.findRecipe(baseDir, path);
                if (content === undefined) {
                    console.warn(`[shopping-list] Recipe not found: ${path}`);
                    continue;
                }
                recipeInputs.push({ content, scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${path}:`, e);
            }
        }

        const aisleConf = await this.readConfigFile(root, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(root, 'config/pantry.conf');

        const json = await this.languageService.generateShoppingList(
            JSON.stringify(recipeInputs),
            aisleConf,
            pantryConf,
        );
        return JSON.parse(json);
    }
```

Behavioural note: the old code checked `seq` between reading recipes and reading configs; the new code checks once after `computeResult`. Result assignment is still guarded, so a stale regenerate never overwrites a newer one.

- [ ] **Step 6: Bind the resolver**

In `packages/cooklang/src/browser/cooklang-frontend-module.ts`, add `import { RecipeReferenceResolver } from './recipe-reference-resolver';` and, right before `bind(ShoppingListService).toSelf().inSingletonScope();`:

```ts
    bind(RecipeReferenceResolver).toSelf().inSingletonScope();
```

- [ ] **Step 7: Compile and run the moved + existing specs**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml ./lib/browser/recipe-reference-resolver.spec.js ./lib/browser/shopping-list-service.spec.js
```
Expected: all passing (5 new + the existing ShoppingListService cases).

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang/src/browser/recipe-reference-resolver.ts packages/cooklang/src/browser/recipe-reference-resolver.spec.ts packages/cooklang/src/browser/shopping-list-contribution.ts packages/cooklang/src/browser/shopping-list-service.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "refactor(cooklang): extract RecipeReferenceResolver and ShoppingListService.computeResult"
```

---

### Task 4: `searchRecipes` tool

**Files:**
- Create: `packages/cooklang/src/browser/search-recipes-tool.ts`
- Create: `packages/cooklang/src/browser/search-recipes-tool.spec.ts`

- [ ] **Step 1: Write the spec**

`packages/cooklang/src/browser/search-recipes-tool.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { SearchRecipesTool } from './search-recipes-tool';

after(() => disableJSDOM());

interface NativeEntry { path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }

class FakeLanguageService {
    entries: NativeEntry[] = [];
    calls: Array<{ baseDir: string; query: string }> = [];
    async searchRecipes(baseDir: string, query: string): Promise<string> {
        this.calls.push({ baseDir, query });
        return JSON.stringify(this.entries);
    }
}

class FakeWorkspaceService {
    roots: URI[] = [new URI('file:///ws')];
    tryGetRoots(): Array<{ resource: URI }> {
        return this.roots.map(resource => ({ resource }));
    }
}

interface SearchResult {
    recipes?: Array<{ path: string; name: string | null; title: string | null; tags: string[]; isMenu: boolean; servings: number | null }>;
    total?: number;
    error?: string;
}

function createTool(): { tool: SearchRecipesTool; ls: FakeLanguageService; ws: FakeWorkspaceService } {
    const tool = new SearchRecipesTool();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).languageService = ls;
    (tool as any).workspaceService = ws;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, ls, ws };
}

async function invoke(tool: SearchRecipesTool, args: object): Promise<SearchResult> {
    return JSON.parse(await tool.getTool().handler(JSON.stringify(args)) as string);
}

const salmon: NativeEntry = { path: '/ws/Dinner/Salmon.cook', name: 'Salmon', title: 'Salmon Bowl', tags: ['Fish', 'quick'], isMenu: false, servings: 2 };
const pancakes: NativeEntry = { path: '/ws/Pancakes.cook', name: 'Pancakes', title: null, tags: ['breakfast'], isMenu: false, servings: null };
const menu: NativeEntry = { path: '/ws/Plans/Week.menu', name: 'Week', title: null, tags: [], isMenu: true, servings: null };

describe('SearchRecipesTool', () => {

    it('exposes searchRecipes with no required parameters', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('searchRecipes');
        expect(def.name).to.equal('searchRecipes');
        expect(def.parameters.required ?? []).to.deep.equal([]);
    });

    it('passes the workspace root path and query to the language service', async () => {
        const { tool, ls } = createTool();
        await invoke(tool, { query: 'salmon' });
        expect(ls.calls).to.deep.equal([{ baseDir: '/ws', query: 'salmon' }]);
    });

    it('sends a blank query when neither query nor tag is given', async () => {
        const { tool, ls } = createTool();
        await invoke(tool, {});
        expect(ls.calls[0].query).to.equal('');
    });

    it('returns workspace-relative paths and the recipe metadata', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, menu];
        const result = await invoke(tool, { query: 'x' });
        expect(result.recipes).to.deep.equal([
            { path: 'Dinner/Salmon.cook', name: 'Salmon', title: 'Salmon Bowl', tags: ['Fish', 'quick'], isMenu: false, servings: 2 },
            { path: 'Plans/Week.menu', name: 'Week', title: null, tags: [], isMenu: true, servings: null },
        ]);
        expect(result.total).to.equal(2);
    });

    it('filters by tag case-insensitively', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, pancakes];
        const result = await invoke(tool, { tag: 'fish' });
        expect(result.recipes?.map(r => r.path)).to.deep.equal(['Dinner/Salmon.cook']);
        expect(result.total).to.equal(1);
    });

    it('applies limit but reports the total before truncation', async () => {
        const { tool, ls } = createTool();
        ls.entries = [salmon, pancakes, menu];
        const result = await invoke(tool, { limit: 2 });
        expect(result.recipes).to.have.length(2);
        expect(result.total).to.equal(3);
    });

    it('caps limit at 100 and falls back to 20 for invalid values', async () => {
        const { tool, ls } = createTool();
        ls.entries = Array.from({ length: 150 }, (_, i) => ({ ...pancakes, path: `/ws/r${i}.cook` }));
        expect((await invoke(tool, { limit: 500 })).recipes).to.have.length(100);
        expect((await invoke(tool, { limit: 'lots' })).recipes).to.have.length(20);
    });

    it('errors without a workspace', async () => {
        const { tool, ws } = createTool();
        ws.roots = [];
        const result = await invoke(tool, { query: 'x' });
        expect(result.error).to.match(/workspace/i);
    });

    it('errors on invalid JSON arguments', async () => {
        const { tool } = createTool();
        const result = JSON.parse(await tool.getTool().handler('not json') as string);
        expect(result.error).to.match(/JSON/);
    });
});
```

- [ ] **Step 2: Compile to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang`
Expected: error — `./search-recipes-tool` not found.

- [ ] **Step 3: Implement the tool**

`packages/cooklang/src/browser/search-recipes-tool.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';

interface SearchRecipesArgs {
    query?: string;
    tag?: string;
    limit?: number;
}

/** Shape produced by the native `searchRecipes` export. */
interface NativeRecipeEntry {
    path: string;
    name: string | null;
    title: string | null;
    tags: string[];
    isMenu: boolean;
    servings: number | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * AI tool: search the user's own recipes the way `cook search` does
 * (cooklang-find, filename + content terms), optionally filtered by tag.
 * Read-only, auto-executes.
 */
@injectable()
export class SearchRecipesTool implements ToolProvider {

    static ID = 'searchRecipes';

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: SearchRecipesTool.ID,
            name: SearchRecipesTool.ID,
            displayName: 'Search Recipes',
            description: 'Search the recipes in the user\'s workspace (their own .cook and .menu files) like `cook search`: '
                + 'query words are matched against file names and file contents (ingredients, steps, metadata), best match first. '
                + 'Optionally keep only recipes carrying a tag. With neither query nor tag it lists every recipe. '
                + 'Prefer this over findFilesByPattern + getFileContent for "which of my recipes…" questions. '
                + 'Returns { recipes: [{ path (workspace-relative — pass it to getFileContent, renderTemplate or generateShoppingList), '
                + 'name, title, tags, isMenu, servings }], total }.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Words to match against recipe file names and contents, e.g. "salmon", "chocolate cake".',
                    },
                    tag: {
                        type: 'string',
                        description: 'Keep only recipes whose tags include this value (case-insensitive), e.g. "vegetarian".',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Maximum number of recipes to return. Default 20, max 100.',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: SearchRecipesArgs;
        try {
            args = JSON.parse(argString || '{}');
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) {
            return this.fail('No workspace is open.');
        }

        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
        const limit = this.normaliseLimit(args.limit);

        let entries: NativeRecipeEntry[];
        try {
            entries = JSON.parse(await this.languageService.searchRecipes(root.path.fsPath(), query));
        } catch (e) {
            return this.fail(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        const filtered = tag
            ? entries.filter(entry => entry.tags.some(t => t.toLowerCase() === tag))
            : entries;

        const recipes = filtered.slice(0, limit).map(entry => ({
            path: this.relativePath(root, entry.path),
            name: entry.name,
            title: entry.title,
            tags: entry.tags,
            isMenu: entry.isMenu,
            servings: entry.servings,
        }));
        return JSON.stringify({ recipes, total: filtered.length });
    }

    protected normaliseLimit(value: unknown): number {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n) || n < 1) {
            return DEFAULT_LIMIT;
        }
        return Math.min(Math.floor(n), MAX_LIMIT);
    }

    /** Workspace-relative path when the file is under the root, else the absolute path. */
    protected relativePath(root: URI, fsPath: string): string {
        const uri = new URI(fsPath).withScheme(root.scheme);
        return root.relative(uri)?.toString() ?? fsPath;
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }
}
```

- [ ] **Step 4: Compile and run the spec**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml ./lib/browser/search-recipes-tool.spec.js
```
Expected: 9 passing. If `relativePath` returns `undefined` for `file:///ws` vs `/ws/…`, use `URI.fromFilePath(fsPath)` (from `@theia/core/lib/common/uri`? — it is `new URI(FileUri.create(fsPath))`; the simplest robust form is `root.relative(new URI(fsPath).withScheme('file'))`; keep whichever the test proves).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/search-recipes-tool.ts packages/cooklang/src/browser/search-recipes-tool.spec.ts
git commit -m "feat(cooklang): searchRecipes AI tool backed by cooklang-find search"
```

---

### Task 5: `getPantry` and `checkPantry` tools

**Files:**
- Create: `packages/cooklang/src/browser/pantry-tools.ts`
- Create: `packages/cooklang/src/browser/pantry-tools.spec.ts`

- [ ] **Step 1: Write the spec**

`packages/cooklang/src/browser/pantry-tools.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { GetPantryTool, CheckPantryTool, PANTRY_CONF_PATH } from './pantry-tools';

after(() => disableJSDOM());

class FakeFileService {
    files = new Map<string, string>();
    async read(uri: URI): Promise<{ value: string }> {
        const value = this.files.get(uri.toString());
        if (value === undefined) { throw new Error(`ENOENT ${uri}`); }
        return { value };
    }
}

class FakeLanguageService {
    parsed = { sections: [{ name: 'fridge', items: [{ name: 'milk', quantity: '1%L', bought: null, expire: null, low: null, isLow: false }] }], lowStock: [] };
    parseCalls: string[] = [];
    checkCalls: Array<{ text: string; names: string[] }> = [];
    failParse = false;
    async parsePantry(text: string): Promise<string> {
        this.parseCalls.push(text);
        if (this.failParse) { throw new Error('parsePantry: TOML parse error'); }
        return JSON.stringify(this.parsed);
    }
    async checkPantry(text: string, names: string[]): Promise<string> {
        this.checkCalls.push({ text, names });
        return JSON.stringify(names.map(name => ({ name, inStock: name === 'milk', section: name === 'milk' ? 'fridge' : null, quantity: name === 'milk' ? '1%L' : null, isLow: false })));
    }
}

class FakeWorkspaceService {
    roots: URI[] = [new URI('file:///ws')];
    tryGetRoots(): Array<{ resource: URI }> {
        return this.roots.map(resource => ({ resource }));
    }
}

function wire<T extends object>(tool: T): { tool: T; fs: FakeFileService; ls: FakeLanguageService; ws: FakeWorkspaceService } {
    const fs = new FakeFileService();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).fileService = fs;
    (tool as any).languageService = ls;
    (tool as any).workspaceService = ws;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, fs, ls, ws };
}

const PANTRY_URI = 'file:///ws/config/pantry.conf';

describe('GetPantryTool', () => {

    it('exposes getPantry with no parameters', () => {
        const def = new GetPantryTool().getTool();
        expect(def.id).to.equal('getPantry');
        expect(Object.keys(def.parameters.properties)).to.deep.equal([]);
    });

    it('reads config/pantry.conf and returns the parsed pantry with its path', async () => {
        const { tool, fs, ls } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, '[fridge]\nmilk = "1%L"\n');
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(ls.parseCalls).to.deep.equal(['[fridge]\nmilk = "1%L"\n']);
        expect(result).to.deep.equal({ path: PANTRY_CONF_PATH, ...ls.parsed });
    });

    it('answers pantry: null with a message when the file is missing', async () => {
        const { tool } = wire(new GetPantryTool());
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(result.pantry).to.equal(null);
        expect(result.message).to.match(/config\/pantry\.conf/);
        expect(result.error).to.equal(undefined);
    });

    it('returns an error when parsing fails', async () => {
        const { tool, fs, ls } = wire(new GetPantryTool());
        fs.files.set(PANTRY_URI, 'garbage');
        ls.failParse = true;
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(result.error).to.match(/TOML/);
    });

    it('errors without a workspace', async () => {
        const { tool, ws } = wire(new GetPantryTool());
        ws.roots = [];
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(result.error).to.match(/workspace/i);
    });
});

describe('CheckPantryTool', () => {

    it('requires ingredients', () => {
        const def = new CheckPantryTool().getTool();
        expect(def.id).to.equal('checkPantry');
        expect(def.parameters.required).to.deep.equal(['ingredients']);
    });

    it('checks the given names against the pantry file', async () => {
        const { tool, fs, ls } = wire(new CheckPantryTool());
        fs.files.set(PANTRY_URI, '[fridge]\nmilk = "1%L"\n');
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ ingredients: ['milk', 'eggs'] })) as string);
        expect(ls.checkCalls).to.deep.equal([{ text: '[fridge]\nmilk = "1%L"\n', names: ['milk', 'eggs'] }]);
        expect(result.results).to.deep.equal([
            { name: 'milk', inStock: true, section: 'fridge', quantity: '1%L', isLow: false },
            { name: 'eggs', inStock: false, section: null, quantity: null, isLow: false },
        ]);
    });

    it('reports every ingredient as out of stock when the pantry file is missing', async () => {
        const { tool, ls } = wire(new CheckPantryTool());
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ ingredients: ['milk'] })) as string);
        expect(ls.checkCalls).to.deep.equal([]);
        expect(result.results).to.deep.equal([{ name: 'milk', inStock: false, section: null, quantity: null, isLow: false }]);
        expect(result.message).to.match(/config\/pantry\.conf/);
    });

    it('rejects an empty or non-array ingredients argument', async () => {
        const { tool } = wire(new CheckPantryTool());
        expect(JSON.parse(await tool.getTool().handler(JSON.stringify({ ingredients: [] })) as string).error).to.match(/ingredients/);
        expect(JSON.parse(await tool.getTool().handler(JSON.stringify({ ingredients: 'milk' })) as string).error).to.match(/ingredients/);
    });

    it('caps at 100 ingredients', async () => {
        const { tool } = wire(new CheckPantryTool());
        const many = Array.from({ length: 101 }, (_, i) => `i${i}`);
        expect(JSON.parse(await tool.getTool().handler(JSON.stringify({ ingredients: many })) as string).error).to.match(/100/);
    });
});
```

- [ ] **Step 2: Compile to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang`
Expected: error — `./pantry-tools` not found.

- [ ] **Step 3: Implement both tools**

`packages/cooklang/src/browser/pantry-tools.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

/* eslint-disable no-null/no-null */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CooklangLanguageService } from '../common/cooklang-language-service';

/** Workspace-relative location of the pantry file (same convention as the shopping list). */
export const PANTRY_CONF_PATH = 'config/pantry.conf';

const MAX_CHECK_NAMES = 100;

const NO_PANTRY_MESSAGE = `No ${PANTRY_CONF_PATH} in this workspace.`;

/**
 * Shared plumbing: locate the workspace root and read the pantry file.
 * `undefined` text means "no pantry file"; a missing workspace throws.
 */
abstract class PantryToolBase {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    protected async readPantryText(): Promise<string | undefined> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) {
            throw new Error('No workspace is open.');
        }
        try {
            return (await this.fileService.read(root.resolve(PANTRY_CONF_PATH))).value;
        } catch {
            return undefined;
        }
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }
}

/**
 * AI tool: return the parsed `config/pantry.conf` (sections, items with
 * quantity/bought/expire/low, and the low-stock items). Read-only.
 */
@injectable()
export class GetPantryTool extends PantryToolBase implements ToolProvider {

    static ID = 'getPantry';

    getTool(): ToolRequest {
        return {
            id: GetPantryTool.ID,
            name: GetPantryTool.ID,
            displayName: 'Get Pantry',
            description: `Read the user's pantry inventory from ${PANTRY_CONF_PATH} (the file CookCLI's \`cook pantry\` reads). `
                + 'Returns { path, sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow }] }], lowStock: [{ name, section, quantity, low }] } '
                + '— or { pantry: null, message } when the workspace has no pantry file (that is a valid answer, not an error). '
                + 'Use checkPantry to test specific ingredients instead of scanning this list.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => this.execute(),
        };
    }

    protected async execute(): Promise<string> {
        let text: string | undefined;
        try {
            text = await this.readPantryText();
        } catch (e) {
            return this.fail(e instanceof Error ? e.message : String(e));
        }
        if (text === undefined) {
            return JSON.stringify({ pantry: null, message: NO_PANTRY_MESSAGE });
        }
        try {
            const parsed = JSON.parse(await this.languageService.parsePantry(text));
            return JSON.stringify({ path: PANTRY_CONF_PATH, ...parsed });
        } catch (e) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

/**
 * AI tool: check whether given ingredients are in the pantry. Read-only.
 */
@injectable()
export class CheckPantryTool extends PantryToolBase implements ToolProvider {

    static ID = 'checkPantry';

    getTool(): ToolRequest {
        return {
            id: CheckPantryTool.ID,
            name: CheckPantryTool.ID,
            displayName: 'Check Pantry',
            description: `Check which ingredients the user has in stock according to ${PANTRY_CONF_PATH} (case-insensitive name match). `
                + 'Returns { results: [{ name, inStock, section, quantity, isLow }] } in the order given; when there is no pantry file every '
                + 'ingredient is inStock:false and a message says so. Use plain ingredient names ("eggs", "olive oil"), 1–100 per call.',
            parameters: {
                type: 'object',
                properties: {
                    ingredients: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ingredient names to look up, e.g. ["eggs", "olive oil"].',
                    },
                },
                required: ['ingredients'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: { ingredients?: unknown };
        try {
            args = JSON.parse(argString || '{}');
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const names = Array.isArray(args.ingredients)
            ? args.ingredients.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map(n => n.trim())
            : [];
        if (names.length === 0) {
            return this.fail('ingredients must be a non-empty array of ingredient names.');
        }
        if (names.length > MAX_CHECK_NAMES) {
            return this.fail(`ingredients: at most ${MAX_CHECK_NAMES} names per call.`);
        }

        let text: string | undefined;
        try {
            text = await this.readPantryText();
        } catch (e) {
            return this.fail(e instanceof Error ? e.message : String(e));
        }
        if (text === undefined) {
            return JSON.stringify({
                results: names.map(name => ({ name, inStock: false, section: null, quantity: null, isLow: false })),
                message: NO_PANTRY_MESSAGE,
            });
        }
        try {
            const results = JSON.parse(await this.languageService.checkPantry(text, names));
            return JSON.stringify({ results });
        } catch (e) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
```

- [ ] **Step 4: Compile and run the spec**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml ./lib/browser/pantry-tools.spec.js
```
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/pantry-tools.ts packages/cooklang/src/browser/pantry-tools.spec.ts
git commit -m "feat(cooklang): getPantry and checkPantry AI tools"
```

---

### Task 6: `generateShoppingList` tool

**Files:**
- Create: `packages/cooklang/src/browser/generate-shopping-list-tool.ts`
- Create: `packages/cooklang/src/browser/generate-shopping-list-tool.spec.ts`

- [ ] **Step 1: Write the spec**

`packages/cooklang/src/browser/generate-shopping-list-tool.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { GenerateShoppingListTool } from './generate-shopping-list-tool';
import { ShoppingListResult } from '../common/shopping-list-types';

after(() => disableJSDOM());

const RESULT: ShoppingListResult = {
    categories: [{ name: 'produce', items: [{ name: 'garlic', quantities: '3 cloves' }] }],
    other: { name: 'other', items: [] },
    pantryItems: ['salt'],
};

class FakeShoppingListService {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: Array<Array<{ path: string; scale: number }>> = [];
    addRecipeCalls: Array<{ path: string; scale: number; refs?: Array<{ path: string; scale: number }> }> = [];
    addMenuCalls: Array<{ path: string; scale: number; recipes: Array<{ path: string; scale: number }> }> = [];
    current: ShoppingListResult | undefined = RESULT;
    getWorkspaceRootUri(): URI | undefined { return this.root; }
    async computeResult(items: Array<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        this.computeCalls.push(items);
        return RESULT;
    }
    async addRecipe(path: string, scale: number, refs?: Array<{ path: string; scale: number }>): Promise<void> {
        this.addRecipeCalls.push({ path, scale, refs });
    }
    async addMenu(path: string, scale: number, recipes: Array<{ path: string; scale: number }>): Promise<void> {
        this.addMenuCalls.push({ path, scale, recipes });
    }
    getResult(): ShoppingListResult | undefined { return this.current; }
}

class FakeFileService {
    files = new Map<string, string>();
    async exists(uri: URI): Promise<boolean> { return this.files.has(uri.toString()); }
    async read(uri: URI): Promise<{ value: string }> {
        const value = this.files.get(uri.toString());
        if (value === undefined) { throw new Error(`ENOENT ${uri}`); }
        return { value };
    }
}

class FakeResolver {
    refs = new Map<string, Array<{ path: string; scale: number }>>();
    async resolve(content: string, _baseDir: string): Promise<Array<{ path: string; scale: number }>> {
        return this.refs.get(content) ?? [];
    }
}

class FakeContribution {
    opened: Array<{ activate?: boolean }> = [];
    async openView(options: { activate?: boolean }): Promise<void> { this.opened.push(options); }
}

function createTool(): { tool: GenerateShoppingListTool; svc: FakeShoppingListService; fs: FakeFileService; resolver: FakeResolver; view: FakeContribution } {
    const tool = new GenerateShoppingListTool();
    const svc = new FakeShoppingListService();
    const fs = new FakeFileService();
    const resolver = new FakeResolver();
    const view = new FakeContribution();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).shoppingListService = svc;
    (tool as any).fileService = fs;
    (tool as any).referenceResolver = resolver;
    (tool as any).shoppingListContribution = view;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, svc, fs, resolver, view };
}

async function invoke(tool: GenerateShoppingListTool, args: object): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return JSON.parse(await tool.getTool().handler(JSON.stringify(args)) as string);
}

describe('GenerateShoppingListTool', () => {

    it('exposes generateShoppingList with no required parameters', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('generateShoppingList');
        expect(def.parameters.required ?? []).to.deep.equal([]);
    });

    it('computes a headless list for recipes (default scale 1) and returns it with the inputs', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'x');
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook' }] });
        expect(svc.computeCalls).to.deep.equal([[{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }]]);
        expect(result).to.deep.equal({ ...RESULT, recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Soup.cook', scale: 1 }] });
        expect(svc.addRecipeCalls).to.deep.equal([]);
    });

    it('includes sub-recipe references in the headless computation', async () => {
        const { tool, svc, fs, resolver } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        resolver.refs.set('pie', [{ path: 'Dough', scale: 0.5 }]);
        await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }] });
        expect(svc.computeCalls[0]).to.deep.equal([{ path: 'Pie.cook', scale: 2 }, { path: 'Dough', scale: 1 }]);
    });

    it('expands a menu into its recipes', async () => {
        const { tool, svc, fs, resolver } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu' });
        expect(svc.computeCalls[0]).to.deep.equal([{ path: 'Plans/Week.menu', scale: 1 }, { path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
        expect(result.recipes).to.deep.equal([{ path: 'Pancakes', scale: 2 }, { path: 'Soup', scale: 1 }]);
    });

    it('requires exactly one of recipes / menu', async () => {
        const { tool } = createTool();
        expect((await invoke(tool, {})).error).to.match(/exactly one/i);
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }], menu: 'm.menu' })).error).to.match(/exactly one/i);
    });

    it('errors before adding anything when a recipe is missing', async () => {
        const { tool, svc, fs } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }, { path: 'Nope.cook' }], addToList: true });
        expect(result.error).to.equal('Recipe not found: Nope.cook');
        expect(svc.addRecipeCalls).to.deep.equal([]);
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('addToList adds each recipe with its refs, opens the view and returns the live list', async () => {
        const { tool, svc, fs, resolver, view } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        resolver.refs.set('pie', [{ path: 'Dough', scale: 0.5 }]);
        const result = await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }], addToList: true });
        expect(svc.addRecipeCalls).to.deep.equal([{ path: 'Pie.cook', scale: 2, refs: [{ path: 'Dough', scale: 0.5 }] }]);
        expect(view.opened).to.deep.equal([{ activate: true }]);
        expect(result).to.deep.equal({ ...RESULT, added: true, recipes: [{ path: 'Pie.cook', scale: 2 }] });
        expect(svc.computeCalls).to.deep.equal([]);
    });

    it('addToList with a menu calls addMenu', async () => {
        const { tool, svc, fs, resolver } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }]);
        await invoke(tool, { menu: 'Plans/Week.menu', addToList: true });
        expect(svc.addMenuCalls).to.deep.equal([{ path: 'Plans/Week.menu', scale: 1, recipes: [{ path: 'Pancakes', scale: 2 }] }]);
    });

    it('errors without a workspace', async () => {
        const { tool, svc } = createTool();
        svc.root = undefined;
        expect((await invoke(tool, { recipes: [{ path: 'a.cook' }] })).error).to.match(/workspace/i);
    });
});
```

- [ ] **Step 2: Compile to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang`
Expected: error — `./generate-shopping-list-tool` not found.

- [ ] **Step 3: Implement the tool**

`packages/cooklang/src/browser/generate-shopping-list-tool.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListContribution } from './shopping-list-contribution';
import { RecipeReferenceResolver, ResolvedRecipeReference } from './recipe-reference-resolver';

interface GenerateShoppingListArgs {
    recipes?: Array<{ path?: string; scale?: number }>;
    menu?: string;
    addToList?: boolean;
}

interface RecipeInput {
    path: string;
    scale: number;
    /** Sub-recipe references with multipliers relative to the recipe itself. */
    refs: ResolvedRecipeReference[];
}

/**
 * AI tool: build a shopping list from recipes (each with a scale) or from a
 * `.menu`, aisle-grouped and pantry-subtracted — the same aggregation as the
 * Shopping List view. Headless by default; `addToList: true` also adds the
 * items to the user's live shopping list and opens the view.
 */
@injectable()
export class GenerateShoppingListTool implements ToolProvider {

    static ID = 'generateShoppingList';

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    @inject(ShoppingListContribution)
    protected readonly shoppingListContribution: ShoppingListContribution;

    @inject(RecipeReferenceResolver)
    protected readonly referenceResolver: RecipeReferenceResolver;

    @inject(FileService)
    protected readonly fileService: FileService;

    getTool(): ToolRequest {
        return {
            id: GenerateShoppingListTool.ID,
            name: GenerateShoppingListTool.ID,
            displayName: 'Generate Shopping List',
            description: 'Build a shopping list from recipes (with optional scale multipliers) or from a .menu file — ingredients '
                + 'aggregated, grouped by aisle (config/aisle.conf), pantry items (config/pantry.conf) subtracted, sub-recipe references '
                + 'included — exactly like the Shopping List view / `cook shopping-list`. Pass exactly one of `recipes` or `menu`. '
                + 'By default it only returns the computed list ({ categories: [{ name, items: [{ name, quantities }] }], other, pantryItems, recipes }). '
                + 'With addToList:true it also adds the recipes to the user\'s live shopping list, opens the Shopping List view and returns the whole current list. '
                + 'Paths are workspace-relative (use searchRecipes to find them).',
            parameters: {
                type: 'object',
                properties: {
                    recipes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'Workspace-relative path of a .cook file, e.g. "Dinner/Carbonara.cook".' },
                                scale: { type: 'number', description: 'Multiplier for this recipe. Default 1.' },
                            },
                            required: ['path'],
                        },
                        description: 'Recipes to include. Mutually exclusive with `menu`.',
                    },
                    menu: {
                        type: 'string',
                        description: 'Workspace-relative path of a .menu file whose recipe references (with their scales) form the list. Mutually exclusive with `recipes`.',
                    },
                    addToList: {
                        type: 'boolean',
                        description: 'When true, also add to the user\'s live shopping list and open the view. Default false (headless).',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: GenerateShoppingListArgs;
        try {
            args = JSON.parse(argString || '{}');
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const hasRecipes = Array.isArray(args.recipes) && args.recipes.length > 0;
        const hasMenu = typeof args.menu === 'string' && args.menu.trim().length > 0;
        if (hasRecipes === hasMenu) {
            return this.fail('Pass exactly one of `recipes` (non-empty) or `menu`.');
        }
        const root = this.shoppingListService.getWorkspaceRootUri();
        if (!root) {
            return this.fail('No workspace is open.');
        }
        const baseDir = root.path.fsPath();

        try {
            if (hasMenu) {
                return await this.fromMenu(root, baseDir, args.menu!.trim(), !!args.addToList);
            }
            return await this.fromRecipes(root, baseDir, args.recipes!, !!args.addToList);
        } catch (e) {
            return this.fail(e instanceof Error ? e.message : String(e));
        }
    }

    protected async fromRecipes(root: URI, baseDir: string, requested: Array<{ path?: string; scale?: number }>, addToList: boolean): Promise<string> {
        const inputs: RecipeInput[] = [];
        for (const r of requested) {
            const path = typeof r.path === 'string' ? r.path.trim() : '';
            if (!path) {
                return this.fail('Every recipe needs a `path`.');
            }
            const scale = typeof r.scale === 'number' && r.scale > 0 ? r.scale : 1;
            const content = await this.readWorkspaceFile(root, path);
            if (content === undefined) {
                return this.fail(`Recipe not found: ${path}`);
            }
            const refs = await this.referenceResolver.resolve(content, baseDir);
            inputs.push({ path, scale, refs });
        }

        const summary = inputs.map(({ path, scale }) => ({ path, scale }));
        if (addToList) {
            for (const input of inputs) {
                await this.shoppingListService.addRecipe(input.path, input.scale, input.refs);
            }
            await this.shoppingListContribution.openView({ activate: true });
            return JSON.stringify({ ...this.currentResult(), added: true, recipes: summary });
        }

        const flat: Array<{ path: string; scale: number }> = [];
        for (const input of inputs) {
            flat.push({ path: input.path, scale: input.scale });
            for (const ref of input.refs) {
                flat.push({ path: ref.path, scale: ref.scale * input.scale });
            }
        }
        const result = await this.shoppingListService.computeResult(flat);
        return JSON.stringify({ ...result, recipes: summary });
    }

    protected async fromMenu(root: URI, baseDir: string, menuPath: string, addToList: boolean): Promise<string> {
        const content = await this.readWorkspaceFile(root, menuPath);
        if (content === undefined) {
            return this.fail(`Menu not found: ${menuPath}`);
        }
        const recipes = await this.referenceResolver.resolve(content, baseDir);
        if (recipes.length === 0) {
            return this.fail(`Menu contains no recipe references: ${menuPath}`);
        }

        if (addToList) {
            await this.shoppingListService.addMenu(menuPath, 1, recipes);
            await this.shoppingListContribution.openView({ activate: true });
            return JSON.stringify({ ...this.currentResult(), added: true, recipes });
        }

        // Same flattening as ShoppingListService.flattenForGeneration for a menu
        // item: the menu itself (own ingredients, if any) plus each referenced recipe.
        const flat = [{ path: menuPath, scale: 1 }, ...recipes];
        const result = await this.shoppingListService.computeResult(flat);
        return JSON.stringify({ ...result, recipes });
    }

    /** Reads a workspace-relative (or absolute / file://) path; undefined when it does not exist. */
    protected async readWorkspaceFile(root: URI, path: string): Promise<string | undefined> {
        const uri = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.startsWith('/')
            ? new URI(path).normalizePath()
            : root.resolve(path).normalizePath();
        if (!(await this.fileService.exists(uri))) {
            return undefined;
        }
        return (await this.fileService.read(uri)).value;
    }

    protected currentResult(): object {
        return this.shoppingListService.getResult() ?? { categories: [], other: { name: 'other', items: [] }, pantryItems: [] };
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }
}
```

Note: the flattening for headless recipes multiplies ref scale by the parent scale (mirrors `flattenForGeneration`); the test "includes sub-recipe references" expects `Dough` at `0.5 * 2 = 1`.

- [ ] **Step 4: Compile and run the spec**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang
cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml ./lib/browser/generate-shopping-list-tool.spec.js
```
Expected: 10 passing. If importing `ShoppingListContribution` at module load pulls browser-only modules that jsdom cannot satisfy, replace the direct import with a type-only import plus a local symbol: `import type { ShoppingListContribution } from './shopping-list-contribution';` and inject via `@inject(Symbol.for('ShoppingListContribution'))` is *not* how the module binds it — instead keep the value import and rely on the jsdom preamble (the report tools already import widget-heavy modules the same way). Only if that fails, inject `CommandService` and execute `'cooklang.toggleShoppingList'` guarded by `WidgetManager.tryGetWidget(SHOPPING_LIST_WIDGET_ID)`.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/generate-shopping-list-tool.ts packages/cooklang/src/browser/generate-shopping-list-tool.spec.ts
git commit -m "feat(cooklang): generateShoppingList AI tool (headless or add-to-list)"
```

---

### Task 7: Bind the workspace tools

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts:46-48,112-113`

- [ ] **Step 1: Add imports and bindings**

Imports (next to `ListReportTemplatesTool`):

```ts
import { SearchRecipesTool } from './search-recipes-tool';
import { GetPantryTool, CheckPantryTool } from './pantry-tools';
import { GenerateShoppingListTool } from './generate-shopping-list-tool';
```

Bindings, after `bindToolProvider(ListReportTemplatesTool, bind);`:

```ts
    // Workspace tools for cookbot (issue #82): recipe search, pantry, shopping list
    bindToolProvider(SearchRecipesTool, bind);
    bindToolProvider(GetPantryTool, bind);
    bindToolProvider(CheckPantryTool, bind);
    bindToolProvider(GenerateShoppingListTool, bind);
```

`GenerateShoppingListTool` injects `ShoppingListContribution`, which is bound later in the same module via `bindViewContribution` — Inversify resolves lazily, order does not matter.

- [ ] **Step 2: Compile, lint, run the package tests**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
npx lerna run test --scope @theia/cooklang
```
Expected: compile clean, lint clean (fix any `max-len`/unused-import complaints inline), all specs passing.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): register workspace AI tools"
```

---

### Task 8: Proto + gRPC client + server-tools protocol/service for the catalog RPCs

**Files:**
- Modify: `packages/cooklang-ai/proto/cookbot.proto`
- Modify: `packages/cooklang-ai/src/common/cookbot-server-tools-protocol.ts`
- Modify: `packages/cooklang-ai/src/node/cookbot-grpc-client.ts` (after `doConvertTextToCooklang`, ~line 325)
- Modify: `packages/cooklang-ai/src/node/cookbot-server-tools-service.ts`

- [ ] **Step 1: Copy the proto from the cook.md repo**

The cook.md plan (`cook.md/docs/superpowers/plans/2026-08-18-cookbot-catalog-search.md`) edits `cook.md/cookbot/proto/cookbot.proto` first. Copy it so both files stay byte-identical:

```bash
cp ../cook.md/cookbot/proto/cookbot.proto packages/cooklang-ai/proto/cookbot.proto
git diff --stat packages/cooklang-ai/proto/cookbot.proto
```

The diff must contain exactly these additions (and nothing else). In the `service CookbotService` block, after `rpc ConvertTextToCooklang(ConvertTextRequest) returns (ConvertResponse);`:

```proto

  // Recipe catalog (cook.md kickstart catalog, forwarded to Rails)
  rpc SearchRecipeCatalog(SearchRecipeCatalogRequest) returns (SearchRecipeCatalogResponse);
  rpc GetCatalogRecipe(GetCatalogRecipeRequest) returns (CatalogRecipe);
```

At the end of the file, after `message ConvertResponse { … }`:

```proto

// Recipe catalog (cook.md kickstart catalog, forwarded to Rails)

message SearchRecipeCatalogRequest {
  string session_id = 1;
  string criteria_json = 2;   // JSON object; schema owned by Rails/editor
}

message SearchRecipeCatalogResponse {
  string results_json = 1;    // Rails response body verbatim: { recipes: [...], hint: null|string }
}

message GetCatalogRecipeRequest {
  string session_id = 1;
  string recipe_id = 2;
}

message CatalogRecipe {
  string id = 1;
  string title = 2;
  string meal_type = 3;
  string course = 4;
  string content = 5;         // .cook file content incl. YAML frontmatter
  string suggested_path = 6;  // e.g. "Dinner/Spaghetti Carbonara.cook"
}
```

If the cook.md side is not done yet, apply exactly the text above by hand to `packages/cooklang-ai/proto/cookbot.proto` and re-run the `cp` + `git diff` check once it lands (`diff ../cook.md/cookbot/proto/cookbot.proto packages/cooklang-ai/proto/cookbot.proto` must print nothing).

- [ ] **Step 2: Extend the common protocol**

In `packages/cooklang-ai/src/common/cookbot-server-tools-protocol.ts` add to the interface:

```ts
    /**
     * Search the cook.md curated recipe catalog. `criteria` is forwarded as JSON
     * (see CookbotSearchRecipeCatalogTool for the schema); resolves with the
     * server's parsed `{ recipes, hint }` body.
     */
    searchRecipeCatalog(criteria: object): Promise<unknown>;
    /** Fetch one catalog recipe (content + suggested workspace path) by id. */
    getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe>;
```

and the type at the end of the file:

```ts
export interface CookbotCatalogRecipe {
    id: string;
    title: string;
    mealType: string;
    course: string;
    content: string;
    suggestedPath: string;
}
```

- [ ] **Step 3: Add the gRPC client methods**

In `packages/cooklang-ai/src/node/cookbot-grpc-client.ts` import `CookbotCatalogRecipe` alongside the other protocol types (find the import of `CookbotSearchResult` and extend it), then add after `doConvertTextToCooklang`:

```ts
    async searchRecipeCatalog(criteriaJson: string): Promise<string> {
        return this.withReconnectRetry('SearchRecipeCatalog', () => this.doSearchRecipeCatalog(criteriaJson));
    }

    protected async doSearchRecipeCatalog(criteriaJson: string): Promise<string> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.SearchRecipeCatalog({
                sessionId: this.sessionId || '',
                criteriaJson,
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(response.resultsJson ?? '');
            });
        });
    }

    async getCatalogRecipe(recipeId: string): Promise<CookbotCatalogRecipe> {
        return this.withReconnectRetry('GetCatalogRecipe', () => this.doGetCatalogRecipe(recipeId));
    }

    protected async doGetCatalogRecipe(recipeId: string): Promise<CookbotCatalogRecipe> {
        this.ensureConnected();
        return new Promise((resolve, reject) => {
            this.service.GetCatalogRecipe({
                sessionId: this.sessionId || '',
                recipeId,
            }, (err: grpc.ServiceError | null, response: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    id: response.id,
                    title: response.title,
                    mealType: response.mealType,
                    course: response.course,
                    content: response.content,
                    suggestedPath: response.suggestedPath,
                });
            });
        });
    }
```

(proto-loader is configured with `keepCase: false`, so `criteria_json` → `criteriaJson`, `results_json` → `resultsJson`, `suggested_path` → `suggestedPath`.)

- [ ] **Step 4: Forward in the backend service**

In `packages/cooklang-ai/src/node/cookbot-server-tools-service.ts` extend the import list with `CookbotCatalogRecipe` and add:

```ts
    async searchRecipeCatalog(criteria: object): Promise<unknown> {
        const resultsJson = await this.grpcClient.searchRecipeCatalog(JSON.stringify(criteria ?? {}));
        try {
            return JSON.parse(resultsJson);
        } catch {
            throw new Error('Catalog search returned an unreadable response.');
        }
    }

    async getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe> {
        return this.grpcClient.getCatalogRecipe(id);
    }
```

- [ ] **Step 5: Compile**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang-ai`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-ai/proto/cookbot.proto packages/cooklang-ai/src/common/cookbot-server-tools-protocol.ts packages/cooklang-ai/src/node/cookbot-grpc-client.ts packages/cooklang-ai/src/node/cookbot-server-tools-service.ts
git commit -m "feat(cooklang-ai): SearchRecipeCatalog/GetCatalogRecipe RPC plumbing"
```

---

### Task 9: `searchRecipeCatalog` tool

**Files:**
- Create: `packages/cooklang-ai/src/browser/catalog-recipe-tools.ts` (this task adds the search tool; Task 10 adds `addCatalogRecipe` to the same file)
- Create: `packages/cooklang-ai/src/browser/catalog-recipe-tools.spec.ts`

- [ ] **Step 1: Write the spec (search part)**

`packages/cooklang-ai/src/browser/catalog-recipe-tools.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { URI } from '@theia/core';
import { CookbotSearchRecipeCatalogTool, CookbotAddCatalogRecipeTool } from './catalog-recipe-tools';
import { CookbotCatalogRecipe } from '../common/cookbot-server-tools-protocol';

after(() => disableJSDOM());

class FakeServerTools {
    searchCalls: object[] = [];
    searchResponse: unknown = { recipes: [], hint: null };
    searchError: Error | undefined;
    recipes = new Map<string, CookbotCatalogRecipe>();
    async searchRecipeCatalog(criteria: object): Promise<unknown> {
        this.searchCalls.push(criteria);
        if (this.searchError) { throw this.searchError; }
        return this.searchResponse;
    }
    async getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe> {
        const recipe = this.recipes.get(id);
        if (!recipe) { throw new Error('5 NOT_FOUND: recipe not found'); }
        return recipe;
    }
}

const CARBONARA: CookbotCatalogRecipe = {
    id: 'dinner-1-0042-carbonara',
    title: 'Spaghetti Carbonara',
    mealType: 'dinner',
    course: 'main',
    content: '---\ntitle: Spaghetti Carbonara\n---\n\nBoil @spaghetti{200%g}.\n',
    suggestedPath: 'Dinner/Spaghetti Carbonara.cook',
};

describe('CookbotSearchRecipeCatalogTool', () => {

    function createTool(): { tool: CookbotSearchRecipeCatalogTool; server: FakeServerTools } {
        const tool = new CookbotSearchRecipeCatalogTool();
        const server = new FakeServerTools();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any).serverTools = server;
        return { tool, server };
    }

    it('exposes searchRecipeCatalog with no required parameters and enum vocabularies', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('searchRecipeCatalog');
        expect(def.parameters.required ?? []).to.deep.equal([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = def.parameters.properties as any;
        expect(props.course.enum).to.deep.equal(['main', 'side', 'drink', 'sauce', 'accompaniment', 'any']);
        expect(props.dietary.items.enum).to.include('vegetarian');
        expect(props.meal_types.items.enum).to.deep.equal(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']);
    });

    it('forwards the parsed arguments as criteria and returns the server JSON', async () => {
        const { tool, server } = createTool();
        server.searchResponse = { recipes: [{ id: 'x', title: 'X' }], hint: null };
        const raw = await tool.getTool().handler(JSON.stringify({ dietary: ['vegetarian'], meal_types: ['dinner'], limit: 3 }));
        expect(server.searchCalls).to.deep.equal([{ dietary: ['vegetarian'], meal_types: ['dinner'], limit: 3 }]);
        expect(JSON.parse(raw as string)).to.deep.equal({ recipes: [{ id: 'x', title: 'X' }], hint: null });
    });

    it('sends {} for empty arguments', async () => {
        const { tool, server } = createTool();
        await tool.getTool().handler('');
        expect(server.searchCalls).to.deep.equal([{}]);
    });

    it('returns { error } when the server call fails', async () => {
        const { tool, server } = createTool();
        server.searchError = new Error('7 PERMISSION_DENIED: ai feature not available');
        const result = JSON.parse(await tool.getTool().handler('{}') as string);
        expect(result.error).to.match(/PERMISSION_DENIED/);
    });

    it('returns { error } on invalid JSON arguments', async () => {
        const { tool } = createTool();
        const result = JSON.parse(await tool.getTool().handler('nope') as string);
        expect(result.error).to.match(/JSON/);
    });
});
```

(The `CookbotAddCatalogRecipeTool` import is used by Task 10's `describe`; leave it in place — TypeScript's `noUnusedLocals` is not enabled for specs, but if lint complains before Task 10, add the Task 10 tests in the same commit.)

- [ ] **Step 2: Compile to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang-ai`
Expected: error — `./catalog-recipe-tools` not found.

- [ ] **Step 3: Implement the search tool**

`packages/cooklang-ai/src/browser/catalog-recipe-tools.ts` (initial version — Task 10 appends the add tool):

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest, ToolInvocationContext } from '@theia/ai-core/lib/common';
import { assertChatContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElementFactory } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';
import { WorkspaceFunctionScope } from './file-tools/workspace-function-scope';
import { FileChangeSetTitleProvider } from './file-tools/file-changeset-functions';

// ── Vocabulary (mirrors the kickstart wizard; unknown values are dropped server-side) ──

const DIETARY = ['vegetarian', 'vegan', 'pescatarian', 'flexitarian', 'keto', 'paleo', 'gluten-free', 'dairy-free', 'halal', 'kosher', 'low-fodmap'];
const ALLERGENS = ['tree-nuts', 'peanuts', 'shellfish', 'fish', 'eggs', 'soy', 'sesame', 'gluten'];
const CUISINES = ['american', 'italian', 'french', 'spanish', 'greek', 'british', 'german', 'chinese', 'japanese', 'thai', 'indian', 'korean',
    'vietnamese', 'mexican', 'middle-eastern', 'caribbean', 'african', 'mediterranean', 'fusion'];
const EQUIPMENT = ['instant-pot', 'slow-cooker', 'air-fryer', 'rice-cooker', 'stand-mixer', 'food-processor', 'blender', 'grill', 'sous-vide',
    'bread-maker', 'pasta-maker', 'smoker', 'wok', 'cast-iron', 'dutch-oven'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack'];
const COURSES = ['main', 'side', 'drink', 'sauce', 'accompaniment', 'any'];
const COOKING_METHODS = ['one-pot', 'sheet-pan', 'no-cook', 'batch-cooking', 'slow-cooker', 'stir-fry', 'casseroles', 'soups-stews'];
const DISH_CATEGORIES = ['pasta_noodles', 'soup_stew', 'salad', 'pizza_flatbread', 'meat_main', 'seafood', 'rice_grain_bowl', 'taco_burrito',
    'sandwich_burger', 'casserole_bake', 'bread', 'baked_sweet', 'eggs'];
const NUTRITIONAL_FOCUS = ['high-protein', 'whole-grains', 'anti-inflammatory', 'heart-healthy', 'gut-health', 'energy-boosting', 'pregnancy-safe',
    'lower-sugar', 'lower-sodium', 'lower-glycemic', 'high-fiber'];

function stringArray(description: string, values?: string[]): object {
    return {
        type: 'array',
        items: values ? { type: 'string', enum: values } : { type: 'string' },
        description,
    };
}

function fail(message: string): string {
    return JSON.stringify({ error: message });
}

/**
 * AI tool: search the cook.md curated recipe catalog with structured criteria
 * (the kickstart wizard's vocabulary) plus an optional keyword. Read-only.
 */
@injectable()
export class CookbotSearchRecipeCatalogTool implements ToolProvider {
    static ID = 'searchRecipeCatalog';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotSearchRecipeCatalogTool.ID,
            name: CookbotSearchRecipeCatalogTool.ID,
            displayName: 'Search Recipe Catalog',
            description: 'Search cook.md\'s curated recipe catalog (~16k tested recipes) with structured criteria: diet, allergens to exclude, '
                + 'cuisines, meal types, course (main vs side/drink/sauce), max cook time, skill level, equipment, dish categories, plus an '
                + 'optional keyword. Use it for "find me…" requests about recipes the user does not have yet; use searchRecipes for the '
                + 'user\'s own workspace and searchWeb only when neither fits. Load the recipe-discovery skill first. '
                + 'Returns { recipes: [{ id, title, meal_type, course, cuisine, cook_time_minutes, skill_level, dietary, tags, source_url, score }], hint } '
                + '— `hint` is set only when nothing matched and names the filters to relax. To show more, repeat with the shown ids in exclude_ids. '
                + 'To add one to the workspace, call addCatalogRecipe with its id.',
            parameters: {
                type: 'object',
                properties: {
                    dietary: stringArray('Dietary requirements every result must satisfy.', DIETARY),
                    exclude_allergens: stringArray('Allergens no result may contain.', ALLERGENS),
                    dislikes: stringArray('Ingredients to avoid, e.g. "cilantro", "olives", "mushrooms", "blue-cheese", "raw-onion".'),
                    cuisines: stringArray('Preferred cuisines (ranking preference, not a hard filter).', CUISINES),
                    equipment: stringArray('Appliances the user owns; recipes needing other appliances are excluded.', EQUIPMENT),
                    max_skill_level: { type: 'integer', minimum: 1, maximum: 4, description: '1 beginner … 4 expert.' },
                    meal_types: stringArray('Meal slots to search; empty = all.', MEAL_TYPES),
                    course: { type: 'string', enum: COURSES, description: 'main (default) = proper meals; side/drink/sauce or accompaniment = sides & drinks; any = everything.' },
                    cooking_methods: stringArray('Cooking style preferences.', COOKING_METHODS),
                    dish_categories: stringArray('Dish shapes to include.', DISH_CATEGORIES),
                    nutritional_focus: stringArray('Nutrition goals (pregnancy-safe is a hard filter, the rest are ranking bonuses).', NUTRITIONAL_FOCUS),
                    max_cook_time_minutes: { type: 'integer', description: 'Upper bound on total cook time in minutes.' },
                    query: { type: 'string', description: 'Keyword(s) matched against title and dish type, e.g. "salmon", "carbonara".' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many recipes to return. Default 5; keep chat answers to 3–5.' },
                    exclude_ids: stringArray('Ids already shown to the user (for "show me more").'),
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let criteria: object;
        try {
            criteria = argString && argString.trim() ? JSON.parse(argString) : {};
        } catch {
            return fail('Invalid arguments: expected a JSON object.');
        }
        try {
            const result = await this.serverTools.searchRecipeCatalog(criteria);
            return JSON.stringify(result);
        } catch (e) {
            return fail(`Catalog search failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
```

(The unused imports — `ToolInvocationContext`, `assertChatContext`, `ChangeSetFileElementFactory`, `FileService`, `WorkspaceFunctionScope`, `FileChangeSetTitleProvider` — are consumed by Task 10; if you commit Task 9 alone and lint complains, add them in Task 10 instead.)

- [ ] **Step 4: Compile and run the spec**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang-ai
cd packages/cooklang-ai && npx mocha --config ../../configs/mocharc.yml ./lib/browser/catalog-recipe-tools.spec.js
```
Expected: 5 passing (the add-tool describe block does not exist yet).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-ai/src/browser/catalog-recipe-tools.ts packages/cooklang-ai/src/browser/catalog-recipe-tools.spec.ts
git commit -m "feat(cooklang-ai): searchRecipeCatalog AI tool"
```

---

### Task 10: `addCatalogRecipe` tool

**Files:**
- Modify: `packages/cooklang-ai/src/browser/catalog-recipe-tools.ts` (append)
- Modify: `packages/cooklang-ai/src/browser/catalog-recipe-tools.spec.ts` (append)

- [ ] **Step 1: Append the spec**

Append to `catalog-recipe-tools.spec.ts`:

```ts
describe('CookbotAddCatalogRecipeTool', () => {

    class FakeFileService {
        existing = new Set<string>();
        async exists(uri: URI): Promise<boolean> { return this.existing.has(uri.toString()); }
    }

    class FakeScope {
        root = new URI('file:///ws');
        async resolveRelativePath(path: string): Promise<URI> {
            return this.root.resolve(path);
        }
    }

    interface StagedElement { uri: URI; type: string; state: string; targetState: string; requestId: string; chatSessionId: string }

    function createContext(): { ctx: object; staged: StagedElement[]; titles: string[] } {
        const staged: StagedElement[] = [];
        const titles: string[] = [];
        const ctx = {
            request: {
                id: 'req-1',
                session: {
                    id: 'session-1',
                    changeSet: {
                        addElements: (...elements: StagedElement[]) => { staged.push(...elements); },
                        setTitle: (title: string) => { titles.push(title); },
                    },
                },
            },
            response: {},
        };
        return { ctx, staged, titles };
    }

    function createTool(): { tool: CookbotAddCatalogRecipeTool; server: FakeServerTools; fs: FakeFileService; scope: FakeScope } {
        const tool = new CookbotAddCatalogRecipeTool();
        const server = new FakeServerTools();
        const fs = new FakeFileService();
        const scope = new FakeScope();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (tool as any).serverTools = server;
        (tool as any).fileService = fs;
        (tool as any).workspaceFunctionScope = scope;
        (tool as any).fileChangeFactory = (element: StagedElement) => element;
        (tool as any).fileChangeSetTitleProvider = { getChangeSetTitle: () => 'Changes proposed' };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        server.recipes.set(CARBONARA.id, CARBONARA);
        return { tool, server, fs, scope };
    }

    it('requires id and shows the path as short label', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('addCatalogRecipe');
        expect(def.parameters.required).to.deep.equal(['id']);
        expect(def.getArgumentsShortLabel!(JSON.stringify({ id: 'x', path: 'Dinner/X.cook' }))).to.deep.equal({ label: 'Dinner/X.cook', hasMore: true });
    });

    it('stages the recipe at the suggested path as an add', async () => {
        const { tool } = createTool();
        const { ctx, staged, titles } = createContext();
        const raw = await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id }), ctx as ToolInvocationContext);
        expect(staged).to.have.length(1);
        expect(staged[0].uri.toString()).to.equal('file:///ws/Dinner/Spaghetti%20Carbonara.cook');
        expect(staged[0].type).to.equal('add');
        expect(staged[0].state).to.equal('pending');
        expect(staged[0].targetState).to.equal(CARBONARA.content);
        expect(staged[0].requestId).to.equal('req-1');
        expect(staged[0].chatSessionId).to.equal('session-1');
        expect(titles).to.deep.equal(['Changes proposed']);
        const result = JSON.parse(raw as string);
        expect(result.proposedPath).to.equal('Dinner/Spaghetti Carbonara.cook');
        expect(result.title).to.equal('Spaghetti Carbonara');
        expect(result.message).to.match(/review/);
    });

    it('honours an explicit path and marks existing files as modify', async () => {
        const { tool, fs } = createTool();
        fs.existing.add('file:///ws/Pasta/Carbonara.cook');
        const { ctx, staged } = createContext();
        const raw = await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id, path: 'Pasta/Carbonara.cook' }), ctx as ToolInvocationContext);
        expect(staged[0].uri.toString()).to.equal('file:///ws/Pasta/Carbonara.cook');
        expect(staged[0].type).to.equal('modify');
        expect(JSON.parse(raw as string).proposedPath).to.equal('Pasta/Carbonara.cook');
    });

    it('returns { error } for an unknown id without staging', async () => {
        const { tool } = createTool();
        const { ctx, staged } = createContext();
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: 'nope' }), ctx as ToolInvocationContext) as string);
        expect(result.error).to.match(/NOT_FOUND/);
        expect(staged).to.deep.equal([]);
    });

    it('returns { error } when id is missing', async () => {
        const { tool } = createTool();
        const { ctx } = createContext();
        const result = JSON.parse(await tool.getTool().handler('{}', ctx as ToolInvocationContext) as string);
        expect(result.error).to.match(/id/);
    });

    it('returns { error } outside a chat context', async () => {
        const { tool } = createTool();
        const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ id: CARBONARA.id })) as string);
        expect(result.error).to.match(/chat/i);
    });
});
```

Add `ToolInvocationContext` to the spec's imports: `import { ToolInvocationContext } from '@theia/ai-core/lib/common';`.

- [ ] **Step 2: Compile to see it fail**

Run: `export PATH=$HOME/.local/bin:$PATH && npx lerna run compile --scope @theia/cooklang-ai`
Expected: error — `CookbotAddCatalogRecipeTool` is not exported.

- [ ] **Step 3: Append the add tool**

Append to `catalog-recipe-tools.ts`:

```ts
/**
 * AI tool: fetch one catalog recipe and stage it into the workspace through the
 * chat changeset (same review/apply UX as suggestFileContent). The recipe body
 * never round-trips through the model.
 */
@injectable()
export class CookbotAddCatalogRecipeTool implements ToolProvider {
    static ID = 'addCatalogRecipe';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    getTool(): ToolRequest {
        return {
            id: CookbotAddCatalogRecipeTool.ID,
            name: CookbotAddCatalogRecipeTool.ID,
            displayName: 'Add Catalog Recipe',
            description: 'Propose adding a recipe from the cook.md catalog to the user\'s workspace: fetches the .cook file by the id returned '
                + 'by searchRecipeCatalog and stages it for review (the user accepts or rejects it, like suggestFileContent). '
                + 'By default the file goes to the catalog\'s suggested path (e.g. "Dinner/<Title>.cook", "Sides & Drinks/<Title>.cook"); '
                + 'pass `path` only when the user asked for a specific location. Returns { proposedPath, title, message } — say the recipe is '
                + 'proposed/ready for review, never that it was saved.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Catalog recipe id from searchRecipeCatalog.' },
                    path: { type: 'string', description: 'Optional workspace-relative target path ending in .cook. Defaults to the catalog\'s suggested path.' },
                },
                required: ['id'],
            },
            handler: async (argString: string, ctx?: ToolInvocationContext) => this.execute(argString, ctx),
            getArgumentsShortLabel: (args: string) => {
                try {
                    const parsed = JSON.parse(args);
                    const label = parsed?.path ?? parsed?.id;
                    return label ? { label: String(label), hasMore: true } : undefined;
                } catch {
                    return undefined;
                }
            },
        };
    }

    protected async execute(argString: string, ctx?: ToolInvocationContext): Promise<string> {
        try {
            assertChatContext(ctx);
        } catch (e) {
            return fail(e instanceof Error ? e.message : String(e));
        }
        if (ctx.cancellationToken?.isCancellationRequested) {
            return fail('Operation cancelled by user');
        }
        let args: { id?: unknown; path?: unknown };
        try {
            args = JSON.parse(argString || '{}');
        } catch {
            return fail('Invalid arguments: expected a JSON object.');
        }
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
            return fail('id is required (use the id from searchRecipeCatalog).');
        }
        const explicitPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;

        try {
            const recipe = await this.serverTools.getCatalogRecipe(id);
            const path = explicitPath ?? recipe.suggestedPath;
            const uri = await this.workspaceFunctionScope.resolveRelativePath(path);
            const type: 'add' | 'modify' = (await this.fileService.exists(uri)) ? 'modify' : 'add';
            ctx.request.session.changeSet.addElements(this.fileChangeFactory({
                uri,
                type,
                state: 'pending',
                targetState: recipe.content,
                requestId: ctx.request.id,
                chatSessionId: ctx.request.session.id,
            }));
            ctx.request.session.changeSet.setTitle(this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
            return JSON.stringify({
                proposedPath: path,
                title: recipe.title,
                message: `Proposed adding "${recipe.title}" at ${path} — the user will review and apply the change.`,
            });
        } catch (e) {
            return fail(`Could not add catalog recipe: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
```

`FileChangeSetTitleProvider` must be exported from `file-changeset-functions.ts` — it already is (`export const FileChangeSetTitleProvider = Symbol(...)` and the interface). `ChatToolContext`'s `request.session.changeSet` and `request.id` are the same fields `SuggestFileContent` uses.

- [ ] **Step 4: Compile and run the spec**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang-ai
cd packages/cooklang-ai && npx mocha --config ../../configs/mocharc.yml ./lib/browser/catalog-recipe-tools.spec.js
```
Expected: 11 passing. If the `assertChatContext` narrowing complains that `ctx` may be undefined after the try/catch, restructure as `if (!ChatToolContext.is(ctx)) { return fail('This tool requires a chat context…'); }` importing `ChatToolContext` from the same module — the test asserts on `/chat/i`.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-ai/src/browser/catalog-recipe-tools.ts packages/cooklang-ai/src/browser/catalog-recipe-tools.spec.ts
git commit -m "feat(cooklang-ai): addCatalogRecipe AI tool staging catalog recipes for review"
```

---

### Task 11: Bind the catalog tools

**Files:**
- Modify: `packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts:85-88`

- [ ] **Step 1: Import and bind**

Add the import next to the `cookbot-server-tools` import:

```ts
import { CookbotSearchRecipeCatalogTool, CookbotAddCatalogRecipeTool } from './catalog-recipe-tools';
```

After `bindToolProvider(CookbotConvertTextTool, bind);`:

```ts
    // cook.md catalog tools (issue cook-md#293)
    bindToolProvider(CookbotSearchRecipeCatalogTool, bind);
    bindToolProvider(CookbotAddCatalogRecipeTool, bind);
```

- [ ] **Step 2: Compile, lint, test the package**

Run:
```bash
export PATH=$HOME/.local/bin:$PATH
npx lerna run compile --scope @theia/cooklang-ai
npx lerna run lint --scope @theia/cooklang-ai
npx lerna run test --scope @theia/cooklang-ai
```
Expected: all clean/passing.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-ai/src/browser/cooklang-ai-frontend-module.ts
git commit -m "feat(cooklang-ai): register catalog AI tools"
```

---

### Task 12: Full verification

- [ ] **Step 1: Native + both packages end to end**

```bash
export PATH=$HOME/.local/bin:$PATH
cd packages/cooklang-native && cargo test && npm run build && cd ../..
npx lerna run compile --scope @theia/cooklang --scope @theia/cooklang-ai
npx lerna run lint --scope @theia/cooklang --scope @theia/cooklang-ai
npx lerna run test --scope @theia/cooklang --scope @theia/cooklang-ai
diff ../cook.md/cookbot/proto/cookbot.proto packages/cooklang-ai/proto/cookbot.proto && echo "proto in sync"
```
Expected: every command succeeds; `proto in sync`.

- [ ] **Step 2: Bundle and smoke-test in the app (needs a local cookbot + Rails, per the cook.md plan)**

```bash
cd app && npm run bundle && cd .. && npm run start:electron
```
In a workspace with `config/pantry.conf` and a `.menu`, ask CookBot:
1. "what's in my pantry?" → `getPantry` runs, answer lists sections.
2. "do I have eggs and butter?" → `checkPantry` runs, per-item answer.
3. "which of my recipes use salmon?" → `searchRecipes` runs, paths listed.
4. "shopping list for Plans/This Week.menu" → `generateShoppingList` runs; add "and put it on my shopping list" → view opens.
5. "find me a few quick vegetarian dinners" → `searchRecipeCatalog`; "add the second one" → `addCatalogRecipe` stages `Dinner/<Title>.cook`; Accept writes it.

- [ ] **Step 3: Final commit (if any fixups) and push**

```bash
git status
git log --oneline main..HEAD
git push -u origin cookbot-workspace-catalog-tools
```

Then open the PR referencing cook-md/editor#82 and cook-md/cook-md#293.
