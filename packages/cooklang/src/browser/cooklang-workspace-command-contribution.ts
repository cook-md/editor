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

import { injectable } from '@theia/core/shared/inversify';
import { WorkspaceCommandContribution } from '@theia/workspace/lib/browser/workspace-commands';
import { CooklangUri } from '../common/cooklang-uri';

/**
 * `New File...` in a recipe editor defaults to a recipe.
 *
 * Upstream proposes `Untitled.txt`, which is never what someone writing in a
 * Cooklang editor wants; every new file here starts life as a recipe unless
 * the name says otherwise.
 */
@injectable()
export class CooklangWorkspaceCommandContribution extends WorkspaceCommandContribution {

    protected override getDefaultFileConfig(): { fileName: string, fileExtension: string } {
        return {
            fileName: 'Untitled',
            fileExtension: CooklangUri.RECIPE_EXTENSION
        };
    }
}
