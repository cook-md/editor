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
import { OpenerService, OpenerOptions } from '@theia/core/lib/browser/opener-service';
import { BinaryFileOpenHandler } from './binary-file-open-handler';

interface Opened {
    uri: string;
    options: OpenerOptions | undefined;
}

function handlerWith(): { handler: BinaryFileOpenHandler, opened: Opened[] } {
    const opened: Opened[] = [];
    const openerService = {
        getOpener: async (uri: URI, options?: OpenerOptions) => ({
            open: async (target: URI, targetOptions?: OpenerOptions) => {
                opened.push({ uri: target.toString(), options: targetOptions });
                return undefined;
            }
        })
    } as unknown as OpenerService;
    const handler = new BinaryFileOpenHandler();
    Object.assign(handler, { openerService });
    return { handler, opened };
}

describe('BinaryFileOpenHandler', () => {

    it('claims archives, documents and media ahead of the text editor', () => {
        const { handler } = handlerWith();
        for (const name of ['export.zip', 'Crouton Recipes.ZIP', 'menu.pdf', 'notes.docx', 'song.mp3', 'demo.mp4']) {
            expect(handler.canHandle(new URI(`file:///r/${name}`)), name).to.be.greaterThan(100);
        }
    });

    it('leaves text, recipes, images and unknown extensions alone', () => {
        const { handler } = handlerWith();
        for (const name of ['Pancakes.cook', 'notes.txt', 'photo.png', 'README', 'data.json']) {
            expect(handler.canHandle(new URI(`file:///r/${name}`)), name).to.equal(0);
        }
    });

    it('steps aside when the system app was asked for explicitly', () => {
        // Otherwise its own delegation below would come straight back to it.
        const { handler } = handlerWith();
        expect(handler.canHandle(new URI('file:///r/export.zip'), { openExternalApp: true })).to.equal(0);
    });

    it('hands the file to the system app', async () => {
        const { handler, opened } = handlerWith();

        await handler.open(new URI('file:///r/export.zip'));

        expect(opened).to.deep.equal([{ uri: 'file:///r/export.zip', options: { openExternalApp: true } }]);
    });
});
