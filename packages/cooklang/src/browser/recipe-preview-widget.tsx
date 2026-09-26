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

import { injectable, inject, postConstruct, interfaces } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ContextKeyService, ScopedValueStore } from '@theia/core/lib/browser/context-key-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID } from '../common';
import { Ingredient, ParseResult, Recipe } from '../common/recipe-types';
import {
    RecipeImages,
    ResolvedRecipeImages,
    resolveImageUri,
    RECIPE_IMAGE_EXTENSIONS,
} from '../common/recipe-images';
import { RecipeImageService } from './recipe-image-service';
import { RecipeNavigator } from './recipe-navigator';
import { RecipeView, LinkOpenerProvider } from './recipe-preview-components';
import { TimerRecipeRef } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';
import { TimerBinding, TimerBindingProvider } from './timer-components';
import { CooklangOutletService } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { IngredientOutletInfo, PreviewBadge, PreviewOutletContext } from '../common/cooklang-outlet-context';

import '../../src/browser/style/recipe-preview.css';

// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export const RECIPE_PREVIEW_WIDGET_ID = 'recipe-preview-widget';

/**
 * Constructs a unique widget ID for a preview panel tied to a specific URI.
 */
export function createRecipePreviewWidgetId(uri: URI): string {
    return `${RECIPE_PREVIEW_WIDGET_ID}:${uri.toString()}`;
}

// ---------------------------------------------------------------------------
// RecipePreviewWidget
// ---------------------------------------------------------------------------

@injectable()
export class RecipePreviewWidget extends ReactWidget implements Navigatable {

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(RecipeImageService)
    protected readonly imageService: RecipeImageService;

    @inject(RecipeNavigator)
    protected readonly navigator: RecipeNavigator;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    @inject(HoverService)
    protected readonly hoverService: HoverService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;

    protected uri: URI;
    protected recipe: Recipe | undefined;
    /** The `title` the native parser resolved from the recipe's metadata, if any. */
    protected recipeTitle: string | undefined;
    protected scale = 1;
    protected badges: PreviewBadge[] = [];
    protected badgeSequence = 0;
    protected badgeTimer: ReturnType<typeof setTimeout> | undefined;
    static readonly BADGE_DEBOUNCE_MS = 500;
    /** Overridable in tests; production code always uses {@link BADGE_DEBOUNCE_MS}. */
    protected badgeDebounceMs = RecipePreviewWidget.BADGE_DEBOUNCE_MS;
    /** A badge refresh was requested while hidden; run it once the preview is shown again. */
    protected badgesStale = false;
    /** Whether this widget currently has a badge hover open, so {@link hideBadgeHover} never cancels another widget's. */
    protected badgeHoverShown = false;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected parseSequence = 0;
    protected images: ResolvedRecipeImages = { steps: {} };
    protected imageSequence = 0;
    protected imageDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** File URIs the last successful refresh actually resolved (remote ones excluded). */
    protected resolvedImageUris: ReadonlySet<string> = new Set<string>();
    /**
     * Context keys scoped to this preview's DOM node. Outlet `when` clauses are
     * evaluated against the node, so `cooklangPreviewScheme` applies to this
     * preview's toolbar and context menus only.
     */
    protected scopedContextKeys: ScopedValueStore | undefined;
    /** The recipe text last parsed. A non-`file` recipe takes its images from it. */
    protected content: string | undefined;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-recipe-preview');
        this.node.tabIndex = 0;
        this.scopedContextKeys = this.contextKeyService.createScoped(this.node);
        this.toDispose.push(this.scopedContextKeys);
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
        this.listenToProviderRegistrations();
        this.toDispose.push(this.timerService.onDidChangeTimers(() => {
            // A tick is only interesting to this preview if one of its own
            // timers is in it. Ticks fire for every timer in the window, and a
            // full re-render of a long recipe once a second is not free.
            if (this.isVisible && this.hasOwnTimer()) {
                this.update();
            }
        }));
        this.toDispose.push(this.outlets.onDidChange(() => {
            this.update();
            this.scheduleBadges();
        }));
        this.toDispose.push(this.subscriptions.onDidChangeSubscription(() => this.scheduleBadges()));
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        // Ticks were ignored while hidden, so the countdown may be stale.
        this.update();
        this.flushStaleBadges();
    }

    /**
     * The first tab in an empty dock area, or the active tab of a restored
     * layout, goes straight from never-attached to visible: Lumino sends
     * `after-attach` but no `after-show` (there was no prior hide to show
     * from), so a badge refresh deferred while `isVisible` was false would
     * otherwise never flush without this.
     */
    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.flushStaleBadges();
    }

    protected override onBeforeHide(msg: Message): void {
        super.onBeforeHide(msg);
        this.hideBadgeHover();
    }

    /** Runs a badge refresh deferred by `scheduleBadges` while hidden, once the preview is visible again. */
    protected flushStaleBadges(): void {
        if (this.badgesStale && this.isVisible) {
            this.badgesStale = false;
            this.scheduleBadges();
        }
    }

    /** Whether any live timer belongs to the recipe this preview shows. */
    protected hasOwnTimer(): boolean {
        const path = this.uri?.toString();
        return path !== undefined
            && this.timerService.list().some(timer => timer.recipeRef?.recipePath === path);
    }

    /**
     * Whether the recipe is a local file. Recipes from other file systems (a
     * plugin's `cooklang-hub:` provider, say) are read through `FileService` like
     * any other, but have no folder to find sibling images in or to watch, and
     * their recipe references cannot be resolved against the workspace.
     */
    protected hasLocalSource(): boolean {
        return this.uri?.scheme === 'file';
    }

    /**
     * Bind this widget to a source `.cook` file URI and trigger the first parse.
     */
    setUri(uri: URI): void {
        this.uri = uri;
        this.scopedContextKeys?.setContext(CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY, uri.scheme);
        this.id = createRecipePreviewWidgetId(uri);
        this.recipeTitle = undefined;
        // A reused widget must not keep showing a previous recipe's grade, nor
        // let a badge refresh for the old recipe land after this switch.
        this.badges = [];
        this.badgeSequence++;
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
            this.badgeTimer = undefined;
        }
        // Text parsed for a previous URI must not name this recipe's images.
        this.content = undefined;
        this.updateTitleLabel();
        this.title.caption = `Recipe preview for ${uri.toString()}`;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-open-preview';
        this.watchImageFolder();
        this.refreshImages();
        this.parseCurrentContent();
    }

    // --- Navigatable ---

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    // --- Document change listeners ---

    protected listenToDocumentChanges(): void {
        this.toDispose.push(
            this.monacoWorkspace.onDidChangeTextDocument(event => {
                if (
                    event.model.languageId !== COOKLANG_LANGUAGE_ID ||
                    event.model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.debouncedParse(event.model.getText());
            })
        );

        this.toDispose.push(
            this.monacoWorkspace.onDidOpenTextDocument(model => {
                if (
                    model.languageId !== COOKLANG_LANGUAGE_ID ||
                    model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.parseContent(model.getText());
            })
        );
    }

    /**
     * A preview restored at startup can come up before the plugin providing
     * its file system (e.g. `cooklang-hub:`) has activated. Such a read either
     * waits for the provider or is cancelled after a timeout, so the preview
     * does not read until the provider exists, and reads again once it
     * registers. Local recipes are unaffected: `file:` is always there.
     */
    protected listenToProviderRegistrations(): void {
        this.toDispose.push(this.fileService.onDidChangeFileSystemProviderRegistrations(({ added, scheme }) => {
            if (added && this.uri && !this.hasLocalSource() && scheme === this.uri.scheme) {
                this.parseCurrentContent();
            }
        }));
    }

    // --- Parse helpers ---

    protected debouncedParse(content: string): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.parseContent(content);
        }, 300);
    }

    protected parseCurrentContent(): void {
        if (!this.uri) {
            return;
        }
        const model = this.monacoWorkspace.getTextDocument(this.uri.toString());
        if (model) {
            this.parseContent(model.getText());
        } else if (!this.hasLocalSource() && !this.fileService.hasProvider(this.uri.scheme)) {
            // Read once the provider registers; see `listenToProviderRegistrations`.
            this.parseErrors = [];
            this.update();
        } else {
            this.fileService.read(this.uri).then(
                content => this.parseContent(content.value),
                err => {
                    this.parseErrors = [`Failed to read file: ${err}`];
                    this.update();
                }
            );
        }
    }

    protected parseContent(content: string): void {
        this.content = content;
        const sequence = ++this.parseSequence;
        this.service.parse(content).then(json => {
            if (this.isDisposed || sequence !== this.parseSequence) {
                return;
            }
            try {
                const result: ParseResult = JSON.parse(json);
                this.recipe = result.recipe ?? undefined;
                this.recipeTitle = result.title ?? undefined;
                this.parseErrors = [
                    ...((result.errors ?? []) as Array<{ message: string }>).map(e => e.message),
                    ...((result.warnings ?? []) as Array<{ message: string }>).map(w => w.message),
                ];
            } catch (e) {
                this.recipe = undefined;
                this.parseErrors = [`Failed to parse response: ${e}`];
            }
            this.updateTitleLabel();
            this.refreshImages();
            this.update();
            this.scheduleBadges();
        }).catch(e => {
            if (this.isDisposed || sequence !== this.parseSequence) {
                return;
            }
            this.recipe = undefined;
            this.badges = [];
            this.parseErrors = [`Parse request failed: ${e}`];
            this.update();
        });
    }

    // --- Image helpers ---

    /**
     * Watch the recipe's folder so an image dropped in from Finder shows up in
     * an already-open preview, and a deleted one disappears.
     */
    protected watchImageFolder(): void {
        if (!this.hasLocalSource()) {
            return;
        }
        const folder = this.uri.parent;
        this.toDispose.push(this.fileService.watch(folder));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            // Which files this recipe uses is `cooklang-find`'s answer, not
            // something to re-derive here: consult the set the last refresh
            // resolved rather than pattern-matching filenames.
            const touched = event.changes
                .map(change => change.resource)
                .filter(resource => this.resolvedImageUris.has(resource.toString()));
            // A file that did not exist at the last refresh cannot be in that
            // set, so also react to any image appearing in the watched folder.
            const folderKey = folder.toString();
            const nearbyImage = event.changes.some(change =>
                change.resource.parent.toString() === folderKey
                && RECIPE_IMAGE_EXTENSIONS.includes(change.resource.path.ext.replace(/^\./, '').toLowerCase()));
            if (touched.length === 0 && !nearbyImage) {
                return;
            }
            // An image replaced in place keeps its URI, so the cached blob for
            // it has to go or the preview would keep showing the old bytes.
            for (const resource of touched) {
                this.imageService.release(resource);
            }
            this.debouncedRefreshImages();
        }));
    }

    /** Coalesce the burst of events a multi-file copy produces into one refresh. */
    protected debouncedRefreshImages(): void {
        if (this.imageDebounceTimer !== undefined) {
            clearTimeout(this.imageDebounceTimer);
        }
        this.imageDebounceTimer = setTimeout(() => {
            this.imageDebounceTimer = undefined;
            this.refreshImages();
        }, 150);
    }

    /**
     * Ask `cooklang-find` which images exist for this recipe and turn each one
     * into an `<img>` src. Guarded by `imageSequence` so a slow refresh cannot
     * overwrite a newer one.
     */
    protected async refreshImages(): Promise<void> {
        if (!this.uri) {
            return;
        }
        const sequence = ++this.imageSequence;
        const resolved: ResolvedRecipeImages = { steps: {} };
        const fileUris = new Set<string>();
        try {
            const discovered = await this.discoverImages();
            // Every entry is a `FileService` read over RPC, so they are flattened
            // and awaited together: a 20-image recipe should not pay for forty
            // sequential round-trips before anything renders.
            const entries: Array<{ section?: string; step?: string; raw: string }> = [];
            if (discovered?.title) {
                entries.push({ raw: discovered.title });
            }
            for (const [section, steps] of Object.entries(discovered?.steps ?? {})) {
                for (const [step, raw] of Object.entries(steps)) {
                    entries.push({ section, step, raw });
                }
            }
            await Promise.all(entries.map(async entry => {
                const src = await this.toImageSrc(entry.raw, fileUris);
                if (!src) {
                    return;
                }
                if (entry.section === undefined || entry.step === undefined) {
                    resolved.title = src;
                } else {
                    (resolved.steps[entry.section] ??= {})[entry.step] = src;
                }
            }));
        } catch (e) {
            // Usually harmless: no images, an unsaved file, or an unreadable
            // folder. But it also catches a native addon that predates
            // `recipeImages` and needs rebuilding, so say what happened.
            console.debug('Recipe image refresh failed', e);
        }
        if (this.isDisposed || sequence !== this.imageSequence) {
            return;
        }
        this.images = resolved;
        this.resolvedImageUris = fileUris;
        this.update();
    }

    /**
     * The recipe's images as `cooklang-find` reports them. A local recipe is
     * looked up on disk (metadata first, then sibling files). Any other recipe
     * has no folder, so only its metadata can name an image, which is read from
     * the parsed text; before the first parse there is nothing to report.
     */
    protected async discoverImages(): Promise<RecipeImages | undefined> {
        if (this.hasLocalSource()) {
            return JSON.parse(await this.service.recipeImages(this.uri.path.fsPath())) as RecipeImages;
        }
        if (this.content === undefined) {
            return undefined;
        }
        return JSON.parse(await this.service.recipeImagesFromContent(this.content)) as RecipeImages;
    }

    /**
     * Resolve one raw image value to a URL an `<img>` can load, recording every
     * local file URI in `fileUris` so the watcher knows what this recipe reads.
     */
    protected async toImageSrc(raw: string | undefined, fileUris: Set<string>): Promise<string | undefined> {
        if (!raw) {
            return undefined;
        }
        const location = resolveImageUri(raw, this.uri);
        if (!location) {
            return undefined;
        }
        if (location.kind === 'remote') {
            // A non-`file` recipe's metadata comes from a third party: only
            // `https:` is loaded, so its images never travel in the clear.
            return this.hasLocalSource() || /^https:/i.test(location.url) ? location.url : undefined;
        }
        // A non-`file` recipe has no folder: a relative or absolute path in its
        // metadata names nothing the preview may read.
        if (!this.hasLocalSource()) {
            return undefined;
        }
        // Recorded even when the read fails: a file that is missing now may be
        // created later, and the watcher should notice when it is.
        fileUris.add(location.uri.toString());
        return this.imageService.resolve(location.uri);
    }

    // --- Rendering ---

    protected handleScaleChange = (scale: number): void => {
        this.scale = scale;
        this.update();
        this.scheduleBadges();
    };

    /**
     * Set the displayed scale from outside the React tree — used when opening a
     * recipe from a timer that was started at a different scale.
     */
    setScale(scale: number): void {
        if (Number.isFinite(scale) && scale > 0 && scale !== this.scale) {
            this.scale = scale;
            this.update();
            this.scheduleBadges();
        }
    }

    protected previewContext(): PreviewOutletContext | undefined {
        if (!this.uri) {
            return undefined;
        }
        return { version: CooklangOutlets.VERSION, ...this.outlets.describe(this.uri), scale: this.scale };
    }

    /**
     * Badges call plugins (and the network), so they refresh after edits
     * settle. A hidden preview (a background tab) defers the refresh until it
     * is shown again (see `onAfterShow`), instead of calling plugins for
     * something nobody can see.
     */
    protected scheduleBadges(): void {
        if (!this.isVisible) {
            this.badgesStale = true;
            return;
        }
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
        }
        this.badgeTimer = setTimeout(() => {
            this.badgeTimer = undefined;
            this.refreshBadges().catch(e => console.warn('[cooklang] badge refresh failed:', e));
        }, this.badgeDebounceMs);
    }

    protected async refreshBadges(): Promise<void> {
        const sequence = ++this.badgeSequence;
        const context = this.recipe ? this.previewContext() : undefined;
        const badges = context ? await this.outlets.collectBadges(CooklangOutlets.RECIPE_PREVIEW_BADGE, context, this.node) : [];
        if (this.isDisposed || sequence !== this.badgeSequence) {
            return;
        }
        if (!PreviewBadge.equals(this.badges, badges)) {
            this.badges = badges;
            this.update();
        }
    }

    protected handleShowBadgeDetails = (badge: PreviewBadge, target: HTMLElement, immediate: boolean): void => {
        this.badgeHoverShown = true;
        this.hoverService.requestHover({
            // Untrusted, no HTML: plugin text never runs commands or injects markup.
            content: new MarkdownStringImpl(badge.tooltipMarkdown, { isTrusted: false, supportHtml: false }),
            target,
            position: 'bottom',
            cssClasses: ['cooklang-preview-badge-hover'],
            skipHoverDelay: immediate,
            // HoverService can close the hover on its own (mouseout, mousedown
            // elsewhere), without going through `handleHideBadgeDetails`.
            onHide: () => { this.badgeHoverShown = false; },
        });
    };

    protected handleHideBadgeDetails = (): void => {
        this.badgeHoverShown = false;
        this.hoverService.cancelHover();
    };

    /**
     * Hides this widget's own badge hover, if any. `HoverService.cancelHover`
     * is global — it hides whatever hover is currently open, regardless of
     * which widget opened it — so this only calls it when `badgeHoverShown`
     * confirms the open hover (if any) is this widget's.
     */
    protected hideBadgeHover(): void {
        if (this.badgeHoverShown) {
            this.hoverService.cancelHover();
        }
        this.badgeHoverShown = false;
    }

    protected handleRunToolbarItem = (id: string): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.run(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, id, context, this.node);
        }
    };

    protected handleIngredientContextMenu = (ingredient: Ingredient, event: React.MouseEvent): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.showContextMenu(CooklangOutlets.RECIPE_INGREDIENT_CONTEXT,
                { ...context, ingredient: IngredientOutletInfo.fromIngredient(ingredient) }, event);
        }
    };

    protected handleNavigateToRecipe = (referencePath: string): void => {
        this.navigator.navigate(referencePath);
    };

    protected handleOpenLink = (url: string): void => {
        this.windowService.openNewWindow(url, { external: true });
    };

    /**
     * The recipe's display name — its `title:` metadata, or the file name
     * without extension — used for the heading, the tab and timer labels.
     */
    protected recipeName(): string {
        return this.recipeTitle ?? this.uri?.path.name ?? '';
    }

    protected updateTitleLabel(): void {
        this.title.label = `Preview: ${this.recipeName()}`;
    }

    // A property initializer, not a method: its arrow functions close over
    // `this` but only dereference `this.timerService` when invoked, by which
    // point property injection has run. Binding eagerly instead — e.g.
    // `find: this.timerService.find` — would read `this.timerService` at
    // construction time, before injection, and throw on `undefined`.
    protected readonly timerBinding: TimerBinding = {
        ref: (globalStepIndex: number, timerPosition: number): TimerRecipeRef => ({
            recipePath: this.uri?.toString() ?? '',
            recipeName: this.recipeName(),
            globalStepIndex,
            timerPosition,
            scale: this.scale,
        }),
        find: ref => this.timerService.find(ref),
        start: (ref, title, durationSeconds) => this.timerService.start(ref, title, durationSeconds),
        toggle: id => this.timerService.toggle(id),
        reset: id => this.timerService.reset(id),
        addTime: (id, seconds) => this.timerService.addTime(id, seconds),
        nowMs: () => this.timerService.nowMs(),
    };

    protected render(): React.ReactNode {
        if (this.recipe) {
            const context = this.previewContext();
            const toolbarItems = context ? this.outlets.getItems(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, context, this.node) : [];
            return (
                <TimerBindingProvider value={this.timerBinding}>
                    <LinkOpenerProvider value={this.handleOpenLink}>
                        <RecipeView
                            recipe={this.recipe}
                            title={this.recipeName()}
                            images={this.images}
                            scale={this.scale}
                            onScaleChange={this.handleScaleChange}
                            toolbarItems={toolbarItems}
                            onRunToolbarItem={this.handleRunToolbarItem}
                            onIngredientContextMenu={this.handleIngredientContextMenu}
                            onNavigateToRecipe={this.hasLocalSource() ? this.handleNavigateToRecipe : undefined}
                            badges={this.badges}
                            onShowBadgeDetails={this.handleShowBadgeDetails}
                            onHideBadgeDetails={this.handleHideBadgeDetails}
                        />
                    </LinkOpenerProvider>
                </TimerBindingProvider>
            );
        }

        if (this.parseErrors.length > 0) {
            return (
                <div className='recipe-error'>
                    <strong>Parse errors:</strong>
                    <ul>
                        {this.parseErrors.map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                        ))}
                    </ul>
                </div>
            );
        }

        return (
            <div className='recipe-empty'>
                Open a <code>.cook</code> file to see its recipe preview.
            </div>
        );
    }

    // --- Disposal ---

    override dispose(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        if (this.imageDebounceTimer !== undefined) {
            clearTimeout(this.imageDebounceTimer);
            this.imageDebounceTimer = undefined;
        }
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
            this.badgeTimer = undefined;
        }
        this.hideBadgeHover();
        this.imageService.releaseAll();
        super.dispose();
    }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a fully initialised {@link RecipePreviewWidget} bound to `uri`.
 *
 * Uses a child container so each preview panel gets its own widget instance
 * while still inheriting all parent bindings (including CooklangLanguageService
 * and MonacoWorkspace).
 */
export function createRecipePreviewWidget(
    container: interfaces.Container,
    uri: URI
): RecipePreviewWidget {
    const child = container.createChild();
    child.bind(RecipeImageService).toSelf().inSingletonScope();
    child.bind(RecipePreviewWidget).toSelf().inTransientScope();
    const widget = child.get(RecipePreviewWidget);
    widget.setUri(uri);
    return widget;
}
