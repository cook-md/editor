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

import { Disposable } from '@theia/core/lib/common/disposable';
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { MenuPath } from '@theia/core/lib/common/menu';
import { PreviewBadge } from '../common/cooklang-outlet-context';
import { CooklangOutletService } from './cooklang-outlet-service';

/** What a preview widget tells its {@link PreviewBadgeController} about itself. */
export interface PreviewBadgeHost {
    /** The badge outlet to query, e.g. `CooklangOutlets.RECIPE_PREVIEW_BADGE`. */
    readonly outlet: MenuPath;
    /** The widget's DOM node; outlet `when` clauses are evaluated against it. */
    readonly element: HTMLElement;
    /** The outlet context for what the preview currently shows, or `undefined` when nothing is loaded (no badges). */
    context(): object | undefined;
    /** Lumino's `isVisible`: a hidden preview defers refreshes until it is shown again. */
    isVisible(): boolean;
    /** Identifies the shown document (its URI) so the number of badges can be remembered per document; `undefined` when unbound. */
    uri?(): string | undefined;
    /** `badges` changed, or the first result arrived (see {@link PreviewBadgeController.pending}); the widget should re-render. */
    onDidChangeBadges(): void;
}

/**
 * Badge bookkeeping shared by the recipe and menu previews: badges call plugins
 * (and the network), so refreshes are debounced, deferred while the preview is
 * hidden, guarded against out-of-order results, and the hover card the badges
 * open is cancelled only by the controller that opened it.
 */
export class PreviewBadgeController implements Disposable {

    static readonly DEBOUNCE_MS = 500;
    /** Placeholder count when nothing is remembered for the document and the outlet's contributions are unknown. */
    static readonly DEFAULT_PLACEHOLDERS = 3;
    /** Upper bound for the placeholders shown while loading. */
    static readonly MAX_PLACEHOLDERS = 6;
    /** Number of documents whose badge count is remembered. */
    protected static readonly MEMORY_LIMIT = 200;
    /** Badge counts of the last settled result per outlet and document, kept for the session so reopening a document reserves the right space at once. */
    protected static readonly remembered = new Map<string, number>();

    /** Forgets every remembered badge count. For tests. */
    static clearMemory(): void {
        PreviewBadgeController.remembered.clear();
    }

    badges: PreviewBadge[] = [];
    /**
     * The first badge result for the shown document has not arrived yet. The
     * widget renders {@link placeholderCount} placeholders meanwhile. Stays
     * false across later refreshes: the previous badges are kept until the new
     * result replaces them.
     */
    pending = true;
    /** Overridable in tests; production code always uses {@link DEBOUNCE_MS}. */
    debounceMs = PreviewBadgeController.DEBOUNCE_MS;
    /** A refresh was requested while hidden; run it once the preview is shown again. */
    stale = false;
    /** Whether this controller currently has a badge hover open, so {@link hideHover} never cancels another widget's. */
    hoverShown = false;
    protected sequence = 0;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;

    constructor(
        protected readonly outlets: CooklangOutletService,
        protected readonly hoverService: HoverService,
        protected readonly host: PreviewBadgeHost,
    ) { }

    /** Refresh after edits settle; a hidden preview defers until `flushStale`. */
    schedule(): void {
        if (this.disposed) {
            return;
        }
        if (!this.host.isVisible()) {
            this.stale = true;
            return;
        }
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.refresh().catch(e => console.warn('[cooklang] badge refresh failed:', e));
        }, this.debounceMs);
    }

    /** Runs a refresh deferred by `schedule` while hidden, once the preview is visible again. */
    flushStale(): void {
        if (this.stale && this.host.isVisible()) {
            this.stale = false;
            this.schedule();
        }
    }

    /**
     * The preview switched to another source: forget the old badges and let no
     * refresh for the old source land after this. Does not call
     * `onDidChangeBadges`; the caller re-renders.
     */
    reset(awaitResult = true): void {
        this.badges = [];
        // A new source awaits its first result, unless the caller knows none will come (e.g. a parse failure).
        this.pending = awaitResult;
        this.sequence++;
        this.clearTimer();
    }

    /** How many placeholders to show while {@link pending}: the count last seen for this document, else the outlet's contributions, else a default. */
    get placeholderCount(): number {
        const known = PreviewBadgeController.remembered.get(this.memoryKey());
        if (known !== undefined) {
            return known;
        }
        let count = PreviewBadgeController.DEFAULT_PLACEHOLDERS;
        try {
            const context = this.host.context();
            if (context) {
                count = this.outlets.getItems(this.host.outlet, context, this.host.element).length;
            }
        } catch {
            // Only a layout hint; fall back to the default.
        }
        return Math.min(count, PreviewBadgeController.MAX_PLACEHOLDERS);
    }

    /** Queries the outlet now (unless disposed) and re-renders the host when the badges changed; a pending debounce is dropped. */
    async refresh(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.clearTimer();
        const sequence = ++this.sequence;
        const context = this.host.context();
        let badges: PreviewBadge[] = [];
        try {
            badges = context ? await this.outlets.collectBadges(this.host.outlet, context, this.host.element) : [];
        } catch (e) {
            console.warn('[cooklang] badge collection failed:', e);
        }
        if (this.disposed || sequence !== this.sequence) {
            return;
        }
        const settled = this.pending;
        this.pending = false;
        if (context) {
            this.remember(badges.length);
        }
        if (settled || !PreviewBadge.equals(this.badges, badges)) {
            this.badges = badges;
            this.host.onDidChangeBadges();
        }
    }

    protected memoryKey(): string {
        return `${this.host.outlet.join('/')}|${this.host.uri?.() ?? ''}`;
    }

    protected remember(count: number): void {
        if (this.host.uri?.() === undefined) {
            return;
        }
        const memory = PreviewBadgeController.remembered;
        const key = this.memoryKey();
        memory.delete(key); // re-insert so the oldest entry is the least recently settled
        memory.set(key, count);
        if (memory.size > PreviewBadgeController.MEMORY_LIMIT) {
            memory.delete(memory.keys().next().value as string);
        }
    }

    /** `immediate` is true for keyboard focus and clicks, where the hover delay would feel broken. */
    showDetails(badge: PreviewBadge, target: HTMLElement, immediate: boolean): void {
        // `requestHover` first cancels any hover already open, which runs ITS
        // `onHide` synchronously — moving the mouse from one badge straight to
        // another would otherwise clear the flag this call is about to set.
        // Setting it after, not before, keeps it true across the move.
        this.hoverService.requestHover({
            // Untrusted, no HTML: plugin text never runs commands or injects markup.
            content: new MarkdownStringImpl(badge.tooltipMarkdown, { isTrusted: false, supportHtml: false }),
            target,
            position: 'bottom',
            cssClasses: ['cooklang-preview-badge-hover'],
            skipHoverDelay: immediate,
            // HoverService can close the hover on its own (mouseout, mousedown
            // elsewhere), without going through `hideDetails`.
            onHide: () => { this.hoverShown = false; },
        });
        this.hoverShown = true;
    }

    /** The badge lost focus: close the hover and give up ownership. */
    hideDetails(): void {
        this.hoverShown = false;
        this.hoverService.cancelHover();
    }

    /**
     * Hides this controller's own hover, if any. `HoverService.cancelHover`
     * is global — it hides whatever hover is open, regardless of who opened
     * it — so this only calls it when `hoverShown` confirms it is ours.
     */
    hideHover(): void {
        if (this.hoverShown) {
            this.hoverService.cancelHover();
        }
        this.hoverShown = false;
    }

    dispose(): void {
        this.disposed = true;
        this.clearTimer();
        this.hideHover();
    }

    protected clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
