//! Pure helpers around cooklang::shopping_list. No NAPI, no filesystem.

use cooklang::shopping_list::{self, CheckEntry, ShoppingList};
use std::collections::HashSet;

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
mod tests {
    use super::*;
    use cooklang::shopping_list::ShoppingListItem;

    #[test]
    fn round_trips_single_ingredient() {
        let text = "pasta\n";
        let list = parse_list(text).expect("parse");
        assert_eq!(list.items.len(), 1);
        assert!(matches!(&list.items[0], ShoppingListItem::Ingredient(i) if i.name == "pasta"));
        let out = write_list(&list).expect("write");
        assert_eq!(out.trim(), "pasta");
    }

    #[test]
    fn round_trips_recipe_with_multiplier() {
        let text = "./pasta{2}\n";
        let list = parse_list(text).expect("parse");
        assert_eq!(list.items.len(), 1);
        match &list.items[0] {
            ShoppingListItem::Recipe(r) => {
                assert_eq!(r.path, "pasta");
                assert_eq!(r.multiplier, Some(2.0));
            }
            _ => panic!("expected recipe"),
        }
        let out = write_list(&list).expect("write");
        assert!(out.contains("pasta"));
        assert!(out.contains("2"));
        // Round-trip parse-equals check
        let reparsed = parse_list(&out).expect("reparse");
        assert_eq!(reparsed, list);
    }

    #[test]
    fn round_trips_nested_children() {
        let text = "./menu/weekday{1}\n  ./pasta{1}\n  salad\n";
        let list = parse_list(text).expect("parse");
        assert_eq!(list.items.len(), 1);
        match &list.items[0] {
            ShoppingListItem::Recipe(r) => {
                assert_eq!(r.path, "menu/weekday");
                assert_eq!(r.children.len(), 2);
            }
            _ => panic!("expected recipe"),
        }
        let out = write_list(&list).expect("write");
        let reparsed = parse_list(&out).expect("reparse");
        assert_eq!(reparsed, list);
    }

    #[test]
    fn empty_input_yields_empty_list() {
        let list = parse_list("").expect("parse");
        assert!(list.items.is_empty());
        let out = write_list(&list).expect("write");
        assert_eq!(out, "");
    }
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
        let parsed = parse_checked_log(&line);
        assert_eq!(parsed.len(), 1);
        let set = checked_set_from_log(&parsed);
        assert!(set.contains("flour"));
    }

    #[test]
    fn checked_set_is_case_insensitive_lowercase() {
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
