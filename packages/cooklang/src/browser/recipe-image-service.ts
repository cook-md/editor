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
import { RECIPE_IMAGE_MIME_TYPES } from '../common/recipe-images';

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

    /** Object URLs for reads that have settled, so they can be revoked. */
    protected readonly urls = new Map<string, string>();

    /** In-flight or settled reads, so concurrent callers share one read. */
    protected readonly pending = new Map<string, Promise<string | undefined>>();

    /**
     * Bumped by every `release`/`releaseAll`. A read that started before the
     * bump is stale by the time it settles and must not populate the cache.
     */
    protected epoch = 0;

    /**
     * A `blob:` URL for `uri`, or `undefined` when the file is missing,
     * unreadable, too large, or not a supported image type. Repeated calls for
     * the same URI reuse one object URL, and concurrent calls share one read.
     */
    resolve(uri: URI): Promise<string | undefined> {
        const key = uri.toString();
        const inFlight = this.pending.get(key);
        if (inFlight) {
            return inFlight;
        }
        const type = RECIPE_IMAGE_MIME_TYPES[uri.path.ext.replace(/^\./, '').toLowerCase()];
        if (!type) {
            return Promise.resolve(undefined);
        }
        const read = this.read(uri, key, type);
        this.pending.set(key, read);
        return read;
    }

    /** Read one file and cache its object URL, unless invalidated meanwhile. */
    protected async read(uri: URI, key: string, type: string): Promise<string | undefined> {
        const epoch = this.epoch;
        try {
            const stat = await this.fileService.resolve(uri);
            if ((stat.size ?? 0) > RecipeImageService.MAX_BYTES) {
                this.forget(key, epoch);
                return undefined;
            }
            const content = await this.fileService.readFile(uri);
            // `BinaryBuffer#buffer` is typed as `Uint8Array<ArrayBufferLike>`, but
            // `BlobPart` wants `ArrayBufferView<ArrayBuffer>`; the bytes are fine as-is.
            const url = URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type }));
            if (epoch !== this.epoch) {
                // The file was invalidated, or the widget disposed, while this read
                // was in flight. These bytes are stale and nothing would ever revoke
                // the URL, so drop it instead of caching it.
                URL.revokeObjectURL(url);
                return undefined;
            }
            this.urls.set(key, url);
            return url;
        } catch {
            this.forget(key, epoch);
            return undefined;
        }
    }

    /** Drop a read that produced nothing, so a later call retries it. */
    protected forget(key: string, epoch: number): void {
        if (epoch === this.epoch) {
            this.pending.delete(key);
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
        this.pending.delete(key);
        this.epoch++;
    }

    /** Revoke every object URL handed out so far and empty the cache. */
    releaseAll(): void {
        for (const url of this.urls.values()) {
            URL.revokeObjectURL(url);
        }
        this.urls.clear();
        this.pending.clear();
        this.epoch++;
    }
}
