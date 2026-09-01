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
import { CommandRegistry } from '@theia/core/lib/common/command';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID } from '../common';
import { Recipe } from '../common/recipe-types';
import {
    RecipeImages,
    ResolvedRecipeImages,
    resolveImageUri,
    RECIPE_IMAGE_EXTENSIONS,
} from '../common/recipe-images';
import { RecipeImageService } from './recipe-image-service';
import { RecipeView, LinkOpenerProvider } from './recipe-preview-components';
import { TimerRecipeRef } from '../common/cooking-timer';
import { CookingTimerService } from './cooking-timer-service';
import { TimerBinding, TimerBindingProvider } from './timer-components';

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

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(RecipeImageService)
    protected readonly imageService: RecipeImageService;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(CookingTimerService)
    protected readonly timerService: CookingTimerService;

    protected uri: URI;
    protected recipe: Recipe | undefined;
    protected scale = 1;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected parseSequence = 0;
    protected images: ResolvedRecipeImages = { steps: {} };
    protected imageSequence = 0;
    protected imageDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** File URIs the last successful refresh actually resolved (remote ones excluded). */
    protected resolvedImageUris: ReadonlySet<string> = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.addClass('theia-recipe-preview');
        this.node.tabIndex = 0;
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
        this.toDispose.push(this.timerService.onDidChangeTimers(() => this.update()));
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    /**
     * Bind this widget to a source `.cook` file URI and trigger the first parse.
     */
    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createRecipePreviewWidgetId(uri);
        this.title.label = `Preview: ${uri.path.base}`;
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
        const sequence = ++this.parseSequence;
        this.service.parse(content).then(json => {
            if (this.isDisposed || sequence !== this.parseSequence) {
                return;
            }
            try {
                const result = JSON.parse(json);
                this.recipe = result.recipe ?? undefined;
                this.parseErrors = [
                    ...((result.errors ?? []) as Array<{ message: string }>).map(e => e.message),
                    ...((result.warnings ?? []) as Array<{ message: string }>).map(w => w.message),
                ];
            } catch (e) {
                this.recipe = undefined;
                this.parseErrors = [`Failed to parse response: ${e}`];
            }
            this.refreshImages();
            this.update();
        }).catch(e => {
            if (this.isDisposed || sequence !== this.parseSequence) {
                return;
            }
            this.recipe = undefined;
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
     * Ask the backend which images exist for this recipe and turn each one into
     * an `<img>` src. Guarded by `imageSequence` so a slow refresh cannot
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
            const json = await this.service.recipeImages(this.uri.path.fsPath());
            const discovered = JSON.parse(json) as RecipeImages;
            // Every entry is a `FileService` read over RPC, so they are flattened
            // and awaited together: a 20-image recipe should not pay for forty
            // sequential round-trips before anything renders.
            const entries: Array<{ section?: string; step?: string; raw: string }> = [];
            if (discovered.title) {
                entries.push({ raw: discovered.title });
            }
            for (const [section, steps] of Object.entries(discovered.steps ?? {})) {
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
            return location.url;
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
    };

    /**
     * Set the displayed scale from outside the React tree — used when opening a
     * recipe from a timer that was started at a different scale.
     */
    setScale(scale: number): void {
        if (Number.isFinite(scale) && scale > 0 && scale !== this.scale) {
            this.scale = scale;
            this.update();
        }
    }

    protected handleShowSource = (): void => {
        if (this.uri) {
            this.editorManager.open(this.uri);
        }
    };

    protected handleAddToShoppingList = (scale: number): void => {
        this.commandRegistry.executeCommand('cooklang.addToShoppingList', this, scale);
    };

    protected handleNavigateToRecipe = (referencePath: string): void => {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return;
        }
        const rootUri = new URI(root.resource.toString());
        const targetUri = rootUri.resolve(referencePath + '.cook');
        open(this.openerService, targetUri);
    };

    protected handleOpenLink = (url: string): void => {
        this.windowService.openNewWindow(url, { external: true });
    };

    /** The recipe's display name, used to label timers in the Timers panel. */
    protected recipeName(): string {
        const name = this.recipe?.metadata.map['name'];
        if (name !== undefined && name !== '') {
            return String(name);
        }
        return (this.uri?.path.base ?? '').replace(/\.cook$/i, '');
    }

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
            return (
                <TimerBindingProvider value={this.timerBinding}>
                    <LinkOpenerProvider value={this.handleOpenLink}>
                        <RecipeView
                            recipe={this.recipe}
                            fileName={this.uri?.path.base ?? ''}
                            images={this.images}
                            scale={this.scale}
                            onScaleChange={this.handleScaleChange}
                            onShowSource={this.handleShowSource}
                            onAddToShoppingList={this.handleAddToShoppingList}
                            onNavigateToRecipe={this.handleNavigateToRecipe}
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
