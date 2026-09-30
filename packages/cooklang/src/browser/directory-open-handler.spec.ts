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

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DirectoryOpenHandler } from './directory-open-handler';

function handlerWith(directories: string[]): { handler: DirectoryOpenHandler, opened: string[] } {
    const opened: string[] = [];
    const fileService = {
        resolve: async (uri: URI) => {
            if (uri.path.toString().startsWith('/missing')) {
                throw new Error('not found');
            }
            return { isDirectory: directories.includes(uri.path.toString()) };
        }
    } as unknown as FileService;
    const workspaceService = {
        open: (uri: URI) => { opened.push(uri.toString()); }
    } as unknown as WorkspaceService;
    const handler = new DirectoryOpenHandler();
    Object.assign(handler, { fileService, workspaceService });
    return { handler, opened };
}

describe('DirectoryOpenHandler', () => {

    it('claims a folder ahead of the editors', async () => {
        const { handler } = handlerWith(['/r/Dinner']);
        expect(await handler.canHandle(new URI('file:///r/Dinner'))).to.be.greaterThan(500);
    });

    it('leaves files, missing paths and non-file schemes alone', async () => {
        const { handler } = handlerWith(['/r/Dinner']);
        expect(await handler.canHandle(new URI('file:///r/Dinner/Pasta.cook'))).to.equal(0);
        expect(await handler.canHandle(new URI('file:///missing/Dinner'))).to.equal(0);
        expect(await handler.canHandle(new URI('untitled:/r/Dinner'))).to.equal(0);
    });

    it('opens the folder as a workspace', async () => {
        const { handler, opened } = handlerWith(['/r/Dinner']);

        await handler.open(new URI('file:///r/Dinner'));

        expect(opened).to.deep.equal(['file:///r/Dinner']);
    });
});
