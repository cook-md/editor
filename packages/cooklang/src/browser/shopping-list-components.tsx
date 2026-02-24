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
