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
    let raw = raw.trim();
    DATE_FORMATS
        .iter()
        .find_map(|format| chrono::NaiveDate::parse_from_str(raw, format).ok())
        .map(|date| date.format("%Y-%m-%d").to_string())
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

/// Apply `edit` to the pantry file `text` and return the new text.
/// The error is a user-facing message.
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
