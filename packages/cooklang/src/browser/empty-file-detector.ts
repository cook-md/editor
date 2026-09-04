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

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';

/**
 * Tells whether a file has any content yet.
 *
 * The previews open by default for `.cook` and `.menu` files, which is the
 * right thing for a recipe that exists but useless for one that does not: a
 * file straight out of `New File...` renders as an empty preview with no way
 * to type into it. The preview open handlers therefore stand down for empty
 * files so the text editor takes over.
 */
@injectable()
export class EmptyFileDetector {

    @inject(FileService)
    protected readonly fileService: FileService;

    /**
     * Whether `uri` is an existing file with no content.
     *
     * Never rejects: a file that cannot be stat'ed is reported as non-empty so
     * that opening behaves as it did before, rather than degrading to the
     * editor on a transient filesystem error.
     */
    async isEmpty(uri: URI): Promise<boolean> {
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            return !stat.isDirectory && stat.size === 0;
        } catch (e) {
            console.warn(`[cooklang] could not stat ${uri.toString()}:`, e);
            return false;
        }
    }
}
