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
import { PreviewBadge } from '../common/cooklang-outlet-context';
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

/** The badge-related internals exercised directly by `RecipePreviewWidget badges` below. */
interface BadgeInternals {
    outlets: { collectBadges: (menuPath: MenuPath, context: object, element?: HTMLElement) => Promise<PreviewBadge[]> };
    badgeDebounceMs: number;
    badges: PreviewBadge[];
    badgesStale: boolean;
    badgeHoverShown: boolean;
    badgeTimer: ReturnType<typeof setTimeout> | undefined;
    badgeSequence: number;
    refreshBadges(): Promise<void>;
    scheduleBadges(): void;
    handleShowBadgeDetails(badge: PreviewBadge, target: HTMLElement, immediate: boolean): void;
    handleHideBadgeDetails(): void;
    hideBadgeHover(): void;
    onAfterShow(msg: unknown): void;
    onAfterAttach(msg: unknown): void;
    onBeforeHide(msg: unknown): void;
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
    hoverCancelCount = 0;
    /** The `onHide` callback of the most recent `requestHover` call, if it provided one. */
    lastHoverOnHide: (() => void) | undefined;
    /** What `recipeImagesFromContent` reports as the title image. */
    contentImage: string | undefined = REMOTE_IMAGE;
    /** What `recipeImages` reports as the title image of a local recipe. */
    localImage: string | undefined;
    /** URI schemes `fileService.hasProvider` reports as registered. */
    readonly providers = new Set<string>(['file', 'cooklang-hub']);
    readonly fileReads: string[] = [];
    readonly registrations = new Emitter<{ added: boolean; scheme: string }>();
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
            collectBadges: async () => [],
        });
        const widget = new RecipePreviewWidget();
        // `isVisible` is a getter-only accessor on Lumino's `Widget`, derived from
        // DOM attachment (`isAttached`) — which a widget built by `new` here never
        // has. `scheduleBadges` now branches on `isVisible`, so it is shadowed with
        // a writable own property defaulting to visible (matching every other test
        // in this file, which assumes badge/parse/image refreshes run eagerly);
        // `setVisible` below flips it for the tests that care about hidden previews.
        Object.defineProperty(widget, 'isVisible', { value: true, writable: true, configurable: true });
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
                hasProvider: (scheme: string) => this.providers.has(scheme),
                onDidChangeFileSystemProviderRegistrations: this.registrations.event,
                read: async (uri: URI) => {
                    this.fileReads.push(uri.toString());
                    return { value: CONTENT };
                },
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
            hoverService: {
                // The real `requestHover` cancels whatever hover is already open first,
                // which runs its `onHide` synchronously, before rendering the new one.
                requestHover: (request: { onHide?: () => void }) => {
                    this.lastHoverOnHide?.();
                    this.lastHoverOnHide = request.onHide;
                },
                cancelHover: () => { this.hoverCancelCount++; },
            },
            subscriptions: { onDidChangeSubscription: never },
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

    /** Register a file system provider for `scheme`, as a plugin activating late would. */
    registerProvider(scheme: string): void {
        this.providers.add(scheme);
        this.registrations.fire({ added: true, scheme });
    }

    /** Flip the `isVisible` override installed in the constructor (see the comment there). */
    setVisible(visible: boolean): void {
        (this.widget as unknown as { isVisible: boolean }).isVisible = visible;
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

describe('RecipePreviewWidget restored before its file system registers', () => {

    it('waits for the provider instead of reading, then parses once it registers', async () => {
        const harness = new PreviewHarness();
        harness.providers.delete('cooklang-hub');
        harness.widget.setUri(HUB);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.fileReads).to.deep.equal([]);
        expect(harness.internals.recipe).to.be.undefined;
        expect(harness.markup()).to.not.contain('Parse errors');

        harness.registerProvider('cooklang-hub');
        await until(() => harness.internals.recipe !== undefined);
        expect(harness.fileReads).to.deep.equal([HUB.toString()]);
        await until(() => harness.internals.images.title === REMOTE_IMAGE);
        expect(harness.markup()).to.contain('Syrup');
    });

    it('ignores providers registered for other schemes', async () => {
        const harness = new PreviewHarness();
        harness.providers.delete('cooklang-hub');
        harness.widget.setUri(HUB);
        harness.registerProvider('other-scheme');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.fileReads).to.deep.equal([]);
        expect(harness.internals.recipe).to.be.undefined;
    });

    it('re-reads a recipe whose read failed once its provider registers', async () => {
        const harness = new PreviewHarness();
        harness.providers.delete('cooklang-hub');
        // The provider is reported absent, but a racing read still ran and failed.
        let failed = false;
        const fileService = (harness.widget as unknown as { fileService: { read(uri: URI): Promise<{ value: string }> } }).fileService;
        const read = fileService.read;
        fileService.read = async (uri: URI) => {
            if (!failed) {
                failed = true;
                throw new Error('Canceled');
            }
            return read(uri);
        };
        harness.providers.add('cooklang-hub');
        harness.widget.setUri(HUB);
        await until(() => failed);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(harness.markup()).to.contain('Parse errors');

        harness.registrations.fire({ added: true, scheme: 'cooklang-hub' });
        await until(() => harness.internals.recipe !== undefined);
        expect(harness.markup()).to.contain('Syrup');
    });

    it('stops listening for provider registrations once disposed', async () => {
        const harness = new PreviewHarness();
        harness.providers.delete('cooklang-hub');
        harness.widget.setUri(HUB);
        harness.widget.dispose();
        harness.registerProvider('cooklang-hub');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.fileReads).to.deep.equal([]);
    });

    it('does not re-read a local recipe when a provider registers', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        expect(harness.fileReads).to.deep.equal([LOCAL.toString()]);
        harness.registrations.fire({ added: true, scheme: 'file' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(harness.fileReads).to.deep.equal([LOCAL.toString()]);
    });
});

describe('RecipePreviewWidget badges', () => {

    it('collects badges from the outlet with the preview context once the debounce elapses', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        // The default 500ms debounce would make this test slow for no benefit.
        internals.badgeDebounceMs = 1;
        const badge: PreviewBadge = { kind: 'nutriscore', grade: 'A', tooltipMarkdown: 'Great choice' };
        const calls: Array<{ menuPath: MenuPath; context: object }> = [];
        internals.outlets.collectBadges = async (menuPath, context) => {
            calls.push({ menuPath, context });
            return [badge];
        };

        await harness.open(LOCAL);
        await until(() => internals.badges.length > 0);

        expect(calls).to.have.lengthOf(1);
        expect(calls[0].menuPath).to.deep.equal(CooklangOutlets.RECIPE_PREVIEW_BADGE);
        expect(calls[0].context).to.deep.equal({ version: 1, uri: LOCAL.toString(), path: 'Breakfast/Pancakes.cook', scale: 1 });
        expect(internals.badges).to.deep.equal([badge]);
    });

    it('coalesces several scheduleBadges calls in one window into a single collectBadges call', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        internals.badgeDebounceMs = 1;
        await harness.open(LOCAL);

        let calls = 0;
        internals.outlets.collectBadges = async () => {
            calls++;
            return [];
        };
        internals.scheduleBadges();
        internals.scheduleBadges();
        internals.scheduleBadges();
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(calls).to.equal(1);
    });

    it('drops a badge refresh in flight when setUri switches to another recipe', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        internals.badgeDebounceMs = 1;
        await harness.open(LOCAL);

        let resolveOld!: (badges: PreviewBadge[]) => void;
        internals.outlets.collectBadges = async () => new Promise<PreviewBadge[]>(resolve => { resolveOld = resolve; });

        // A refresh is in flight for the current recipe when the preview switches to
        // another URI. That URI has no registered file system provider, so the
        // switch itself parses nothing and schedules no badge refresh of its own —
        // isolating this test to the sequence guard in `refreshBadges`/`setUri`.
        const inFlight = internals.refreshBadges();
        harness.widget.setUri(new URI('other-scheme:/nope.cook'));
        resolveOld([{ kind: 'pill', text: 'old', tone: 'neutral', tooltipMarkdown: '' }]);
        await inFlight;

        expect(internals.badges).to.deep.equal([]);
    });

    it('defers a badge refresh while hidden and runs it once the preview is shown again', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        internals.badgeDebounceMs = 1;
        harness.setVisible(false);
        await harness.open(LOCAL);

        const calls: object[] = [];
        internals.outlets.collectBadges = async (_menuPath, context) => {
            calls.push(context);
            return [];
        };
        // Hidden: the parse that just completed called `scheduleBadges`, but it
        // must not have started a timer or ever reached the outlet.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(calls).to.have.lengthOf(0);
        expect(internals.badgesStale).to.equal(true);

        harness.setVisible(true);
        internals.onAfterShow(undefined);
        await until(() => calls.length > 0);

        expect(calls).to.have.lengthOf(1);
        expect(internals.badgesStale).to.equal(false);
    });

    it('flushes a deferred badge refresh on attach, not just on show', async () => {
        // A widget that never went hidden-then-shown — e.g. the first tab in an
        // empty dock area, or the active tab of a restored layout — gets
        // `after-attach` but no `after-show`. `scheduleBadges` deferred while
        // `isVisible` was false must still flush from `onAfterAttach`.
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        internals.badgeDebounceMs = 1;
        harness.setVisible(false);
        await harness.open(LOCAL);
        expect(internals.badgesStale).to.equal(true);

        const calls: object[] = [];
        internals.outlets.collectBadges = async (_menuPath, context) => {
            calls.push(context);
            return [];
        };

        harness.setVisible(true);
        internals.onAfterAttach(undefined);
        await until(() => calls.length > 0);

        expect(calls).to.have.lengthOf(1);
        expect(internals.badgesStale).to.equal(false);
    });

    it('drops a stale badge refresh that resolves after a newer one', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        // Debounced so the automatic refresh the parse triggers does not leave a
        // pending timer running past the end of this test.
        internals.badgeDebounceMs = 1;
        await harness.open(LOCAL);

        const stale: PreviewBadge = { kind: 'pill', text: 'stale', tone: 'neutral', tooltipMarkdown: '' };
        const fresh: PreviewBadge = { kind: 'pill', text: 'fresh', tone: 'neutral', tooltipMarkdown: '' };
        let resolveStale!: (badges: PreviewBadge[]) => void;
        let calls = 0;
        internals.outlets.collectBadges = async () => {
            calls++;
            if (calls === 1) {
                // Never resolves until the test does it explicitly, below.
                return new Promise<PreviewBadge[]>(resolve => { resolveStale = resolve; });
            }
            return [fresh];
        };

        // Two refreshes in flight; the second (higher sequence number) settles first.
        const firstRefresh = internals.refreshBadges();
        const secondRefresh = internals.refreshBadges();
        await secondRefresh;
        expect(internals.badges).to.deep.equal([fresh]);

        // The stale first refresh settles later and must not overwrite the newer result.
        resolveStale([stale]);
        await firstRefresh;
        expect(internals.badges).to.deep.equal([fresh]);
    });
});

describe('RecipePreviewWidget badge hover', () => {

    it('cancels its own badge hover on dispose', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        await harness.open(LOCAL);

        const badge: PreviewBadge = { kind: 'pill', text: 'x', tone: 'neutral', tooltipMarkdown: '' };
        internals.handleShowBadgeDetails(badge, harness.widget.node, true);
        expect(internals.badgeHoverShown).to.equal(true);

        harness.widget.dispose();

        expect(harness.hoverCancelCount).to.equal(1);
        expect(internals.badgeHoverShown).to.equal(false);
    });

    it('never calls the global cancelHover on dispose when it never opened a hover', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);

        harness.widget.dispose();

        expect(harness.hoverCancelCount).to.equal(0);
    });

    it('tracks HoverService closing the hover on its own, so dispose does not cancel again', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        await harness.open(LOCAL);

        const badge: PreviewBadge = { kind: 'pill', text: 'x', tone: 'neutral', tooltipMarkdown: '' };
        internals.handleShowBadgeDetails(badge, harness.widget.node, true);
        expect(internals.badgeHoverShown).to.equal(true);

        // HoverService can hide the hover itself (mouseout, a click elsewhere)
        // without either `handleHideBadgeDetails` or dispose ever running.
        expect(harness.lastHoverOnHide, 'requestHover was not given an onHide callback').to.not.be.undefined;
        harness.lastHoverOnHide!();
        expect(internals.badgeHoverShown).to.equal(false);

        harness.widget.dispose();

        expect(harness.hoverCancelCount).to.equal(0);
    });

    it('keeps hover ownership across a move straight from one badge to another', async () => {
        const harness = new PreviewHarness();
        const internals = harness.widget as unknown as BadgeInternals;
        await harness.open(LOCAL);

        // `requestHover` cancels the previous hover (running its `onHide`)
        // before the new one renders; `badgeHoverShown` must survive that.
        const first: PreviewBadge = { kind: 'pill', text: 'a', tone: 'neutral', tooltipMarkdown: '' };
        const second: PreviewBadge = { kind: 'pill', text: 'b', tone: 'neutral', tooltipMarkdown: '' };
        internals.handleShowBadgeDetails(first, harness.widget.node, true);
        internals.handleShowBadgeDetails(second, harness.widget.node, true);
        expect(internals.badgeHoverShown).to.equal(true);

        harness.widget.dispose();

        expect(harness.hoverCancelCount).to.equal(1);
    });
});
