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

import { injectable } from '@theia/core/shared/inversify';
import { MimeAssociation } from '@theia/core/lib/browser/mime-service';
import { MonacoMimeService } from '@theia/monaco/lib/browser/monaco-mime-service';
import { COOKLANG_LANGUAGE_ID } from '../common';

/**
 * Pins `.cook` and `.menu` to the cooklang language regardless of what
 * runtime plugins register: the bundled VS Code XML plugin claims `.menu`,
 * and Monaco lets the last registration win. Configured associations take
 * precedence over plugin ones, so these built-ins go in first, and the
 * user's own `files.associations` (added after them) still override.
 */
@injectable()
export class CooklangMimeService extends MonacoMimeService {

    static readonly BUILT_IN: readonly MimeAssociation[] = [
        { id: COOKLANG_LANGUAGE_ID, filepattern: '*.cook' },
        { id: COOKLANG_LANGUAGE_ID, filepattern: '*.menu' },
    ];

    constructor() {
        super();
        this.associations = [...CooklangMimeService.BUILT_IN];
    }

    override setAssociations(associations: MimeAssociation[]): void {
        super.setAssociations([...CooklangMimeService.BUILT_IN, ...associations]);
    }
}
