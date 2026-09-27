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
import { PreviewBadge } from '../common/cooklang-outlet-context';

/** Sentinel `collectBadge` races a pending `executeCommand` against; never leaks outside this module. */
const BADGE_TIMEOUT = Symbol('badge-timeout');

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

    /** How long {@link collectBadge} waits for a badge provider before treating it as failed. */
    static readonly BADGE_TIMEOUT_MS = 10000;

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

    /** Overridable in tests; production code always uses {@link BADGE_TIMEOUT_MS}. */
    protected badgeTimeoutMs = CooklangOutletService.BADGE_TIMEOUT_MS;

    /** Command ids of badge providers whose last attempt failed (threw or timed out); used to log a failure only once. */
    protected readonly failingBadgeProviders = new Set<string>();

    @postConstruct()
    protected init(): void {
        // Not disposed: this service is a root singleton that lives as long as the registries it listens to.
        this.menus.onDidChange(() => this.onDidChangeEmitter.fire());
        this.commands.onCommandsChanged(() => this.onDidChangeEmitter.fire());
    }

    /**
     * Tells outlet hosts that contents may have changed although no menu or
     * command did, e.g. a badge provider's settings. Hosts re-query on
     * {@link onDidChange}; the recipe preview debounces badge refreshes.
     */
    refresh(): void {
        this.onDidChangeEmitter.fire();
    }

    /**
     * The outlet's visible entries. `element` scopes `when` clauses: context keys
     * set on it or on an ancestor (like the recipe preview's
     * `cooklangPreviewScheme`) apply. Without it, `when` clauses are evaluated
     * against the focused element.
     */
    getItems(menuPath: MenuPath, context: object, element?: HTMLElement): OutletItem[] {
        return this.visibleCommands(menuPath, context, element).map(node => {
            const item: OutletItem = { id: node.id, label: node.label };
            if (node.icon) {
                item.iconClass = node.icon;
            }
            return item;
        });
    }

    /** Runs one visible entry with `context`; `element` scopes `when` clauses as in {@link getItems}. */
    async run(menuPath: MenuPath, id: string, context: object, element?: HTMLElement): Promise<void> {
        const node = this.visibleCommands(menuPath, context, element).find(candidate => candidate.id === id);
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

    /**
     * Runs every visible command of a badge outlet with `context` and returns
     * the valid badges in outlet order. A provider that fails, times out or
     * returns something else just shows no badge; badges are passive, so no
     * error notification.
     */
    async collectBadges(menuPath: MenuPath, context: object, element?: HTMLElement): Promise<PreviewBadge[]> {
        const nodes = this.visibleCommands(menuPath, context, element);
        const results = await Promise.all(nodes.map(node => this.collectBadge(node, context)));
        return results.filter((badge): badge is PreviewBadge => badge !== undefined);
    }

    /**
     * Runs one badge provider with a timeout, so a single hung command cannot
     * block the other badges in {@link collectBadges} (which awaits all of
     * them together). An `undefined` or malformed result is not a failure and
     * is never logged; a throw or a timeout is a failure and is logged once
     * (see {@link failingBadgeProviders}).
     */
    protected async collectBadge(node: CommandMenu, context: object): Promise<PreviewBadge | undefined> {
        // The Promise executor runs synchronously, so `timer` is assigned before it is read below.
        let timer!: ReturnType<typeof setTimeout>;
        const timeout = new Promise<typeof BADGE_TIMEOUT>(resolve => {
            timer = setTimeout(() => resolve(BADGE_TIMEOUT), this.badgeTimeoutMs);
        });
        const execution = this.commands.executeCommand(node.id, context);
        try {
            const outcome = await Promise.race([execution, timeout]);
            if (outcome === BADGE_TIMEOUT) {
                // The command is still pending; don't let its eventual settlement become an unhandled rejection.
                execution.catch(() => { /* already timed out */ });
                this.reportBadgeFailure(node.id, `timed out after ${this.badgeTimeoutMs}ms`);
                return undefined;
            }
            clearTimeout(timer);
            this.reportBadgeSuccess(node.id);
            return PreviewBadge.parse(outcome);
        } catch (e) {
            clearTimeout(timer);
            this.reportBadgeFailure(node.id, e);
            return undefined;
        }
    }

    /** Logs a warning the first time `id` fails; repeats are silent until it recovers. */
    protected reportBadgeFailure(id: string, reason: unknown): void {
        if (!this.failingBadgeProviders.has(id)) {
            this.failingBadgeProviders.add(id);
            console.warn(`[cooklang] badge provider ${id} failed:`, reason);
        }
    }

    /** Logs a recovery info once for a provider that was previously failing. */
    protected reportBadgeSuccess(id: string): void {
        if (this.failingBadgeProviders.delete(id)) {
            console.info(`[cooklang] badge provider ${id} recovered`);
        }
    }

    /** Opens the outlet as a context menu; does nothing when it has no visible items. */
    showContextMenu(menuPath: MenuPath, context: object, event: OutletMouseEvent): void {
        const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : document.body;
        if (this.visibleCommands(menuPath, context, element).length === 0) {
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
            context: element,
        });
    }

    /**
     * `uri` (with its real scheme) and workspace-relative `path` for an outlet
     * context. `path` is `''` when the resource is outside the workspace:
     * another folder, or a non-`file` URI such as `cooklang-hub:`.
     */
    describe(uri: URI): { uri: string; path: string } {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const relative = root && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        return { uri: uri.toString(), path: relative ?? '' };
    }

    protected visibleCommands(menuPath: MenuPath, context: object, element?: HTMLElement): CommandMenu[] {
        const root = this.menus.getMenu(menuPath);
        if (!root) {
            return [];
        }
        const out: CommandMenu[] = [];
        const visit = (node: MenuNode): void => {
            if (!node.isVisible(menuPath, this.contextKeys, element, context)) {
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
