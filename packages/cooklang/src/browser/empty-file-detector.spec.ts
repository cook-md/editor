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

// `EmptyFileDetector` injects `FileService`, whose module graph reaches the
// Lumino widgets and touches `document` while loading. Left enabled for the
// rest of the run: mocha loads every spec file before running any test, so the
// sibling specs loaded after this one capture the DOM this sets up.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { EmptyFileDetector } from './empty-file-detector';

function detectorFor(stat: { size?: number, isDirectory?: boolean } | Error): EmptyFileDetector {
    const detector = new EmptyFileDetector();
    (detector as unknown as { fileService: unknown }).fileService = {
        resolve: async () => {
            if (stat instanceof Error) {
                throw stat;
            }
            return { size: stat.size ?? 0, isDirectory: stat.isDirectory ?? false };
        }
    };
    return detector;
}

const uri = new URI('file:///ws/Untitled.cook');

describe('EmptyFileDetector', () => {

    it('reports a zero byte file as empty', async () => {
        expect(await detectorFor({ size: 0 }).isEmpty(uri)).to.be.true;
    });

    it('reports a file with content as non-empty', async () => {
        expect(await detectorFor({ size: 42 }).isEmpty(uri)).to.be.false;
    });

    it('reports a directory as non-empty', async () => {
        expect(await detectorFor({ size: 0, isDirectory: true }).isEmpty(uri)).to.be.false;
    });

    it('reports a file it cannot stat as non-empty', async () => {
        expect(await detectorFor(new Error('ENOENT')).isEmpty(uri)).to.be.false;
    });
});
