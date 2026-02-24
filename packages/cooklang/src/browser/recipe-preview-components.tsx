// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import * as React from '@theia/core/shared/react';
import {
    Recipe,
    Section,
    SectionContent,
    StepItem,
    Ingredient,
    Cookware,
    Timer,
    InlineQuantity,
    formatQuantity,
} from '../common/recipe-types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SKIP_META_KEYS = new Set([
    'name', 'tags', 'tag', 'description', 'images', 'image', 'locale',
]);

const KNOWN_META_KEYS: ReadonlyArray<string> = [
    'servings', 'time', 'prep_time', 'cook_time', 'difficulty',
    'cuisine', 'course', 'diet', 'author', 'source',
];

const META_KEY_LABELS: Record<string, string> = {
    servings: 'Servings',
    time: 'Time',
    prep_time: 'Prep',
    cook_time: 'Cook',
    difficulty: 'Difficulty',
    cuisine: 'Cuisine',
    course: 'Course',
    diet: 'Diet',
    author: 'Author',
    source: 'Source',
};

/**
 * Collect the unique set of ingredient indices referenced by all steps in a
 * section, preserving first-seen order.
 */
function ingredientIndicesForSection(section: Section): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const content of section.content) {
        if (content.type !== 'step') {
            continue;
        }
        for (const item of content.value.items) {
            if (item.type === 'ingredient' && !seen.has(item.index)) {
                seen.add(item.index);
                result.push(item.index);
            }
        }
    }
    return result;
}

/**
 * Format a timer for display. Uses the timer name when present, falls back to
 * the formatted quantity, and ultimately to an empty string.
 */
function formatTimer(timer: Timer): string {
    if (timer.name) {
        return timer.name;
    }
    if (timer.quantity !== null) {
        return formatQuantity(timer.quantity);
    }
    return '';
}

// ---------------------------------------------------------------------------
// StepItemView
// ---------------------------------------------------------------------------

interface StepItemViewProps {
    item: StepItem;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
}

const StepItemView = ({ item, ingredients, cookware, timers, inlineQuantities }: StepItemViewProps): React.ReactElement => {
    switch (item.type) {
        case 'text':
            return <React.Fragment>{item.value}</React.Fragment>;

        case 'ingredient': {
            const ing = ingredients[item.index];
            const displayName = ing ? (ing.alias ?? ing.name) : `ingredient[${item.index}]`;
            return <span className='ingredient-badge'>{displayName}</span>;
        }

        case 'cookware': {
            const cw = cookware[item.index];
            const displayName = cw ? (cw.alias ?? cw.name) : `cookware[${item.index}]`;
            return <span className='cookware-badge'>{displayName}</span>;
        }

        case 'timer': {
            const timer = timers[item.index];
            const displayText = timer ? formatTimer(timer) : `timer[${item.index}]`;
            return <span className='timer-badge'>{displayText}</span>;
        }

        case 'inlineQuantity': {
            const iq = inlineQuantities[item.index];
            const displayText = iq ? formatQuantity(iq) : `qty[${item.index}]`;
            return <strong>{displayText}</strong>;
        }
    }
};

// ---------------------------------------------------------------------------
// StepIngredientsSummary  (small list below a step)
// ---------------------------------------------------------------------------

interface StepIngredientsSummaryProps {
    items: StepItem[];
    ingredients: Ingredient[];
}

const StepIngredientsSummary = ({ items, ingredients }: StepIngredientsSummaryProps): React.ReactElement | null => {
    const ingItems = items.filter((i): i is Extract<StepItem, { type: 'ingredient' }> => i.type === 'ingredient');
    if (ingItems.length === 0) {
        return null;
    }
    const parts = ingItems.map(i => {
        const ing = ingredients[i.index];
        if (!ing) {
            return null;
        }
        const qty = formatQuantity(ing.quantity);
        const name = ing.alias ?? ing.name;
        const note = ing.note ? ` (${ing.note})` : '';
        return qty ? `${name}: ${qty}${note}` : `${name}${note}`;
    }).filter((p): p is string => p !== null);

    if (parts.length === 0) {
        return null;
    }

    return (
        <div className='step-ingredients'>
            {parts.join(' · ')}
        </div>
    );
};

// ---------------------------------------------------------------------------
// SectionContentView  (single step or text note)
// ---------------------------------------------------------------------------

interface SectionContentViewProps {
    content: SectionContent;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
}

const SectionContentView = ({
    content,
    ingredients,
    cookware,
    timers,
    inlineQuantities,
}: SectionContentViewProps): React.ReactElement => {
    if (content.type === 'text') {
        return <div className='note-item'>{content.value}</div>;
    }

    const { items, number } = content.value;
    return (
        <div className='step-item'>
            <div className='step-number'>{number}</div>
            <div className='step-content'>
                {items.map((item, idx) => (
                    <StepItemView
                        key={idx}
                        item={item}
                        ingredients={ingredients}
                        cookware={cookware}
                        timers={timers}
                        inlineQuantities={inlineQuantities}
                    />
                ))}
                <StepIngredientsSummary items={items} ingredients={ingredients} />
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// InstructionsPanel
// ---------------------------------------------------------------------------

interface InstructionsPanelProps {
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
}

export const InstructionsPanel = ({
    sections,
    ingredients,
    cookware,
    timers,
    inlineQuantities,
}: InstructionsPanelProps): React.ReactElement => (
    <div className='recipe-instructions'>
        <h2 className='instructions-title'>Instructions</h2>
        {sections.map((section, sIdx) => (
            <React.Fragment key={sIdx}>
                {section.name && (
                    <h3 className='section-header'>{section.name}</h3>
                )}
                {section.content.map((content, cIdx) => (
                    <SectionContentView
                        key={cIdx}
                        content={content}
                        ingredients={ingredients}
                        cookware={cookware}
                        timers={timers}
                        inlineQuantities={inlineQuantities}
                    />
                ))}
            </React.Fragment>
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// IngredientRow
// ---------------------------------------------------------------------------

interface IngredientRowProps {
    ingredient: Ingredient;
}

const IngredientRow = ({ ingredient }: IngredientRowProps): React.ReactElement => {
    const qty = formatQuantity(ingredient.quantity);
    return (
        <li className='ingredient-item'>
            <span className='ingredient-name'>
                {ingredient.alias ?? ingredient.name}
                {ingredient.note && (
                    <span className='ingredient-note'> ({ingredient.note})</span>
                )}
            </span>
            {qty && <span className='ingredient-quantity'>{qty}</span>}
        </li>
    );
};

// ---------------------------------------------------------------------------
// IngredientsSidebar
// ---------------------------------------------------------------------------

interface IngredientsSidebarProps {
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
}

export const IngredientsSidebar = ({
    sections,
    ingredients,
    cookware,
}: IngredientsSidebarProps): React.ReactElement => {
    const multiSection = sections.length > 1;

    const renderIngredientList = (indices: number[]): React.ReactElement => (
        <ul className='ingredient-list'>
            {indices.map(idx => (
                ingredients[idx] && (
                    <IngredientRow key={idx} ingredient={ingredients[idx]} />
                )
            ))}
        </ul>
    );

    return (
        <aside className='recipe-sidebar'>
            <h2 className='sidebar-title'>Ingredients</h2>

            {multiSection ? (
                sections.map((section, sIdx) => {
                    const indices = ingredientIndicesForSection(section);
                    if (indices.length === 0) {
                        return null;
                    }
                    return (
                        <React.Fragment key={sIdx}>
                            {section.name && (
                                <h3 className='section-subtitle'>{section.name}</h3>
                            )}
                            {renderIngredientList(indices)}
                        </React.Fragment>
                    );
                })
            ) : (
                renderIngredientList(ingredients.map((_, i) => i))
            )}

            {cookware.length > 0 && (
                <>
                    <h2 className='sidebar-title cookware-title'>Cookware</h2>
                    {cookware.map((cw, idx) => (
                        <div key={idx} className='cookware-item'>
                            {cw.alias ?? cw.name}
                            {cw.quantity && (
                                <span className='ingredient-quantity'> {formatQuantity(cw.quantity)}</span>
                            )}
                        </div>
                    ))}
                </>
            )}
        </aside>
    );
};

// ---------------------------------------------------------------------------
// MetadataPills
// ---------------------------------------------------------------------------

interface MetadataPillsProps {
    meta: Record<string, unknown>;
}

export const MetadataPills = ({ meta }: MetadataPillsProps): React.ReactElement | null => {
    const pills: Array<{ label: string; value: string }> = [];

    // Render well-known keys first, in order.
    for (const key of KNOWN_META_KEYS) {
        if (key in meta) {
            const raw = meta[key];
            if (raw !== undefined && raw !== null && raw !== '') {
                pills.push({ label: META_KEY_LABELS[key] ?? key, value: String(raw) });
            }
        }
    }

    // Render any remaining custom keys.
    for (const key of Object.keys(meta)) {
        if (SKIP_META_KEYS.has(key) || KNOWN_META_KEYS.includes(key)) {
            continue;
        }
        const raw = meta[key];
        if (raw !== undefined && raw !== null && raw !== '') {
            const label = key.replace(/_/g, ' ');
            pills.push({ label, value: String(raw) });
        }
    }

    if (pills.length === 0) {
        return null;
    }

    return (
        <div className='recipe-metadata'>
            {pills.map((pill, idx) => (
                <span key={idx} className='metadata-pill'>
                    <strong>{pill.label}:</strong> {pill.value}
                </span>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// RecipeView  (top-level export)
// ---------------------------------------------------------------------------

export interface RecipeViewProps {
    recipe: Recipe;
    fileName: string;
}

export const RecipeView = ({ recipe, fileName }: RecipeViewProps): React.ReactElement => {
    const meta = recipe.metadata.map;

    // Derive title from metadata or strip the .cook extension from the filename.
    const title = meta['name']
        ? String(meta['name'])
        : fileName.replace(/\.cook$/i, '');

    // Tags can be a single string or an array; try both 'tags' and 'tag'.
    const rawTags = meta['tags'] ?? meta['tag'];
    const tags: string[] = Array.isArray(rawTags)
        ? rawTags.map(String)
        : typeof rawTags === 'string' && rawTags.trim() !== ''
            ? [rawTags]
            : [];

    const description = meta['description'] ? String(meta['description']) : undefined;

    return (
        <div>
            <h1 className='recipe-title'>{title}</h1>

            {tags.length > 0 && (
                <div className='recipe-tags'>
                    {tags.map((tag, idx) => (
                        <span key={idx} className='recipe-tag'>{tag}</span>
                    ))}
                </div>
            )}

            {description && (
                <p className='recipe-description'>{description}</p>
            )}

            <MetadataPills meta={meta} />

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
};
