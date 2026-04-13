// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
import { MenuParseResult } from '../common/menu-types';
import { MenuView } from './menu-preview-components';

import '../../src/browser/style/menu-preview.css';

// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export const MENU_PREVIEW_WIDGET_ID = 'menu-preview-widget';

/**
 * Constructs a unique widget ID for a preview panel tied to a specific URI.
 */
export function createMenuPreviewWidgetId(uri: URI): string {
    return `${MENU_PREVIEW_WIDGET_ID}:${uri.toString()}`;
}

// ---------------------------------------------------------------------------
// MenuPreviewWidget
// ---------------------------------------------------------------------------

@injectable()
export class MenuPreviewWidget extends ReactWidget implements Navigatable {

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
    protected menuResult: MenuParseResult | undefined;
    protected parseErrors: string[] = [];
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected scale = 1;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-menu-preview');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.listenToDocumentChanges();
    }

    /**
     * Bind this widget to a source `.menu` file URI and trigger the first parse.
     */
    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createMenuPreviewWidgetId(uri);
        this.title.label = `Preview: ${uri.path.base}`;
        this.title.caption = `Menu preview for ${uri.toString()}`;
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
        this.service.parseMenu(content, this.scale).then(json => {
            try {
                const result: MenuParseResult = JSON.parse(json);
                this.menuResult = result;
                this.parseErrors = [
                    ...(result.errors ?? []).map(e => e.message),
                    ...(result.warnings ?? []).map(w => w.message),
                ];
            } catch (e) {
                this.menuResult = undefined;
                this.parseErrors = [`Failed to parse response: ${e}`];
            }
            this.update();
        }).catch(e => {
            this.menuResult = undefined;
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

    protected handleScaleChange = (newScale: number): void => {
        this.scale = newScale;
        this.parseCurrentContent();
    };

    protected handleAddToShoppingList = (currentScale: number): void => {
        this.commandRegistry.executeCommand('cooklang.addToShoppingList', this, currentScale);
    };

    protected handleNavigateToRecipe = (referencePath: string): void => {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return;
        }
        const rootUri = new URI(root.resource.toString());
        const cleanPath = referencePath.startsWith('./')
            ? referencePath.slice(2)
            : referencePath;
        const targetUri = rootUri.resolve(cleanPath + '.cook');
        open(this.openerService, targetUri);
    };

    protected render(): React.ReactNode {
        if (this.menuResult && this.menuResult.sections.length > 0) {
            return (
                <MenuView
                    menuResult={this.menuResult}
                    fileName={this.uri?.path.base ?? ''}
                    scale={this.scale}
                    onScaleChange={this.handleScaleChange}
                    onShowSource={this.handleShowSource}
                    onAddToShoppingList={this.handleAddToShoppingList}
                    onNavigateToRecipe={this.handleNavigateToRecipe}
                />
            );
        }

        if (this.parseErrors.length > 0) {
            return (
                <div className='menu-error'>
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
            <div className='menu-empty'>
                Open a <code>.menu</code> file to see its meal plan preview.
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
 * Create a fully initialised {@link MenuPreviewWidget} bound to `uri`.
 *
 * Uses a child container so each preview panel gets its own widget instance
 * while still inheriting all parent bindings (including CooklangLanguageService
 * and MonacoWorkspace).
 */
export function createMenuPreviewWidget(
    container: interfaces.Container,
    uri: URI
): MenuPreviewWidget {
    const child = container.createChild();
    child.bind(MenuPreviewWidget).toSelf().inTransientScope();
    const widget = child.get(MenuPreviewWidget);
    widget.setUri(uri);
    return widget;
}
