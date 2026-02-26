# Menu/Meal Plan Preview Design

## Goal

Add support for rendering `.menu` files (meal plans) in a dedicated preview widget, mirroring the cookcli web UI's menu rendering.

## Architecture

Three layers of changes:

### 1. Rust Native Crate (`packages/cooklang-native`)

Add `parse_menu(input: String, scale: f64) -> String` NAPI function that:
- Parses `.menu` content using `CooklangParser` (same parser as `parse()`)
- Walks sections and steps, splitting on `-` bullets and `\n` newlines to form lines
- Identifies recipe references (ingredients with `.reference` field) vs standalone ingredients
- Applies `scale` factor to recipe reference quantities (`recipe_scale * menu_scale`)
- Extracts metadata (servings, time, author, description, source, custom fields)
- Returns JSON-serialized `MenuParseResult`

Output structure:
```json
{
  "metadata": { "servings": "4", "time": "1h", "description": "Weekly meal plan", ... },
  "sections": [
    {
      "name": "Day 1",
      "lines": [
        [{ "type": "text", "value": "Breakfast:" }],
        [
          { "type": "recipeReference", "name": "./Breakfast/Pancakes", "scale": 2.0 },
          { "type": "text", "value": "with" },
          { "type": "ingredient", "name": "maple syrup", "quantity": "2", "unit": "tbsp" }
        ]
      ]
    }
  ],
  "errors": [],
  "warnings": []
}
```

### 2. Common Types (`packages/cooklang/src/common`)

New file `menu-types.ts` with TypeScript interfaces:
- `MenuParseResult` — top-level result with metadata, sections, errors, warnings
- `MenuSection` — named section containing lines
- `MenuSectionItem` — tagged union: `Text | RecipeReference | Ingredient`
- `MenuMetadata` — typed metadata fields (servings, time, author, description, source, custom)

Add `parseMenu(content: string, scale: number): Promise<string>` to `CooklangLanguageService` interface.

### 3. Browser Components (`packages/cooklang/src/browser`)

**MenuPreviewWidget** (`menu-preview-widget.tsx`):
- Extends `ReactWidget`, implements `Navigatable`
- Listens to document changes (debounced 300ms) for `.menu` files
- Calls `parseMenu()` via language service RPC
- Manages scale state
- Separate widget ID: `menu-preview-widget`

**MenuView Components** (`menu-preview-components.tsx`):
- `MenuView` — top-level: header with title + "Menu" badge, scale input, shopping list button, description, metadata pills, sections
- `MenuSectionView` — gradient header bar + lines
- `MenuLineView` — flex-wrapped items in a line
- `MenuItemView` — renders Text / RecipeReference (clickable link) / Ingredient (badge)

**MenuPreviewContribution** (`menu-preview-contribution.ts`):
- Commands: `cooklang.toggleMenuPreview`, `cooklang.openMenuPreviewSide`
- Keybindings: same as recipe preview (`Ctrl+Shift+V`, `Ctrl+K V`) when editor has `.menu` file
- `OpenHandler` for `.menu` files

**Styling** (`style/menu-preview.css`):
- Section headers: gradient background (purple to pink), white text
- Recipe references: purple text, clickable, hover underline
- Ingredient badges: yellow/amber gradient (matching cookcli `.ingredient-badge`)
- Meal-type headers (text ending in `:`): bold, larger font
- Theme-aware using `--theia-*` CSS variables where possible

### 4. DI Wiring

In `cooklang-frontend-module.ts`:
- Register `MenuPreviewWidget` factory
- Register `MenuPreviewContribution` for commands, keybindings, open handler

In `cooklang-backend-module.ts`:
- Implement `parseMenu()` in `CooklangLanguageServiceImpl` calling the native `parse_menu()`

### 5. Language Registration

Register `.menu` extension with the `cooklang` language ID in the grammar contribution so `.menu` files get syntax highlighting and LSP features.

## Data Flow

```
.menu file edit
  → MonacoWorkspace.onDidChangeTextDocument
  → MenuPreviewWidget.debouncedParse()
  → CooklangLanguageService.parseMenu(content, scale)  [RPC to backend]
  → cooklang-native parse_menu()  [Rust]
  → MenuParseResult JSON
  → MenuView React render
```

## UI Layout

```
┌─────────────────────────────────────────┐
│ "Menu Name"  [Menu]  Scale:[__] [+cart] │
├─────────────────────────────────────────┤
│ Description (optional)                  │
│ [Servings: 4] [Time: 1h] [Author: ...]│
├─────────────────────────────────────────┤
│ ╔═══ Day 1 ═══════════════════════════╗ │
│ ║ Breakfast:                          ║ │
│ ║   Pancakes (×2) with maple syrup    ║ │
│ ║   2 tbsp                            ║ │
│ ║ Lunch:                              ║ │
│ ║   lamb-chops                        ║ │
│ ╚═════════════════════════════════════╝ │
│ ╔═══ Day 2 ═══════════════════════════╗ │
│ ║ ...                                 ║ │
│ ╚═════════════════════════════════════╝ │
└─────────────────────────────────────────┘
```

## Interactions

- **Recipe reference click** → opens the `.cook` file in the text editor
- **Scale input** → re-parses with new scale, updates recipe reference scales
- **Add to shopping list** → executes `cooklang.addToShoppingList` command (same as recipe preview)

## Key Decisions

- Separate `MenuPreviewWidget` (not reusing `RecipePreviewWidget`)
- Menu-specific parsing in Rust (`parse_menu()`) — mirrors cookcli's `menu_page_handler` logic
- `.menu` files registered under `cooklang` language ID for shared syntax/LSP
