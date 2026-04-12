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
