// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

/* eslint-disable no-null/no-null */

// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import {
    ShoppingListRecipeItem,
    ShoppingListResult,
    ShoppingListCategory,
    ShoppingListItem,
} from '../common/shopping-list-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a human-friendly display name from a recipe path. */
function displayNameFromPath(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.(cook|menu)$/i, '');
}

// ---------------------------------------------------------------------------
// RecipeListPanel
// ---------------------------------------------------------------------------

interface RecipeListPanelProps {
    items: readonly ShoppingListRecipeItem[];
    onRemove: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
}

export const RecipeListPanel = ({
    items,
    onRemove,
    onScaleChange,
    onClearAll,
}: RecipeListPanelProps): React.ReactElement => {
    if (items.length === 0) {
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
            {items.map((item, idx) => {
                const name = displayNameFromPath(item.path);
                const isMenu = item.children.length > 0 && item.path.toLowerCase().endsWith('.menu');
                const scale = item.multiplier ?? 1;
                return (
                    <div key={`${item.path}-${idx}`} className='shopping-list-recipe-row'>
                        <div className='shopping-list-recipe-main'>
                            <span className='shopping-list-recipe-name'>{name}</span>
                            {isMenu && (
                                <span className='shopping-list-recipe-sub'>
                                    menu ({item.children.length} recipes)
                                </span>
                            )}
                        </div>
                        <input
                            className='shopping-list-scale-input'
                            type='number'
                            min='0.5'
                            max='100'
                            step='0.5'
                            defaultValue={scale}
                            onBlur={e => {
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
                );
            })}
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
    if (category.items.length === 0) { return null; }
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
// PantrySection (unchanged)
// ---------------------------------------------------------------------------

interface PantrySectionProps {
    pantryItems: string[];
}

export const PantrySection = ({ pantryItems }: PantrySectionProps): React.ReactElement | null => {
    const [expanded, setExpanded] = React.useState(false);
    if (pantryItems.length === 0) { return null; }
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
    items: readonly ShoppingListRecipeItem[];
    result: ShoppingListResult | undefined;
    checkedItems: Set<string>;
    onRemoveRecipe: (index: number) => void;
    onScaleChange: (index: number, scale: number) => void;
    onClearAll: () => void;
    onToggleItem: (name: string) => void;
}

export const ShoppingListView = ({
    items,
    result,
    checkedItems,
    onRemoveRecipe,
    onScaleChange,
    onClearAll,
    onToggleItem,
}: ShoppingListViewProps): React.ReactElement => (
    <div className='shopping-list-content'>
        <RecipeListPanel
            items={items}
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
                        key='other'
                        category={{
                            ...result.other,
                            items: [...result.other.items].sort((a, b) => a.name.localeCompare(b.name)),
                        }}
                        checkedItems={checkedItems}
                        onToggle={onToggleItem}
                    />
                )}
                <PantrySection pantryItems={result.pantryItems} />
            </>
        )}
    </div>
);
