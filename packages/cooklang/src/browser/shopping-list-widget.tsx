// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

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
        void this.shoppingListService.removeRecipe(index);
    };

    protected handleScaleChange = (index: number, scale: number): void => {
        void this.shoppingListService.updateScale(index, scale);
    };

    protected handleClearAll = (): void => {
        void this.shoppingListService.clearAll();
    };

    protected handleToggleItem = (name: string): void => {
        if (this.shoppingListService.isChecked(name)) {
            void this.shoppingListService.uncheckItem(name);
        } else {
            void this.shoppingListService.checkItem(name);
        }
    };
}
