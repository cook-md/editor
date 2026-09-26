//! Editing `config/pantry.conf` **in place**, as text, for `editPantry`.
//!
//! Ported from cookcli-core (`crates/core/src/pantry/edit.rs`): only the entry
//! asked for is touched, so comments (including a trailing `# note` on the
//! item), blank lines, key order, the short `name = "1%kg"` form, items
//! written as `[section.item]` tables and attributes `cooklang` does not model
//! all survive. On top of cookcli, an update can *clear* an attribute (empty
//! string).
//!
//! The edits must agree with how `cooklang::pantry` reads the file:
//! - top-level string keys are the items of the section called `general`,
//!   and they *replace* an explicit `[general]` table. So `general` means the
//!   document root, unless the root holds no items and a `general` section
//!   exists, in which case that section is edited like any other; when both
//!   exist the edit is refused.
//! - any other top-level key is a section: a table, an inline table, an array
//!   of names or of tables, or `[[section]]`. Only tables can be edited; an
//!   array of names is first rewritten as a table.
//!
//! Anything the editor cannot change without dropping or rewriting data it
//! was not asked to touch is refused with a message pointing to the file.

use chrono::Datelike;
use serde::Deserialize;
use toml_edit::{Decor, DocumentMut, InlineTable, Item, RawString, Table, TableLike, Value};

/// The section name that addresses the entries above the first `[header]`.
pub(crate) const GENERAL: &str = "general";

/// Date formats accepted in `bought` / `expire`, tried in order (same list as
/// cookcli's pantry `parse_date`).
const DATE_FORMATS: [&str; 6] = [
    "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y.%m.%d", "%d-%m-%Y",
];

/// `raw` as `YYYY-MM-DD`, or `None` when no accepted format matches. A year
/// before 1000 is taken as a two-digit year (`01.10.26`) and rejected rather
/// than read as the year 26.
pub(crate) fn normalise_pantry_date(raw: &str) -> Option<String> {
    let raw = raw.trim();
    DATE_FORMATS
        .iter()
        .find_map(|format| chrono::NaiveDate::parse_from_str(raw, format).ok())
        .filter(|date| date.year() >= 1000)
        .map(|date| date.format("%Y-%m-%d").to_string())
}

/// Item attributes. On `update`: `None` leaves the attribute alone, `Some("")`
/// removes it, anything else sets it. On `add`: `None` and `Some("")` both
/// mean "do not write". Unknown attributes are rejected.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// One edit, as JSON: `{"op":"add"|"update"|"remove", ...}`. Unknown fields
/// are rejected, so a misspelt attribute is an error rather than a no-op.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
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

    /// The value a fresh item takes: short form at the root, or unless an
    /// attribute other than the quantity needs a table.
    fn to_item(&self, target: SectionTarget) -> Item {
        let short = matches!(target, SectionTarget::Root)
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

/// Where the items of the section an edit names live.
#[derive(Debug, Clone, Copy, PartialEq)]
enum SectionTarget<'a> {
    /// `general` as the parser reads it: the string keys at the document root.
    Root,
    /// The top-level key holding the section (possibly an explicit `general`).
    Key(&'a str),
}

/// Decide where `section` lives; see the module doc for `general`.
fn resolve_target<'a>(doc: &DocumentMut, section: &'a str) -> Result<SectionTarget<'a>, String> {
    if section != GENERAL {
        return Ok(SectionTarget::Key(section));
    }
    // `general = "1%kg"` would be a root item called general, not a section.
    let general_section = doc.get(GENERAL).is_some_and(|item| !is_root_item(item));
    let has_root_items = doc.iter().any(|(_, item)| is_root_item(item));
    match (general_section, has_root_items) {
        (true, true) => Err(
            "both top-level items and a [general] table exist; merge them by hand in config/pantry.conf"
                .to_string(),
        ),
        (true, false) => Ok(SectionTarget::Key(GENERAL)),
        (false, _) => Ok(SectionTarget::Root),
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
            let target = resolve_target(&doc, section)?;
            check_general_attributes(target, name, &attributes)?;
            normalise_array_section(&mut doc, target)?;
            if let Some(existing) = matching_items(&doc, target)?.and_then(|keys| {
                let wanted = name.to_lowercase();
                keys.into_iter().find(|key| key.to_lowercase() == wanted)
            }) {
                return Err(format!("item '{existing}' already exists in section '{section}'"));
            }
            if target == SectionTarget::Root && doc.get(name).is_some() {
                return Err(format!("'{name}' is already used as a section name"));
            }
            insert(&mut doc, target, name, &attributes)?;
        }
        PantryEdit::Update { section, name, fields } => {
            let (section, name) = (required(section, "section")?, required(name, "name")?);
            if fields.is_empty() {
                return Err(format!("no fields to update on item '{name}' in section '{section}'"));
            }
            let target = resolve_target(&doc, section)?;
            check_general_attributes(target, name, &fields.written())?;
            normalise_array_section(&mut doc, target)?;
            let key = resolve_item(&doc, target, section, name)?;
            apply(&mut doc, target, section, &key, fields)?;
        }
        PantryEdit::Remove { section, name } => {
            let (section, name) = (required(section, "section")?, required(name, "name")?);
            let target = resolve_target(&doc, section)?;
            normalise_array_section(&mut doc, target)?;
            let key = resolve_item(&doc, target, section, name)?;
            remove(&mut doc, target, &key);
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

/// A root item can only be written `name = "quantity"`: the parser reads a
/// top-level inline table as a section, so refuse rather than corrupt.
fn check_general_attributes(target: SectionTarget, name: &str, attributes: &Attributes) -> Result<(), String> {
    if target != SectionTarget::Root {
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
/// to put a key. Arrays holding anything but strings are left alone (and then
/// refused by the edit); a name listed twice cannot become two keys, and a
/// comment inside or after the list has no place in the table, so both are
/// refused here rather than merged or dropped. The comment lines above the
/// list move onto the `[fridge]` header. Each name becomes `milk = {}`, which
/// the parser reads like a listed name: an item without a quantity.
fn normalise_array_section(doc: &mut DocumentMut, target: SectionTarget) -> Result<(), String> {
    let SectionTarget::Key(section) = target else {
        return Ok(());
    };
    let Some(Item::Value(Value::Array(array))) = doc.get(section) else {
        return Ok(());
    };
    let names: Vec<String> = array
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    if names.len() != array.len() {
        return Ok(());
    }
    if array_has_comments(array) {
        return Err(format!(
            "section '{section}' is a list with comments; move it to a [{section}] table by hand in \
             config/pantry.conf"
        ));
    }
    let mut table = Table::new();
    table.set_implicit(false);
    for name in &names {
        if table.contains_key(name) {
            return Err(format!(
                "section '{section}' lists '{name}' more than once; remove the duplicate by hand in \
                 config/pantry.conf"
            ));
        }
        table.insert(name, toml_edit::value(InlineTable::new()));
    }
    let comments = doc.as_table().key(section).and_then(|key| comment_lines(key.leaf_decor().prefix()));
    if let Some(comments) = comments {
        table.decor_mut().set_prefix(comments);
    }
    doc.insert(section, Item::Table(table));
    Ok(())
}

/// True when a comment is written anywhere in `array`: around a value,
/// after the last one, or after the closing bracket.
fn array_has_comments(array: &toml_edit::Array) -> bool {
    let is_comment = |raw: Option<&RawString>| raw.and_then(RawString::as_str).is_some_and(|raw| raw.contains('#'));
    is_comment(Some(array.trailing()))
        || is_comment(array.decor().prefix())
        || is_comment(array.decor().suffix())
        || array
            .iter()
            .any(|value| is_comment(value.decor().prefix()) || is_comment(value.decor().suffix()))
}

/// How `item` is written, for messages ("an array", "a string", ...).
fn describe(item: &Item) -> &'static str {
    match item {
        Item::None => "nothing",
        Item::Table(_) => "a table",
        Item::ArrayOfTables(_) => "an array of tables",
        Item::Value(Value::String(_)) => "a string",
        Item::Value(Value::Integer(_) | Value::Float(_)) => "a bare number",
        Item::Value(Value::Boolean(_)) => "a boolean",
        Item::Value(Value::Datetime(_)) => "a date",
        Item::Value(Value::Array(_)) => "an array",
        Item::Value(Value::InlineTable(_)) => "an inline table",
    }
}

fn not_a_table(section: &str, item: &Item) -> String {
    format!(
        "section '{section}' is written in a form this editor can't change ({}); edit it by hand in \
         config/pantry.conf",
        describe(item)
    )
}

/// A root entry that the parser reads as a `general` item (any other root
/// entry is a section).
fn is_root_item(entry: &Item) -> bool {
    entry.as_str().is_some()
}

/// The table holding the section's items: `None` when the section does not
/// exist, an error when it exists in a form that cannot be edited.
fn section_entries<'a>(doc: &'a DocumentMut, target: SectionTarget) -> Result<Option<&'a dyn TableLike>, String> {
    match target {
        SectionTarget::Root => Ok(Some(doc.as_table())),
        SectionTarget::Key(section) => match doc.get(section) {
            None => Ok(None),
            Some(item) => item.as_table_like().map(Some).ok_or_else(|| not_a_table(section, item)),
        },
    }
}

/// The keys of the section's items (a root table is a section, not an item).
fn matching_items(doc: &DocumentMut, target: SectionTarget) -> Result<Option<Vec<String>>, String> {
    Ok(section_entries(doc, target)?.map(|entries| {
        entries
            .iter()
            .filter(|(_, entry)| target != SectionTarget::Root || is_root_item(entry))
            .map(|(key, _)| key.to_string())
            .collect()
    }))
}

/// The key of item `name`, matched ignoring case like `add`'s duplicate check.
/// When several keys differ only by case, only an exact match will do.
fn resolve_item(doc: &DocumentMut, target: SectionTarget, section: &str, name: &str) -> Result<String, String> {
    let Some(keys) = matching_items(doc, target)? else {
        return Err(format!("section '{section}' not found"));
    };
    let wanted = name.to_lowercase();
    let matches: Vec<String> = keys.into_iter().filter(|key| key.to_lowercase() == wanted).collect();
    if matches.iter().any(|key| key == name) {
        return Ok(name.to_string());
    }
    match matches.as_slice() {
        [] => Err(format!("item '{name}' not found in section '{section}'")),
        [only] => Ok(only.clone()),
        _ => Err(format!(
            "more than one item in section '{section}' is called '{name}' ({}); use the exact name",
            matches.join(", ")
        )),
    }
}

/// Add the item, creating a `[section]` table when the section is missing.
/// Refuses a section that exists in a form other than a table rather than
/// replacing it.
fn insert(doc: &mut DocumentMut, target: SectionTarget, name: &str, attributes: &Attributes) -> Result<(), String> {
    let value = attributes.to_item(target);
    let SectionTarget::Key(section) = target else {
        // Root keys are emitted before any `[header]`, which is where they belong.
        doc.insert(name, value);
        return Ok(());
    };
    match doc.get(section) {
        None => {
            let mut table = Table::new();
            table.set_implicit(false);
            doc.insert(section, Item::Table(table));
        }
        Some(item) if !item.is_table_like() => return Err(not_a_table(section, item)),
        Some(_) => {}
    }
    if let Some(table) = doc.get_mut(section).and_then(Item::as_table_like_mut) {
        table.insert(name, value);
    }
    Ok(())
}

/// Remove the item, and its section when that empties it (the parser drops
/// empty sections anyway, so keeping one would not survive a round-trip).
/// Comments written above whatever is removed are kept; see
/// [`remove_keeping_comments`].
fn remove(doc: &mut DocumentMut, target: SectionTarget, key: &str) {
    let SectionTarget::Key(section) = target else {
        remove_keeping_comments(doc, &[], key);
        return;
    };
    let emptied = match doc.get_mut(section) {
        // An inline table cannot hold comments, so a plain remove loses nothing.
        Some(Item::Value(Value::InlineTable(table))) => {
            table.remove(key);
            table.is_empty()
        }
        Some(Item::Table(_)) => {
            remove_keeping_comments(doc, &[(section.to_string(), None)], key);
            doc.get(section).and_then(Item::as_table_like).is_some_and(TableLike::is_empty)
        }
        _ => false,
    };
    if emptied {
        remove_keeping_comments(doc, &[], section);
    }
}

/// A `[table]`'s place in the document: the keys leading to it from the root,
/// each with the index into `[[array.of.tables]]` when the key holds one.
type TablePath = [(String, Option<usize>)];

/// An owned [`TablePath`].
type TablePathBuf = Vec<(String, Option<usize>)>;

/// Remove `key` from the table at `path`. In toml_edit a comment belongs to
/// the key or `[header]` written below it, so the comment lines above the
/// removed entry are first moved onto whatever renders next: the following
/// key of the same table, else the next `[header]`, else the end of the file.
fn remove_keeping_comments(doc: &mut DocumentMut, path: &TablePath, key: &str) {
    let Some(table) = table_at_mut(doc, path) else {
        return;
    };
    let (comments, next_key, after) = match table.get(key) {
        None => return,
        Some(item) if !headers(item).is_empty() => {
            let headers = headers(item);
            let comments: String = headers.iter().filter_map(|t| comment_lines(t.decor().prefix())).collect();
            let index = matches!(item, Item::ArrayOfTables(_)).then(|| headers.len() - 1);
            let mut after = path.to_vec();
            after.push((key.to_string(), index));
            (comments, None, after)
        }
        Some(_) => {
            let comments = table.key(key).and_then(|key| comment_lines(key.leaf_decor().prefix()));
            (comments.unwrap_or_default(), next_value_key(table, key), path.to_vec())
        }
    };
    let next_header = next_header(doc, &after, path.len(), key);
    if let Some(table) = table_at_mut(doc, path) {
        table.remove(key);
    }
    if comments.is_empty() {
        return;
    }
    if let Some(next) = next_key {
        if let Some(mut next) = table_at_mut(doc, path).and_then(|table| table.key_mut(&next)) {
            prepend_prefix(next.leaf_decor_mut(), &comments);
        }
    } else if let Some(header) = next_header.and_then(|header| table_at_mut(doc, &header)) {
        prepend_prefix(header.decor_mut(), &comments);
    } else {
        let trailing = doc.trailing().as_str().unwrap_or("").to_string();
        doc.set_trailing(format!("{trailing}{comments}"));
    }
}

/// Put `lines` in front of what is already written above a key or header.
fn prepend_prefix(decor: &mut Decor, lines: &str) {
    let existing = decor.prefix().and_then(RawString::as_str).unwrap_or("").to_string();
    decor.set_prefix(format!("{lines}{existing}"));
}

/// The `[header]` tables an entry is written as: none for a key/value (a
/// dotted `a.b = 1` included), one for `[table]`, one per `[[table]]`.
fn headers(item: &Item) -> Vec<&Table> {
    match item {
        Item::Table(table) if !table.is_dotted() => vec![table],
        Item::ArrayOfTables(tables) => tables.iter().collect(),
        _ => Vec::new(),
    }
}

/// The comment lines of a key or header prefix: everything up to its last
/// line break (the rest is the indentation of the key itself). `None` when
/// there is no comment, so blank lines alone are not moved around.
fn comment_lines(prefix: Option<&RawString>) -> Option<String> {
    let prefix = prefix?.as_str()?;
    if !prefix.contains('#') {
        return None;
    }
    Some(prefix[..=prefix.rfind('\n')?].to_string())
}

/// The key written right after `key` in `table`, among the entries rendered
/// as `key = value` lines (sub-tables render later, under their own header).
fn next_value_key(table: &Table, key: &str) -> Option<String> {
    table
        .iter()
        .skip_while(|(candidate, _)| *candidate != key)
        .skip(1)
        .find(|(_, item)| headers(item).is_empty())
        .map(|(candidate, _)| candidate.to_string())
}

/// The first `[header]` rendered after the table at `after`, skipping the
/// headers of entry `key` of the table at `after[..depth]` (the entry being
/// removed, and anything nested in it).
fn next_header(doc: &DocumentMut, after: &TablePath, depth: usize, key: &str) -> Option<TablePathBuf> {
    let inside_removed =
        |path: &TablePath| path.len() > depth && path[..depth] == after[..depth] && path[depth].0 == key;
    render_order(doc)
        .into_iter()
        .skip_while(|(path, _)| path.as_slice() != after)
        .skip(1)
        .find(|(path, has_header)| *has_header && !inside_removed(path))
        .map(|(path, _)| path)
}

/// Every table in the order toml_edit renders them (by position, a table
/// without one following the table visited before it), with whether a
/// `[header]` line is written for it.
fn render_order(doc: &DocumentMut) -> Vec<(TablePathBuf, bool)> {
    fn visit(
        table: &Table,
        path: &mut TablePathBuf,
        is_array: bool,
        last_position: &mut usize,
        out: &mut Vec<(usize, TablePathBuf, bool)>,
    ) {
        if !table.is_dotted() {
            *last_position = table.position().unwrap_or(*last_position);
            let has_values = table.iter().any(|(_, item)| headers(item).is_empty());
            let has_header = !path.is_empty() && (is_array || !table.is_implicit() || has_values);
            out.push((*last_position, path.clone(), has_header));
        }
        for (key, item) in table.iter() {
            match item {
                Item::Table(child) => {
                    path.push((key.to_string(), None));
                    visit(child, path, false, last_position, out);
                    path.pop();
                }
                Item::ArrayOfTables(children) => {
                    for (index, child) in children.iter().enumerate() {
                        path.push((key.to_string(), Some(index)));
                        visit(child, path, true, last_position, out);
                        path.pop();
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    visit(doc.as_table(), &mut Vec::new(), false, &mut 0, &mut out);
    out.sort_by_key(|(position, _, _)| *position);
    out.into_iter().map(|(_, path, has_header)| (path, has_header)).collect()
}

/// The table at `path`, if it is still there.
fn table_at_mut<'a>(doc: &'a mut DocumentMut, path: &TablePath) -> Option<&'a mut Table> {
    let mut table = doc.as_table_mut();
    for (key, index) in path {
        table = match (table.get_mut(key)?, index) {
            (Item::Table(child), None) => child,
            (Item::ArrayOfTables(children), Some(index)) => children.get_mut(*index)?,
            _ => return None,
        };
    }
    Some(table)
}

/// Update the item at `key`. A `[section.item]` table has its keys edited in
/// place; a string or inline table value is rewritten in the shortest form
/// that holds its attributes, keeping its trailing comment.
fn apply(
    doc: &mut DocumentMut,
    target: SectionTarget,
    section: &str,
    key: &str,
    fields: &Attributes,
) -> Result<(), String> {
    let existing = match target {
        SectionTarget::Root => doc.as_table_mut().get_mut(key),
        SectionTarget::Key(section) => doc
            .get_mut(section)
            .and_then(Item::as_table_like_mut)
            .and_then(|table| table.get_mut(key)),
    };
    let Some(existing) = existing else {
        return Err(format!("item '{key}' not found in section '{section}'"));
    };

    if let Some(table) = existing.as_table_mut() {
        write_fields(table, fields);
        return Ok(());
    }
    let Some(existing) = existing.as_value_mut() else {
        return Err(unsupported_item(existing, section, key));
    };

    // Only the quantity changes (clearing an attribute a short item does not
    // have is a no-op): keep `milk = "1%L"` short.
    let only_quantity = fields
        .entries()
        .iter()
        .all(|(key, value)| *key == "quantity" || value.map_or(true, str::is_empty));
    // `milk = {}` (a listed name) has no attributes to keep either.
    let bare = existing.is_str() || existing.as_inline_table().is_some_and(InlineTable::is_empty);
    if bare && only_quantity {
        match fields.quantity.as_deref() {
            // Clearing the quantity of `milk = {}` leaves it as it is.
            Some("") if !existing.is_str() => {}
            Some(quantity) => replace_value(existing, quantity.into()),
            None => {}
        }
        return Ok(());
    }

    let mut table = as_inline_table(existing, section, key)?;
    let cleared = write_fields(&mut table, fields);
    let collapse = cleared
        && table.iter().all(|(key, _)| key == "quantity")
        && table.get("quantity").map_or(true, |quantity| quantity.as_str().is_some());
    let replacement = if collapse {
        table.get("quantity").and_then(Value::as_str).unwrap_or("").into()
    } else {
        Value::InlineTable(table)
    };
    replace_value(existing, replacement);
    Ok(())
}

/// Set or clear `fields` on an item's attribute table, keeping the comments
/// of the keys it overwrites. True when an attribute was removed.
fn write_fields(table: &mut dyn TableLike, fields: &Attributes) -> bool {
    let mut cleared = false;
    for (key, value) in fields.entries() {
        match value {
            Some("") => cleared |= table.remove(key).is_some(),
            Some(value) => match table.get_mut(key).and_then(Item::as_value_mut) {
                Some(slot) => replace_value(slot, value.into()),
                None => {
                    table.insert(key, toml_edit::value(value));
                }
            },
            None => {}
        }
    }
    cleared
}

/// Put `replacement` in `slot`, keeping the whitespace and trailing comment
/// around the old value.
fn replace_value(slot: &mut Value, mut replacement: Value) {
    *replacement.decor_mut() = slot.decor().clone();
    *slot = replacement;
}

/// The value as an inline table. Refuses values that are neither a quantity
/// string nor an inline table, rather than guessing and overwriting them.
fn as_inline_table(value: &Value, section: &str, name: &str) -> Result<InlineTable, String> {
    match value {
        Value::String(quantity) => {
            let mut table = InlineTable::new();
            table.insert("quantity", quantity.value().as_str().into());
            Ok(table)
        }
        Value::InlineTable(table) => Ok(table.clone()),
        _ => Err(unsupported_item(&Item::Value(value.clone()), section, name)),
    }
}

fn unsupported_item(item: &Item, section: &str, name: &str) -> String {
    format!(
        "item '{name}' in section '{section}' is written as {}, which is not a quantity or a set of \
         attributes; edit it by hand in config/pantry.conf",
        describe(item)
    )
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
        assert!(out.contains("milk = {}"), "{out}");
        assert!(out.contains("eggs = {}"), "{out}");
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

    fn general_items(out: &str) -> Vec<(String, Option<String>)> {
        let conf = cooklang::pantry::parse_lenient(out).into_output().expect("parses");
        conf.sections
            .get("general")
            .map(|items| {
                items
                    .iter()
                    .map(|item| (item.name().to_string(), item.quantity().map(str::to_string)))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn dates_with_a_two_digit_year_are_not_read_as_the_first_century() {
        assert_eq!(normalise_pantry_date("01.10.26"), None);
        assert_eq!(normalise_pantry_date("26-10-01"), None);
        assert_eq!(normalise_pantry_date("0999-01-01"), None);
        assert_eq!(normalise_pantry_date("1000-01-01").as_deref(), Some("1000-01-01"));
    }

    #[test]
    fn add_refuses_to_replace_a_section_that_is_not_a_table() {
        let add = r#"{"op":"add","section":"fridge","name":"butter","quantity":"200%g"}"#;
        for (text, kind) in [
            ("[[fridge]]\nname = \"milk\"\n", "an array of tables"),
            ("fridge = [{ name = \"milk\" }]\n", "an array"),
            ("fridge = [\"milk\", 3]\n", "an array"),
        ] {
            let err = edit(text, add).unwrap_err();
            assert_eq!(
                err,
                format!(
                    "section 'fridge' is written in a form this editor can't change ({kind}); \
                     edit it by hand in config/pantry.conf"
                ),
                "{text}"
            );
        }
        let err = edit(
            "salt = \"1%kg\"\n",
            r#"{"op":"add","section":"salt","name":"flakes","quantity":"1"}"#,
        )
        .unwrap_err();
        assert!(err.contains("section 'salt' is written in a form") && err.contains("(a string)"), "{err}");
    }

    #[test]
    fn update_and_remove_explain_a_section_that_is_not_a_table() {
        let text = "[[fridge]]\nname = \"milk\"\n";
        let err = edit(text, r#"{"op":"remove","section":"fridge","name":"milk"}"#).unwrap_err();
        assert!(err.contains("can't change (an array of tables)"), "{err}");
        let err = edit(
            text,
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"1"}}"#,
        )
        .unwrap_err();
        assert!(err.contains("can't change (an array of tables)"), "{err}");
    }

    #[test]
    fn add_to_general_refuses_a_name_already_used_by_a_section() {
        let text = "[fridge]\nmilk = \"1%L\"\n";
        let err = edit(text, r#"{"op":"add","section":"general","name":"fridge","quantity":"1"}"#)
            .unwrap_err();
        assert_eq!(err, "'fridge' is already used as a section name");
        let err = edit(
            "fridge = [\"milk\"]\n",
            r#"{"op":"add","section":"general","name":"fridge","quantity":"1"}"#,
        )
        .unwrap_err();
        assert_eq!(err, "'fridge' is already used as a section name");
    }

    #[test]
    fn remove_from_general_does_not_touch_a_top_level_array_section() {
        let err = edit("fridge = [\"milk\"]\n", r#"{"op":"remove","section":"general","name":"fridge"}"#)
            .unwrap_err();
        assert_eq!(err, "item 'fridge' not found in section 'general'");
    }

    #[test]
    fn an_explicit_general_table_is_edited_as_a_section() {
        let text = "# spices\n[general]\nsalt = \"1%kg\"\n";

        let out = edit(text, r#"{"op":"update","section":"general","name":"salt","fields":{"quantity":"2%kg"}}"#)
            .unwrap();
        assert!(out.contains("[general]\nsalt = \"2%kg\""), "{out}");
        assert_eq!(general_items(&out), vec![("salt".to_string(), Some("2%kg".to_string()))]);

        let out = edit(text, r#"{"op":"update","section":"general","name":"salt","fields":{"expire":"2027-01-01"}}"#)
            .unwrap();
        assert!(out.contains("salt = { quantity = \"1%kg\", expire = \"2027-01-01\" }"), "{out}");
        let conf = cooklang::pantry::parse_lenient(&out).into_output().expect("parses");
        assert_eq!(conf.sections["general"][0].expire(), Some("2027-01-01"));

        let out = edit(text, r#"{"op":"add","section":"general","name":"pepper","quantity":"50%g","low":"10%g"}"#)
            .unwrap();
        assert!(out.find("pepper").unwrap() > out.find("[general]").unwrap(), "{out}");
        assert_eq!(
            general_items(&out),
            vec![
                ("salt".to_string(), Some("1%kg".to_string())),
                ("pepper".to_string(), Some("50%g".to_string())),
            ]
        );

        let out = edit(text, r#"{"op":"remove","section":"general","name":"salt"}"#).unwrap();
        assert!(!out.contains("salt"), "{out}");
        assert!(general_items(&out).is_empty(), "{out}");
    }

    #[test]
    fn a_general_array_section_is_edited_as_a_section() {
        let out = edit(
            "general = [\"salt\"]\n",
            r#"{"op":"add","section":"general","name":"pepper","quantity":"50%g"}"#,
        )
        .unwrap();
        assert_eq!(
            general_items(&out),
            vec![("salt".to_string(), None), ("pepper".to_string(), Some("50%g".to_string()))]
        );
    }

    #[test]
    fn general_edits_refuse_top_level_items_next_to_a_general_table() {
        let text = "pepper = \"1\"\n[general]\nsalt = \"1%kg\"\n";
        let expected = "both top-level items and a [general] table exist; merge them by hand in config/pantry.conf";
        for json in [
            r#"{"op":"add","section":"general","name":"cumin"}"#,
            r#"{"op":"update","section":"general","name":"pepper","fields":{"quantity":"2"}}"#,
            r#"{"op":"remove","section":"general","name":"salt"}"#,
        ] {
            assert_eq!(edit(text, json).unwrap_err(), expected, "{json}");
        }
    }

    #[test]
    fn an_item_written_as_a_subtable_is_edited_in_place() {
        let text = "[fridge]\neggs = \"6\"\n\n# the good milk\n[fridge.milk]\n# note\nquantity = \"1%L\"\n";
        let out = edit(text, r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":"2026-10-01"}}"#)
            .unwrap();
        assert!(out.contains("# the good milk\n[fridge.milk]\n# note\nquantity = \"1%L\"\n"), "{out}");
        assert!(out.contains("expire = \"2026-10-01\""), "{out}");
        assert!(!out.contains("milk ="), "{out}");
        let conf = cooklang::pantry::parse_lenient(&out).into_output().expect("parses");
        let milk = conf.sections["fridge"].iter().find(|item| item.name() == "milk").unwrap();
        assert_eq!(milk.expire(), Some("2026-10-01"));

        let out = edit(&out, r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}"#)
            .unwrap();
        assert!(out.contains("# the good milk\n[fridge.milk]\n# note\nquantity = \"1%L\"\n"), "{out}");
        assert!(!out.contains("expire"), "{out}");
        assert!(!out.contains("milk ="), "{out}");
    }

    #[test]
    fn a_trailing_comment_on_the_item_survives_an_update() {
        let out = edit(
            "[fridge]\nmilk = \"1%L\" # note\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"2%L"}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = \"2%L\" # note"), "{out}");

        let out = edit(
            "[fridge]\nmilk = \"1%L\" # note\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":"2026-10-01"}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = { quantity = \"1%L\", expire = \"2026-10-01\" } # note"), "{out}");

        let out = edit(
            "[fridge]\nmilk = { quantity = \"1%L\", expire = \"2026-10-01\" } # note\n",
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expire":""}}"#,
        )
        .unwrap();
        assert!(out.contains("milk = \"1%L\" # note"), "{out}");

        let out = edit(
            "salt = \"1%kg\" # note\n",
            r#"{"op":"update","section":"general","name":"salt","fields":{"quantity":"2%kg"}}"#,
        )
        .unwrap();
        assert!(out.contains("salt = \"2%kg\" # note"), "{out}");
    }

    #[test]
    fn unknown_fields_in_an_edit_are_rejected() {
        for json in [
            r#"{"op":"update","section":"fridge","name":"milk","fields":{"expiry":"x"}}"#,
            r#"{"op":"add","section":"fridge","name":"milk","expiry":"x"}"#,
            r#"{"op":"remove","section":"fridge","name":"milk","quantity":"1"}"#,
        ] {
            assert!(serde_json::from_str::<PantryEdit>(json).is_err(), "{json}");
        }
    }

    #[test]
    fn update_and_remove_find_the_item_ignoring_case() {
        let text = "[fridge]\nMilk = \"1%L\"\n";
        let out = edit(text, r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"2%L"}}"#)
            .unwrap();
        assert!(out.contains("Milk = \"2%L\""), "{out}");
        let out = edit(text, r#"{"op":"remove","section":"fridge","name":"milk"}"#).unwrap();
        assert!(!out.contains("Milk"), "{out}");
        let out = edit(
            "Salt = \"1%kg\"\n",
            r#"{"op":"update","section":"general","name":"salt","fields":{"quantity":"2%kg"}}"#,
        )
        .unwrap();
        assert!(out.contains("Salt = \"2%kg\""), "{out}");
    }

    #[test]
    fn items_differing_only_by_case_need_an_exact_name() {
        let text = "[fridge]\nMilk = \"1%L\"\nMILK = \"2%L\"\n";
        let err = edit(text, r#"{"op":"remove","section":"fridge","name":"milk"}"#).unwrap_err();
        assert!(err.contains("more than one item") && err.contains("Milk") && err.contains("MILK"), "{err}");
        let out = edit(text, r#"{"op":"remove","section":"fridge","name":"MILK"}"#).unwrap();
        assert!(out.contains("Milk = \"1%L\""), "{out}");
        assert!(!out.contains("MILK"), "{out}");
    }

    #[test]
    fn an_array_section_listing_a_name_twice_is_not_converted() {
        let err = edit(
            "fridge = [\"rice\", \"rice\"]\n",
            r#"{"op":"add","section":"fridge","name":"beans"}"#,
        )
        .unwrap_err();
        assert_eq!(
            err,
            "section 'fridge' lists 'rice' more than once; remove the duplicate by hand in config/pantry.conf"
        );
    }

    /// `text` minus the item, checked to still parse.
    fn removed(text: &str, section: &str, name: &str) -> String {
        let out = edit(text, &format!(r#"{{"op":"remove","section":"{section}","name":"{name}"}}"#)).unwrap();
        cooklang::pantry::parse_lenient(&out).into_output().expect("parses");
        out
    }

    #[test]
    fn removing_a_root_item_keeps_the_comment_above_it() {
        let out = removed("# my pantry header\nsalt = \"1%kg\"\npepper = \"1\"\n", "general", "salt");
        assert!(out.contains("# my pantry header\npepper = \"1\""), "{out}");
        assert!(!out.contains("salt"), "{out}");
    }

    #[test]
    fn removing_a_section_item_keeps_the_comment_above_it() {
        let out = removed("[fridge]\n# dairy\nmilk = \"1\"\ncheese = \"2\"\n", "fridge", "milk");
        assert!(out.contains("# dairy\ncheese = \"2\""), "{out}");
        assert!(!out.contains("milk"), "{out}");
    }

    #[test]
    fn removing_the_last_root_item_moves_its_comment_to_the_first_header() {
        let out = removed("pepper = \"1\"\n# salt note\nsalt = \"1\"\n[fridge]\nmilk = \"1\"\n", "general", "salt");
        assert!(out.contains("# salt note\n"), "{out}");
        assert!(out.find("# salt note").unwrap() < out.find("[fridge]").unwrap(), "{out}");
        assert!(!out.contains("salt ="), "{out}");
    }

    #[test]
    fn removing_the_last_item_of_a_surviving_section_moves_its_comment_to_the_next_header() {
        let out = removed(
            "[fridge]\nmilk = \"1\"\n# eggs note\neggs = \"6\"\n\n[fridge.cheese]\nquantity = \"1\"\n",
            "fridge",
            "eggs",
        );
        assert!(out.contains("# eggs note\n"), "{out}");
        assert!(out.find("# eggs note").unwrap() < out.find("[fridge.cheese]").unwrap(), "{out}");
        assert!(!out.contains("eggs ="), "{out}");
    }

    #[test]
    fn removing_the_last_item_of_the_file_moves_its_comment_to_the_end() {
        let out = removed("[fridge]\nmilk = \"1\"\n# eggs note\neggs = \"6\"\n", "fridge", "eggs");
        assert!(out.contains("milk = \"1\"\n# eggs note\n"), "{out}");
        assert!(!out.contains("eggs ="), "{out}");
    }

    #[test]
    fn removing_an_emptied_section_keeps_the_comment_above_its_header() {
        let out = removed("# fridge notes\n[fridge]\nmilk = \"1\"\n[pantry]\nrice = \"1\"\n", "fridge", "milk");
        assert!(!out.contains("[fridge]"), "{out}");
        assert!(out.contains("# fridge notes\n"), "{out}");
        assert!(out.find("# fridge notes").unwrap() < out.find("[pantry]").unwrap(), "{out}");

        let out = removed("[pantry]\nrice = \"1\"\n\n# fridge notes\n[fridge]\nmilk = \"1\"\n", "fridge", "milk");
        assert!(!out.contains("[fridge]"), "{out}");
        assert!(out.contains("rice = \"1\"\n\n# fridge notes\n"), "{out}");
    }

    #[test]
    fn removing_an_item_written_as_a_subtable_keeps_the_comment_above_its_header() {
        let out = removed(
            "[fridge]\neggs = \"6\"\n\n# the good milk\n[fridge.milk]\nquantity = \"1\"\n\n[pantry]\nrice = \"1\"\n",
            "fridge",
            "milk",
        );
        assert!(!out.contains("[fridge.milk]"), "{out}");
        assert!(out.find("# the good milk").unwrap() < out.find("[pantry]").unwrap(), "{out}");
    }

    #[test]
    fn removing_an_emptied_inline_table_section_keeps_the_comment_above_it() {
        let out = removed("# cold\nfridge = { milk = \"1\" }\n[pantry]\nrice = \"1\"\n", "fridge", "milk");
        assert!(!out.contains("fridge"), "{out}");
        assert!(out.find("# cold").unwrap() < out.find("[pantry]").unwrap(), "{out}");
    }

    #[test]
    fn converting_an_array_section_keeps_the_comment_above_it() {
        let out = edit(
            "# cold stuff\nfridge = [\"milk\"]\n",
            r#"{"op":"add","section":"fridge","name":"butter","quantity":"200%g"}"#,
        )
        .unwrap();
        assert!(out.contains("# cold stuff\n[fridge]"), "{out}");
    }

    #[test]
    fn an_array_section_with_comments_is_not_converted() {
        let expected =
            "section 'fridge' is a list with comments; move it to a [fridge] table by hand in config/pantry.conf";
        for text in [
            "fridge = [\n  \"milk\", # semi-skimmed\n  \"eggs\",\n]\n",
            "fridge = [\n  # dairy\n  \"milk\",\n]\n",
            "fridge = [\n  \"milk\",\n  # more later\n]\n",
            "fridge = [\"milk\"] # note\n",
        ] {
            let err = edit(text, r#"{"op":"add","section":"fridge","name":"butter"}"#).unwrap_err();
            assert_eq!(err, expected, "{text}");
        }
    }

    #[test]
    fn items_of_a_converted_array_section_keep_having_no_quantity() {
        let out = edit(
            "fridge = [\"milk\"]\n",
            r#"{"op":"add","section":"fridge","name":"butter","quantity":"200%g"}"#,
        )
        .unwrap();
        let conf = cooklang::pantry::parse_lenient(&out).into_output().expect("parses");
        let milk = conf.sections["fridge"].iter().find(|item| item.name() == "milk").unwrap();
        assert_eq!(milk.quantity(), None, "{out}");

        let out = edit(&out, r#"{"op":"update","section":"fridge","name":"milk","fields":{"quantity":"1%L"}}"#)
            .unwrap();
        assert!(out.contains("milk = \"1%L\""), "{out}");
    }
}
