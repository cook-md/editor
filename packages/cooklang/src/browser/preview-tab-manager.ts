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

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { OpenerOptions } from '@theia/core/lib/browser/opener-service';
import { Disposable } from '@theia/core/lib/common';

import '../../src/browser/style/preview-tab.css';

/**
 * Opener options carrying the "preview tab" flag: the explorer sets it for a
 * single click and leaves it off for a double click, and Theia's text editors
 * read the same flag.
 */
export interface PreviewTabOpenerOptions extends OpenerOptions {
    preview?: boolean;
}

/** Marks the tab title of the reusable preview, rendering its label in italics. */
const TEMPORARY_TITLE_CLASS = 'cooklang-preview-tab-temporary';

/** What counts as using a preview rather than glancing at it. */
const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="link"]';

/**
 * Keeps browsing recipes down to a single tab.
 *
 * A recipe or menu opened by a single click lands in one reusable tab, the way
 * VS Code and Theia's own text editors treat a preview: the next recipe opened
 * the same way takes its place. The tab stops being reusable as soon as it is
 * used for real - a double click, a started timer, a followed link, a changed
 * scale - or when the recipe is opened deliberately (a double click in the
 * explorer, a command, the preview toolbar).
 */
@injectable()
export class PreviewTabManager {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    /** The preview currently occupying the reusable tab, if any. */
    protected temporary: BaseWidget | undefined;

    /** Untracks {@link temporary} when it goes away on its own. */
    protected toReset: Disposable | undefined;

    @postConstruct()
    protected init(): void {
        document.addEventListener('dblclick', this.handleDoubleClick, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
    }

    /**
     * Where to attach a preview that is about to open. A reusable tab is passed
     * as the reference of a `tab-replace`, so the shell puts the new preview in
     * its place and closes it.
     */
    placement(): ApplicationShell.WidgetOptions {
        const reused = this.temporary;
        return reused?.isAttached
            ? { area: 'main', mode: 'tab-replace', ref: reused }
            : { area: 'main' };
    }

    /**
     * Record what `widget` became now that it is open.
     *
     * @param options the opener options it was opened with.
     * @param created whether this open created the widget. A tab that was
     * already open keeps the state it had: reopening never turns a tab the user
     * has settled into back into a reusable one.
     */
    apply(widget: BaseWidget, options: OpenerOptions | undefined, created: boolean): void {
        const requested = this.isTemporaryRequested(options);
        if (this.temporary === widget) {
            if (!requested) {
                this.pin(widget);
            }
            return;
        }
        if (!requested || !created) {
            return;
        }
        this.reset();
        this.temporary = widget;
        widget.title.className += ` ${TEMPORARY_TITLE_CLASS}`;
        this.toReset = widget.onDidDispose(() => this.reset());
    }

    /** Make `widget` a tab of its own, if it is the reusable one. */
    pin(widget: BaseWidget): void {
        if (this.temporary !== widget) {
            return;
        }
        widget.title.className = widget.title.className.replace(TEMPORARY_TITLE_CLASS, '').trim();
        this.reset();
    }

    protected isTemporaryRequested(options: OpenerOptions | undefined): boolean {
        return !!(options as PreviewTabOpenerOptions | undefined)?.preview
            && this.preferenceService.get<boolean>('editor.enablePreview', true);
    }

    protected reset(): void {
        this.temporary = undefined;
        this.toReset?.dispose();
        this.toReset = undefined;
    }

    protected readonly handleDoubleClick = (event: MouseEvent): void => {
        if (this.isInsideTemporary(event)) {
            this.pin(this.temporary!);
        }
    };

    protected readonly handleClick = (event: MouseEvent): void => {
        if (this.isInsideTemporary(event) && this.isInteractive(event.target)) {
            this.pin(this.temporary!);
        }
    };

    protected readonly handleKeyDown = (event: KeyboardEvent): void => {
        if ((event.key === 'Enter' || event.key === ' ') && this.isInsideTemporary(event) && this.isInteractive(event.target)) {
            this.pin(this.temporary!);
        }
    };

    /**
     * Whether the event happened in the reusable preview itself. Clicks on its
     * tab are deliberately not "inside": picking a tab is not using it.
     */
    protected isInsideTemporary(event: Event): boolean {
        const widget = this.temporary;
        return !!widget && event.target instanceof Node && widget.node.contains(event.target);
    }

    protected isInteractive(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest(INTERACTIVE_SELECTOR);
    }
}
