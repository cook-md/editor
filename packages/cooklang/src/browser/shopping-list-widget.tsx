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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
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
        this.title.iconClass = 'theia-shopping-cart-icon';
        this.title.closable = true;
        this.addClass('theia-shopping-list');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };

        this.toDispose.push(
            this.shoppingListService.onDidChange(() => this.update())
        );
        this.update();
    }

    protected render(): React.ReactNode {
        const items = this.shoppingListService.getItems();
        const result = this.shoppingListService.getResult();

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
                items={items}
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
        this.shoppingListService.removeRecipe(index).catch(err => console.error(err));
    };

    protected handleScaleChange = (index: number, scale: number): void => {
        this.shoppingListService.updateScale(index, scale).catch(err => console.error(err));
    };

    protected handleClearAll = (): void => {
        this.shoppingListService.clearAll().catch(err => console.error(err));
    };

    protected handleToggleItem = (name: string): void => {
        if (this.shoppingListService.isChecked(name)) {
            this.shoppingListService.uncheckItem(name).catch(err => console.error(err));
        } else {
            this.shoppingListService.checkItem(name).catch(err => console.error(err));
        }
    };
}
