# Shopping List Feature Design

## Overview

Full shopping companion integrated as a Theia side panel view. Users select recipes from the workspace, the backend aggregates ingredients using the cooklang crate's native APIs, categorizes by aisle, subtracts pantry inventory, and the frontend renders an interactive checklist.

## Architecture: Backend-Driven (Approach A)

Reuses the cooklang Rust crate's proven `IngredientList`, `AisleConf`, and `PantryConf` APIs via new NAPI-RS bindings. Consistent with cookcli's shopping list implementation.

## Data Flow

```
User selects recipes (with scale factors)
  -> Backend reads & parses each .cook file
  -> Scales each recipe by its factor
  -> IngredientList aggregates ingredients across all recipes
  -> AisleConf (from config/aisle.conf) categorizes by store section
  -> PantryConf (from config/pantry.conf) subtracts items in stock
  -> Returns CategorizedIngredientList + pantry items as JSON
  -> Frontend renders grouped, checkable shopping list
```

## Persistence

- **Recipe selections**: `.shopping_list.txt` in workspace root (tab-delimited: `path\tname\tscale`), same format as cookcli
- **Checked items**: Theia `StorageService` (widget state, persists across sessions)
- **Config files**: `config/aisle.conf` and `config/pantry.conf` from workspace root (cookcli convention)

## UI Design

### Placement
Side panel view (bottom panel), always accessible like Problems or Output views. Registered as a Theia view contribution.

### Layout

**Top area -- Selected Recipes:**
- List of recipes on the shopping list: recipe name, editable scale factor, remove button
- "Clear All" button
- Empty state message when no recipes selected

**Main area -- Shopping List (scrollable):**
- Grouped by aisle categories (from `aisle.conf`), with category headers
- Each item: checkbox + ingredient name + aggregated quantities (e.g., "500 g, 2 cups")
- Uncategorized items under "Other" section
- Pantry items in a separate collapsed section at bottom (green styling, "already in stock" note)
- Checked items get strikethrough styling

### Entry Points
- **Command palette**: `cooklang.addToShoppingList` -- adds current recipe from active editor/preview
- **Recipe preview**: "Add to Shopping List" button in title bar
- **Explorer**: right-click context menu on `.cook` files
- **Editor title**: action button when a `.cook` file is active

## Component Architecture

### New files in `packages/cooklang/`

**Common (shared types):**
- `src/common/shopping-list-types.ts` -- DTOs: `ShoppingListRecipe`, `ShoppingListResult`, `CategorizedItem`, `PantryItem`
- Extend `cooklang-language-service.ts` with `generateShoppingList()` RPC method

**Browser (frontend):**
- `src/browser/shopping-list-widget.tsx` -- Main `ShoppingListWidget` (extends `ReactWidget`)
- `src/browser/shopping-list-components.tsx` -- React components: `RecipeListPanel`, `CategorySection`, `IngredientRow`, `PantrySection`
- `src/browser/shopping-list-service.ts` -- `ShoppingListService`: manages recipe selections, reads/writes `.shopping_list.txt`, triggers regeneration, tracks checked state via StorageService
- `src/browser/shopping-list-contribution.ts` -- Commands, keybindings, menu contributions, TabBarToolbarContribution
- `src/browser/style/shopping-list.css` -- Styles (orange accents matching recipe preview)

**Node (backend):**
- Extend `cooklang-language-service-impl.ts` with `generateShoppingList()` calling new NAPI function

### Changes to `packages/cooklang-native/`

**`Cargo.toml`:**
- Enable `pantry` feature on cooklang dependency

**`src/lib.rs`:**
- New NAPI function: `generate_shopping_list(recipes: Vec<RecipeInput>, aisle_conf: Option<String>, pantry_conf: Option<String>) -> String`
- `RecipeInput`: `{ content: String, scale: f64 }`
- Implementation: parse each recipe, scale, aggregate via `IngredientList`, categorize via `AisleConf`, subtract via `PantryConf`, serialize to JSON

### DI Bindings (cooklang-frontend-module.ts)
- `ShoppingListService` (singleton)
- `ShoppingListWidget` widget factory
- `ShoppingListContribution` -> `CommandContribution`, `MenuContribution`, `TabBarToolbarContribution`

## Type Definitions

```typescript
interface ShoppingListRecipe {
    path: string;      // workspace-relative path to .cook file
    name: string;      // display name
    scale: number;     // scale factor (default 1)
}

interface ShoppingListResult {
    categories: ShoppingListCategory[];
    other: ShoppingListCategory;       // uncategorized items
    pantryItems: string[];             // names of items already in pantry
}

interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

interface ShoppingListItem {
    name: string;
    quantities: string;  // pre-formatted, e.g. "500 g, 2 cups"
}
```

## Matching CookCLI Behavior

- Same `.shopping_list.txt` format (tab-delimited: path, name, scale)
- Same `config/aisle.conf` and `config/pantry.conf` lookup paths
- Same ingredient aggregation logic (via shared cooklang crate)
- Same aisle categorization order
- Same pantry subtraction rules (unlimited, zero quantity, unit matching)
