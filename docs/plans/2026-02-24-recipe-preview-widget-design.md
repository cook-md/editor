# Recipe Preview Widget Design

**Status:** Approved
**Date:** 2026-02-24

## Goal

Add a recipe details preview widget to the Cooklang editor that renders parsed `.cook` files in a rich, readable layout matching the cookcli web UI style. Supports both toggle mode (replace editor tab) and side-by-side mode (split panel).

## Architecture

All new code lives in `packages/cooklang/` — no new packages needed.

### New Files

```
src/browser/
  recipe-preview-widget.tsx         # ReactWidget rendering parsed recipe
  recipe-preview-contribution.ts    # Commands, menus, keybindings
  recipe-preview-handler.ts         # OpenHandler for preview URI scheme
  recipe-preview-components.tsx     # React components (ingredients, steps, metadata)
  style/recipe-preview.css          # Styling matching cookcli layout
```

### Modified Files

```
src/common/cooklang-language-service.ts   # Add parse() method to RPC interface
src/node/cooklang-language-service-impl.ts # Implement parse() using cooklang-native
src/browser/cooklang-frontend-module.ts    # Register new widget, commands, handler
package.json                               # Add theiaExtensions entry if needed
```

## Data Flow

1. User opens a `.cook` file in the Monaco editor
2. User triggers "Toggle Preview" or "Open Preview to Side" command
3. `RecipePreviewHandler` creates/reveals a `RecipePreviewWidget` for the file URI
4. Widget calls `CooklangLanguageService.parse(content)` via RPC
5. Backend runs `cooklang-native` `parse()`, returns JSON string
6. Widget deserializes JSON into TypeScript types, React renders the layout
7. On editor content changes (debounced 300ms), re-parse and re-render

## RPC Interface Addition

```typescript
// Added to CooklangLanguageService interface
export interface CooklangLanguageService {
    // ... existing methods ...
    parse(content: string): Promise<string>;  // Returns JSON-serialized ParseResult
}
```

## Widget Design

### RecipePreviewWidget

- Extends `ReactWidget` (Theia's React-based widget base class)
- Widget ID: `recipe-preview-widget:<file-uri>`
- Tracks source file URI
- Subscribes to `EditorManager` for active editor changes
- Subscribes to `MonacoWorkspace` for document change events
- Debounces re-parsing at 300ms
- Disposes subscriptions on close

### Recipe Data Types (TypeScript)

```typescript
interface ParseResult {
    recipe: Recipe | null;
    errors: DiagnosticInfo[];
    warnings: DiagnosticInfo[];
}

interface Recipe {
    metadata: { map: Record<string, any> };
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inline_quantities: Quantity[];
}

interface Section {
    name: string | null;
    content: ContentItem[];
}

interface ContentItem {
    type: 'step' | 'text';
    value: Step | string;
}

interface Step {
    items: StepItem[];
    number: number;
}

interface StepItem {
    type: 'text' | 'ingredient' | 'cookware' | 'timer' | 'inlineQuantity';
    value?: string;
    index?: number;
}

interface Ingredient {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
}

interface Cookware {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
}

interface Timer {
    name: string | null;
    quantity: Quantity | null;
}

interface Quantity {
    value: QuantityValue;
    unit: string | null;
    scalable: boolean;
}
```

## Commands

| Command | ID | Keybinding | Behavior |
|---------|-----|-----------|----------|
| Cooklang: Toggle Preview | `cooklang.togglePreview` | `Ctrl+Shift+V` | Open preview replacing editor tab, or switch back |
| Cooklang: Open Preview to Side | `cooklang.openPreviewSide` | `Ctrl+K V` | Open preview in right split panel |

Both commands are only visible/enabled when active editor language is `cooklang`.

## UI Layout

Follows the cookcli web UI recipe details page structure:

```
┌──────────────────────────────────────────────┐
│  Recipe Title (from metadata or filename)     │
│  [#tag1] [#tag2]                             │
│  Description text (if present)               │
│  [Servings: 4] [Time: 30min] [Cuisine: ...]  │
├──────────────┬───────────────────────────────┤
│ INGREDIENTS  │  INSTRUCTIONS                 │
│              │                               │
│ Section Name │  Section Name                 │
│  • item 250g │  ① Step text with @ingredient │
│  • item 2    │    #cookware and ~timer{5min} │
│              │                               │
│ COOKWARE     │  ② Next step...               │
│  • pan       │                               │
│  • bowl      │  Note text                    │
└──────────────┴───────────────────────────────┘
```

### Styling

- **Grid layout:** CSS Grid with `grid-template-columns: 1fr 2fr`
- **Inline badges:** ingredient (yellow/orange), cookware (green), timer (red)
- **Step numbers:** Orange circle with white number
- **Metadata pills:** Rounded pill badges with key-value pairs
- **Tags:** Orange gradient pills with `#` prefix
- **Section headers:** Bold with orange bottom border
- **Notes:** Blue/purple background with left border accent
- **Theme compatibility:** Use Theia CSS variables (`--theia-*`) for background, foreground, and border colors where possible. Badge colors are recipe-specific and hardcoded.

## Scope

### Included
- Full recipe layout (title, metadata, tags, description, ingredients, cookware, instructions)
- Inline badges for ingredients, cookware, and timers in steps
- Section support (named sections)
- Live update with 300ms debounce
- Toggle and side-by-side preview modes
- Scrollable content

### Excluded (future work)
- Recipe scaling UI
- Shopping list integration
- Cooking mode (full-screen step-by-step)
- Image display
- Print optimization
- Dark mode badge color adjustments (will use same colors initially)
