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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { CommandMenu, CompoundMenuNode, MenuModelRegistry, MenuNode, MenuPath } from '@theia/core/lib/common/menu';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';

/** One visible entry of an outlet, ready to render as a button. */
export interface OutletItem {
    id: string;
    label: string;
    iconClass?: string;
}

/** The parts of a mouse event `showContextMenu` needs (DOM and React events both fit). */
export interface OutletMouseEvent {
    clientX: number;
    clientY: number;
    /** The element the menu was opened on; it scopes `when` clauses and picks the window. */
    readonly currentTarget: EventTarget | null;
    preventDefault(): void;
    stopPropagation(): void;
}

/**
 * Reads what plugins (and the editor itself) contributed to a Cooklang outlet
 * (`CooklangOutlets`) and runs it with the outlet's JSON context.
 */
@injectable()
export class CooklangOutletService {

    @inject(MenuModelRegistry)
    protected readonly menus: MenuModelRegistry;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(ContextKeyService)
    protected readonly contextKeys: ContextKeyService;

    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /**
     * Fires when outlet contents may have changed. Menu additions fire no
     * registry event, but plugin contributions register their commands in the
     * same pass and `onCommandsChanged` fires (debounced) right after.
     */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.menus.onDidChange(() => this.onDidChangeEmitter.fire());
        this.commands.onCommandsChanged(() => this.onDidChangeEmitter.fire());
    }

    getItems(menuPath: MenuPath, context: object): OutletItem[] {
        return this.visibleCommands(menuPath, context).map(node => {
            const item: OutletItem = { id: node.id, label: node.label };
            if (node.icon) {
                item.iconClass = node.icon;
            }
            return item;
        });
    }

    async run(menuPath: MenuPath, id: string, context: object): Promise<void> {
        const node = this.visibleCommands(menuPath, context).find(candidate => candidate.id === id);
        if (!node) {
            return;
        }
        try {
            await node.run(menuPath, context);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            console.error(`[cooklang] outlet command ${id} failed:`, e);
            this.messages.error(nls.localize('theia/cooklang/outletCommandFailed', '{0} failed: {1}', node.label, reason));
        }
    }

    /** Opens the outlet as a context menu; does nothing when it has no visible items. */
    showContextMenu(menuPath: MenuPath, context: object, event: OutletMouseEvent): void {
        if (this.visibleCommands(menuPath, context).length === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuRenderer.render({
            menuPath,
            anchor: { x: event.clientX, y: event.clientY },
            args: [context],
            // The anchor is a DOM object; plugin commands only get the JSON context.
            includeAnchorArg: false,
            context: event.currentTarget instanceof HTMLElement ? event.currentTarget : document.body,
        });
    }

    /** `uri` and workspace-relative `path` for an outlet context. */
    describe(uri: URI): { uri: string; path: string } {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const relative = root && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        return { uri: uri.toString(), path: relative ?? uri.path.base };
    }

    protected visibleCommands(menuPath: MenuPath, context: object): CommandMenu[] {
        const root = this.menus.getMenu(menuPath);
        if (!root) {
            return [];
        }
        const out: CommandMenu[] = [];
        const visit = (node: MenuNode): void => {
            if (!node.isVisible(menuPath, this.contextKeys, undefined, context)) {
                return;
            }
            if (CommandMenu.is(node)) {
                out.push(node);
            } else if (CompoundMenuNode.is(node)) {
                [...node.children].sort(CompoundMenuNode.sortChildren).forEach(visit);
            }
        };
        [...root.children].sort(CompoundMenuNode.sortChildren).forEach(visit);
        return out;
    }
}
