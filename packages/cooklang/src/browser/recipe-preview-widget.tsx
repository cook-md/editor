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
import { RecipeView } from './recipe-preview-components';

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

    protected uri: URI;
    protected recipe: Recipe | undefined;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected parseSequence = 0;
    protected images: ResolvedRecipeImages = { steps: {} };
    protected imageSequence = 0;
    protected imageDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-recipe-preview');
        this.node.tabIndex = 0;
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
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
            const touched = event.changes
                .map(change => change.resource)
                .filter(resource => this.isImageOfThisRecipe(resource));
            if (touched.length === 0) {
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

    /** True when `resource` is a `<stem>.….<ext>` image belonging to this recipe. */
    protected isImageOfThisRecipe(resource: URI): boolean {
        if (resource.parent.toString() !== this.uri.parent.toString()) {
            return false;
        }
        const name = resource.path.base;
        const stem = this.uri.path.name;
        if (!name.toLowerCase().startsWith(stem.toLowerCase() + '.')) {
            return false;
        }
        const ext = resource.path.ext.replace(/^\./, '').toLowerCase();
        return RECIPE_IMAGE_EXTENSIONS.includes(ext);
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
        try {
            const json = await this.service.recipeImages(this.uri.path.fsPath());
            const discovered = JSON.parse(json) as RecipeImages;
            resolved.title = await this.toImageSrc(discovered.title);
            for (const [section, steps] of Object.entries(discovered.steps ?? {})) {
                for (const [step, raw] of Object.entries(steps)) {
                    const src = await this.toImageSrc(raw);
                    if (src) {
                        (resolved.steps[section] ??= {})[step] = src;
                    }
                }
            }
        } catch {
            // No images, an unsaved file, or an unreadable folder: render none.
        }
        if (this.isDisposed || sequence !== this.imageSequence) {
            return;
        }
        this.images = resolved;
        this.update();
    }

    /** Resolve one raw image value to a URL an `<img>` can load. */
    protected async toImageSrc(raw: string | undefined): Promise<string | undefined> {
        if (!raw) {
            return undefined;
        }
        const root = this.workspaceService.tryGetRoots()[0];
        const location = resolveImageUri(
            raw,
            this.uri,
            root ? new URI(root.resource.toString()) : undefined
        );
        if (!location) {
            return undefined;
        }
        return location.kind === 'remote'
            ? location.url
            : this.imageService.resolve(location.uri);
    }

    // --- Rendering ---

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

    protected render(): React.ReactNode {
        if (this.recipe) {
            return (
                <RecipeView
                    recipe={this.recipe}
                    fileName={this.uri?.path.base ?? ''}
                    images={this.images}
                    onShowSource={this.handleShowSource}
                    onAddToShoppingList={this.handleAddToShoppingList}
                    onNavigateToRecipe={this.handleNavigateToRecipe}
                />
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
