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

import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';

const MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/**
 * Turns local image files into `blob:` URLs an `<img>` can load.
 *
 * The Theia renderer is served from `http://localhost:<port>`, so Chromium
 * blocks `file://` sources: the bytes have to come through `FileService`.
 * One instance is bound per preview widget, and `releaseAll` runs on dispose.
 */
@injectable()
export class RecipeImageService {

    /**
     * `FileService` reads travel over the RPC channel to the backend, so a very
     * large file would stall the preview. Recipe photos are far below this.
     */
    static readonly MAX_BYTES = 20 * 1024 * 1024;

    @inject(FileService)
    protected readonly fileService: FileService;

    protected readonly urls = new Map<string, string>();

    /**
     * A `blob:` URL for `uri`, or `undefined` when the file is missing,
     * unreadable, too large, or not a supported image type. Repeated calls for
     * the same URI reuse one object URL.
     */
    async resolve(uri: URI): Promise<string | undefined> {
        const key = uri.toString();
        const cached = this.urls.get(key);
        if (cached) {
            return cached;
        }
        const type = MIME_TYPES[uri.path.ext.replace(/^\./, '').toLowerCase()];
        if (!type) {
            return undefined;
        }
        try {
            const stat = await this.fileService.resolve(uri);
            if ((stat.size ?? 0) > RecipeImageService.MAX_BYTES) {
                return undefined;
            }
            const content = await this.fileService.readFile(uri);
            // `BinaryBuffer#buffer` is typed as `Uint8Array<ArrayBufferLike>`, but
            // `BlobPart` wants `ArrayBufferView<ArrayBuffer>`; the bytes are fine as-is.
            const url = URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type }));
            // Another call may have populated the cache while we awaited.
            const raced = this.urls.get(key);
            if (raced) {
                URL.revokeObjectURL(url);
                return raced;
            }
            this.urls.set(key, url);
            return url;
        } catch {
            return undefined;
        }
    }

    /**
     * Drop the cached URL for one file, so the next `resolve` re-reads it.
     * Needed when an image is replaced in place: the URI is unchanged, so
     * without this the preview would keep showing the old bytes.
     */
    release(uri: URI): void {
        const key = uri.toString();
        const url = this.urls.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            this.urls.delete(key);
        }
    }

    /** Revoke every object URL handed out so far and empty the cache. */
    releaseAll(): void {
        for (const url of this.urls.values()) {
            URL.revokeObjectURL(url);
        }
        this.urls.clear();
    }
}
