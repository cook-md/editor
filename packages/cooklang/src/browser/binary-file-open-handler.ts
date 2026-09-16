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
import { open, OpenerOptions, OpenerService, OpenHandler } from '@theia/core/lib/browser/opener-service';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';

/**
 * Files Chromium cannot show and the text editor cannot edit. Archives first: a
 * Crouton or Paprika export is a zip, and the system unpacks it. Installers and
 * executables are left out on purpose; a recipe editor should not launch them.
 */
const BINARY_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
    'zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'epub',
    'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm',
    'heic', 'heif', 'psd', 'ai', 'sketch',
]);

/** The options the electron-browser `ExternalAppOpenHandler` looks for. */
interface ExternalAppOpenerOptions extends OpenerOptions {
    openExternalApp?: boolean;
}

/**
 * Sends known binary files to the system application instead of the text editor.
 *
 * Before this, a double-click on `export.zip` reached the editor, which rejected
 * it with `File seems to be binary and cannot be opened as text` out of an
 * unhandled promise, and the user saw nothing happen.
 */
@injectable()
export class BinaryFileOpenHandler implements OpenHandler {

    /** Above the text editor (100), like the other type-specific openers here. */
    static readonly PRIORITY = 300;

    readonly id = 'cooklang-binary-file';
    readonly label = nls.localize('theia/cooklang/binaryFile/label', 'System Application');

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    canHandle(uri: URI, options?: ExternalAppOpenerOptions): number {
        if (options?.openExternalApp) {
            // That request is for the system-app opener; answering it would come straight back here.
            return 0;
        }
        if (uri.scheme !== 'file') {
            return 0;
        }
        const extension = uri.path.ext.replace(/^\./, '').toLowerCase();
        return BINARY_FILE_EXTENSIONS.has(extension) ? BinaryFileOpenHandler.PRIORITY : 0;
    }

    async open(uri: URI): Promise<undefined> {
        await open(this.openerService, uri, { openExternalApp: true } as ExternalAppOpenerOptions);
        return undefined;
    }
}
