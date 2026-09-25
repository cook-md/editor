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

import URI from '@theia/core/lib/common/uri';
import { DraftSaver } from '../draft-saver';

/**
 * A real {@link DraftSaver} over stubbed workspace, file and opener services.
 * Importers must enable jsdom first: `DraftSaver` pulls in browser modules.
 */
export class DraftSaverFixture {

    /** File or folder URI string -> content written (`''` for folders). */
    readonly created = new Map<string, string>();
    /** URI strings opened after saving, in order. */
    readonly opened: string[] = [];
    readonly saver = new DraftSaver();

    constructor(roots: URI[], existing: string[] = []) {
        Object.assign(this.saver, {
            workspaceService: { roots: Promise.resolve(roots.map(resource => ({ resource }))) },
            fileService: {
                exists: async (uri: URI) => existing.includes(uri.toString()) || this.created.has(uri.toString()),
                createFolder: async (uri: URI) => { this.created.set(uri.toString(), ''); },
                create: async (uri: URI, content: string) => { this.created.set(uri.toString(), content); },
            },
            openerService: {
                getOpener: async (uri: URI) => ({
                    canHandle: () => 1,
                    open: async () => { this.opened.push(uri.toString()); },
                }),
            },
        });
    }
}
