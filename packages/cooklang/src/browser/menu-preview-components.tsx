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
                        <span className='menu-recipe-scale'>({'\u00D7'}{item.scale})</span>
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
    onShowSource?: () => void;
    onAddToShoppingList?: (scale: number) => void;
    onNavigateToRecipe?: (referencePath: string) => void;
}

export const MenuView = ({
    menuResult,
    fileName,
    scale,
    onScaleChange,
    onShowSource,
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
                    {onShowSource && (
                        <button
                            className='menu-add-shopping-list'
                            onClick={onShowSource}
                            title='Show Source'
                        >
                            <span className='codicon codicon-go-to-file'></span>
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
