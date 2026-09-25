// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

// The widget module imports `MonacoWorkspace` and `FileService`, which need
// browser globals at require time. jsdom stays up for the whole run.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { Recipe } from '../common/recipe-types';
import { ResolvedRecipeImages } from '../common/recipe-images';
import { CooklangOutletService, OutletItem } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { RecipePreviewWidget } from './recipe-preview-widget';

const ROOT = new URI('file:///ws');
const HUB = new URI('cooklang-hub:/recipes/12/Pancakes.cook');
const LOCAL = new URI('file:///ws/Breakfast/Pancakes.cook');
const CONTENT = 'Mix @eggs{2}.';
const REMOTE_IMAGE = 'https://cdn.example/pancakes.jpg';

/** One ingredient that references another recipe, so link rendering is observable. */
const RECIPE: Recipe = {
    metadata: { map: {} },
    sections: [{ name: null, content: [] }],
    ingredients: [{ name: 'Syrup', alias: null, quantity: null, note: null, reference: { name: 'Syrup', components: ['Sauces'] } }],
    cookware: [],
    timers: [],
    inline_quantities: [],
};

interface PreviewInternals {
    init(): void;
    render(): React.ReactNode;
    previewContext(): unknown;
    handleRunToolbarItem(id: string): void;
    recipe: Recipe | undefined;
    images: ResolvedRecipeImages;
}

/** Poll until `condition` holds; the preview parses asynchronously and exposes no promise. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

/** A real preview widget over stubbed services, recording what it asked them. */
class PreviewHarness {
    readonly contextValues = new Map<string, unknown>();
    scopedTarget: HTMLElement | undefined;
    readonly watched: string[] = [];
    readonly nativeImageLookups: string[] = [];
    readonly contentImageLookups: string[] = [];
    readonly imageReads: string[] = [];
    readonly itemElements: Array<HTMLElement | undefined> = [];
    readonly runElements: Array<HTMLElement | undefined> = [];
    /** What `recipeImagesFromContent` reports as the title image. */
    contentImage: string | undefined = REMOTE_IMAGE;
    /** What `recipeImages` reports as the title image of a local recipe. */
    localImage: string | undefined;
    readonly widget: RecipePreviewWidget;

    constructor() {
        const never = new Emitter<unknown>().event;
        const outlets = new CooklangOutletService();
        Object.assign(outlets, {
            menus: { getMenu: () => undefined },
            workspaceService: { tryGetRoots: () => [{ resource: ROOT }] },
            getItems: (_path: MenuPath, _context: object, element?: HTMLElement): OutletItem[] => {
                this.itemElements.push(element);
                return [];
            },
            run: async (_path: MenuPath, _id: string, _context: object, element?: HTMLElement): Promise<void> => {
                this.runElements.push(element);
            },
        });
        const widget = new RecipePreviewWidget();
        Object.assign(widget, {
            service: {
                parse: async () => JSON.stringify({ recipe: RECIPE, title: 'Pancakes', errors: [], warnings: [] }),
                recipeImages: async (path: string) => {
                    this.nativeImageLookups.push(path);
                    return JSON.stringify({ title: this.localImage ?? null, steps: {} });
                },
                recipeImagesFromContent: async (content: string) => {
                    this.contentImageLookups.push(content);
                    return JSON.stringify({ title: this.contentImage ?? null, steps: {} });
                },
            },
            monacoWorkspace: { onDidChangeTextDocument: never, onDidOpenTextDocument: never, getTextDocument: () => undefined },
            fileService: {
                watch: (uri: URI) => {
                    this.watched.push(uri.toString());
                    return Disposable.NULL;
                },
                onDidFilesChange: never,
                read: async () => ({ value: CONTENT }),
            },
            imageService: {
                resolve: async (uri: URI) => {
                    this.imageReads.push(uri.toString());
                    return 'blob:fake/0';
                },
                release: () => undefined,
                releaseAll: () => undefined,
            },
            timerService: { onDidChangeTimers: never, list: () => [] },
            outlets,
            contextKeyService: {
                createScoped: (target: HTMLElement) => {
                    this.scopedTarget = target;
                    return {
                        setContext: (key: string, value: unknown) => { this.contextValues.set(key, value); },
                        dispose: () => undefined,
                    };
                },
            },
            // Markup is asserted with renderToStaticMarkup; the widget's own async render is not needed.
            update: () => undefined,
        });
        (widget as unknown as PreviewInternals).init();
        this.widget = widget;
    }

    get internals(): PreviewInternals {
        return this.widget as unknown as PreviewInternals;
    }

    /** Bind the preview to `uri` and wait until it parsed and refreshed its images. */
    async open(uri: URI): Promise<void> {
        this.widget.setUri(uri);
        await until(() => this.internals.recipe !== undefined);
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    markup(): string {
        return renderToStaticMarkup(this.internals.render() as React.ReactElement);
    }
}

describe('RecipePreviewWidget context key and outlets', () => {

    it('sets cooklangPreviewScheme on the preview element to the source scheme', async () => {
        const hub = new PreviewHarness();
        await hub.open(HUB);
        expect(hub.scopedTarget).to.equal(hub.widget.node);
        expect(hub.contextValues.get(CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY)).to.equal('cooklang-hub');

        const local = new PreviewHarness();
        await local.open(LOCAL);
        expect(local.contextValues.get('cooklangPreviewScheme')).to.equal('file');
    });

    it('updates cooklangPreviewScheme when the preview is re-bound to another URI', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        harness.widget.setUri(LOCAL);
        expect(harness.contextValues.get(CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY)).to.equal('file');
    });

    it('evaluates toolbar outlets against the preview element', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        harness.internals.render();
        harness.internals.handleRunToolbarItem('recipeHub.saveToDrafts');
        expect(harness.itemElements).to.deep.equal([harness.widget.node]);
        expect(harness.runElements).to.deep.equal([harness.widget.node]);
    });

    it('describes a remote recipe with its real URI and an empty path', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        expect(harness.internals.previewContext())
            .to.deep.equal({ version: 1, uri: 'cooklang-hub:/recipes/12/Pancakes.cook', path: '', scale: 1 });
    });
});

describe('RecipePreviewWidget for non-file recipes', () => {

    it('shows the metadata image of a remote recipe without touching the file system', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        expect(harness.internals.images.title).to.equal(REMOTE_IMAGE);
        expect(harness.contentImageLookups).to.deep.equal([CONTENT]);
        expect(harness.nativeImageLookups).to.deep.equal([]);
        expect(harness.watched).to.deep.equal([]);
        expect(harness.imageReads).to.deep.equal([]);
    });

    it('ignores a relative image path in a remote recipe', async () => {
        const harness = new PreviewHarness();
        harness.contentImage = 'Pancakes.jpg';
        await harness.open(HUB);
        expect(harness.contentImageLookups).to.deep.equal([CONTENT]);
        expect(harness.internals.images.title).to.be.undefined;
        expect(harness.imageReads).to.deep.equal([]);
    });

    it('never uses an http:, javascript: or data: value as an image src in a remote recipe', async () => {
        for (const value of ['http://cdn.example/pancakes.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '/etc/passwd']) {
            const harness = new PreviewHarness();
            harness.contentImage = value;
            await harness.open(HUB);
            expect(harness.contentImageLookups).to.deep.equal([CONTENT]);
            expect(harness.internals.images.title, value).to.be.undefined;
            expect(harness.imageReads, value).to.deep.equal([]);
        }
    });

    it('keeps the on-disk image lookup and folder watch for local recipes', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        expect(harness.nativeImageLookups).to.include(LOCAL.path.fsPath());
        expect(harness.contentImageLookups).to.deep.equal([]);
        expect(harness.watched).to.deep.equal(['file:///ws/Breakfast']);
    });

    it('still shows an http image named by a local recipe', async () => {
        const harness = new PreviewHarness();
        harness.localImage = 'http://cdn.example/pancakes.jpg';
        await harness.open(LOCAL);
        expect(harness.internals.images.title).to.equal('http://cdn.example/pancakes.jpg');
    });

    it('renders recipe references as plain text in a remote recipe', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        const markup = harness.markup();
        expect(markup).to.contain('Syrup');
        expect(markup).to.not.contain('ingredient-ref-link');
    });

    it('keeps recipe reference links in a local recipe', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        expect(harness.markup()).to.contain('ingredient-ref-link');
    });
});
