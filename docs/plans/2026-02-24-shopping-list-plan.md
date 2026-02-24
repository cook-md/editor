# Shopping List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full shopping list companion as a Theia bottom-panel view that aggregates ingredients across selected recipes, categorizes by aisle, subtracts pantry items, and persists selections.

**Architecture:** Backend-driven via NAPI-RS bindings to the cooklang crate's `IngredientList`, `AisleConf`, and `PantryConf` APIs. The frontend is a React-based `ShoppingListWidget` registered as a Theia view contribution in the bottom panel. Recipe selections persist in `.shopping_list.txt` (cookcli-compatible format).

**Tech Stack:** Rust (cooklang crate v0.17 + NAPI-RS), TypeScript, React 18, InversifyJS DI, Theia widget/contribution APIs.

---

### Task 1: Add `generate_shopping_list` NAPI function (Rust)

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Modify: `packages/cooklang-native/src/lib.rs`

**Step 1: Enable `pantry` feature and add `serde_json` for intermediate serialization**

In `packages/cooklang-native/Cargo.toml`, change the cooklang dependency to enable `pantry`:

```toml
cooklang = { version = "0.17", features = ["pantry"] }
```

**Step 2: Add `generate_shopping_list` NAPI function**

In `packages/cooklang-native/src/lib.rs`, add after the existing `parse` function:

```rust
#[derive(serde::Deserialize)]
pub struct RecipeInput {
    pub content: String,
    pub scale: f64,
}

#[derive(Serialize)]
pub struct ShoppingListResult {
    pub categories: Vec<ShoppingListCategory>,
    pub other: ShoppingListCategory,
    pub pantry_items: Vec<String>,
}

#[derive(Serialize)]
pub struct ShoppingListCategory {
    pub name: String,
    pub items: Vec<ShoppingListItem>,
}

#[derive(Serialize)]
pub struct ShoppingListItem {
    pub name: String,
    pub quantities: String,
}

/// Generate a shopping list from multiple recipes.
///
/// Parses each recipe, scales it, aggregates ingredients, categorizes by aisle,
/// and subtracts pantry items. Returns JSON-serialized ShoppingListResult.
#[napi]
pub fn generate_shopping_list(
    recipes_json: String,
    aisle_conf: Option<String>,
    pantry_conf: Option<String>,
) -> napi::Result<String> {
    let recipes: Vec<RecipeInput> = serde_json::from_str(&recipes_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid recipes JSON: {}", e)))?;

    let parser = cooklang::CooklangParser::new(
        cooklang::Extensions::all(),
        Default::default(),
    );
    let converter = parser.converter();

    // Parse and aggregate ingredients
    let mut ingredient_list = cooklang::IngredientList::new();
    for recipe_input in &recipes {
        let result = parser.parse(&recipe_input.content);
        if let Some(mut recipe) = result.into_output() {
            if (recipe_input.scale - 1.0).abs() > f64::EPSILON {
                recipe.scale(recipe_input.scale, converter);
            }
            ingredient_list.add_recipe(&recipe, converter, false);
        }
    }

    // Parse aisle config and categorize
    let aisle = aisle_conf
        .as_deref()
        .and_then(|conf| cooklang::aisle::parse_lenient(conf).into_output());

    // Apply common names if aisle config exists
    if let Some(ref aisle) = aisle {
        ingredient_list = ingredient_list.use_common_names(aisle, converter);
    }

    // Parse pantry config and subtract
    let pantry = pantry_conf
        .as_deref()
        .and_then(|conf| cooklang::pantry::parse_lenient(conf).into_output());

    let mut pantry_items: Vec<String> = Vec::new();

    if let Some(ref pantry) = pantry {
        // Collect pantry item names before subtraction
        for (name, _) in ingredient_list.iter() {
            if pantry.has_ingredient(name) {
                pantry_items.push(name.clone());
            }
        }
        ingredient_list = ingredient_list.subtract_pantry(pantry, converter);
    }

    // Categorize
    let categorized = if let Some(ref aisle) = aisle {
        ingredient_list.categorize(aisle)
    } else {
        // No aisle config: everything goes to "other"
        cooklang::ingredient_list::CategorizedIngredientList {
            categories: Default::default(),
            other: ingredient_list,
        }
    };

    // Convert to output format
    let mut categories: Vec<ShoppingListCategory> = Vec::new();
    for (cat_name, cat_list) in categorized.categories.iter() {
        let items: Vec<ShoppingListItem> = cat_list
            .iter()
            .map(|(name, qty)| ShoppingListItem {
                name: name.clone(),
                quantities: qty.to_string(),
            })
            .collect();
        if !items.is_empty() {
            categories.push(ShoppingListCategory {
                name: cat_name.clone(),
                items,
            });
        }
    }

    let other_items: Vec<ShoppingListItem> = categorized
        .other
        .iter()
        .map(|(name, qty)| ShoppingListItem {
            name: name.clone(),
            quantities: qty.to_string(),
        })
        .collect();

    let other = ShoppingListCategory {
        name: "Other".to_string(),
        items: other_items,
    };

    let result = ShoppingListResult {
        categories,
        other,
        pantry_items,
    };

    serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}
```

**Step 3: Build the native addon**

Run: `cd packages/cooklang-native && cargo build`
Expected: Compiles successfully with new function.

**Step 4: Commit**

```bash
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/src/lib.rs
git commit -m "feat(cooklang-native): add generate_shopping_list NAPI function"
```

---

### Task 2: Add shopping list TypeScript types

**Files:**
- Create: `packages/cooklang/src/common/shopping-list-types.ts`
- Modify: `packages/cooklang/src/common/index.ts`

**Step 1: Create the types file**

Create `packages/cooklang/src/common/shopping-list-types.ts`:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

/**
 * A recipe entry in the shopping list with its scale factor.
 */
export interface ShoppingListRecipe {
    /** Workspace-relative path to the .cook file */
    path: string;
    /** Display name (derived from metadata or filename) */
    name: string;
    /** Scale factor (1 = original, 2 = double, etc.) */
    scale: number;
}

/**
 * Result returned by the backend shopping list generator.
 */
export interface ShoppingListResult {
    /** Ingredient categories from aisle.conf, in aisle order */
    categories: ShoppingListCategory[];
    /** Uncategorized ingredients */
    other: ShoppingListCategory;
    /** Names of ingredients found in pantry (informational) */
    pantry_items: string[];
}

/**
 * A category of ingredients (e.g. "produce", "dairy").
 */
export interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

/**
 * A single ingredient in the shopping list.
 */
export interface ShoppingListItem {
    name: string;
    /** Pre-formatted quantity string, e.g. "500 g, 2 cups" */
    quantities: string;
}
```

**Step 2: Export from common index**

In `packages/cooklang/src/common/index.ts`, add:

```typescript
export * from './shopping-list-types';
```

**Step 3: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add packages/cooklang/src/common/shopping-list-types.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): add shopping list TypeScript types"
```

---

### Task 3: Add `generateShoppingList` RPC method

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

**Step 1: Add method to the RPC interface**

In `packages/cooklang/src/common/cooklang-language-service.ts`, add to the `CooklangLanguageService` interface (after the `parse` method):

```typescript
    // Shopping list generation
    generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null): Promise<string>;
```

**Step 2: Implement in the backend**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`, add after the `parse` method:

```typescript
    async generateShoppingList(recipesJson: string, aisleConf: string | null, pantryConf: string | null): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.generateShoppingList(
                recipesJson,
                aisleConf ?? undefined,
                pantryConf ?? undefined
            );
        } catch (error) {
            console.error('[cooklang] Failed to generate shopping list:', error);
            return JSON.stringify({ categories: [], other: { name: 'Other', items: [] }, pantry_items: [] });
        }
    }
```

**Step 3: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): add generateShoppingList RPC method"
```

---

### Task 4: Create ShoppingListService (frontend state management)

**Files:**
- Create: `packages/cooklang/src/browser/shopping-list-service.ts`

**Step 1: Create the service**

Create `packages/cooklang/src/browser/shopping-list-service.ts`:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { ShoppingListRecipe, ShoppingListResult } from '../common/shopping-list-types';

@injectable()
export class ShoppingListService implements Disposable {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();
    protected recipes: ShoppingListRecipe[] = [];
    protected result: ShoppingListResult | undefined;
    protected checkedItems = new Set<string>();

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.loadFromFile();
    }

    getRecipes(): readonly ShoppingListRecipe[] {
        return this.recipes;
    }

    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    isChecked(ingredientName: string): boolean {
        return this.checkedItems.has(ingredientName);
    }

    toggleChecked(ingredientName: string): void {
        if (this.checkedItems.has(ingredientName)) {
            this.checkedItems.delete(ingredientName);
        } else {
            this.checkedItems.add(ingredientName);
        }
        this.onDidChangeEmitter.fire();
    }

    async addRecipe(path: string, name: string, scale: number = 1): Promise<void> {
        this.recipes.push({ path, name, scale });
        await this.saveToFile();
        await this.regenerate();
    }

    async removeRecipe(index: number): Promise<void> {
        if (index >= 0 && index < this.recipes.length) {
            this.recipes.splice(index, 1);
            await this.saveToFile();
            await this.regenerate();
        }
    }

    async updateScale(index: number, scale: number): Promise<void> {
        if (index >= 0 && index < this.recipes.length) {
            this.recipes[index].scale = scale;
            await this.saveToFile();
            await this.regenerate();
        }
    }

    async clearAll(): Promise<void> {
        this.recipes = [];
        this.result = undefined;
        this.checkedItems.clear();
        await this.saveToFile();
        this.onDidChangeEmitter.fire();
    }

    async regenerate(): Promise<void> {
        if (this.recipes.length === 0) {
            this.result = undefined;
            this.onDidChangeEmitter.fire();
            return;
        }

        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        // Read recipe file contents
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const recipe of this.recipes) {
            try {
                const fileUri = rootUri.resolve(recipe.path);
                const content = await this.fileService.read(fileUri);
                recipeInputs.push({ content: content.value, scale: recipe.scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${recipe.path}:`, e);
            }
        }

        // Read config files
        const aisleConf = await this.readConfigFile(rootUri, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(rootUri, 'config/pantry.conf');

        try {
            const json = await this.languageService.generateShoppingList(
                JSON.stringify(recipeInputs),
                aisleConf,
                pantryConf
            );
            this.result = JSON.parse(json);
        } catch (e) {
            console.error('[shopping-list] Failed to generate shopping list:', e);
            this.result = undefined;
        }

        this.onDidChangeEmitter.fire();
    }

    // --- File I/O ---

    protected async loadFromFile(): Promise<void> {
        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        const fileUri = rootUri.resolve('.shopping_list.txt');
        try {
            const content = await this.fileService.read(fileUri);
            this.recipes = this.parseShoppingListFile(content.value);
            if (this.recipes.length > 0) {
                await this.regenerate();
            }
        } catch {
            // File doesn't exist yet, start with empty list
        }
    }

    protected parseShoppingListFile(content: string): ShoppingListRecipe[] {
        const recipes: ShoppingListRecipe[] = [];
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            const parts = trimmed.split('\t');
            if (parts.length >= 3) {
                recipes.push({
                    path: parts[0],
                    name: parts[1],
                    scale: parseFloat(parts[2]) || 1,
                });
            }
        }
        return recipes;
    }

    protected async saveToFile(): Promise<void> {
        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        const fileUri = rootUri.resolve('.shopping_list.txt');
        const lines = this.recipes.map(r => `${r.path}\t${r.name}\t${r.scale}`);
        const content = lines.length > 0 ? lines.join('\n') + '\n' : '';

        try {
            await this.fileService.write(fileUri, content);
        } catch (e) {
            console.error('[shopping-list] Failed to save shopping list:', e);
        }
    }

    protected async readConfigFile(rootUri: URI, relativePath: string): Promise<string | null> {
        try {
            const fileUri = rootUri.resolve(relativePath);
            const content = await this.fileService.read(fileUri);
            return content.value;
        } catch {
            return null;
        }
    }

    protected getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    dispose(): void {
        this.toDispose.dispose();
    }
}
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.ts
git commit -m "feat(cooklang): add ShoppingListService for state management"
```

---

### Task 5: Create ShoppingListWidget (React UI)

**Files:**
- Create: `packages/cooklang/src/browser/shopping-list-widget.tsx`
- Create: `packages/cooklang/src/browser/shopping-list-components.tsx`
- Create: `packages/cooklang/src/browser/style/shopping-list.css`

**Step 1: Create the React components**

Create `packages/cooklang/src/browser/shopping-list-components.tsx`:

```tsx
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import * as React from '@theia/core/shared/react';
import {
    ShoppingListRecipe,
    ShoppingListResult,
    ShoppingListCategory,
    ShoppingListItem,
} from '../common/shopping-list-types';

// ---------------------------------------------------------------------------
// RecipeListPanel
// ---------------------------------------------------------------------------

interface RecipeListPanelProps {
    recipes: readonly ShoppingListRecipe[];
    onRemove: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
}

export const RecipeListPanel = ({
    recipes,
    onRemove,
    onScaleChange,
    onClearAll,
}: RecipeListPanelProps): React.ReactElement => {
    if (recipes.length === 0) {
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
            {recipes.map((recipe, idx) => (
                <div key={idx} className='shopping-list-recipe-row'>
                    <span className='shopping-list-recipe-name'>{recipe.name}</span>
                    <input
                        className='shopping-list-scale-input'
                        type='number'
                        min='0.5'
                        max='100'
                        step='0.5'
                        value={recipe.scale}
                        onChange={e => {
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
            ))}
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
    if (category.items.length === 0) {
        return null;
    }

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
// PantrySection
// ---------------------------------------------------------------------------

interface PantrySectionProps {
    pantryItems: string[];
}

export const PantrySection = ({ pantryItems }: PantrySectionProps): React.ReactElement | null => {
    const [expanded, setExpanded] = React.useState(false);

    if (pantryItems.length === 0) {
        return null;
    }

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
    recipes: readonly ShoppingListRecipe[];
    result: ShoppingListResult | undefined;
    checkedItems: Set<string>;
    onRemoveRecipe: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
    onToggleItem: (name: string) => void;
}

export const ShoppingListView = ({
    recipes,
    result,
    checkedItems,
    onRemoveRecipe,
    onScaleChange,
    onClearAll,
    onToggleItem,
}: ShoppingListViewProps): React.ReactElement => (
    <div className='shopping-list-content'>
        <RecipeListPanel
            recipes={recipes}
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
                        category={result.other}
                        checkedItems={checkedItems}
                        onToggle={onToggleItem}
                    />
                )}

                <PantrySection pantryItems={result.pantry_items} />
            </>
        )}
    </div>
);
```

**Step 2: Create the widget**

Create `packages/cooklang/src/browser/shopping-list-widget.tsx`:

```tsx
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { codicon } from '@theia/core/lib/browser';
import * as React from '@theia/core/shared/react';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListView } from './shopping-list-components';

import '../../src/browser/style/shopping-list.css';

export const SHOPPING_LIST_WIDGET_ID = 'shopping-list-widget';

@injectable()
export class ShoppingListWidget extends ReactWidget {

    static readonly ID = SHOPPING_LIST_WIDGET_ID;
    static readonly LABEL = 'Shopping List';

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    @postConstruct()
    protected init(): void {
        this.id = SHOPPING_LIST_WIDGET_ID;
        this.title.label = ShoppingListWidget.LABEL;
        this.title.caption = ShoppingListWidget.LABEL;
        this.title.iconClass = codicon('checklist');
        this.title.closable = true;
        this.addClass('theia-shopping-list');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };

        this.toDispose.push(
            this.shoppingListService.onDidChange(() => this.update())
        );
    }

    protected render(): React.ReactNode {
        const recipes = this.shoppingListService.getRecipes();
        const result = this.shoppingListService.getResult();

        // Build checked set for rendering
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
                recipes={recipes}
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
        this.shoppingListService.removeRecipe(index);
    };

    protected handleScaleChange = (index: number, scale: number): void => {
        this.shoppingListService.updateScale(index, scale);
    };

    protected handleClearAll = (): void => {
        this.shoppingListService.clearAll();
    };

    protected handleToggleItem = (name: string): void => {
        this.shoppingListService.toggleChecked(name);
    };
}
```

**Step 3: Create the CSS**

Create `packages/cooklang/src/browser/style/shopping-list.css`:

```css
.theia-shopping-list {
    height: 100%;
    overflow-y: auto;
    font-family: var(--theia-ui-font-family);
    color: var(--theia-foreground);
    background: var(--theia-panel-background);
}

.shopping-list-content {
    padding: 12px 16px;
}

/* --- Selected Recipes --- */

.shopping-list-empty-recipes {
    padding: 16px;
    color: var(--theia-descriptionForeground);
    font-style: italic;
    text-align: center;
}

.shopping-list-recipes {
    margin-bottom: 16px;
    border-bottom: 1px solid var(--theia-panel-border);
    padding-bottom: 12px;
}

.shopping-list-recipes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}

.shopping-list-recipes-title {
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theia-descriptionForeground);
}

.shopping-list-clear-btn {
    background: none;
    border: 1px solid var(--theia-button-border);
    color: var(--theia-descriptionForeground);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
}

.shopping-list-clear-btn:hover {
    color: var(--theia-foreground);
    border-color: var(--theia-foreground);
}

.shopping-list-recipe-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
}

.shopping-list-recipe-name {
    flex: 1;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.shopping-list-scale-input {
    width: 48px;
    padding: 2px 4px;
    font-size: 12px;
    text-align: center;
    background: var(--theia-input-background);
    color: var(--theia-input-foreground);
    border: 1px solid var(--theia-input-border);
    border-radius: 4px;
}

.shopping-list-remove-btn {
    background: none;
    border: none;
    color: var(--theia-descriptionForeground);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    line-height: 1;
}

.shopping-list-remove-btn:hover {
    color: var(--theia-errorForeground);
}

/* --- Category --- */

.shopping-list-category {
    margin-bottom: 12px;
}

.shopping-list-category-header {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #ff6b35;
    margin: 0 0 6px 0;
    padding: 4px 0;
    border-bottom: 1px solid var(--theia-panel-border);
}

/* --- Ingredient Row --- */

.shopping-list-ingredient {
    padding: 3px 0;
}

.shopping-list-ingredient.checked {
    opacity: 0.5;
}

.shopping-list-ingredient.checked .shopping-list-ingredient-name {
    text-decoration: line-through;
}

.shopping-list-ingredient-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
}

.shopping-list-ingredient-label input[type='checkbox'] {
    margin: 0;
    accent-color: #ff6b35;
}

.shopping-list-ingredient-name {
    flex: 1;
}

.shopping-list-ingredient-qty {
    color: var(--theia-descriptionForeground);
    font-size: 12px;
    white-space: nowrap;
}

/* --- Pantry --- */

.shopping-list-pantry {
    margin-top: 16px;
    border-top: 1px solid var(--theia-panel-border);
    padding-top: 8px;
}

.shopping-list-pantry-toggle {
    background: none;
    border: none;
    color: #22c55e;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 0;
}

.shopping-list-pantry-toggle:hover {
    text-decoration: underline;
}

.shopping-list-pantry-list {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0 0 0 20px;
}

.shopping-list-pantry-item {
    font-size: 12px;
    color: #22c55e;
    padding: 2px 0;
}
```

**Step 4: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-widget.tsx packages/cooklang/src/browser/shopping-list-components.tsx packages/cooklang/src/browser/style/shopping-list.css
git commit -m "feat(cooklang): add ShoppingListWidget with React UI"
```

---

### Task 6: Create ShoppingListContribution (commands, menus)

**Files:**
- Create: `packages/cooklang/src/browser/shopping-list-contribution.ts`

**Step 1: Create the contribution**

Create `packages/cooklang/src/browser/shopping-list-contribution.ts`:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { EditorManager } from '@theia/editor/lib/browser';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { COOKLANG_LANGUAGE_ID } from '../common';
import { RecipePreviewWidget } from './recipe-preview-widget';

export namespace ShoppingListCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cooklang.toggleShoppingList',
        label: 'Cooklang: Toggle Shopping List',
    };
    export const ADD_TO_LIST: Command = {
        id: 'cooklang.addToShoppingList',
        label: 'Cooklang: Add to Shopping List',
        iconClass: 'codicon codicon-add',
    };
}

@injectable()
export class ShoppingListContribution
    extends AbstractViewContribution<ShoppingListWidget>
    implements FrontendApplicationContribution, TabBarToolbarContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    constructor() {
        super({
            widgetId: SHOPPING_LIST_WIDGET_ID,
            widgetName: ShoppingListWidget.LABEL,
            defaultWidgetOptions: {
                area: 'bottom',
            },
            toggleCommandId: ShoppingListCommands.TOGGLE_VIEW.id,
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(ShoppingListCommands.ADD_TO_LIST, {
            execute: (...args: unknown[]) => this.addCurrentRecipe(args[0] as URI | undefined),
            isEnabled: (...args: unknown[]) => this.canAddRecipe(args[0] as URI | undefined),
            isVisible: (...args: unknown[]) => this.canAddRecipe(args[0] as URI | undefined),
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: ShoppingListCommands.ADD_TO_LIST.id,
            label: 'Add to Shopping List',
            when: 'resourceExtname == .cook',
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: ShoppingListCommands.ADD_TO_LIST.id,
            command: ShoppingListCommands.ADD_TO_LIST.id,
            tooltip: 'Add to Shopping List',
        });
    }

    protected canAddRecipe(uri?: URI): boolean {
        if (uri && uri.path.ext === '.cook') {
            return true;
        }
        return this.getActiveCookUri() !== undefined;
    }

    protected async addCurrentRecipe(uri?: URI): Promise<void> {
        const targetUri = uri ?? this.getActiveCookUri();
        if (!targetUri) {
            return;
        }

        const name = targetUri.path.base.replace(/\.cook$/i, '');
        const workspaceRoot = this.shoppingListService['getWorkspaceRootUri']();
        const relativePath = workspaceRoot
            ? workspaceRoot.relative(targetUri)?.toString() ?? targetUri.path.base
            : targetUri.path.base;

        await this.shoppingListService.addRecipe(relativePath, name);
        await this.openView({ activate: true });
    }

    protected getActiveCookUri(): URI | undefined {
        // Check if current widget is a recipe preview
        const currentWidget = this.shell?.currentWidget;
        if (currentWidget instanceof RecipePreviewWidget) {
            return currentWidget.getResourceUri();
        }

        // Check active editor
        const editor = this.editorManager.currentEditor;
        if (editor && editor.editor.document.languageId === COOKLANG_LANGUAGE_ID) {
            return new URI(editor.editor.document.uri);
        }
        return undefined;
    }
}
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: May fail if `@theia/navigator` is not a dependency — check in next step.

**Step 3: Add navigator dependency if needed**

Check if `@theia/navigator` is in `packages/cooklang/package.json` dependencies. If not, add it:

```json
"@theia/navigator": "1.68.0"
```

Then run `npm install` from the project root.

**Step 4: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-contribution.ts packages/cooklang/package.json
git commit -m "feat(cooklang): add ShoppingListContribution with commands and menus"
```

---

### Task 7: Wire everything into the DI container

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Update the frontend module**

Replace the contents of `packages/cooklang/src/browser/cooklang-frontend-module.ts` with:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    WidgetFactory,
    bindViewContribution,
} from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import URI from '@theia/core/lib/common/uri';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';
import { CooklangLanguageClientContribution } from './cooklang-language-client-contribution';
import { CooklangLanguageService, CooklangLanguageServicePath } from '../common/cooklang-language-service';
import { RECIPE_PREVIEW_WIDGET_ID, createRecipePreviewWidget } from './recipe-preview-widget';
import { RecipePreviewContribution } from './recipe-preview-contribution';
import { ShoppingListWidget, SHOPPING_LIST_WIDGET_ID } from './shopping-list-widget';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListContribution } from './shopping-list-contribution';
import { bindCooklangPreferences } from '../common';

export default new ContainerModule(bind => {
    // TextMate grammar
    bind(CooklangGrammarContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(CooklangGrammarContribution);

    // RPC proxy to the backend LSP bridge service
    bind(CooklangLanguageService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<CooklangLanguageService>(ctx.container, CooklangLanguageServicePath)
    ).inSingletonScope();

    // Language client contribution (registers Monaco providers + document listeners)
    bind(CooklangLanguageClientContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CooklangLanguageClientContribution);

    // Recipe preview widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RECIPE_PREVIEW_WIDGET_ID,
        createWidget: (options: { uri: string }) =>
            createRecipePreviewWidget(ctx.container, new URI(options.uri)),
    })).inSingletonScope();

    // Recipe preview commands and keybindings
    bind(RecipePreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(RecipePreviewContribution);
    bind(KeybindingContribution).toService(RecipePreviewContribution);
    bind(OpenHandler).toService(RecipePreviewContribution);

    // Cooklang preferences
    bindCooklangPreferences(bind);

    // Shopping list
    bind(ShoppingListService).toSelf().inSingletonScope();

    bind(ShoppingListWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SHOPPING_LIST_WIDGET_ID,
        createWidget: () => ctx.container.get<ShoppingListWidget>(ShoppingListWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ShoppingListContribution);
    bind(FrontendApplicationContribution).toService(ShoppingListContribution);
    bind(TabBarToolbarContribution).toService(ShoppingListContribution);
});
```

**Step 2: Compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): wire shopping list into DI container"
```

---

### Task 8: Build native addon and bundle Electron app

**Step 1: Build the native addon**

Run: `cd packages/cooklang-native && cargo build`
Expected: Compiles successfully.

Run: `cd packages/cooklang-native && npm run build`
Expected: Generates new `.node` binary with `generateShoppingList` function.

**Step 2: Compile all TypeScript**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Compiles without errors.

**Step 3: Bundle Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: `src-gen/` files regenerated successfully.

**Step 4: Start and test**

Run: `cd examples/electron && npm run start:electron`
Expected: Application starts. Shopping List view available in bottom panel via command palette (Cooklang: Toggle Shopping List).

**Step 5: Manual smoke test**

1. Open a workspace with `.cook` files
2. Open a `.cook` file in the editor
3. Run "Cooklang: Add to Shopping List" from the command palette
4. Verify the Shopping List panel opens in the bottom panel
5. Verify the recipe appears in the selected recipes list
6. Verify ingredients are listed (possibly under "Other" if no aisle.conf)
7. Check/uncheck items and verify strikethrough styling
8. Change scale factor and verify list updates
9. Remove recipe and verify list updates
10. Close and reopen app, verify `.shopping_list.txt` persists selections

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "feat(cooklang): complete shopping list feature integration"
```

---

### Task 9: Fix issues from smoke testing

This task is a placeholder for fixing any issues discovered during smoke testing in Task 8. Common issues to watch for:

- **Import paths**: Ensure all imports use `lib/` paths (not `src/`) in compiled output
- **Navigator dependency**: If `NavigatorContextMenu` import fails, check that `@theia/navigator` is in package.json
- **NAPI type mismatch**: The `Option<String>` in Rust maps to `string | undefined | null` in NAPI — verify the backend passes `undefined` (not `null`) for missing config
- **FileService.write**: May need to create the file first if it doesn't exist — check if `FileService.createFile` is needed
- **WorkspaceService roots**: Verify `tryGetRoots()` returns results after workspace is loaded (may need to wait for `onWorkspaceChanged`)
