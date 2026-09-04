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

// The shell types this pulls in reach the Lumino widgets, which touch
// `document` while loading. See empty-file-detector.spec.ts.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { PreviewTabManager } from './preview-tab-manager';

const TEMPORARY_CLASS = 'cooklang-preview-tab-temporary';

/** A stand-in for a preview widget: a tab title and a DOM node are all the manager touches. */
function widgetWith(html: string = '<p>Boil water</p>'): BaseWidget {
    const node = document.createElement('div');
    node.innerHTML = html;
    return {
        node,
        isAttached: true,
        title: { className: '' },
        onDidDispose: () => Disposable.NULL
    } as unknown as BaseWidget;
}

function isTemporary(widget: BaseWidget): boolean {
    return widget.title.className.includes(TEMPORARY_CLASS);
}

interface Handlers {
    handleClick(event: unknown): void;
    handleDoubleClick(event: unknown): void;
}

function managerWith(enablePreview: boolean = true): PreviewTabManager & Handlers {
    const manager = new PreviewTabManager();
    (manager as unknown as { preferenceService: unknown }).preferenceService = {
        get: (_name: string, defaultValue: boolean) => enablePreview ? defaultValue : false
    };
    return manager as PreviewTabManager & Handlers;
}

/** A click on `selector` within `widget`, shaped like the DOM events the manager listens for. */
function clickOn(widget: BaseWidget, selector: string): unknown {
    return { target: widget.node.querySelector(selector) };
}

describe('PreviewTabManager', () => {

    it('places the first preview in a tab of its own', () => {
        expect(managerWith().placement()).to.deep.equal({ area: 'main' });
    });

    it('gives a single-click preview the reusable tab', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        expect(isTemporary(recipe)).to.be.true;
        expect(manager.placement()).to.deep.equal({ area: 'main', mode: 'tab-replace', ref: recipe });
    });

    it('hands the reusable tab to the next single-click preview', () => {
        const manager = managerWith();
        const first = widgetWith();
        const second = widgetWith();
        manager.apply(first, { preview: true }, true);
        manager.apply(second, { preview: true }, true);
        expect(manager.placement()).to.deep.equal({ area: 'main', mode: 'tab-replace', ref: second });
        expect(isTemporary(second)).to.be.true;
    });

    it('opens a deliberately opened recipe in its own tab', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, undefined, true);
        expect(isTemporary(recipe)).to.be.false;
        expect(manager.placement()).to.deep.equal({ area: 'main' });
    });

    it('keeps the tab reusable when the same recipe is single-clicked again', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        manager.apply(recipe, { preview: true }, false);
        expect(isTemporary(recipe)).to.be.true;
    });

    it('pins the tab when the same recipe is opened deliberately', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        manager.apply(recipe, undefined, false);
        expect(isTemporary(recipe)).to.be.false;
        expect(manager.placement()).to.deep.equal({ area: 'main' });
    });

    it('leaves a tab that was already open alone', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, false);
        expect(isTemporary(recipe)).to.be.false;
    });

    it('pins the tab on an interaction with the recipe', () => {
        const manager = managerWith();
        const recipe = widgetWith('<p>Boil <span role="button">10 min</span></p>');
        manager.apply(recipe, { preview: true }, true);
        manager.handleClick(clickOn(recipe, '[role="button"]'));
        expect(isTemporary(recipe)).to.be.false;
    });

    it('keeps the tab reusable when the recipe is only read', () => {
        const manager = managerWith();
        const recipe = widgetWith('<p>Boil <span role="button">10 min</span></p>');
        manager.apply(recipe, { preview: true }, true);
        manager.handleClick(clickOn(recipe, 'p'));
        expect(isTemporary(recipe)).to.be.true;
    });

    it('pins the tab on a double click anywhere in the recipe', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        manager.handleDoubleClick(clickOn(recipe, 'p'));
        expect(isTemporary(recipe)).to.be.false;
    });

    it('ignores events outside the reusable tab', () => {
        const manager = managerWith();
        const recipe = widgetWith();
        const elsewhere = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        manager.handleDoubleClick(clickOn(elsewhere, 'p'));
        expect(isTemporary(recipe)).to.be.true;
    });

    it('opens every recipe in its own tab when preview tabs are turned off', () => {
        const manager = managerWith(false);
        const recipe = widgetWith();
        manager.apply(recipe, { preview: true }, true);
        expect(isTemporary(recipe)).to.be.false;
    });
});
