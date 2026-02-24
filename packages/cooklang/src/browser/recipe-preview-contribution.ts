// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID } from '../common';
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
}

// ---------------------------------------------------------------------------
// RecipePreviewContribution
// ---------------------------------------------------------------------------

@injectable()
export class RecipePreviewContribution implements CommandContribution, KeybindingContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangPreviewCommands.TOGGLE_PREVIEW, {
            execute: () => this.togglePreview(),
            isEnabled: () => this.canPreview(),
            isVisible: () => this.canPreview()
        });
        commands.registerCommand(CooklangPreviewCommands.OPEN_PREVIEW_SIDE, {
            execute: () => this.openPreviewSide(),
            isEnabled: () => this.canPreview(),
            isVisible: () => this.canPreview()
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
     * Toggles between the preview panel and the source editor.
     *
     * - If the current widget is a preview, reveal the originating editor.
     * - If the current widget is a Cooklang editor, open/reveal the preview in
     *   the same area.
     */
    protected async togglePreview(): Promise<void> {
        const current = this.shell.currentWidget;

        if (current instanceof RecipePreviewWidget) {
            const resourceUri = current.getResourceUri();
            if (resourceUri) {
                await this.editorManager.open(resourceUri);
            }
            return;
        }

        const uri = this.getActiveCooklangEditorUri();
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main' });
        this.shell.activateWidget(preview.id);
    }

    /**
     * Opens the preview panel to the right of the active Cooklang editor.
     */
    protected async openPreviewSide(): Promise<void> {
        const uri = this.getActiveCooklangEditorUri();
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
