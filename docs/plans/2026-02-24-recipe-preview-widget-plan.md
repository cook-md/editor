# Recipe Preview Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a recipe details preview widget that renders parsed `.cook` files with ingredients, steps, metadata, and inline badges — matching the cookcli web UI layout.

**Architecture:** A `RecipePreviewWidget` (ReactWidget) lives in `packages/cooklang/src/browser/`. It calls `CooklangLanguageService.parse()` via RPC to get parsed recipe JSON from the backend (which uses `cooklang-native`). Commands allow toggling the preview in-place or opening it side-by-side with the editor. Content updates live with 300ms debounce.

**Tech Stack:** TypeScript, React 18, InversifyJS DI, Theia ReactWidget, CSS Grid, `@theia/editor` EditorManager

---

### Task 1: Add `parse()` to the RPC interface

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`

**Step 1: Add parse method to CooklangLanguageService interface**

Add this method to the `CooklangLanguageService` interface (after the `semanticTokensFull` method at line 29):

```typescript
    // Recipe parsing (returns JSON-serialized ParseResult)
    parse(content: string): Promise<string>;
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS (interface change only, impl will be added next)

Note: Compilation may warn about missing implementation — that's expected and will be fixed in Task 2.

---

### Task 2: Implement `parse()` on the backend

**Files:**
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

**Step 1: Add parse method implementation**

Add this method to `CooklangLanguageServiceImpl` class (after the `semanticTokensFull` method):

```typescript
    async parse(content: string): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.parse(content);
        } catch (error) {
            console.error('[cooklang] Failed to parse recipe:', error);
            return JSON.stringify({ recipe: null, errors: [{ message: String(error), severity: 'error' }], warnings: [] });
        }
    }
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): add parse() method to language service RPC interface"
```

---

### Task 3: Add `@theia/editor` dependency to cooklang package

**Files:**
- Modify: `packages/cooklang/package.json`
- Modify: `packages/cooklang/tsconfig.json`

**Step 1: Add @theia/editor dependency to package.json**

Add to the `dependencies` object in `packages/cooklang/package.json`:

```json
    "@theia/editor": "1.68.0",
```

**Step 2: Add editor to tsconfig references**

Add to the `references` array in `packages/cooklang/tsconfig.json`:

```json
    { "path": "../editor" }
```

**Step 3: Install dependencies**

Run: `npm install` (from repo root)
Expected: SUCCESS — workspace symlink created for @theia/editor

**Step 4: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 5: Commit**

```bash
git add packages/cooklang/package.json packages/cooklang/tsconfig.json
git commit -m "feat(cooklang): add @theia/editor dependency for preview widget"
```

---

### Task 4: Define recipe data types

**Files:**
- Create: `packages/cooklang/src/common/recipe-types.ts`
- Modify: `packages/cooklang/src/common/index.ts`

**Step 1: Create recipe-types.ts**

Create `packages/cooklang/src/common/recipe-types.ts` with TypeScript interfaces matching the cooklang parser JSON output:

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

/**
 * TypeScript types matching the JSON output of cooklang-native parse().
 */

export interface ParseResult {
    recipe: Recipe | null;
    errors: DiagnosticInfo[];
    warnings: DiagnosticInfo[];
}

export interface DiagnosticInfo {
    message: string;
    severity: string;
}

export interface Recipe {
    metadata: RecipeMetadata;
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inline_quantities: Quantity[];
}

export interface RecipeMetadata {
    map: Record<string, unknown>;
}

export interface Section {
    name: string | null;
    content: ContentItem[];
}

export interface ContentItem {
    type: 'step' | 'text';
    value: Step | string;
}

export interface Step {
    items: StepItem[];
    number: number;
}

export interface StepItem {
    type: 'text' | 'ingredient' | 'cookware' | 'timer' | 'inlineQuantity';
    value?: string;
    index?: number;
}

export interface Ingredient {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
}

export interface Cookware {
    name: string;
    alias: string | null;
    quantity: Quantity | null;
    note: string | null;
}

export interface Timer {
    name: string | null;
    quantity: Quantity | null;
}

export interface Quantity {
    value: QuantityValue;
    unit: string | null;
    scalable: boolean;
}

export type QuantityValue =
    | { type: 'number'; value: NumberValue }
    | { type: 'range'; value: { start: NumberValue; end: NumberValue } }
    | { type: 'text'; value: string };

export type NumberValue =
    | { type: 'regular'; value: number }
    | { type: 'fraction'; value: { whole: number; num: number; den: number; err: number } };

/**
 * Format a Quantity as a human-readable string (e.g. "250 g", "1/2 cup").
 */
export function formatQuantity(qty: Quantity | null): string {
    if (!qty) {
        return '';
    }
    const val = formatQuantityValue(qty.value);
    if (qty.unit) {
        return val ? `${val} ${qty.unit}` : qty.unit;
    }
    return val;
}

function formatQuantityValue(val: QuantityValue): string {
    switch (val.type) {
        case 'number':
            return formatNumber(val.value);
        case 'range':
            return `${formatNumber(val.value.start)}-${formatNumber(val.value.end)}`;
        case 'text':
            return val.value;
    }
}

function formatNumber(num: NumberValue): string {
    switch (num.type) {
        case 'regular':
            return num.value % 1 === 0 ? String(num.value) : num.value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        case 'fraction': {
            const { whole, num: n, den } = num.value;
            if (whole > 0) {
                return `${whole} ${n}/${den}`;
            }
            return `${n}/${den}`;
        }
    }
}
```

**Step 2: Export from common/index.ts**

Add to `packages/cooklang/src/common/index.ts`:

```typescript
export * from './recipe-types';
```

**Step 3: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add packages/cooklang/src/common/recipe-types.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): add TypeScript types for parsed recipe data"
```

---

### Task 5: Create the CSS stylesheet

**Files:**
- Create: `packages/cooklang/src/browser/style/recipe-preview.css`

**Step 1: Create the CSS file**

Create `packages/cooklang/src/browser/style/recipe-preview.css`:

```css
.theia-recipe-preview {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    font-family: var(--theia-ui-font-family);
    color: var(--theia-foreground);
    background: var(--theia-editor-background);
}

/* Header */
.theia-recipe-preview .recipe-title {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 12px;
    color: var(--theia-foreground);
}

/* Tags */
.theia-recipe-preview .recipe-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}

.theia-recipe-preview .recipe-tag {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 9999px;
    background: linear-gradient(135deg, #fbbf24, #fb923c);
    color: white;
    font-size: 12px;
    font-weight: 500;
}

/* Description */
.theia-recipe-preview .recipe-description {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #fed7aa;
    background: #fffbeb;
    margin-bottom: 12px;
    font-style: italic;
    color: #374151;
}

/* Metadata pills */
.theia-recipe-preview .recipe-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
}

.theia-recipe-preview .metadata-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: 9999px;
    background: var(--theia-badge-background, #f3f4f6);
    color: var(--theia-badge-foreground, #374151);
    font-size: 13px;
    border: 1px solid var(--theia-contrastBorder, #e5e7eb);
}

/* Grid layout */
.theia-recipe-preview .recipe-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 24px;
}

/* Sidebar (ingredients + cookware) */
.theia-recipe-preview .recipe-sidebar {
    border: 1px solid var(--theia-panel-border, #e5e7eb);
    border-radius: 12px;
    padding: 20px;
    background: var(--theia-editorWidget-background, #ffffff);
    align-self: start;
}

.theia-recipe-preview .sidebar-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 12px;
    color: #ea580c;
}

.theia-recipe-preview .sidebar-title.cookware-title {
    color: #16a34a;
    margin-top: 20px;
}

.theia-recipe-preview .section-subtitle {
    font-size: 15px;
    font-weight: 600;
    color: #c2410c;
    margin-top: 12px;
    margin-bottom: 8px;
}

/* Ingredient list */
.theia-recipe-preview .ingredient-list {
    list-style: none;
    padding: 0;
    margin: 0;
}

.theia-recipe-preview .ingredient-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-radius: 8px;
    background: #fffbeb;
    margin-bottom: 6px;
}

.theia-recipe-preview .ingredient-name {
    font-weight: 500;
}

.theia-recipe-preview .ingredient-note {
    font-size: 12px;
    color: #6b7280;
    font-style: italic;
    margin-left: 4px;
}

.theia-recipe-preview .ingredient-quantity {
    color: #c2410c;
    font-weight: 600;
    margin-left: 8px;
    white-space: nowrap;
}

/* Cookware list */
.theia-recipe-preview .cookware-item {
    padding: 6px 10px;
    border-radius: 8px;
    background: #f0fdf4;
    margin-bottom: 6px;
    font-weight: 500;
}

/* Instructions panel */
.theia-recipe-preview .recipe-instructions {
    border: 1px solid var(--theia-panel-border, #e5e7eb);
    border-radius: 12px;
    padding: 20px;
    background: var(--theia-editorWidget-background, #ffffff);
}

.theia-recipe-preview .instructions-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 16px;
    color: #ea580c;
}

.theia-recipe-preview .section-header {
    font-size: 17px;
    font-weight: 600;
    color: #c2410c;
    border-bottom: 2px solid #fed7aa;
    padding-bottom: 6px;
    margin-top: 20px;
    margin-bottom: 12px;
}

/* Step */
.theia-recipe-preview .step-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    background: #fafaf9;
    margin-bottom: 12px;
}

.theia-recipe-preview .step-number {
    width: 32px;
    height: 32px;
    min-width: 32px;
    background: linear-gradient(135deg, #ff6b35, #f97316);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
}

.theia-recipe-preview .step-content {
    flex: 1;
    line-height: 1.8;
}

/* Inline badges */
.theia-recipe-preview .ingredient-badge {
    display: inline;
    padding: 1px 6px;
    border-radius: 4px;
    background: linear-gradient(135deg, #fef3c7, #fed7aa);
    border: 1px solid #fbbf24;
    font-weight: 500;
    font-size: 13px;
}

.theia-recipe-preview .cookware-badge {
    display: inline;
    padding: 1px 6px;
    border-radius: 4px;
    background: linear-gradient(135deg, #dcfce7, #bbf7d0);
    border: 1px solid #4ade80;
    font-weight: 500;
    font-size: 13px;
}

.theia-recipe-preview .timer-badge {
    display: inline;
    padding: 1px 6px;
    border-radius: 4px;
    background: linear-gradient(135deg, #fee2e2, #fecaca);
    border: 1px solid #f87171;
    font-weight: 500;
    font-size: 13px;
}

/* Note block */
.theia-recipe-preview .note-item {
    padding: 12px;
    border-radius: 12px;
    background: #eff6ff;
    border-left: 4px solid #60a5fa;
    margin-bottom: 12px;
    font-style: italic;
    color: #374151;
}

/* Step ingredients summary */
.theia-recipe-preview .step-ingredients {
    font-size: 12px;
    color: #6b7280;
    margin-top: 8px;
    padding-left: 12px;
    border-left: 2px solid #fed7aa;
}

/* Error/empty states */
.theia-recipe-preview .recipe-error {
    padding: 16px;
    border-radius: 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
}

.theia-recipe-preview .recipe-empty {
    padding: 32px;
    text-align: center;
    color: #9ca3af;
    font-style: italic;
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/style/recipe-preview.css
git commit -m "feat(cooklang): add CSS stylesheet for recipe preview widget"
```

---

### Task 6: Create React rendering components

**Files:**
- Create: `packages/cooklang/src/browser/recipe-preview-components.tsx`

**Step 1: Create the React components file**

Create `packages/cooklang/src/browser/recipe-preview-components.tsx`. This file contains pure React components for rendering the recipe layout. Each component is a function component receiving typed props. The components are:

- `RecipeView` — top-level component: title, tags, description, metadata, grid
- `MetadataPills` — renders metadata pills from `recipe.metadata.map`
- `IngredientsSidebar` — left column: ingredients grouped by section + cookware
- `InstructionsPanel` — right column: sections with numbered steps and notes
- `StepItemView` — renders a single step item (text, ingredient badge, cookware badge, timer badge)

Key implementation notes:
- Import React as `import * as React from '@theia/core/shared/react';`
- Import recipe types from `'../common/recipe-types'`
- The `RecipeView` component receives `{ recipe: Recipe; fileName: string }` props
- Recipe name is derived from `recipe.metadata.map.name` falling back to `fileName`
- Tags come from `recipe.metadata.map.tags` (can be string or string[])
- Steps within sections use the `content` array which contains `{ type: 'step' | 'text', value }` items
- Step items reference ingredients/cookware/timers by index into the recipe-level arrays
- Each ingredient/cookware/timer badge is rendered inline within step text
- The `formatQuantity` helper from `recipe-types.ts` is used for displaying quantities
- Metadata pills are rendered for known keys (servings, time, prep_time, cook_time, difficulty, cuisine, course, diet, author, source) plus any remaining custom keys

The full component tree renders as:
```
RecipeView
├── recipe-title (h1)
├── recipe-tags (tag pills)
├── recipe-description (if present)
├── recipe-metadata (MetadataPills)
└── recipe-grid
    ├── IngredientsSidebar
    │   ├── Ingredients (grouped by section if >1 section)
    │   └── Cookware list
    └── InstructionsPanel
        └── For each section:
            ├── Section header (if named)
            └── For each content item:
                ├── Step (step-number + StepItemView[] + step-ingredients)
                └── Note (note-item block)
```

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import * as React from '@theia/core/shared/react';
import {
    Recipe, Section, Step, StepItem, Ingredient, Cookware,
    Timer, Quantity, ContentItem, formatQuantity
} from '../common/recipe-types';

export interface RecipeViewProps {
    recipe: Recipe;
    fileName: string;
}

export function RecipeView({ recipe, fileName }: RecipeViewProps): React.ReactElement {
    const metadata = recipe.metadata.map;
    const name = (metadata.name as string) || fileName.replace(/\.cook$/, '');
    const tags = extractTags(metadata);
    const description = metadata.description as string | undefined;

    return (
        <div>
            <h1 className='recipe-title'>{name}</h1>
            {tags.length > 0 && (
                <div className='recipe-tags'>
                    {tags.map((tag, i) => <span key={i} className='recipe-tag'>#{tag}</span>)}
                </div>
            )}
            {description && <div className='recipe-description'>{description}</div>}
            <MetadataPills metadata={metadata} />
            <div className='recipe-grid'>
                <IngredientsSidebar
                    sections={recipe.sections}
                    ingredients={recipe.ingredients}
                    cookware={recipe.cookware}
                />
                <InstructionsPanel
                    sections={recipe.sections}
                    ingredients={recipe.ingredients}
                    cookware={recipe.cookware}
                    timers={recipe.timers}
                    inlineQuantities={recipe.inline_quantities}
                />
            </div>
        </div>
    );
}

function extractTags(metadata: Record<string, unknown>): string[] {
    const raw = metadata.tags ?? metadata.tag;
    if (!raw) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw.map(String);
    }
    if (typeof raw === 'string') {
        return raw.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
}

const KNOWN_METADATA: Array<{ key: string; label: string }> = [
    { key: 'servings', label: 'Servings' },
    { key: 'time', label: 'Time' },
    { key: 'prep_time', label: 'Prep Time' },
    { key: 'cook_time', label: 'Cook Time' },
    { key: 'difficulty', label: 'Difficulty' },
    { key: 'cuisine', label: 'Cuisine' },
    { key: 'course', label: 'Course' },
    { key: 'diet', label: 'Diet' },
    { key: 'author', label: 'Author' },
    { key: 'source', label: 'Source' },
];

const SKIP_METADATA_KEYS = new Set([
    'name', 'tags', 'tag', 'description', 'images', 'image', 'locale',
    ...KNOWN_METADATA.map(m => m.key)
]);

function MetadataPills({ metadata }: { metadata: Record<string, unknown> }): React.ReactElement | null {
    const pills: Array<{ label: string; value: string }> = [];

    for (const { key, label } of KNOWN_METADATA) {
        const val = metadata[key];
        if (val !== undefined && val !== null) {
            pills.push({ label, value: String(val) });
        }
    }

    // Custom metadata
    for (const [key, val] of Object.entries(metadata)) {
        if (!SKIP_METADATA_KEYS.has(key) && val !== undefined && val !== null) {
            pills.push({ label: key, value: String(val) });
        }
    }

    if (pills.length === 0) {
        return null;
    }

    return (
        <div className='recipe-metadata'>
            {pills.map((pill, i) => (
                <span key={i} className='metadata-pill'>
                    {pill.label}: {pill.value}
                </span>
            ))}
        </div>
    );
}

interface SidebarProps {
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
}

function IngredientsSidebar({ sections, ingredients, cookware }: SidebarProps): React.ReactElement {
    const hasMultipleSections = sections.length > 1;

    return (
        <div className='recipe-sidebar'>
            <div className='sidebar-title'>Ingredients</div>
            {hasMultipleSections ? (
                sections.map((section, si) => {
                    const sectionIngredients = getSectionIngredients(section, ingredients);
                    if (sectionIngredients.length === 0) {
                        return null;
                    }
                    return (
                        <div key={si}>
                            {section.name && <div className='section-subtitle'>{section.name}</div>}
                            <IngredientList items={sectionIngredients} />
                        </div>
                    );
                })
            ) : (
                <IngredientList items={ingredients} />
            )}
            {cookware.length > 0 && (
                <>
                    <div className='sidebar-title cookware-title'>Cookware</div>
                    <ul className='ingredient-list'>
                        {cookware.map((cw, i) => (
                            <li key={i} className='cookware-item'>
                                {cw.alias || cw.name}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}

function IngredientList({ items }: { items: Ingredient[] }): React.ReactElement {
    return (
        <ul className='ingredient-list'>
            {items.map((ing, i) => (
                <li key={i} className='ingredient-item'>
                    <div>
                        <span className='ingredient-name'>{ing.alias || ing.name}</span>
                        {ing.note && <span className='ingredient-note'>({ing.note})</span>}
                    </div>
                    <span className='ingredient-quantity'>{formatQuantity(ing.quantity)}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * Extract ingredient indices referenced in a section's steps and return the
 * corresponding Ingredient objects from the recipe-level array.
 */
function getSectionIngredients(section: Section, allIngredients: Ingredient[]): Ingredient[] {
    const indices = new Set<number>();
    for (const content of section.content) {
        if (content.type === 'step') {
            const step = content.value as Step;
            for (const item of step.items) {
                if (item.type === 'ingredient' && item.index !== undefined) {
                    indices.add(item.index);
                }
            }
        }
    }
    return Array.from(indices).sort((a, b) => a - b).map(i => allIngredients[i]).filter(Boolean);
}

interface InstructionsProps {
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: Quantity[];
}

function InstructionsPanel({ sections, ingredients, cookware, timers, inlineQuantities }: InstructionsProps): React.ReactElement {
    return (
        <div className='recipe-instructions'>
            <div className='instructions-title'>Instructions</div>
            {sections.map((section, si) => (
                <div key={si}>
                    {section.name && <div className='section-header'>{section.name}</div>}
                    {section.content.map((content, ci) => (
                        <ContentItemView
                            key={ci}
                            content={content}
                            ingredients={ingredients}
                            cookware={cookware}
                            timers={timers}
                            inlineQuantities={inlineQuantities}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

interface ContentItemViewProps {
    content: ContentItem;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: Quantity[];
}

function ContentItemView({ content, ingredients, cookware, timers, inlineQuantities }: ContentItemViewProps): React.ReactElement | null {
    if (content.type === 'text') {
        const text = content.value as string;
        return <div className='note-item'>{text}</div>;
    }

    const step = content.value as Step;
    const stepIngredientIndices = new Set<number>();
    for (const item of step.items) {
        if (item.type === 'ingredient' && item.index !== undefined) {
            stepIngredientIndices.add(item.index);
        }
    }
    const stepIngredients = Array.from(stepIngredientIndices)
        .map(i => ingredients[i])
        .filter(Boolean);

    return (
        <div className='step-item'>
            <div className='step-number'>{step.number}</div>
            <div className='step-content'>
                <div>
                    {step.items.map((item, i) => (
                        <StepItemView
                            key={i}
                            item={item}
                            ingredients={ingredients}
                            cookware={cookware}
                            timers={timers}
                            inlineQuantities={inlineQuantities}
                        />
                    ))}
                </div>
                {stepIngredients.length > 0 && (
                    <div className='step-ingredients'>
                        {stepIngredients.map((ing, i) => (
                            <span key={i}>
                                {ing.alias || ing.name}
                                {ing.quantity ? `: ${formatQuantity(ing.quantity)}` : ''}
                                {i < stepIngredients.length - 1 ? ', ' : ''}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

interface StepItemViewProps {
    item: StepItem;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: Quantity[];
}

function StepItemView({ item, ingredients, cookware, timers, inlineQuantities }: StepItemViewProps): React.ReactElement | null {
    switch (item.type) {
        case 'text':
            return <>{item.value}</>;
        case 'ingredient': {
            const ing = item.index !== undefined ? ingredients[item.index] : undefined;
            return <span className='ingredient-badge'>{ing ? (ing.alias || ing.name) : '?'}</span>;
        }
        case 'cookware': {
            const cw = item.index !== undefined ? cookware[item.index] : undefined;
            return <span className='cookware-badge'>{cw ? (cw.alias || cw.name) : '?'}</span>;
        }
        case 'timer': {
            const tm = item.index !== undefined ? timers[item.index] : undefined;
            const label = tm ? (tm.name || formatQuantity(tm.quantity)) : '?';
            return <span className='timer-badge'>{label}</span>;
        }
        case 'inlineQuantity': {
            const qty = item.index !== undefined ? inlineQuantities[item.index] : undefined;
            return <strong>{qty ? formatQuantity(qty) : '?'}</strong>;
        }
        default:
            return null;
    }
}
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-components.tsx
git commit -m "feat(cooklang): add React components for recipe preview rendering"
```

---

### Task 7: Create the RecipePreviewWidget

**Files:**
- Create: `packages/cooklang/src/browser/recipe-preview-widget.tsx`

**Step 1: Create the widget file**

Create `packages/cooklang/src/browser/recipe-preview-widget.tsx`. This is a `ReactWidget` subclass that:

- Has a static `ID` prefix and `createId(uri)` helper
- Stores the source file `URI`
- Injects `CooklangLanguageService` for parsing and `EditorManager` for tracking content
- On `@postConstruct`, subscribes to `MonacoWorkspace` document change events (filtered to matching URI + cooklang language) with 300ms debounce
- Calls `this.service.parse(content)` and stores the deserialized `ParseResult`
- `render()` returns `<RecipeView>` if recipe is parsed, or an error/empty state
- `getResourceUri()` returns the tracked URI (implements `Navigatable`)
- On dispose, cleans up listeners

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct, interfaces } from '@theia/core/shared/inversify';
import { ReactWidget, Widget } from '@theia/core/lib/browser';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { DisposableCollection, Disposable } from '@theia/core/lib/common/disposable';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID } from '../common';
import { ParseResult, Recipe } from '../common/recipe-types';
import { RecipeView } from './recipe-preview-components';

import '../../src/browser/style/recipe-preview.css';

export const RECIPE_PREVIEW_WIDGET_ID = 'recipe-preview-widget';

export function createRecipePreviewWidgetId(uri: URI): string {
    return `${RECIPE_PREVIEW_WIDGET_ID}:${uri.toString()}`;
}

@injectable()
export class RecipePreviewWidget extends ReactWidget implements Navigatable {

    protected uri: URI;
    protected recipe: Recipe | undefined;
    protected parseErrors: string[] = [];
    protected readonly toDispose = new DisposableCollection();
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-recipe-preview');
        this.scrollOptions = { suppressScrollX: true };
        this.listenToDocumentChanges();
    }

    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createRecipePreviewWidgetId(uri);
        const fileName = uri.path.base;
        this.title.label = `Preview: ${fileName}`;
        this.title.caption = `Recipe Preview - ${fileName}`;
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
        this.toDispose.push(this.monacoWorkspace.onDidChangeTextDocument(event => {
            if (!this.uri) {
                return;
            }
            if (event.model.uri !== this.uri.toString()) {
                return;
            }
            if (event.model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            this.debouncedParse(event.model.getText());
        }));

        this.toDispose.push(this.monacoWorkspace.onDidOpenTextDocument(model => {
            if (!this.uri) {
                return;
            }
            if (model.uri !== this.uri.toString()) {
                return;
            }
            if (model.languageId !== COOKLANG_LANGUAGE_ID) {
                return;
            }
            this.parseContent(model.getText());
        }));
    }

    protected debouncedParse(content: string): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.parseContent(content);
        }, 300);
    }

    protected async parseCurrentContent(): Promise<void> {
        if (!this.uri) {
            return;
        }
        const model = monaco.editor.getModels().find(m => m.uri.toString() === this.uri.toString());
        if (model) {
            await this.parseContent(model.getValue());
        }
    }

    protected async parseContent(content: string): Promise<void> {
        try {
            const json = await this.service.parse(content);
            const result: ParseResult = JSON.parse(json);
            this.recipe = result.recipe ?? undefined;
            this.parseErrors = result.errors.map(e => e.message);
        } catch (error) {
            this.recipe = undefined;
            this.parseErrors = [String(error)];
        }
        this.update();
    }

    protected render(): React.ReactNode {
        if (this.recipe) {
            const fileName = this.uri ? this.uri.path.base : 'Recipe';
            return <RecipeView recipe={this.recipe} fileName={fileName} />;
        }
        if (this.parseErrors.length > 0) {
            return (
                <div className='recipe-error'>
                    <strong>Parse errors:</strong>
                    <ul>{this.parseErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            );
        }
        return <div className='recipe-empty'>Open a .cook file to see the recipe preview.</div>;
    }

    override dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.toDispose.dispose();
        super.dispose();
    }
}

export function createRecipePreviewWidget(container: interfaces.Container, uri: URI): RecipePreviewWidget {
    const child = container.createChild();
    child.bind(RecipePreviewWidget).toSelf();
    const widget = child.get(RecipePreviewWidget);
    widget.setUri(uri);
    return widget;
}
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-widget.tsx
git commit -m "feat(cooklang): add RecipePreviewWidget with live parsing"
```

---

### Task 8: Create commands and contribution

**Files:**
- Create: `packages/cooklang/src/browser/recipe-preview-contribution.ts`

**Step 1: Create the contribution file**

Create `packages/cooklang/src/browser/recipe-preview-contribution.ts`. This file:

- Defines two commands: `cooklang.togglePreview` and `cooklang.openPreviewSide`
- Implements `CommandContribution` and `KeybindingContribution`
- Injects `EditorManager`, `ApplicationShell`, and `WidgetManager`
- The toggle command: if active widget is an editor with cooklang language, opens preview in same area; if active widget is already a preview, activates the editor
- The side command: opens preview in the right split
- Both commands only enabled when there's an active cooklang editor or the active widget is a recipe preview
- Uses `WidgetManager.getOrCreateWidget` with a factory ID to create/find the preview widget

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID } from '../common';
import {
    RecipePreviewWidget,
    RECIPE_PREVIEW_WIDGET_ID,
    createRecipePreviewWidgetId
} from './recipe-preview-widget';

export namespace CooklangPreviewCommands {
    export const TOGGLE_PREVIEW: Command = {
        id: 'cooklang.togglePreview',
        label: 'Cooklang: Toggle Preview',
        iconClass: 'codicon codicon-open-preview',
    };
    export const OPEN_PREVIEW_SIDE: Command = {
        id: 'cooklang.openPreviewSide',
        label: 'Cooklang: Open Preview to the Side',
        iconClass: 'codicon codicon-open-preview',
    };
}

@injectable()
export class RecipePreviewContribution implements CommandContribution, KeybindingContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CooklangPreviewCommands.TOGGLE_PREVIEW, {
            execute: () => this.togglePreview(),
            isEnabled: () => this.canPreview(),
            isVisible: () => this.canPreview(),
        });

        registry.registerCommand(CooklangPreviewCommands.OPEN_PREVIEW_SIDE, {
            execute: () => this.openPreviewSide(),
            isEnabled: () => this.canPreview(),
            isVisible: () => this.canPreview(),
        });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({
            command: CooklangPreviewCommands.TOGGLE_PREVIEW.id,
            keybinding: 'ctrlcmd+shift+v',
            when: 'editorLangId == cooklang',
        });
        registry.registerKeybinding({
            command: CooklangPreviewCommands.OPEN_PREVIEW_SIDE.id,
            keybinding: 'ctrlcmd+k v',
            when: 'editorLangId == cooklang',
        });
    }

    protected canPreview(): boolean {
        const current = this.shell.currentWidget;
        if (current instanceof RecipePreviewWidget) {
            return true;
        }
        return this.getActiveCooklangEditorUri() !== undefined;
    }

    protected getActiveCooklangEditorUri(): URI | undefined {
        const editor = this.editorManager.currentEditor;
        if (!editor) {
            return undefined;
        }
        const model = editor.editor?.document;
        if (model && model.languageId === COOKLANG_LANGUAGE_ID) {
            return editor.getResourceUri();
        }
        return undefined;
    }

    protected async togglePreview(): Promise<void> {
        const current = this.shell.currentWidget;

        // If active widget is a preview, switch back to editor
        if (current instanceof RecipePreviewWidget) {
            const uri = current.getResourceUri();
            if (uri) {
                await this.editorManager.open(uri, { mode: 'activate' });
            }
            return;
        }

        // If active widget is a cooklang editor, open preview
        const uri = this.getActiveCooklangEditorUri();
        if (uri) {
            const preview = await this.getOrCreatePreview(uri);
            await this.shell.addWidget(preview, { area: 'main' });
            this.shell.activateWidget(preview.id);
        }
    }

    protected async openPreviewSide(): Promise<void> {
        const uri = this.getActiveCooklangEditorUri();
        if (!uri) {
            return;
        }
        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main', mode: 'split-right' });
        this.shell.activateWidget(preview.id);
    }

    protected async getOrCreatePreview(uri: URI): Promise<RecipePreviewWidget> {
        const widgetId = createRecipePreviewWidgetId(uri);
        const existing = this.widgetManager.tryGetWidget<RecipePreviewWidget>(widgetId);
        if (existing) {
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<RecipePreviewWidget>(
            RECIPE_PREVIEW_WIDGET_ID,
            { uri: uri.toString() }
        );
    }
}
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-contribution.ts
git commit -m "feat(cooklang): add preview toggle and side-by-side commands"
```

---

### Task 9: Wire everything into the frontend DI module

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Update the frontend module**

Replace the contents of `packages/cooklang/src/browser/cooklang-frontend-module.ts` with the following. The key additions are:
- Import and bind `RecipePreviewWidget` with a `WidgetFactory`
- Import and bind `RecipePreviewContribution` as `CommandContribution` and `KeybindingContribution`
- The `WidgetFactory` uses `createRecipePreviewWidget` to create widget instances with the URI from options

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import URI from '@theia/core/lib/common/uri';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';
import { CooklangLanguageClientContribution } from './cooklang-language-client-contribution';
import { CooklangLanguageService, CooklangLanguageServicePath } from '../common/cooklang-language-service';
import { RECIPE_PREVIEW_WIDGET_ID, createRecipePreviewWidget } from './recipe-preview-widget';
import { RecipePreviewContribution } from './recipe-preview-contribution';

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
});
```

**Step 2: Compile to verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): wire recipe preview widget into DI container"
```

---

### Task 10: Build and test the Electron app

**Step 1: Full compile**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: SUCCESS

**Step 2: Bundle the Electron app**

Run: `cd examples/electron && npm run bundle`
Expected: SUCCESS — src-gen/ regenerated with recipe preview widget bindings

**Step 3: Start and manually verify**

Run: `cd examples/electron && npm run start:electron`

Manual test checklist:
1. Open a `.cook` file in the editor
2. Open the command palette (`Ctrl+Shift+P`) and run "Cooklang: Toggle Preview"
3. Verify the recipe preview appears in the same tab area
4. Verify ingredients, cookware, steps, and metadata render correctly
5. Run "Cooklang: Toggle Preview" again — verify it switches back to the editor
6. Open the editor again, then run "Cooklang: Open Preview to the Side" (`Ctrl+K V`)
7. Verify the preview opens in a split panel to the right
8. Edit the recipe in the editor — verify the preview updates after ~300ms
9. Close the preview tab — verify no errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(cooklang): recipe preview widget with toggle and side-by-side modes

Adds a rich recipe details preview that renders parsed .cook files
matching the cookcli web UI layout. Includes ingredients sidebar,
numbered instruction steps with inline badges, metadata pills,
and live updating with 300ms debounce."
```
