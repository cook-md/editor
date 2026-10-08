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
    /** `badges` changed; the widget should re-render. */
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

    badges: PreviewBadge[] = [];
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
    reset(): void {
        this.badges = [];
        this.sequence++;
        this.clearTimer();
    }

    /** Queries the outlet now (unless disposed) and re-renders the host when the badges changed; a pending debounce is dropped. */
    async refresh(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.clearTimer();
        const sequence = ++this.sequence;
        const context = this.host.context();
        const badges = context ? await this.outlets.collectBadges(this.host.outlet, context, this.host.element) : [];
        if (this.disposed || sequence !== this.sequence) {
            return;
        }
        if (!PreviewBadge.equals(this.badges, badges)) {
            this.badges = badges;
            this.host.onDidChangeBadges();
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
