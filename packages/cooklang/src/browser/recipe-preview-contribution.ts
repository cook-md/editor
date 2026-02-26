// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common/menu';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { EditorManager } from '@theia/editor/lib/browser';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import URI from '@theia/core/lib/common/uri';
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler';
import { COOKLANG_LANGUAGE_ID, CooklangPreferences } from '../common';
import {
    RecipePreviewWidget,
    RECIPE_PREVIEW_WIDGET_ID,
    createRecipePreviewWidgetId
} from './recipe-preview-widget';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export namespace CooklangPreviewCommands {
    export const TOGGLE_PREVIEW: Command = {
        id: 'cooklang.togglePreview',
        label: 'Cooklang: Toggle Preview',
        iconClass: 'codicon codicon-open-preview'
    };
    export const OPEN_PREVIEW_SIDE: Command = {
        id: 'cooklang.openPreviewSide',
        label: 'Cooklang: Open Preview to the Side',
        iconClass: 'codicon codicon-open-preview'
    };
    export const OPEN_SOURCE: Command = {
        id: 'cooklang.openSource',
        label: 'Cooklang: Open Source',
        iconClass: 'codicon codicon-go-to-file'
    };
}

// ---------------------------------------------------------------------------
// RecipePreviewContribution
// ---------------------------------------------------------------------------

@injectable()
export class RecipePreviewContribution implements CommandContribution, KeybindingContribution, OpenHandler, TabBarToolbarContribution, MenuContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(CooklangPreferences)
    protected readonly preferences: CooklangPreferences;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    readonly id = 'cooklang-preview-open-handler';
    readonly label = 'Cooklang: Recipe Preview';

    canHandle(uri: URI): number {
        if (uri.path.ext === '.cook' && this.preferences['cooklang.openInPreviewMode']) {
            return 200;
        }
        return 0;
    }

    async open(uri: URI): Promise<RecipePreviewWidget> {
        const preview = await this.getOrCreatePreview(uri);
        if (!preview.isAttached) {
            await this.shell.addWidget(preview, { area: 'main' });
        }
        this.shell.activateWidget(preview.id);
        return preview;
    }

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangPreviewCommands.TOGGLE_PREVIEW, {
            execute: (...args: unknown[]) => this.togglePreview(args),
            isEnabled: (...args: unknown[]) => this.canTogglePreview(args),
        });
        commands.registerCommand(CooklangPreviewCommands.OPEN_PREVIEW_SIDE, {
            execute: (...args: unknown[]) => this.openPreviewSide(args),
            isEnabled: (...args: unknown[]) => this.canOpenPreview(args),
        });
        commands.registerCommand(CooklangPreviewCommands.OPEN_SOURCE,
            UriAwareCommandHandler.MonoSelect(this.selectionService, {
                execute: uri => this.editorManager.open(uri),
                isEnabled: uri => uri.path.ext === '.cook',
            })
        );
    }

    // --- TabBarToolbarContribution ---

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: CooklangPreviewCommands.TOGGLE_PREVIEW.id + '.toolbar',
            command: CooklangPreviewCommands.TOGGLE_PREVIEW.id,
            tooltip: 'Toggle Preview',
            isVisible: widget => {
                if (widget instanceof RecipePreviewWidget) {
                    return true;
                }
                if (NavigatableWidget.is(widget)) {
                    const uri = widget.getResourceUri();
                    return uri !== undefined && uri.path.ext === '.cook';
                }
                return false;
            },
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: CooklangPreviewCommands.OPEN_SOURCE.id,
            label: 'Open Source',
            when: 'resourceExtname == .cook',
        });
    }

    // --- KeybindingContribution ---

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: CooklangPreviewCommands.TOGGLE_PREVIEW.id,
            keybinding: 'ctrlcmd+shift+v',
            when: `editorLangId == ${COOKLANG_LANGUAGE_ID}`
        });
        keybindings.registerKeybinding({
            command: CooklangPreviewCommands.OPEN_PREVIEW_SIDE.id,
            keybinding: 'ctrlcmd+k v'
        });
    }

    // --- Helpers ---

    /**
     * Returns true if the current widget is a RecipePreviewWidget, or if there
     * is an active editor whose language is Cooklang.
     */
    protected canPreview(): boolean {
        const current = this.shell.currentWidget;
        if (current instanceof RecipePreviewWidget) {
            return true;
        }
        return this.getActiveCooklangEditorUri() !== undefined;
    }

    /**
     * Returns the URI of the active editor when its language is Cooklang,
     * or `undefined` otherwise.
     */
    protected getActiveCooklangEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const { languageId, uri } = editorWidget.editor.document;
        if (languageId !== COOKLANG_LANGUAGE_ID) {
            return undefined;
        }
        return new URI(uri);
    }

    /**
     * Returns true when a toggle/preview action can be performed, accepting
     * optional widget arguments from the toolbar.
     */
    protected canTogglePreview(args: unknown[] = []): boolean {
        if (args.length > 0) {
            if (args[0] instanceof RecipePreviewWidget) {
                return true;
            }
            if (NavigatableWidget.is(args[0])) {
                const uri = (args[0] as NavigatableWidget).getResourceUri();
                if (uri && uri.path.ext === '.cook') {
                    return true;
                }
            }
        }
        return this.canPreview();
    }

    /**
     * Toggles between the preview panel and the source editor.
     *
     * - If the current widget is a preview, reveal the originating editor.
     * - If the current widget is a Cooklang editor, open/reveal the preview in
     *   the same area.
     */
    protected async togglePreview(args: unknown[] = []): Promise<void> {
        // Toolbar may pass the widget as an argument
        const target = args.length > 0 ? args[0] : this.shell.currentWidget;

        if (target instanceof RecipePreviewWidget) {
            const resourceUri = target.getResourceUri();
            if (resourceUri) {
                await this.editorManager.open(resourceUri);
            }
            return;
        }

        const uri = (NavigatableWidget.is(target) && target.getResourceUri()?.path.ext === '.cook')
            ? target.getResourceUri()!
            : this.getActiveCooklangEditorUri();
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main' });
        this.shell.activateWidget(preview.id);
    }

    /**
     * Resolves a .cook URI from command arguments (context menu, toolbar widget)
     * or falls back to the active Cooklang editor.
     */
    protected resolveUri(args: unknown[]): URI | undefined {
        if (args.length > 0 && args[0] instanceof URI) {
            const uri = args[0] as URI;
            if (uri.path.ext === '.cook') {
                return uri;
            }
        }
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (uri && uri.path.ext === '.cook') {
                return uri;
            }
        }
        return this.getActiveCooklangEditorUri();
    }

    protected canOpenPreview(args: unknown[] = []): boolean {
        return this.resolveUri(args) !== undefined;
    }

    protected canOpenSource(args: unknown[] = []): boolean {
        return this.resolveUri(args) !== undefined;
    }

    /**
     * Opens the preview panel to the right of the active Cooklang editor.
     */
    protected async openPreviewSide(args: unknown[] = []): Promise<void> {
        const uri = this.resolveUri(args);
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main', mode: 'open-to-right' });
        this.shell.activateWidget(preview.id);
    }

    /**
     * Returns an existing preview widget for `uri` if one is already open,
     * otherwise creates a new one via the widget factory.
     */
    protected async getOrCreatePreview(uri: URI): Promise<RecipePreviewWidget> {
        const widgetId = createRecipePreviewWidgetId(uri);
        const existing = this.widgetManager.tryGetWidget<RecipePreviewWidget>(widgetId);
        if (existing) {
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<RecipePreviewWidget>(
            RECIPE_PREVIEW_WIDGET_ID,
            { uri: uri.toString() }
        );
    }
}
