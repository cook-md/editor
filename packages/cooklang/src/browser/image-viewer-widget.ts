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
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { LabelProvider } from '@theia/core/lib/browser/label-provider';
import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { RECIPE_IMAGE_MIME_TYPES } from '../common/recipe-images';
import '../../src/browser/style/image-viewer.css';

export const IMAGE_VIEWER_WIDGET_ID = 'cooklang-image-viewer';

/** One viewer per file, so the explorer reveals the open tab instead of adding another. */
export function createImageViewerWidgetId(uri: URI): string {
    return `${IMAGE_VIEWER_WIDGET_ID}:${uri.toString()}`;
}

/** What Chromium's `<img>` renders: the recipe photo formats plus the rest of the common web set. */
const VIEWABLE_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    ...RECIPE_IMAGE_MIME_TYPES,
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
};

/** The MIME type to show `uri` with, or `undefined` when it is not an image the viewer can display. */
export function imageMimeType(uri: URI): string | undefined {
    return VIEWABLE_IMAGE_MIME_TYPES[uri.path.ext.replace(/^\./, '').toLowerCase()];
}

/**
 * Shows an image file in a main-area tab.
 *
 * Before this, an image opened from the explorer went to the text editor, which
 * rejected it with `File seems to be binary and cannot be opened as text` out of
 * an unhandled promise. The renderer is served from `http://localhost`, so
 * `file://` sources are blocked: the bytes come through `FileService` and are
 * shown from a `blob:` URL, revoked on reload and on dispose.
 */
@injectable()
export class ImageViewerWidget extends BaseWidget implements Navigatable {

    /** A read travels over the RPC channel; a file this large would stall the renderer. */
    static readonly MAX_BYTES = 50 * 1024 * 1024;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;

    protected uri: URI;
    protected image: HTMLImageElement;
    protected message: HTMLElement;
    protected objectUrl: string | undefined;
    /** Bumped by every load; a read that started before the bump is stale when it settles. */
    protected loadSequence = 0;

    @postConstruct()
    protected init(): void {
        this.addClass('cooklang-image-viewer');
        this.node.tabIndex = 0;
        this.image = document.createElement('img');
        this.image.hidden = true;
        this.message = document.createElement('p');
        this.message.className = 'cooklang-image-viewer-message';
        this.message.hidden = true;
        this.node.append(this.image, this.message);
        this.toDispose.push(Disposable.create(() => this.revoke()));
    }

    /** Bind this viewer to `uri`, name the tab after it, and load it now and on every change on disk. */
    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createImageViewerWidgetId(uri);
        this.title.label = uri.path.base;
        this.title.caption = uri.path.fsPath();
        this.title.closable = true;
        this.title.iconClass = this.labelProvider.getIcon(uri);
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (event.contains(uri)) {
                this.load();
            }
        }));
        this.load();
    }

    // --- Navigatable ---

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    protected async load(): Promise<void> {
        const sequence = ++this.loadSequence;
        const uri = this.uri;
        const stale = () => sequence !== this.loadSequence || this.isDisposed;
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            if (stale()) {
                return;
            }
            if ((stat.size ?? 0) > ImageViewerWidget.MAX_BYTES) {
                this.showContent(undefined, nls.localize('theia/cooklang/imageViewer/tooLarge', '{0} is too large to display here.', uri.path.base));
                return;
            }
            const content = await this.fileService.readFile(uri);
            if (stale()) {
                return;
            }
            const type = imageMimeType(uri) ?? 'application/octet-stream';
            // `BinaryBuffer#buffer` is typed as `Uint8Array<ArrayBufferLike>`, but
            // `BlobPart` wants `ArrayBufferView<ArrayBuffer>`; the bytes are fine as-is.
            this.showContent(URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type })));
        } catch (e) {
            if (stale()) {
                return;
            }
            // Missing, unreadable, or on a drive that went away: a message, not a crash report.
            console.warn(`[cooklang] failed to load image ${uri.toString()}:`, e);
            this.showContent(undefined, nls.localize('theia/cooklang/imageViewer/unreadable', 'Could not open image: {0}', uri.path.base));
        }
    }

    /** Show `url` in the image, or `text` in its place, releasing whatever was shown before. */
    protected showContent(url: string | undefined, text?: string): void {
        this.revoke();
        this.objectUrl = url;
        if (url) {
            this.image.src = url;
            this.image.alt = this.uri.path.base;
        } else {
            this.image.removeAttribute('src');
        }
        this.image.hidden = url === undefined;
        this.message.textContent = text ?? '';
        this.message.hidden = text === undefined;
    }

    protected revoke(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = undefined;
        }
    }
}
