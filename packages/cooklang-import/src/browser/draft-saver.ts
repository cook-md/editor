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
import URI from '@theia/core/lib/common/uri';
import { nls } from '@theia/core/lib/common/nls';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ConvertSuccess } from '../common/recipe-import-protocol';
import { DraftName } from './draft-name';

export const DRAFTS_FOLDER_NAME = 'Drafts';

/**
 * Writes a converted recipe into `<workspace root>/Drafts/<Title>.cook`
 * (creating the folder and de-duplicating the name) and opens it in the editor.
 */
@injectable()
export class DraftSaver {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    async save(result: ConvertSuccess): Promise<URI> {
        const roots = await this.workspaceService.roots;
        if (roots.length === 0) {
            throw new Error(nls.localize('theia/cooklang-import/noWorkspace', 'Open a folder before importing recipes.'));
        }
        const draftsDir = roots[0].resource.resolve(DRAFTS_FOLDER_NAME);
        if (!await this.fileService.exists(draftsDir)) {
            await this.fileService.createFolder(draftsDir);
        }
        const title = DraftName.resolveTitle(result.cooklang, result.name)
            ?? nls.localize('theia/cooklang-import/importedRecipe', 'Imported Recipe');
        const content = DraftName.ensureTitleFrontmatter(result.cooklang, title);
        const base = await DraftName.uniqueBaseName(
            DraftName.sanitizeFilename(title),
            candidate => this.fileService.exists(draftsDir.resolve(`${candidate}.cook`))
        );
        const uri = draftsDir.resolve(`${base}.cook`);
        await this.fileService.create(uri, content);
        await open(this.openerService, uri);
        return uri;
    }
}
