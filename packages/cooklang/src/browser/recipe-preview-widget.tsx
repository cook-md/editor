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

    protected uri: URI;
    protected recipe: Recipe | undefined;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-recipe-preview');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
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
        this.service.parse(content).then(json => {
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
            this.update();
        }).catch(e => {
            this.recipe = undefined;
            this.parseErrors = [`Parse request failed: ${e}`];
            this.update();
        });
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
    child.bind(RecipePreviewWidget).toSelf().inTransientScope();
    const widget = child.get(RecipePreviewWidget);
    widget.setUri(uri);
    return widget;
}
