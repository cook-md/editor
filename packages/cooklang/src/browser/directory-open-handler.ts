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
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

/**
 * Opens a folder as a workspace instead of as a text file.
 *
 * Dragging a folder from Finder or Explorer onto the editor area hands its path to
 * the opener service like any dropped file. Without this the text editor claims
 * it and fails with `A resource provider for '…' is not registered`.
 */
@injectable()
export class DirectoryOpenHandler implements OpenHandler {

    /** Ahead of every editor: nothing else can show a folder. */
    static readonly PRIORITY = 1000;

    readonly id = 'cooklang-directory';
    readonly label = nls.localizeByDefault('Open Folder');

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    async canHandle(uri: URI): Promise<number> {
        if (uri.scheme !== 'file') {
            return 0;
        }
        try {
            const stat = await this.fileService.resolve(uri);
            return stat.isDirectory ? DirectoryOpenHandler.PRIORITY : 0;
        } catch {
            // Missing or unreadable: let the editor report it as it normally would.
            return 0;
        }
    }

    async open(uri: URI): Promise<undefined> {
        this.workspaceService.open(uri);
        return undefined;
    }
}
