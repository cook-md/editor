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
import { COOKLANG_LANGUAGE_ID } from '../common';
import {
    MenuPreviewWidget,
    MENU_PREVIEW_WIDGET_ID,
    createMenuPreviewWidgetId,
} from './menu-preview-widget';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export namespace CooklangMenuPreviewCommands {
    export const TOGGLE_MENU_PREVIEW: Command = {
        id: 'cooklang.toggleMenuPreview',
        label: 'Cooklang: Toggle Menu Preview',
        iconClass: 'codicon codicon-open-preview'
    };
    export const OPEN_MENU_PREVIEW_SIDE: Command = {
        id: 'cooklang.openMenuPreviewSide',
        label: 'Cooklang: Open Menu Preview to the Side',
        iconClass: 'codicon codicon-open-preview'
    };
    export const OPEN_MENU_SOURCE: Command = {
        id: 'cooklang.openMenuSource',
        label: 'Cooklang: Open Menu Source',
        iconClass: 'codicon codicon-go-to-file'
    };
}

// ---------------------------------------------------------------------------
// MenuPreviewContribution
// ---------------------------------------------------------------------------

@injectable()
export class MenuPreviewContribution implements CommandContribution, KeybindingContribution, OpenHandler, TabBarToolbarContribution, MenuContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    readonly id = 'cooklang-menu-preview-open-handler';
    readonly label = 'Cooklang: Menu Preview';

    canHandle(uri: URI): number {
        if (uri.path.ext === '.menu') {
            return 200;
        }
        return 0;
    }

    async open(uri: URI): Promise<MenuPreviewWidget> {
        const preview = await this.getOrCreatePreview(uri);
        if (!preview.isAttached) {
            await this.shell.addWidget(preview, { area: 'main' });
        }
        this.shell.activateWidget(preview.id);
        return preview;
    }

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW, {
            execute: (...args: unknown[]) => this.togglePreview(args),
            isEnabled: (...args: unknown[]) => this.canTogglePreview(args),
        });
        commands.registerCommand(CooklangMenuPreviewCommands.OPEN_MENU_PREVIEW_SIDE, {
            execute: (...args: unknown[]) => this.openPreviewSide(args),
            isEnabled: (...args: unknown[]) => this.canOpenPreview(args),
        });
        commands.registerCommand(CooklangMenuPreviewCommands.OPEN_MENU_SOURCE,
            UriAwareCommandHandler.MonoSelect(this.selectionService, {
                execute: uri => this.editorManager.open(uri),
                isEnabled: uri => uri.path.ext === '.menu',
            })
        );
    }

    // --- TabBarToolbarContribution ---

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW.id + '.toolbar',
            command: CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW.id,
            tooltip: 'Toggle Menu Preview',
            isVisible: widget => {
                if (widget instanceof MenuPreviewWidget) {
                    return true;
                }
                if (NavigatableWidget.is(widget)) {
                    const uri = widget.getResourceUri();
                    return uri !== undefined && uri.path.ext === '.menu';
                }
                return false;
            },
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: CooklangMenuPreviewCommands.OPEN_MENU_SOURCE.id,
            label: 'Open Source',
            when: 'resourceExtname == .menu',
        });
    }

    // --- KeybindingContribution ---

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: CooklangMenuPreviewCommands.TOGGLE_MENU_PREVIEW.id,
            keybinding: 'ctrlcmd+shift+v',
            when: `editorLangId == ${COOKLANG_LANGUAGE_ID} && resourceExtname == .menu`
        });
        keybindings.registerKeybinding({
            command: CooklangMenuPreviewCommands.OPEN_MENU_PREVIEW_SIDE.id,
            keybinding: 'ctrlcmd+k v',
            when: `resourceExtname == .menu`
        });
    }

    // --- Helpers ---

    /**
     * Returns true if the current widget is a MenuPreviewWidget, or if there
     * is an active editor whose file has a `.menu` extension.
     */
    protected canPreviewMenu(): boolean {
        const current = this.shell.currentWidget;
        if (current instanceof MenuPreviewWidget) {
            return true;
        }
        return this.getActiveMenuEditorUri() !== undefined;
    }

    /**
     * Returns the URI of the active editor when its file has a `.menu` extension,
     * or `undefined` otherwise.
     */
    protected getActiveMenuEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const uri = new URI(editorWidget.editor.document.uri);
        if (uri.path.ext !== '.menu') {
            return undefined;
        }
        return uri;
    }

    /**
     * Returns true when a toggle/preview action can be performed, accepting
     * optional widget arguments from the toolbar.
     */
    protected canTogglePreview(args: unknown[] = []): boolean {
        if (args.length > 0) {
            if (args[0] instanceof MenuPreviewWidget) {
                return true;
            }
            if (NavigatableWidget.is(args[0])) {
                const uri = (args[0] as NavigatableWidget).getResourceUri();
                if (uri && uri.path.ext === '.menu') {
                    return true;
                }
            }
        }
        return this.canPreviewMenu();
    }

    /**
     * Toggles between the preview panel and the source editor.
     *
     * - If the current widget is a preview, reveal the originating editor.
     * - If the current widget is a menu editor, open/reveal the preview in
     *   the same area.
     */
    protected async togglePreview(args: unknown[] = []): Promise<void> {
        const target = args.length > 0 ? args[0] : this.shell.currentWidget;

        if (target instanceof MenuPreviewWidget) {
            const resourceUri = target.getResourceUri();
            if (resourceUri) {
                await this.editorManager.open(resourceUri);
            }
            return;
        }

        const uri = (NavigatableWidget.is(target) && target.getResourceUri()?.path.ext === '.menu')
            ? target.getResourceUri()!
            : this.getActiveMenuEditorUri();
        if (!uri) {
            return;
        }

        const preview = await this.getOrCreatePreview(uri);
        await this.shell.addWidget(preview, { area: 'main' });
        this.shell.activateWidget(preview.id);
    }

    /**
     * Resolves a .menu URI from command arguments (context menu, toolbar widget)
     * or falls back to the active menu editor.
     */
    protected resolveUri(args: unknown[]): URI | undefined {
        if (args.length > 0 && args[0] instanceof URI) {
            const uri = args[0] as URI;
            if (uri.path.ext === '.menu') {
                return uri;
            }
        }
        if (args.length > 0 && NavigatableWidget.is(args[0])) {
            const uri = (args[0] as NavigatableWidget).getResourceUri();
            if (uri && uri.path.ext === '.menu') {
                return uri;
            }
        }
        return this.getActiveMenuEditorUri();
    }

    protected canOpenPreview(args: unknown[] = []): boolean {
        return this.resolveUri(args) !== undefined;
    }

    protected canOpenSource(args: unknown[] = []): boolean {
        return this.resolveUri(args) !== undefined;
    }

    /**
     * Opens the preview panel to the right of the active menu editor.
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
    protected async getOrCreatePreview(uri: URI): Promise<MenuPreviewWidget> {
        const widgetId = createMenuPreviewWidgetId(uri);
        const existing = this.widgetManager.tryGetWidget<MenuPreviewWidget>(widgetId);
        if (existing) {
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<MenuPreviewWidget>(
            MENU_PREVIEW_WIDGET_ID,
            { uri: uri.toString() }
        );
    }
}
