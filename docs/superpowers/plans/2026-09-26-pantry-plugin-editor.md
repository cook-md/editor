# Pantry Plugin — Editor API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give plugins a formatting-preserving way to read and edit `config/pantry.conf`: native `editPantry`, a richer native `parsePantry`, and the `cooklang.api.parsePantry` / `cooklang.api.editPantry` commands.

**Architecture:** A new Rust module `pantry_file.rs` in the NAPI addon edits the TOML text with `toml_edit` (ported from cookcli-core's `crates/core/src/pantry/edit.rs`, plus clearing attributes) and normalises dates. `lib.rs` exposes it as `editPantry` and adds computed fields to `parsePantry`. The backend language service forwards `editPantry`; `CooklangPluginApiContribution` validates plugin arguments and exposes both commands (text in, text/JSON out — the plugin owns file I/O).

**Tech Stack:** Rust (napi-rs, `toml_edit` 0.22, `chrono`, `cooklang` 0.18.5 `pantry` feature), TypeScript (Theia, InversifyJS), mocha/chai.

**Spec:** `docs/superpowers/specs/2026-09-26-pantry-plugin-design.md` (§1).

**Branch:** `feature/pantry-plugin` (already created; the spec is committed on it).

**Test environment:** mocha needs Node 22. Before any `npm`/`npx`/`lerna` command run:

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
```

Do not try to install Node. Rust tests run with plain `cargo test` in `packages/cooklang-native`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/cooklang-native/Cargo.toml` | Modify | Add `toml_edit = "0.22"` (already in `Cargo.lock` via `cooklang`). |
| `packages/cooklang-native/src/pantry_file.rs` | Create | `PantryEdit` JSON shape, `apply_edit(text, edit)`, `normalise_pantry_date`; unit tests. |
| `packages/cooklang-native/src/lib.rs` | Modify | `mod pantry_file;`, `#[napi] edit_pantry`, three new fields on `PantryItemJson`. |
| `packages/cooklang-native/index.d.ts` | Modify | Declare `editPantry`; update `parsePantry` doc. |
| `packages/cooklang/src/common/cooklang-language-service.ts` | Modify | `editPantry` on the RPC interface; update `parsePantry` doc. |
| `packages/cooklang/src/node/cooklang-language-service-impl.ts` | Modify | Forward `editPantry` to the addon. |
| `packages/cooklang/src/common/pantry-types.ts` | Create | Plugin-facing pantry types (`PantryContents`, `PantryItemInfo`, `PantryAttributes`, `PantryEdit`). |
| `packages/cooklang/src/common/index.ts` | Modify | Re-export `pantry-types`. |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` | Modify | `PARSE_PANTRY`, `EDIT_PANTRY` commands + validation. |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | Modify | Tests for both commands. |

---

### Task 1: Rust `pantry_file` module — dates and edits

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Create: `packages/cooklang-native/src/pantry_file.rs`
- Modify: `packages/cooklang-native/src/lib.rs:20` (module declaration)

Background the implementer needs:

- A pantry file is TOML. Each `[table]` is a section; its keys are items. An item is either short form `milk = "1%L"` (the string is the quantity) or an inline table `milk = { quantity = "1%L", expire = "2026-10-01", low = "200%ml", bought = "2026-09-20" }`.
- Keys above the first `[header]` form the section called `general`. The cooklang parser reads a top-level *inline table* as a section, so a `general` item can only ever be written short form (quantity only). Adding `bought`/`expire`/`low` to a `general` item must be refused.
- A section may also be written as an array of names, `fridge = ["milk", "eggs"]`. Before editing it we rewrite it as a table (`milk = ""`, `eggs = ""`) so there is somewhere to put keys.
- Everything that is not the targeted entry must be left byte-for-byte alone (comments, blank lines, key order, unknown attributes such as `shelf = "top"`).

- [ ] **Step 1: Add the dependency**

In `packages/cooklang-native/Cargo.toml`, under `[dependencies]` directly after the `chrono = "0.4"` line, add:

```toml
toml_edit = "0.22"
```

(`cooklang` already pulls `toml_edit 0.22.27`, so `Cargo.lock` only gains a direct edge.)

- [ ] **Step 2: Write the module skeleton with failing tests**

Create `packages/cooklang-native/src/pantry_file.rs`:

```rust
//! Editing `config/pantry.conf` **in place**, as text, for `editPantry`.
//!
//! Ported from cookcli-core (`crates/core/src/pantry/edit.rs`): only the entry
//! asked for is touched, so comments, blank lines, key order, the short
//! `name = "1%kg"` form and attributes `cooklang` does not model all survive.
//! On top of cookcli, an update can *clear* an attribute (empty string).
//!
//! Items above the first `[header]` belong to the section the parser calls
//! `general`; here that is the document root.

use serde::Deserialize;
use toml_edit::{DocumentMut, InlineTable, Item, Table, TableLike, Value};

/// The section name that addresses the entries above the first `[header]`.
pub(crate) const GENERAL: &str = "general";

/// Date formats accepted in `bought` / `expire`, tried in order (same list as
/// cookcli's pantry `parse_date`).
const DATE_FORMATS: [&str; 6] = [
    "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y.%m.%d", "%d-%m-%Y",
];

/// `raw` as `YYYY-MM-DD`, or `None` when no accepted format matches.
pub(crate) fn normalise_pantry_date(raw: &str) -> Option<String> {
    unimplemented!()
}

/// Item attributes. On `update`: `None` leaves the attribute alone, `Some("")`
/// removes it, anything else sets it. On `add`: `None` and `Some("")` both
/// mean "do not write".
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct Attributes {
    #[serde(default)]
    pub quantity: Option<String>,
    #[serde(default)]
    pub bought: Option<String>,
    #[serde(default)]
    pub expire: Option<String>,
    #[serde(default)]
    pub low: Option<String>,
}

/// One edit, as JSON: `{"op":"add"|"update"|"remove", ...}`.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub(crate) enum PantryEdit {
    Add {
        section: String,
        name: String,
        #[serde(default)]
        quantity: Option<String>,
        #[serde(default)]
        bought: Option<String>,
        #[serde(default)]
        expire: Option<String>,
        #[serde(default)]
        low: Option<String>,
    },
    Update {
        section: String,
        name: String,
        fields: Attributes,
    },
    Remove {
        section: String,
        name: String,
    },
}

/// Apply `edit` to the pantry file `text` and return the new text.
/// The error is a user-facing message.
pub(crate) fn apply_edit(text: &str, edit: &PantryEdit) -> Result<String, String> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(text: &str, json: &str) -> Result<String, String> {
        let edit: PantryEdit = serde_json::from_str(json).expect("valid edit JSON");
        apply_edit(text, &edit)
    }

    #[test]
    fn dates_normalise_from_every_accepted_format() {
        assert_eq!(normalise_pantry_date("2026-10-01").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date("01.10.2026").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date("01/10/2026").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date("12/31/2026").as_deref(), Some("2026-12-31"));
        assert_eq!(normalise_pantry_date("2026.10.01").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date("01-10-2026").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date(" 2026-10-01 ").as_deref(), Some("2026-10-01"));
        assert_eq!(normalise_pantry_date("next week"), None);
        assert_eq!(normalise_pantry_date(""), None);
    }

    #[test]
    fn add_to_an_existing_section_keeps_comments_and_other_items() {
        let out = edit(
            "# my pantry\n[fridge]\n# dairy\nmilk = { quantity = \"1%L\", shelf = \"top\" }\n",
            r#"{"op":"add","section":"fridge","name":"butter","quantity":"200%g"}"#,
        )
        .unwrap();
        assert!(out.contains("# my pantry"), "{out}");
        assert!(out.contains("# dairy"), "{out}");
        assert!(out.contains("milk = { quantity = \"1%L\", shelf = \"top\" }"), "{out}");
        assert!(out.contains("butter = \"200%g\""), "{out}");
    }

    #[test]
    fn add_with_attributes_writes_an_inline_table_and_skips_empty_ones() {
        let out = edit(
            "[fridge]\n",
            r#"{"op":"add","section":"fridge","name":"milk","quantity":"1%L","expire":"2026-10-01","low":""}"#,
        )
        .unwrap();
        assert!(out.contains("milk = { quantity = \"1%L\", expire = \"2026-10-01\" }"), "{out}");
    }

    #[test]
    fn add_creates_a_missing_section() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"add","section":"freezer","name":"peas","quantity":"500%g"}"#,
        )
        .unwrap();
        assert!(out.contains("[freezer]"), "{out}");
        assert!(out.contains("peas = \"500%g\""), "{out}");
        assert!(out.contains("milk = \"1%L\""), "{out}");
    }

    #[test]
    fn add_without_attributes_writes_an_empty_quantity() {
        let out = edit("[pantry]\n", r#"{"op":"add","section":"pantry","name":"salt"}"#).unwrap();
        assert!(out.contains("salt = \"\""), "{out}");
    }

    #[test]
    fn add_refuses_a_duplicate_in_any_case() {
        let err = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"add","section":"fridge","name":"Milk"}"#,
        )
        .unwrap_err();
        assert_eq!(err, "item 'milk' already exists in section 'fridge'");
    }

    #[test]
    fn add_to_general_goes_above_the_first_header_short_form() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"add","section":"general","name":"salt","quantity":"1%kg"}"#,
        )
        .unwrap();
        assert!(out.find("salt = \"1%kg\"").unwrap() < out.find("[fridge]").unwrap(), "{out}");
    }

    #[test]
    fn general_items_refuse_attributes_other_than_quantity() {
        let err = edit(
            "",
            r#"{"op":"add","section":"general","name":"salt","expire":"2027-01-01"}"#,
        )
        .unwrap_err();
        assert!(err.contains("above the first section header"), "{err}");
    }

    #[test]
    fn add_to_an_array_section_converts_it_to_a_table() {
        let out = edit(
            "fridge = [\"milk\", \"eggs\"]\n",
            r#"{"op":"add","section":"fridge","name":"butter","quantity":"200%g"}"#,
        )
        .unwrap();
        assert!(out.contains("[fridge]"), "{out}");
        assert!(out.contains("milk = \"\""), "{out}");
        assert!(out.contains("eggs = \"\""), "{out}");
        assert!(out.contains("butter = \"200%g\""), "{out}");
    }

    #[test]
    fn update_sets_attributes_and_keeps_unknown_keys() {
        let out = edit(
            "[fridge]\nmilk = { quantity = \"1%L\", shelf = \"top\" }\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"2%L","low":"500%ml"}}"#,
        )
        .unwrap();
        assert!(out.contains("quantity = \"2%L\""), "{out}");
        assert!(out.contains("low = \"500%ml\""), "{out}");
        assert!(out.contains("shelf = \"top\""), "{out}");
    }

    #[test]
    fn update_of_quantity_keeps_short_form_short() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"2%L"}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = \"2%L\""), "{out}");
    }

    #[test]
    fn update_promotes_short_form_when_an_attribute_is_set() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":"2026-10-01"}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = { quantity = \"1%L\", expire = \"2026-10-01\" }"), "{out}");
    }

    #[test]
    fn update_with_empty_string_clears_the_attribute() {
        let out = edit(
            "[fridge]\nmilk = { quantity = \"1%L\", expire = \"2026-10-01\", low = \"200%ml\" }\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}"#,
        )
        .unwrap();
        assert!(!out.contains("expire"), "{out}");
        assert!(out.contains("low = \"200%ml\""), "{out}");
    }

    #[test]
    fn clearing_the_last_attribute_collapses_to_short_form() {
        let out = edit(
            "[fridge]\nmilk = { quantity = \"1%L\", expire = \"2026-10-01\" }\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = \"1%L\""), "{out}");
    }

    #[test]
    fn clearing_does_not_collapse_when_unknown_keys_remain() {
        let out = edit(
            "[fridge]\nmilk = { quantity = \"1%L\", expire = \"2026-10-01\", shelf = \"top\" }\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}"#,
        )
        .unwrap();
        assert!(out.contains("shelf = \"top\""), "{out}");
        assert!(out.contains("quantity = \"1%L\""), "{out}");
    }

    #[test]
    fn update_refuses_a_value_it_cannot_interpret() {
        let err = edit(
            "[fridge]\nmilk = 3\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":"2026-10-01"}}"#,
        )
        .unwrap_err();
        assert!(err.contains("a bare number"), "{err}");
    }

    #[test]
    fn update_and_remove_report_unknown_sections_and_items() {
        let text = "[fridge]\nmilk = \"1%L\"\n";
        assert_eq!(
            edit(text, r#"{"op":"update","section":"cellar","name":"milk","fields":{"quantity":"1"}}"#).unwrap_err(),
            "section 'cellar' not found"
        );
        assert_eq!(
            edit(text, r#"{"op":"remove","section":"fridge","name":"eggs"}"#).unwrap_err(),
            "item 'eggs' not found in section 'fridge'"
        );
    }

    #[test]
    fn update_without_fields_is_an_error() {
        let err = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{}}"#,
        )
        .unwrap_err();
        assert_eq!(err, "no fields to update on item 'milk' in section 'fridge'");
    }

    #[test]
    fn remove_keeps_comments_and_drops_an_emptied_section() {
        // A comment directly above `[fridge]` belongs to that header and goes
        // with it; comments on other sections and items stay.
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n\n# dry goods\n[pantry]\n# staples\nrice = \"1%kg\"\n",
            r#"{"op":"remove","section":"fridge","name":"milk"}"#,
        )
        .unwrap();
        assert!(!out.contains("[fridge]"), "{out}");
        assert!(out.contains("# dry goods"), "{out}");
        assert!(out.contains("# staples"), "{out}");
        assert!(out.contains("rice = \"1%kg\""), "{out}");
    }

    #[test]
    fn empty_section_or_name_is_an_error() {
        assert_eq!(
            edit("", r#"{"op":"remove","section":" ","name":"milk"}"#).unwrap_err(),
            "section must not be empty"
        );
        assert_eq!(
            edit("[fridge]\n", r#"{"op":"add","section":"fridge","name":""}"#).unwrap_err(),
            "name must not be empty"
        );
    }

    #[test]
    fn invalid_toml_is_an_error() {
        assert!(edit("[fridge\nmilk =", r#"{"op":"remove","section":"fridge","name":"milk"}"#).is_err());
    }

    #[test]
    fn edited_output_reparses_with_the_item_in_place() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\"\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":"2026-10-01"}}"#,
        )
        .unwrap();
        let conf = cooklang::pantry::parse_lenient(&out).into_output().expect("parses");
        let milk = &conf.sections["fridge"][0];
        assert_eq!(milk.name(), "milk");
        assert_eq!(milk.quantity(), Some("1%L"));
        assert_eq!(milk.expire(), Some("2026-10-01"));
    }
}
```

In `packages/cooklang-native/src/lib.rs`, directly after the existing `mod shopping_list;` line (line 20), add:

```rust
mod pantry_file;
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/cooklang-native && cargo test pantry_file`
Expected: compiles (warnings about unused items are fine), every `pantry_file::tests::*` test FAILS with `not implemented`.

- [ ] **Step 4: Implement**

Replace the two `unimplemented!()` bodies and add the private helpers. The final non-test part of `pantry_file.rs` (keep the header, `GENERAL`, `DATE_FORMATS`, `Attributes` and `PantryEdit` exactly as written in Step 2) gains:

```rust
pub(crate) fn normalise_pantry_date(raw: &str) -> Option<String> {
    let raw = raw.trim();
    DATE_FORMATS
        .iter()
        .find_map(|format| chrono::NaiveDate::parse_from_str(raw, format).ok())
        .map(|date| date.format("%Y-%m-%d").to_string())
}

impl Attributes {
    fn entries(&self) -> [(&'static str, Option<&str>); 4] {
        [
            ("quantity", self.quantity.as_deref()),
            ("bought", self.bought.as_deref()),
            ("expire", self.expire.as_deref()),
            ("low", self.low.as_deref()),
        ]
    }

    fn is_empty(&self) -> bool {
        self.entries().iter().all(|(_, value)| value.is_none())
    }

    /// The attributes that would be *written* (set to a non-empty value).
    fn written(&self) -> Attributes {
        let keep = |value: &Option<String>| value.clone().filter(|v| !v.is_empty());
        Attributes {
            quantity: keep(&self.quantity),
            bought: keep(&self.bought),
            expire: keep(&self.expire),
            low: keep(&self.low),
        }
    }

    /// The value a fresh item takes: short form unless an attribute other
    /// than the quantity needs a table.
    fn to_item(&self, section: &str) -> Item {
        let short = section == GENERAL
            || (self.bought.is_none() && self.expire.is_none() && self.low.is_none());
        if short {
            return toml_edit::value(self.quantity.clone().unwrap_or_default());
        }
        let mut table = InlineTable::new();
        for (key, value) in self.entries() {
            if let Some(value) = value {
                table.insert(key, value.into());
            }
        }
        toml_edit::value(table)
    }
}

pub(crate) fn apply_edit(text: &str, edit: &PantryEdit) -> Result<String, String> {
    let mut doc: DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
    match edit {
        PantryEdit::Add { section, name, quantity, bought, expire, low } => {
            let (section, name) = (required(section, "section")?, required(name, "name")?);
            let attributes = Attributes {
                quantity: quantity.clone(),
                bought: bought.clone(),
                expire: expire.clone(),
                low: low.clone(),
            }
            .written();
            check_general_attributes(section, name, &attributes)?;
            normalise_array_section(&mut doc, section);
            if let Some(existing) = find_item_ignoring_case(&doc, section, name) {
                return Err(format!("item '{existing}' already exists in section '{section}'"));
            }
            insert(&mut doc, section, name, &attributes);
        }
        PantryEdit::Update { section, name, fields } => {
            let (section, name) = (required(section, "section")?, required(name, "name")?);
            if fields.is_empty() {
                return Err(format!("no fields to update on item '{name}' in section '{section}'"));
            }
            check_general_attributes(section, name, &fields.written())?;
            normalise_array_section(&mut doc, section);
            require_item(&doc, section, name)?;
            apply(&mut doc, section, name, fields)?;
        }
        PantryEdit::Remove { section, name } => {
            let (section, name) = (required(section, "section")?, required(name, "name")?);
            normalise_array_section(&mut doc, section);
            require_item(&doc, section, name)?;
            remove(&mut doc, section, name);
        }
    }
    Ok(doc.to_string())
}

fn required<'a>(value: &'a str, what: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{what} must not be empty"));
    }
    Ok(value)
}

/// A `general` item can only be written `name = "quantity"`: the parser reads
/// a top-level inline table as a section, so refuse rather than corrupt.
fn check_general_attributes(section: &str, name: &str, attributes: &Attributes) -> Result<(), String> {
    if section != GENERAL {
        return Ok(());
    }
    let unwritable: Vec<&str> = attributes
        .entries()
        .into_iter()
        .filter(|(key, value)| *key != "quantity" && value.is_some())
        .map(|(key, _)| key)
        .collect();
    if unwritable.is_empty() {
        return Ok(());
    }
    Err(format!(
        "item '{name}' is above the first section header, where only a quantity can be written; \
         move it into a section to give it {}",
        unwritable.join(", ")
    ))
}

/// Rewrite `fridge = ["milk"]` as a `[fridge]` table so an edit has somewhere
/// to put a key. Arrays holding anything but strings are left alone.
fn normalise_array_section(doc: &mut DocumentMut, section: &str) {
    if section == GENERAL {
        return;
    }
    let Some(array) = doc.get(section).and_then(Item::as_array) else {
        return;
    };
    let names: Vec<String> = array
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    if names.len() != array.len() {
        return;
    }
    let mut table = Table::new();
    table.set_implicit(false);
    for name in &names {
        table.insert(name, toml_edit::value(""));
    }
    doc.insert(section, Item::Table(table));
}

/// The table holding `section`'s items, if it is there.
fn section_entries<'a>(doc: &'a DocumentMut, section: &str) -> Option<&'a dyn TableLike> {
    if section == GENERAL {
        Some(doc.as_table())
    } else {
        doc.get(section).and_then(Item::as_table_like)
    }
}

/// Whether `entry` is an item of `section` (a root table is a section, not an item).
fn is_item(section: &str, entry: &Item) -> bool {
    section != GENERAL || !entry.is_table_like()
}

fn find_item_ignoring_case(doc: &DocumentMut, section: &str, name: &str) -> Option<String> {
    let wanted = name.to_lowercase();
    section_entries(doc, section)?
        .iter()
        .find(|(key, entry)| is_item(section, entry) && key.to_lowercase() == wanted)
        .map(|(key, _)| key.to_string())
}

fn require_item(doc: &DocumentMut, section: &str, name: &str) -> Result<(), String> {
    let Some(entries) = section_entries(doc, section) else {
        return Err(format!("section '{section}' not found"));
    };
    match entries.get(name) {
        Some(entry) if is_item(section, entry) => Ok(()),
        _ => Err(format!("item '{name}' not found in section '{section}'")),
    }
}

fn insert(doc: &mut DocumentMut, section: &str, name: &str, attributes: &Attributes) {
    let value = attributes.to_item(section);
    if section == GENERAL {
        // Root keys are emitted before any `[header]`, which is where they belong.
        doc.insert(name, value);
        return;
    }
    if !doc.get(section).is_some_and(Item::is_table_like) {
        let mut table = Table::new();
        table.set_implicit(false);
        doc.insert(section, Item::Table(table));
    }
    if let Some(table) = doc.get_mut(section).and_then(Item::as_table_like_mut) {
        table.insert(name, value);
    }
}

/// Remove the item, and its section when that empties it (the parser drops
/// empty sections anyway, so keeping one would not survive a round-trip).
fn remove(doc: &mut DocumentMut, section: &str, name: &str) {
    if section == GENERAL {
        doc.remove(name);
        return;
    }
    let emptied = match doc.get_mut(section).and_then(Item::as_table_like_mut) {
        Some(table) => {
            table.remove(name);
            table.is_empty()
        }
        None => false,
    };
    if emptied {
        doc.remove(section);
    }
}

fn apply(doc: &mut DocumentMut, section: &str, name: &str, fields: &Attributes) -> Result<(), String> {
    let existing = if section == GENERAL {
        doc.as_table_mut().get_mut(name)
    } else {
        doc.get_mut(section)
            .and_then(Item::as_table_like_mut)
            .and_then(|table| table.get_mut(name))
    };
    let Some(existing) = existing else {
        return Err(format!("item '{name}' not found in section '{section}'"));
    };

    // Only the quantity changes (clearing an attribute a short item does not
    // have is a no-op): keep `milk = "1%L"` short.
    let only_quantity = fields
        .entries()
        .iter()
        .all(|(key, value)| *key == "quantity" || value.map_or(true, str::is_empty));
    if existing.as_str().is_some() && only_quantity {
        if let Some(quantity) = &fields.quantity {
            *existing = toml_edit::value(quantity.as_str());
        }
        return Ok(());
    }

    let mut table = as_inline_table(existing, section, name)?;
    let mut cleared = false;
    for (key, value) in fields.entries() {
        match value {
            Some("") => cleared |= table.remove(key).is_some(),
            Some(value) => {
                table.insert(key, value.into());
            }
            None => {}
        }
    }
    let collapse = cleared
        && table.iter().all(|(key, _)| key == "quantity")
        && table.get("quantity").map_or(true, |quantity| quantity.as_str().is_some());
    *existing = if collapse {
        toml_edit::value(table.get("quantity").and_then(Value::as_str).unwrap_or(""))
    } else {
        toml_edit::value(table)
    };
    Ok(())
}

/// The entry as an inline table. Refuses values that are neither a quantity
/// string nor a table, rather than guessing and overwriting them.
fn as_inline_table(item: &Item, section: &str, name: &str) -> Result<InlineTable, String> {
    if let Some(quantity) = item.as_str() {
        let mut table = InlineTable::new();
        table.insert("quantity", quantity.into());
        return Ok(table);
    }
    if let Some(table) = item.as_inline_table() {
        return Ok(table.clone());
    }
    if let Some(table) = item.as_table() {
        return Ok(table.clone().into_inline_table());
    }
    let kind = match item.as_value() {
        Some(Value::Integer(_)) | Some(Value::Float(_)) => "a bare number",
        Some(Value::Boolean(_)) => "a boolean",
        Some(Value::Array(_)) => "an array",
        Some(Value::Datetime(_)) => "a date",
        _ => "an unsupported value",
    };
    Err(format!(
        "item '{name}' in section '{section}' is written as {kind}, which is not a quantity or a \
         set of attributes; edit it by hand in config/pantry.conf"
    ))
}
```

Notes for the implementer:
- `doc.get`, `doc.insert`, `doc.remove`, `doc.get_mut` come from `DocumentMut`'s `Deref<Target = Table>`.
- If `toml_edit` 0.22 names a method differently from what's written here, check `~/.cargo/registry/src/index.crates.io-*/toml_edit-0.22.27/src/`. Keep the behaviour the tests pin down.
- If `add_with_attributes_writes_an_inline_table_and_skips_empty_ones` fails only on spacing (for example `{quantity = ...}` instead of `{ quantity = ... }`), call `table.fmt()` before `toml_edit::value(table)` in `to_item` and `apply`. Do not change the test.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/cooklang-native && cargo test pantry_file`
Expected: all `pantry_file::tests::*` PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/pantry_file.rs packages/cooklang-native/src/lib.rs
git commit -m "feat(cooklang-native): formatting-preserving pantry edits"
```

(If there is no `packages/cooklang-native/Cargo.lock`, the lock lives at the repo root. Run `git status` and add whichever `Cargo.lock` changed.)

---

### Task 2: NAPI `editPantry` and richer `parsePantry`

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs` (`PantryItemJson` ~line 1189, after `check_pantry` ~line 1290, tests module holding `const PANTRY` ~line 1767)
- Modify: `packages/cooklang-native/index.d.ts:118-130`

- [ ] **Step 1: Write the failing tests**

In `lib.rs`, find the test module that contains `const PANTRY: &str` and `fn parse_pantry_reports_sections_items_and_low_stock`. Add these tests directly after `parse_pantry_rejects_invalid_toml`:

```rust
    #[test]
    fn parse_pantry_adds_stock_and_date_fields() {
        let json = parse_pantry(
            "[fridge]\nmilk = { quantity = \"0%L\", expire = \"10.05.2026\", bought = \"garbage\" }\n\
             eggs = \"6\"\nsalt = \"\"\n"
                .to_string(),
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let items = &v["sections"][0]["items"];
        assert_eq!(items[0]["isOutOfStock"], true);
        assert_eq!(items[0]["expireDate"], "2026-05-10");
        assert_eq!(items[0]["boughtDate"], serde_json::Value::Null);
        assert_eq!(items[0]["bought"], "garbage");
        assert_eq!(items[1]["isOutOfStock"], false);
        assert_eq!(items[2]["isOutOfStock"], false, "no quantity means we have it");
    }

    #[test]
    fn parse_pantry_accepts_a_comment_only_file() {
        let json = parse_pantry("# just a comment\n".to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["sections"], serde_json::json!([]));
    }

    #[test]
    fn edit_pantry_applies_the_edit() {
        let out = edit_pantry(
            "[fridge]\nmilk = \"1%L\"\n".to_string(),
            r#"{"op":"remove","section":"fridge","name":"milk"}"#.to_string(),
        )
        .unwrap();
        assert!(!out.contains("milk"), "{out}");
    }

    #[test]
    fn edit_pantry_errors_name_their_caller() {
        let err = edit_pantry("".to_string(), "{\"op\":\"nope\"}".to_string()).unwrap_err();
        assert!(err.reason.starts_with("editPantry:"), "{}", err.reason);
        let err = edit_pantry(
            "[fridge]\n".to_string(),
            r#"{"op":"remove","section":"fridge","name":"milk"}"#.to_string(),
        )
        .unwrap_err();
        assert_eq!(err.reason, "editPantry: item 'milk' not found in section 'fridge'");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/cooklang-native && cargo test edit_pantry`

Expected: compile error `cannot find function edit_pantry`. That is the failure we want.

- [ ] **Step 3: Implement**

Replace `PantryItemJson` and its `impl` in `lib.rs` with:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PantryItemJson {
    name: String,
    quantity: Option<String>,
    bought: Option<String>,
    expire: Option<String>,
    low: Option<String>,
    is_low: bool,
    /// The quantity parses to zero. No quantity at all means "have it".
    is_out_of_stock: bool,
    /// `expire` normalised to `YYYY-MM-DD`; null when absent or unparseable.
    expire_date: Option<String>,
    /// `bought` normalised to `YYYY-MM-DD`; null when absent or unparseable.
    bought_date: Option<String>,
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
            is_out_of_stock: item.parsed_quantity().is_some_and(|(value, _)| value <= 0.0),
            expire_date: item.expire().and_then(pantry_file::normalise_pantry_date),
            bought_date: item.bought().and_then(pantry_file::normalise_pantry_date),
        }
    }
}
```

Update the doc comment on `parse_pantry` so its `items` shape lists the new fields:

```rust
/// Parse a `config/pantry.conf` (TOML) and return its sections and items.
///
/// Returns JSON: `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow,
///                  isOutOfStock, expireDate, boughtDate }] }],
///                  lowStock: [{ name, section, quantity, low }] }`.
```

Directly after the `check_pantry` function, add:

```rust
/// Apply one edit to a `config/pantry.conf` text and return the new text,
/// preserving comments and formatting (see `pantry_file`).
///
/// `edit_json`: `{ op: "add", section, name, quantity?, bought?, expire?, low? }`
/// | `{ op: "update", section, name, fields: { quantity?, bought?, expire?, low? } }`
/// (an empty string clears that attribute) | `{ op: "remove", section, name }`.
#[napi(js_name = "editPantry")]
pub fn edit_pantry(text: String, edit_json: String) -> napi::Result<String> {
    let edit: pantry_file::PantryEdit = serde_json::from_str(&edit_json)
        .map_err(|e| napi::Error::from_reason(format!("editPantry: invalid edit: {e}")))?;
    pantry_file::apply_edit(&text, &edit)
        .map_err(|message| napi::Error::from_reason(format!("editPantry: {message}")))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/cooklang-native && cargo test parse_pantry && cargo test edit_pantry && cargo test check_pantry`
Expected: PASS. The existing `parse_pantry_reports_sections_items_and_low_stock` still passes, because it only checks the fields that already existed.

If `parse_pantry_accepts_a_comment_only_file` fails because `parse_lenient` returns no output for an empty document, change `parse_pantry_conf` to return `Ok(cooklang::pantry::PantryConf::default())` when `text.lines().all(|l| { let l = l.trim(); l.is_empty() || l.starts_with('#') })`. Only do this if the test fails, and check that `PantryConf` implements `Default`. The plugin depends on this case, because its "Create pantry" button writes a comment-only file.

- [ ] **Step 5: Declare it in `index.d.ts`**

`index.d.ts` is committed. Edit it by hand so it matches what `napi build` generates. Replace the `parsePantry` doc block and add `editPantry` after `checkPantry`:

```ts
/**
 * Parse a `config/pantry.conf` (TOML) and return its sections and items.
 *
 * Returns JSON: `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow,
 *                  isOutOfStock, expireDate, boughtDate }] }],
 *                  lowStock: [{ name, section, quantity, low }] }`.
 */
export declare function parsePantry(text: string): string
```

```ts
/**
 * Apply one edit to a `config/pantry.conf` text and return the new text,
 * preserving comments and formatting (see `pantry_file`).
 *
 * `edit_json`: `{ op: "add", section, name, quantity?, bought?, expire?, low? }`
 * | `{ op: "update", section, name, fields: { quantity?, bought?, expire?, low? } }`
 * (an empty string clears that attribute) | `{ op: "remove", section, name }`.
 */
export declare function editPantry(text: string, editJson: string): string
```

- [ ] **Step 6: Build the addon and confirm the generated typings match**

Run:
```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd packages/cooklang-native && npm run build && git diff --stat index.d.ts index.js
```
Expected: the build succeeds and produces the `.node` file. `git diff` on `index.d.ts` shows only your Step 5 edits; if `napi` rewrote the file, keep its version. `index.js` is unchanged, or gains `editPantry` in its exports list, in which case commit that too.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-native/src/lib.rs packages/cooklang-native/index.d.ts packages/cooklang-native/index.js
git commit -m "feat(cooklang-native): editPantry and stock/date fields in parsePantry"
```

---

### Task 3: Language service `editPantry`

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts:128-139`
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts:304-312`

This is a straight pass-through with no logic of its own. It gets exercised through the Task 5 spec (mocked) and the manual check in Task 6.

- [ ] **Step 1: Extend the interface**

In `cooklang-language-service.ts`, replace the `parsePantry` doc block and add `editPantry` directly after `checkPantry`:

```ts
    /**
     * Parse a `pantry.conf` (TOML). Returns JSON
     * `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow, isOutOfStock, expireDate, boughtDate }] }], lowStock: [...] }`.
     * `expireDate`/`boughtDate` are the dates normalised to `YYYY-MM-DD` (null when unparseable).
     * Rejects on an unparseable file.
     */
    parsePantry(text: string): Promise<string>;
```

```ts
    /**
     * Apply one pantry edit (JSON, see native `editPantry`) to a `pantry.conf`
     * text and return the new text, preserving comments and formatting.
     * Rejects with `editPantry: <message>` on a bad edit or unparseable file.
     */
    editPantry(text: string, editJson: string): Promise<string>;
```

- [ ] **Step 2: Implement it**

In `cooklang-language-service-impl.ts`, directly after `checkPantry`:

```ts
    async editPantry(text: string, editJson: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.editPantry(text, editJson);
    }
```

- [ ] **Step 3: Compile**

Run:
```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```
Expected: success. If a test double somewhere declares `implements CooklangLanguageService`, the compiler will point at it. Add an `editPantry` stub there that returns `''`.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): editPantry on the language service"
```

---

### Task 4: Plugin-facing pantry types

**Files:**
- Create: `packages/cooklang/src/common/pantry-types.ts`
- Modify: `packages/cooklang/src/common/index.ts`

- [ ] **Step 1: Create the types**

`packages/cooklang/src/common/pantry-types.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

/**
 * One pantry item as `cooklang.api.parsePantry` returns it. Raw attribute
 * strings are as written in `pantry.conf` (quantities like `500%g`); absent
 * attributes are omitted.
 */
export interface PantryItemInfo {
    name: string;
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
    /** Quantity is at or below `low` (same unit). */
    isLow: boolean;
    /** Quantity parses to zero. An item without a quantity is in stock. */
    isOutOfStock: boolean;
    /** `expire` as `YYYY-MM-DD`; omitted when absent or unparseable. */
    expireDate?: string;
    /** `bought` as `YYYY-MM-DD`; omitted when absent or unparseable. */
    boughtDate?: string;
}

/** A `[section]` of `pantry.conf`; items above the first header are in `general`. */
export interface PantrySectionInfo {
    name: string;
    items: PantryItemInfo[];
}

/** Result of `cooklang.api.parsePantry`, sections in file order. */
export interface PantryContents {
    sections: PantrySectionInfo[];
}

/**
 * Attributes of a pantry edit. On `update`, an omitted attribute is left
 * alone and an empty string removes it.
 */
export interface PantryAttributes {
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
}

/** Argument `edit` of `cooklang.api.editPantry`. */
export type PantryEdit =
    | ({ op: 'add'; section: string; name: string } & PantryAttributes)
    | { op: 'update'; section: string; name: string; fields: PantryAttributes }
    | { op: 'remove'; section: string; name: string };
```

- [ ] **Step 2: Re-export**

Add a line to `packages/cooklang/src/common/index.ts`, following the file's existing style (for example `export * from './shopping-list-types';`):

```ts
export * from './pantry-types';
```

- [ ] **Step 3: Compile and commit**

Run: `npx lerna run compile --scope @theia/cooklang` (with the Node 22 PATH)
Expected: success.

```bash
git add packages/cooklang/src/common/pantry-types.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): plugin-facing pantry types"
```

---

### Task 5: `cooklang.api.parsePantry` and `cooklang.api.editPantry`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `cooklang-plugin-api-contribution.spec.ts`:

1. Add a field to `class Fixture` below `opened: string[] = [];`:

```ts
    pantryEdits: Array<{ text: string; json: string }> = [];
```

2. In `create()`, add two members to the `languageService` stub object after `compactChecked`:

```ts
            parsePantry: async () => JSON.stringify({
                sections: [{
                    name: 'fridge',
                    items: [{
                        name: 'milk', quantity: '1%L', bought: null, expire: '10.05.2026', low: null,
                        isLow: false, isOutOfStock: false, expireDate: '2026-05-10', boughtDate: null,
                    }],
                }],
                lowStock: [],
            }),
            editPantry: async (text: string, json: string) => {
                this.pantryEdits.push({ text, json });
                return 'edited';
            },
```

The fixture file already disables `no-null` only where the checked-log wire JSON needs it. If lint complains about the `null`s here, put `/* eslint-disable no-null/no-null */` on the line before `parsePantry:` and `/* eslint-enable no-null/no-null */` after its closing `}),`.

3. Add these tests at the end of the `describe` block:

```ts
    it('parses the pantry into the plugin shape, dropping nulls and lowStock', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_PANTRY, { text: '[fridge]' })).to.deep.equal({
            sections: [{
                name: 'fridge',
                items: [{ name: 'milk', quantity: '1%L', expire: '10.05.2026', isLow: false, isOutOfStock: false, expireDate: '2026-05-10' }],
            }],
        });
        expect(await fixture.error(CooklangPluginApi.Commands.PARSE_PANTRY, {})).to.match(/^Invalid arguments/);
    });

    it('edits the pantry with a validated, normalised edit', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.run(id, { text: 'T', edit: { op: 'add', section: ' fridge ', name: 'milk', quantity: '1%L', extra: 1 } }))
            .to.equal('edited');
        await fixture.run(id, { text: 'T', edit: { op: 'update', section: 'fridge', name: 'milk', fields: { expire: '' } } });
        await fixture.run(id, { text: 'T', edit: { op: 'remove', section: 'fridge', name: 'milk' } });
        expect(fixture.pantryEdits).to.deep.equal([
            { text: 'T', json: '{"op":"add","section":"fridge","name":"milk","quantity":"1%L"}' },
            { text: 'T', json: '{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}' },
            { text: 'T', json: '{"op":"remove","section":"fridge","name":"milk"}' },
        ]);
    });

    it('rejects malformed pantry edits before reaching the native code', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.EDIT_PANTRY;
        expect(await fixture.error(id, { text: 'T', edit: { op: 'rename', section: 'a', name: 'b' } })).to.match(/^Invalid arguments: `edit.op`/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'remove', section: 'a' } })).to.match(/^Invalid arguments: `edit.name`/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b', quantity: 3 } }))
            .to.match(/^Invalid arguments: `edit`.quantity must be a string/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'update', section: 'a', name: 'b' } })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { text: 'T', edit: { op: 'add', section: 'a', name: 'b\nc' } })).to.match(/control characters/);
        expect(await fixture.error(id, { edit: { op: 'remove', section: 'a', name: 'b' } })).to.match(/^Invalid arguments: `text`/);
        expect(fixture.pantryEdits).to.deep.equal([]);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang
```
Expected: compile FAILS with `Property 'PARSE_PANTRY' does not exist`. That is the failure we want.

- [ ] **Step 3: Implement**

In `cooklang-plugin-api-contribution.ts`:

1. Add the import below the `shopping-list-types` import:

```ts
import { PantryAttributes, PantryContents, PantryEdit, PantryItemInfo } from '../common/pantry-types';
```

2. Add two entries to `CooklangPluginApi.Commands` after `OPEN_PREVIEW`:

```ts
        /** `{ text }` → `PantryContents`: parse a `config/pantry.conf` text. */
        PARSE_PANTRY: 'cooklang.api.parsePantry',
        /** `{ text, edit: PantryEdit }` → new file text, comments and formatting preserved. */
        EDIT_PANTRY: 'cooklang.api.editPantry',
```

3. Register them at the end of `registerCommands`:

```ts
        registry.registerCommand({ id: Commands.PARSE_PANTRY }, { execute: (args: unknown) => this.parsePantry(args) });
        registry.registerCommand({ id: Commands.EDIT_PANTRY }, { execute: (args: unknown) => this.editPantry(args) });
```

4. Directly after the `openPreview` method, add:

```ts
    protected async parsePantry(args: unknown): Promise<PantryContents> {
        const text = this.text(this.object(args).text, '`text`');
        const wire = JSON.parse(await this.languageService.parsePantry(text)) as { sections: Array<{ name: string; items: Record<string, unknown>[] }> };
        return {
            sections: wire.sections.map(section => ({ name: section.name, items: section.items.map(item => this.pantryItem(item)) })),
        };
    }

    /** Native JSON uses null for absent attributes; the plugin shape omits them. */
    protected pantryItem(wire: Record<string, unknown>): PantryItemInfo {
        const item: PantryItemInfo = { name: String(wire.name), isLow: wire.isLow === true, isOutOfStock: wire.isOutOfStock === true };
        for (const key of ['quantity', 'bought', 'expire', 'low', 'expireDate', 'boughtDate'] as const) {
            const value = wire[key];
            if (typeof value === 'string') {
                item[key] = value;
            }
        }
        return item;
    }

    protected async editPantry(args: unknown): Promise<string> {
        const request = this.object(args);
        const text = this.text(request.text, '`text`');
        const edit = this.pantryEdit(request.edit);
        return this.languageService.editPantry(text, JSON.stringify(edit));
    }

    protected pantryEdit(value: unknown): PantryEdit {
        const edit = this.object(value);
        const op = edit.op;
        if (op !== 'add' && op !== 'update' && op !== 'remove') {
            throw this.invalid('`edit.op` must be "add", "update" or "remove".');
        }
        const section = this.string(edit.section, '`edit.section`');
        const name = this.string(edit.name, '`edit.name`');
        switch (op) {
            case 'add': return { op, section, name, ...this.pantryAttributes(edit, '`edit`') };
            case 'update': return { op, section, name, fields: this.pantryAttributes(this.object(edit.fields), '`edit.fields`') };
            case 'remove': return { op, section, name };
        }
    }

    /** Picks the four known attributes; an empty string is kept (it clears on update). */
    protected pantryAttributes(source: Record<string, unknown>, name: string): PantryAttributes {
        const attributes: PantryAttributes = {};
        for (const key of ['quantity', 'bought', 'expire', 'low'] as const) {
            const value = source[key];
            if (value === undefined) {
                continue;
            }
            if (typeof value !== 'string') {
                throw this.invalid(`${name}.${key} must be a string.`);
            }
            this.noControlCharacters(value, `${name}.${key}`);
            attributes[key] = value.trim();
        }
        return attributes;
    }
```

5. In the class JSDoc of `CooklangPluginApi`, no text change is needed; the commands are additive and `VERSION` stays `1`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang
```
Expected: all tests PASS, including the existing `registers every API command without a label`. That test reads `Object.values(Commands)`, so it now covers the new commands too.

- [ ] **Step 5: Lint**

Run: `npx eslint packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts packages/cooklang/src/common/pantry-types.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.parsePantry and cooklang.api.editPantry"
```

---

### Task 6: End-to-end check in the running app

**Files:** none (verification only)

- [ ] **Step 1: Bundle and start**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd app && npm run bundle && cd .. && npm run start:electron
```

- [ ] **Step 2: Call the commands from a plugin host**

Open a recipe folder that has a `config/pantry.conf` containing a comment line. The easiest caller is the Developer Tools console of the Electron window, through the frontend command registry. If that isn't reachable from the console, skip this step and rely on the plugin E2E in the plugin plan. Confirm:
- `cooklang.api.parsePantry` returns sections, and items carry `isOutOfStock` and `expireDate`.
- `cooklang.api.editPantry` with an `update` that clears `expire` returns text in which the comment line is still present.

- [ ] **Step 3: Confirm the AI pantry tools still work**

In Cookbot chat, ask "what's in my pantry?". The `getPantry` tool response now includes the extra fields, and nothing breaks.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feature/pantry-plugin
gh pr create --title "feat(cooklang): pantry editing API for plugins" --body "$(cat <<'EOF'
Adds `cooklang.api.parsePantry` and `cooklang.api.editPantry` so a plugin can show and edit `config/pantry.conf`.

- Native `editPantry` edits the TOML in place with `toml_edit` (ported from cookcli-core), so comments and formatting survive; an empty string clears an attribute.
- `parsePantry` gains `isOutOfStock`, `expireDate`, `boughtDate`.
- API version stays 1 (additive).

Spec: docs/superpowers/specs/2026-09-26-pantry-plugin-design.md
EOF
)"
```
