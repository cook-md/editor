# Menu/Meal Plan Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated menu preview widget that renders `.menu` files (meal plans) with sections, recipe references, and ingredient badges, matching the cookcli web UI layout.

**Architecture:** A Rust-side `parse_menu()` function in `cooklang-native` transforms the parsed Recipe AST into a menu-specific JSON structure. The TypeScript `MenuPreviewWidget` calls this via RPC and renders the result using React components. A separate contribution wires up commands, keybindings, and open-handler for `.menu` files.

**Tech Stack:** Rust (NAPI-RS, cooklang crate 0.17), TypeScript, React 18, InversifyJS DI, Theia ReactWidget

---

### Task 1: Add `parse_menu()` to the Rust native crate

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs`

**Step 1: Add menu data structures and `parse_menu` function**

Add these types and function after the existing `generate_shopping_list` function (before the `LspServer` struct at line 198):

```rust
// ---------------------------------------------------------------------------
// Menu parsing
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct MenuParseResult {
    pub metadata: Option<MenuMetadata>,
    pub sections: Vec<MenuSection>,
    pub errors: Vec<DiagnosticInfo>,
    pub warnings: Vec<DiagnosticInfo>,
}

#[derive(Serialize)]
pub struct MenuMetadata {
    pub servings: Option<String>,
    pub time: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    #[serde(rename = "sourceUrl")]
    pub source_url: Option<String>,
    pub custom: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct MenuSection {
    pub name: Option<String>,
    pub lines: Vec<Vec<MenuSectionItem>>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum MenuSectionItem {
    #[serde(rename = "text")]
    Text { value: String },
    #[serde(rename = "recipeReference")]
    RecipeReference {
        name: String,
        scale: Option<f64>,
    },
    #[serde(rename = "ingredient")]
    Ingredient {
        name: String,
        quantity: Option<String>,
        unit: Option<String>,
    },
}

fn format_menu_value(value: &cooklang::Value) -> Option<String> {
    match value {
        cooklang::Value::Number(n) => {
            let v = n.value();
            if v == v.floor() {
                Some(format!("{}", v as i64))
            } else {
                Some(format!("{}", v))
            }
        }
        cooklang::Value::Range { start, end } => {
            let s = start.value();
            let e = end.value();
            Some(format!("{}-{}", s, e))
        }
        cooklang::Value::Text(t) => Some(t.to_string()),
    }
}

/// Parse a Cooklang menu file and return a menu-specific JSON structure.
///
/// The menu transformation mirrors cookcli's `menu_page_handler`:
/// - Walks sections and steps, splitting on `-` bullets and `\n` newlines
/// - Identifies recipe references (ingredients with `.reference` field)
/// - Applies `scale` factor to recipe reference quantities
/// - Extracts typed metadata
#[napi]
pub fn parse_menu(input: String, scale: f64) -> napi::Result<String> {
    let parser = cooklang::CooklangParser::new(
        cooklang::Extensions::all(),
        Default::default(),
    );

    let result = parser.parse(&input);
    let report = result.report();

    let errors: Vec<DiagnosticInfo> = report
        .errors()
        .map(|e| DiagnosticInfo {
            message: e.message.to_string(),
            severity: "error".to_string(),
        })
        .collect();

    let warnings: Vec<DiagnosticInfo> = report
        .warnings()
        .map(|w| DiagnosticInfo {
            message: w.message.to_string(),
            severity: "warning".to_string(),
        })
        .collect();

    let recipe = match result.into_output() {
        Some(r) => r,
        None => {
            let menu_result = MenuParseResult {
                metadata: None,
                sections: Vec::new(),
                errors,
                warnings,
            };
            return serde_json::to_string(&menu_result)
                .map_err(|e| napi::Error::from_reason(e.to_string()));
        }
    };

    // Extract metadata
    let skip_keys = ["name", "tags", "tag", "images", "image", "locale"];
    let known_keys = ["servings", "time", "author", "description", "source", "source_url"];

    let metadata = if recipe.metadata.map.is_empty() {
        None
    } else {
        let get_field = |key: &str| -> Option<String> {
            recipe.metadata.get(key).and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if let Some(n) = v.as_i64() {
                    Some(n.to_string())
                } else {
                    v.as_f64().map(|f| format!("{}", f))
                }
            })
        };

        let custom: Vec<(String, String)> = recipe.metadata.map.iter()
            .filter(|(k, _)| !skip_keys.contains(&k.as_str()) && !known_keys.contains(&k.as_str()))
            .filter_map(|(k, v)| {
                if let Some(s) = v.as_str() {
                    Some((k.clone(), s.to_string()))
                } else if let Some(n) = v.as_i64() {
                    Some((k.clone(), n.to_string()))
                } else {
                    v.as_f64().map(|f| (k.clone(), format!("{}", f)))
                }
            })
            .collect();

        Some(MenuMetadata {
            servings: get_field("servings"),
            time: get_field("time"),
            author: get_field("author"),
            description: get_field("description"),
            source: get_field("source"),
            source_url: get_field("source_url"),
            custom,
        })
    };

    // Process sections into menu lines
    let mut sections = Vec::new();

    for section in &recipe.sections {
        let section_name = section.name.clone();
        let mut lines: Vec<Vec<MenuSectionItem>> = Vec::new();

        for content in &section.content {
            use cooklang::Content;
            if let Content::Step(step) = content {
                let mut step_items: Vec<MenuSectionItem> = Vec::new();
                let mut current_text = String::new();

                for item in &step.items {
                    use cooklang::Item;

                    match item {
                        Item::Text { value } => {
                            if value == "-" {
                                // Bullet marker — complete current line and start new one
                                if !current_text.is_empty() {
                                    step_items.push(MenuSectionItem::Text {
                                        value: current_text.clone(),
                                    });
                                    current_text.clear();
                                }
                                if !step_items.is_empty() {
                                    lines.push(step_items.clone());
                                    step_items.clear();
                                }
                            } else {
                                // Split on newlines to preserve line breaks
                                let parts: Vec<&str> = value.split('\n').collect();
                                for (i, part) in parts.iter().enumerate() {
                                    if i > 0 {
                                        if !current_text.is_empty() {
                                            step_items.push(MenuSectionItem::Text {
                                                value: current_text.clone(),
                                            });
                                            current_text.clear();
                                        }
                                        if !step_items.is_empty() {
                                            lines.push(step_items.clone());
                                            step_items.clear();
                                        }
                                    }
                                    if !part.is_empty() {
                                        current_text.push_str(part);
                                    }
                                }
                            }
                        }
                        Item::Ingredient { index } => {
                            if !current_text.is_empty() {
                                step_items.push(MenuSectionItem::Text {
                                    value: current_text.clone(),
                                });
                                current_text.clear();
                            }

                            if let Some(ing) = recipe.ingredients.get(*index) {
                                if let Some(ref recipe_ref) = ing.reference {
                                    // Recipe reference
                                    let recipe_scale = ing.quantity.as_ref().and_then(|q| {
                                        match q.value() {
                                            cooklang::Value::Number(n) => Some(n.value()),
                                            _ => None,
                                        }
                                    });
                                    let final_scale = recipe_scale.map(|s| s * scale);

                                    let name = if recipe_ref.components.is_empty() {
                                        recipe_ref.name.clone()
                                    } else {
                                        format!(
                                            "{}/{}",
                                            recipe_ref.components.join("/"),
                                            recipe_ref.name
                                        )
                                    };

                                    step_items.push(MenuSectionItem::RecipeReference {
                                        name,
                                        scale: final_scale,
                                    });
                                } else {
                                    // Regular ingredient
                                    let quantity = ing.quantity.as_ref().and_then(|q| {
                                        format_menu_value(q.value())
                                    });
                                    let unit = ing
                                        .quantity
                                        .as_ref()
                                        .and_then(|q| q.unit().as_ref().map(|u| u.to_string()));

                                    step_items.push(MenuSectionItem::Ingredient {
                                        name: ing.name.to_string(),
                                        quantity,
                                        unit,
                                    });
                                }
                            }
                        }
                        _ => {} // Ignore cookware, timers in menu files
                    }
                }

                if !current_text.is_empty() {
                    step_items.push(MenuSectionItem::Text { value: current_text });
                }
                if !step_items.is_empty() {
                    lines.push(step_items);
                }
            }
        }

        if !lines.is_empty() {
            sections.push(MenuSection {
                name: section_name,
                lines,
            });
        }
    }

    let menu_result = MenuParseResult {
        metadata,
        sections,
        errors,
        warnings,
    };

    serde_json::to_string(&menu_result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}
```

**Step 2: Build the native addon**

Run: `cd packages/cooklang-native && cargo build`
Expected: Successful compilation

**Step 3: Commit**

```bash
git add packages/cooklang-native/src/lib.rs
git commit -m "feat(cooklang-native): add parse_menu() for menu/meal plan parsing"
```

---

### Task 2: Add menu TypeScript types

**Files:**
- Create: `packages/cooklang/src/common/menu-types.ts`
- Modify: `packages/cooklang/src/common/index.ts`

**Step 1: Create menu-types.ts**

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

/**
 * TypeScript types matching the JSON output of cooklang-native's parse_menu().
 */

export interface MenuMetadata {
    servings?: string;
    time?: string;
    author?: string;
    description?: string;
    source?: string;
    sourceUrl?: string;
    custom: [string, string][];
}

export interface MenuTextItem {
    type: 'text';
    value: string;
}

export interface MenuRecipeReferenceItem {
    type: 'recipeReference';
    name: string;
    scale?: number;
}

export interface MenuIngredientItem {
    type: 'ingredient';
    name: string;
    quantity?: string;
    unit?: string;
}

export type MenuSectionItem = MenuTextItem | MenuRecipeReferenceItem | MenuIngredientItem;

export interface MenuSection {
    name: string | null;
    lines: MenuSectionItem[][];
}

export interface MenuParseResult {
    metadata: MenuMetadata | null;
    sections: MenuSection[];
    errors: Array<{ message: string; severity: string }>;
    warnings: Array<{ message: string; severity: string }>;
}
```

**Step 2: Export from common/index.ts**

Add to end of `packages/cooklang/src/common/index.ts`:

```typescript
export * from './menu-types';
```

**Step 3: Commit**

```bash
git add packages/cooklang/src/common/menu-types.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): add menu TypeScript type definitions"
```

---

### Task 3: Add `parseMenu()` to the language service interface and implementation

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

**Step 1: Add `parseMenu` to the service interface**

In `packages/cooklang/src/common/cooklang-language-service.ts`, add after the `parse` method (line 32):

```typescript
    // Menu parsing (returns JSON-serialized MenuParseResult)
    parseMenu(content: string, scale: number): Promise<string>;
```

**Step 2: Implement `parseMenu` in the backend**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`, add after the `parse` method (after line 160):

```typescript
    async parseMenu(content: string, scale: number): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.parseMenu(content, scale);
        } catch (error) {
            console.error('[cooklang] Failed to parse menu:', error);
            return JSON.stringify({ metadata: null, sections: [], errors: [{ message: String(error), severity: 'error' }], warnings: [] });
        }
    }
```

**Step 3: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Successful compilation

**Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): add parseMenu() to language service interface and backend"
```

---

### Task 4: Create MenuPreviewWidget

**Files:**
- Create: `packages/cooklang/src/browser/menu-preview-widget.tsx`

**Step 1: Create the widget**

Model after `recipe-preview-widget.tsx` but tailored for `.menu` files. Key differences: calls `parseMenu()` instead of `parse()`, manages scale state that gets sent to the parser, renders `MenuView` instead of `RecipeView`.

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct, interfaces } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID } from '../common';
import { MenuParseResult } from '../common/menu-types';
import { MenuView } from './menu-preview-components';

import '../../src/browser/style/menu-preview.css';

export const MENU_PREVIEW_WIDGET_ID = 'menu-preview-widget';

export function createMenuPreviewWidgetId(uri: URI): string {
    return `${MENU_PREVIEW_WIDGET_ID}:${uri.toString()}`;
}

@injectable()
export class MenuPreviewWidget extends ReactWidget implements Navigatable {

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected uri: URI;
    protected menuResult: MenuParseResult | undefined;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected scale = 1;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-menu-preview');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
    }

    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createMenuPreviewWidgetId(uri);
        this.title.label = `Preview: ${uri.path.base}`;
        this.title.caption = `Menu preview for ${uri.toString()}`;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-open-preview';
        this.parseCurrentContent();
    }

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    protected listenToDocumentChanges(): void {
        this.toDispose.push(
            this.monacoWorkspace.onDidChangeTextDocument(event => {
                if (
                    event.model.languageId !== COOKLANG_LANGUAGE_ID ||
                    event.model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.debouncedParse(event.model.getText());
            })
        );

        this.toDispose.push(
            this.monacoWorkspace.onDidOpenTextDocument(model => {
                if (
                    model.languageId !== COOKLANG_LANGUAGE_ID ||
                    model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.parseContent(model.getText());
            })
        );
    }

    protected debouncedParse(content: string): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.parseContent(content);
        }, 300);
    }

    protected parseCurrentContent(): void {
        if (!this.uri) {
            return;
        }
        const model = this.monacoWorkspace.getTextDocument(this.uri.toString());
        if (model) {
            this.parseContent(model.getText());
        } else {
            this.fileService.read(this.uri).then(
                content => this.parseContent(content.value),
                err => {
                    this.parseErrors = [`Failed to read file: ${err}`];
                    this.update();
                }
            );
        }
    }

    protected parseContent(content: string): void {
        this.service.parseMenu(content, this.scale).then(json => {
            try {
                const result: MenuParseResult = JSON.parse(json);
                this.menuResult = result;
                this.parseErrors = [
                    ...(result.errors ?? []).map(e => e.message),
                    ...(result.warnings ?? []).map(w => w.message),
                ];
            } catch (e) {
                this.menuResult = undefined;
                this.parseErrors = [`Failed to parse response: ${e}`];
            }
            this.update();
        }).catch(e => {
            this.menuResult = undefined;
            this.parseErrors = [`Parse request failed: ${e}`];
            this.update();
        });
    }

    protected handleScaleChange = (newScale: number): void => {
        this.scale = newScale;
        this.parseCurrentContent();
    };

    protected handleAddToShoppingList = (currentScale: number): void => {
        this.commandRegistry.executeCommand('cooklang.addToShoppingList', this, currentScale);
    };

    protected handleNavigateToRecipe = (referencePath: string): void => {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return;
        }
        const rootUri = new URI(root.resource.toString());
        const cleanPath = referencePath.startsWith('./')
            ? referencePath.slice(2)
            : referencePath;
        const targetUri = rootUri.resolve(cleanPath + '.cook');
        open(this.openerService, targetUri);
    };

    protected render(): React.ReactNode {
        if (this.menuResult && this.menuResult.sections.length > 0) {
            return (
                <MenuView
                    menuResult={this.menuResult}
                    fileName={this.uri?.path.base ?? ''}
                    scale={this.scale}
                    onScaleChange={this.handleScaleChange}
                    onAddToShoppingList={this.handleAddToShoppingList}
                    onNavigateToRecipe={this.handleNavigateToRecipe}
                />
            );
        }

        if (this.parseErrors.length > 0) {
            return (
                <div className='menu-error'>
                    <strong>Parse errors:</strong>
                    <ul>
                        {this.parseErrors.map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                        ))}
                    </ul>
                </div>
            );
        }

        return (
            <div className='menu-empty'>
                Open a <code>.menu</code> file to see its meal plan preview.
            </div>
        );
    }

    override dispose(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        super.dispose();
    }
}

export function createMenuPreviewWidget(
    container: interfaces.Container,
    uri: URI
): MenuPreviewWidget {
    const child = container.createChild();
    child.bind(MenuPreviewWidget).toSelf().inTransientScope();
    const widget = child.get(MenuPreviewWidget);
    widget.setUri(uri);
    return widget;
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/menu-preview-widget.tsx
git commit -m "feat(cooklang): add MenuPreviewWidget for .menu files"
```

---

### Task 5: Create MenuView React components

**Files:**
- Create: `packages/cooklang/src/browser/menu-preview-components.tsx`

**Step 1: Create the components**

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import * as React from '@theia/core/shared/react';
import {
    MenuParseResult,
    MenuSection,
    MenuSectionItem,
    MenuMetadata,
} from '../common/menu-types';

// ---------------------------------------------------------------------------
// MenuMetadataPills
// ---------------------------------------------------------------------------

interface MenuMetadataPillsProps {
    metadata: MenuMetadata;
}

const MenuMetadataPills = ({ metadata }: MenuMetadataPillsProps): React.ReactElement | null => {
    const pills: Array<{ label: string; value: string }> = [];

    if (metadata.servings) {
        pills.push({ label: 'Servings', value: metadata.servings });
    }
    if (metadata.time) {
        pills.push({ label: 'Time', value: metadata.time });
    }
    if (metadata.author) {
        pills.push({ label: 'Author', value: metadata.author });
    }
    if (metadata.source) {
        pills.push({ label: 'Source', value: metadata.source });
    }
    for (const [key, value] of metadata.custom) {
        pills.push({ label: key.replace(/_/g, ' '), value });
    }

    if (pills.length === 0) {
        return null;
    }

    return (
        <div className='menu-metadata'>
            {pills.map((pill, idx) => (
                <span key={idx} className='metadata-pill'>
                    <strong>{pill.label}:</strong> {pill.value}
                </span>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// MenuItemView
// ---------------------------------------------------------------------------

interface MenuItemViewProps {
    item: MenuSectionItem;
    onNavigateToRecipe?: (referencePath: string) => void;
}

const MenuItemView = ({ item, onNavigateToRecipe }: MenuItemViewProps): React.ReactElement => {
    switch (item.type) {
        case 'text':
            return <span className='menu-text'>{item.value}</span>;

        case 'recipeReference': {
            const displayName = item.name.startsWith('./')
                ? item.name.slice(2)
                : item.name;
            return (
                <span className='menu-recipe-ref'>
                    <a
                        className='menu-recipe-ref-link'
                        onClick={() => onNavigateToRecipe?.(item.name)}
                    >
                        {displayName.replace(/\//g, ' \u203A ')}
                    </a>
                    {item.scale !== undefined && item.scale !== null && (
                        <span className='menu-recipe-scale'>(\u00D7{item.scale})</span>
                    )}
                </span>
            );
        }

        case 'ingredient':
            return (
                <span className='menu-ingredient-badge'>
                    {item.name}
                    {item.quantity && (
                        <span className='menu-ingredient-qty'> {item.quantity}</span>
                    )}
                    {item.unit && (
                        <span className='menu-ingredient-unit'> {item.unit}</span>
                    )}
                </span>
            );
    }
};

// ---------------------------------------------------------------------------
// MenuLineView
// ---------------------------------------------------------------------------

interface MenuLineViewProps {
    items: MenuSectionItem[];
    onNavigateToRecipe?: (referencePath: string) => void;
}

const MenuLineView = ({ items, onNavigateToRecipe }: MenuLineViewProps): React.ReactElement => {
    // Single text item ending with ':' — render as meal type header
    if (items.length === 1 && items[0].type === 'text' && items[0].value.trim().endsWith(':')) {
        return <h3 className='menu-meal-header'>{items[0].value}</h3>;
    }

    return (
        <div className='menu-line'>
            {items.map((item, idx) => (
                <MenuItemView
                    key={idx}
                    item={item}
                    onNavigateToRecipe={onNavigateToRecipe}
                />
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// MenuSectionView
// ---------------------------------------------------------------------------

interface MenuSectionViewProps {
    section: MenuSection;
    onNavigateToRecipe?: (referencePath: string) => void;
}

const MenuSectionView = ({ section, onNavigateToRecipe }: MenuSectionViewProps): React.ReactElement => (
    <div className='menu-section'>
        {section.name && (
            <div className='menu-section-header'>
                <h2 className='menu-section-title'>{section.name}</h2>
            </div>
        )}
        <div className='menu-section-content'>
            {section.lines.map((line, idx) => (
                <MenuLineView
                    key={idx}
                    items={line}
                    onNavigateToRecipe={onNavigateToRecipe}
                />
            ))}
        </div>
    </div>
);

// ---------------------------------------------------------------------------
// MenuView (top-level export)
// ---------------------------------------------------------------------------

export interface MenuViewProps {
    menuResult: MenuParseResult;
    fileName: string;
    scale: number;
    onScaleChange?: (scale: number) => void;
    onAddToShoppingList?: (scale: number) => void;
    onNavigateToRecipe?: (referencePath: string) => void;
}

export const MenuView = ({
    menuResult,
    fileName,
    scale,
    onScaleChange,
    onAddToShoppingList,
    onNavigateToRecipe,
}: MenuViewProps): React.ReactElement => {
    const meta = menuResult.metadata;
    const title = fileName.replace(/\.menu$/i, '');

    return (
        <div>
            <div className='menu-header'>
                <div className='menu-header-left'>
                    <h1 className='menu-title'>{title}</h1>
                    <span className='menu-badge'>Menu</span>
                </div>
                <div className='menu-header-actions'>
                    <div className='menu-scale-control'>
                        <label className='menu-scale-label'>Scale</label>
                        <input
                            className='menu-scale-input'
                            type='number'
                            min={0.5}
                            max={200}
                            step={0.5}
                            value={scale}
                            onChange={e => {
                                const val = parseFloat(e.target.value);
                                if (Number.isFinite(val) && val > 0) {
                                    onScaleChange?.(val);
                                }
                            }}
                            title='Scale factor'
                        />
                    </div>
                    {onAddToShoppingList && (
                        <button
                            className='menu-add-shopping-list'
                            onClick={() => onAddToShoppingList(scale)}
                            title='Add All to Shopping List'
                        >
                            <span className='codicon codicon-add'></span>
                            <span className='theia-shopping-cart-icon'></span>
                        </button>
                    )}
                </div>
            </div>

            {meta?.description && (
                <p className='menu-description'>{meta.description}</p>
            )}

            {meta && <MenuMetadataPills metadata={meta} />}

            <div className='menu-sections'>
                {menuResult.sections.map((section, idx) => (
                    <MenuSectionView
                        key={idx}
                        section={section}
                        onNavigateToRecipe={onNavigateToRecipe}
                    />
                ))}
            </div>
        </div>
    );
};
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/menu-preview-components.tsx
git commit -m "feat(cooklang): add MenuView React components for menu rendering"
```

---

### Task 6: Create menu preview CSS

**Files:**
- Create: `packages/cooklang/src/browser/style/menu-preview.css`

**Step 1: Create the stylesheet**

Theme-aware CSS using `--theia-*` variables. Adapts the cookcli Tailwind layout into Theia's design system.

```css
/* Menu Preview — meal plan rendering, fully theme-aware */

.theia-menu-preview {
    height: 100%;
    overflow-y: auto;
    padding: 24px 32px;
    font-family: var(--theia-editor-font-family, var(--theia-ui-font-family));
    font-size: var(--theia-content-font-size, 13px);
    line-height: var(--theia-content-line-height, 1.6);
    color: var(--theia-foreground);
    background: var(--theia-editor-background);
}

/* Header row */
.theia-menu-preview .menu-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--theia-panel-border);
    padding-bottom: 8px;
    margin-bottom: 8px;
}

.theia-menu-preview .menu-header-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
}

.theia-menu-preview .menu-title {
    font-size: 1.8em;
    font-weight: 600;
    margin-bottom: 0;
    color: var(--theia-foreground);
    border-bottom: none;
    padding-bottom: 0;
}

.theia-menu-preview .menu-badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 3px;
    background: var(--theia-badge-background);
    color: var(--theia-badge-foreground);
    font-size: 0.85em;
    font-weight: 500;
}

/* Header actions (scale + add to shopping list) */
.theia-menu-preview .menu-header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
}

.theia-menu-preview .menu-scale-control {
    display: flex;
    align-items: center;
    gap: 6px;
}

.theia-menu-preview .menu-scale-label {
    font-size: 0.85em;
    color: var(--theia-descriptionForeground);
    white-space: nowrap;
}

.theia-menu-preview .menu-scale-input {
    width: 52px;
    padding: 2px 4px;
    border: 1px solid var(--theia-panel-border);
    border-radius: 3px;
    background: var(--theia-input-background);
    color: var(--theia-input-foreground);
    font-size: 0.9em;
    text-align: center;
}

.theia-menu-preview .menu-scale-input:focus {
    outline: 1px solid var(--theia-focusBorder);
    border-color: var(--theia-focusBorder);
}

.theia-menu-preview .menu-add-shopping-list {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid var(--theia-panel-border);
    border-radius: 3px;
    background: transparent;
    color: var(--theia-descriptionForeground);
    cursor: pointer;
    white-space: nowrap;
    font-size: 14px;
    flex-shrink: 0;
}

.theia-menu-preview .menu-add-shopping-list:hover {
    background: var(--theia-toolbar-hoverBackground, var(--theia-textCodeBlock-background));
    color: var(--theia-foreground);
}

/* Description */
.theia-menu-preview .menu-description {
    padding: 8px 16px;
    border-left: 3px solid var(--theia-textBlockQuote-border, var(--theia-panel-border));
    background: var(--theia-textBlockQuote-background, transparent);
    margin-bottom: 16px;
    font-style: italic;
    color: var(--theia-foreground);
}

/* Metadata pills */
.theia-menu-preview .menu-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
}

.theia-menu-preview .metadata-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: 3px;
    background: var(--theia-textCodeBlock-background, var(--theia-badge-background));
    color: var(--theia-foreground);
    font-size: 0.9em;
    border: 1px solid var(--theia-panel-border);
}

/* Sections container */
.theia-menu-preview .menu-sections {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

/* Individual section */
.theia-menu-preview .menu-section {
    border: 1px solid var(--theia-panel-border);
    border-radius: 4px;
    overflow: hidden;
}

.theia-menu-preview .menu-section-header {
    background: var(--theia-badge-background);
    padding: 6px 16px;
}

.theia-menu-preview .menu-section-title {
    font-size: 1.1em;
    font-weight: 600;
    color: var(--theia-badge-foreground);
    margin: 0;
    border-bottom: none;
    padding-bottom: 0;
}

.theia-menu-preview .menu-section-content {
    padding: 12px 16px;
}

/* Meal type header (e.g. "Breakfast:") */
.theia-menu-preview .menu-meal-header {
    font-size: 1.05em;
    font-weight: 600;
    color: var(--theia-foreground);
    margin-top: 8px;
    margin-bottom: 4px;
    border-bottom: none;
    padding-bottom: 0;
}

.theia-menu-preview .menu-meal-header:first-child {
    margin-top: 0;
}

/* Line of items */
.theia-menu-preview .menu-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0 2px 20px;
}

/* Text within a line */
.theia-menu-preview .menu-text {
    color: var(--theia-foreground);
}

/* Recipe reference link */
.theia-menu-preview .menu-recipe-ref {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
}

.theia-menu-preview .menu-recipe-ref-link {
    color: var(--theia-textLink-foreground);
    cursor: pointer;
    font-weight: 500;
}

.theia-menu-preview .menu-recipe-ref-link:hover {
    color: var(--theia-textLink-activeForeground);
    text-decoration: underline;
}

.theia-menu-preview .menu-recipe-scale {
    font-size: 0.85em;
    color: var(--theia-descriptionForeground);
}

/* Ingredient badge */
.theia-menu-preview .menu-ingredient-badge {
    display: inline;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--theia-textCodeBlock-background, rgba(128, 128, 128, 0.15));
    border: 1px solid var(--theia-panel-border);
    font-size: 0.92em;
}

.theia-menu-preview .menu-ingredient-qty {
    font-weight: 600;
}

.theia-menu-preview .menu-ingredient-unit {
    color: var(--theia-descriptionForeground);
}

/* Error/empty states */
.theia-menu-preview .menu-error {
    padding: 12px 16px;
    border-radius: 3px;
    background: var(--theia-inputValidation-errorBackground, var(--theia-editor-background));
    border: 1px solid var(--theia-inputValidation-errorBorder, var(--theia-panel-border));
    color: var(--theia-errorForeground);
}

.theia-menu-preview .menu-empty {
    padding: 32px;
    text-align: center;
    color: var(--theia-descriptionForeground);
    font-style: italic;
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/style/menu-preview.css
git commit -m "style(cooklang): add theme-aware CSS for menu preview"
```

---

### Task 7: Create MenuPreviewContribution

**Files:**
- Create: `packages/cooklang/src/browser/menu-preview-contribution.ts`

**Step 1: Create the contribution**

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { COOKLANG_LANGUAGE_ID } from '../common';
import {
    MenuPreviewWidget,
    MENU_PREVIEW_WIDGET_ID,
    createMenuPreviewWidgetId,
} from './menu-preview-widget';

export namespace CooklangMenuPreviewCommands {
    export const TOGGLE_MENU_PREVIEW: Command = {
        id: 'cooklang.toggleMenuPreview',
        label: 'Cooklang: Toggle Menu Preview',
        iconClass: 'codicon codicon-open-preview'
    };
    export const OPEN_MENU_PREVIEW_SIDE: Command = {
        id: 'cooklang.openMenuPreviewSide',
        label: 'Cooklang: Open Menu Preview to the Side',
        iconClass: 'codicon codicon-open-preview'
    };
}

@injectable()
export class MenuPreviewContribution implements CommandContribution, KeybindingContribution, OpenHandler {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    readonly id = 'cooklang-menu-preview-open-handler';
    readonly label = 'Cooklang: Menu Preview';

    canHandle(uri: URI): number {
        if (uri.path.ext === '.menu') {
            return 200;
        }
        return 0;
    }

    async open(uri: URI): Promise<MenuPreviewWidget> {
        const preview = await this.getOrCreatePreview(uri);
        if (!preview.isAttached) {
            await this.shell.addWidget(preview, { area: 'main' });
        }
        this.shell.activateWidget(preview.id);
        return preview;
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW, {
            execute: () => this.togglePreview(),
            isEnabled: () => this.canPreviewMenu(),
            isVisible: () => this.canPreviewMenu()
        });
        commands.registerCommand(CooklangMenuPreviewCommands.OPEN_MENU_PREVIEW_SIDE, {
            execute: () => this.openPreviewSide(),
            isEnabled: () => this.canPreviewMenu(),
            isVisible: () => this.canPreviewMenu()
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW.id,
            keybinding: 'ctrlcmd+shift+v',
            when: `editorLangId == ${COOKLANG_LANGUAGE_ID} && resourceExtname == .menu`
        });
        keybindings.registerKeybinding({
            command: CooklangMenuPreviewCommands.OPEN_MENU_PREVIEW_SIDE.id,
            keybinding: 'ctrlcmd+k v',
            when: `resourceExtname == .menu`
        });
    }

    protected canPreviewMenu(): boolean {
        const current = this.shell.currentWidget;
        if (current instanceof MenuPreviewWidget) {
            return true;
        }
        return this.getActiveMenuEditorUri() !== undefined;
    }

    protected getActiveMenuEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const uri = new URI(editorWidget.editor.document.uri);
        if (uri.path.ext !== '.menu') {
            return undefined;
        }
        return uri;
    }

    protected async togglePreview(): Promise<void> {
        const current = this.shell.currentWidget;

        if (current instanceof MenuPreviewWidget) {
            const resourceUri = current.getResourceUri();
            if (resourceUri) {
                await this.editorManager.open(resourceUri);
            }
            return;
        }

        const uri = this.getActiveMenuEditorUri();
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main' });
        this.shell.activateWidget(preview.id);
    }

    protected async openPreviewSide(): Promise<void> {
        const uri = this.getActiveMenuEditorUri();
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main', mode: 'open-to-right' });
        this.shell.activateWidget(preview.id);
    }

    protected async getOrCreatePreview(uri: URI): Promise<MenuPreviewWidget> {
        const widgetId = createMenuPreviewWidgetId(uri);
        const existing = this.widgetManager.tryGetWidget<MenuPreviewWidget>(widgetId);
        if (existing) {
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<MenuPreviewWidget>(
            MENU_PREVIEW_WIDGET_ID,
            { uri: uri.toString() }
        );
    }
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/menu-preview-contribution.ts
git commit -m "feat(cooklang): add MenuPreviewContribution with commands, keybindings, and open handler"
```

---

### Task 8: Wire up DI bindings

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Add imports**

Add these imports after the existing imports in `cooklang-frontend-module.ts`:

```typescript
import { MENU_PREVIEW_WIDGET_ID, createMenuPreviewWidget } from './menu-preview-widget';
import { MenuPreviewContribution } from './menu-preview-contribution';
```

**Step 2: Add bindings**

Add these bindings inside the `ContainerModule` callback, after the recipe preview bindings (after line 52):

```typescript
    // Menu preview widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MENU_PREVIEW_WIDGET_ID,
        createWidget: (options: { uri: string }) =>
            createMenuPreviewWidget(ctx.container, new URI(options.uri)),
    })).inSingletonScope();

    // Menu preview commands and keybindings
    bind(MenuPreviewContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MenuPreviewContribution);
    bind(KeybindingContribution).toService(MenuPreviewContribution);
    bind(OpenHandler).toService(MenuPreviewContribution);
```

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): wire up MenuPreviewWidget and MenuPreviewContribution in DI"
```

---

### Task 9: Build, rebuild native addon, and verify

**Step 1: Build the native addon for Node.js**

Run: `cd packages/cooklang-native && npm run build`
Expected: Successful native build

**Step 2: Compile TypeScript**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Successful compilation with no errors

**Step 3: Bundle the Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: Successful bundling (regenerates src-gen/ files with new DI bindings)

**Step 4: Start and test**

Run: `cd examples/electron && npm run start:electron`

Manual verification:
1. Open a workspace containing `.menu` files
2. Open a `.menu` file — should open directly in preview mode (OpenHandler priority 200)
3. Verify sections render with headers
4. Verify recipe references are clickable links
5. Verify ingredient badges render correctly
6. Verify scale input re-renders with updated scales
7. Verify the toggle preview keybinding (`Ctrl+Shift+V`) works
8. Verify "Open preview to the side" (`Ctrl+K V`) works

**Step 5: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "feat(cooklang): complete menu/meal plan preview support"
```
