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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { RecipeImageService } from './recipe-image-service';

after(() => disableJSDOM());

class FakeFileService {
    size = 1024;
    reads: string[] = [];
    missing = false;
    async resolve(uri: URI): Promise<{ size: number }> {
        if (this.missing) { throw new Error(`not found: ${uri.toString()}`); }
        return { size: this.size };
    }
    async readFile(uri: URI): Promise<{ value: BinaryBuffer }> {
        if (this.missing) { throw new Error(`not found: ${uri.toString()}`); }
        this.reads.push(uri.toString());
        return { value: BinaryBuffer.wrap(new Uint8Array([1, 2, 3])) };
    }
}

function createService(): { service: RecipeImageService; files: FakeFileService; created: string[]; revoked: string[] } {
    const created: string[] = [];
    const revoked: string[] = [];
    let counter = 0;
    // jsdom has no URL.createObjectURL; stub it so the service is observable.
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
        const url = `blob:fake/${counter++}`;
        created.push(url);
        return url;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = url => {
        revoked.push(url);
    };
    const service = new RecipeImageService();
    const files = new FakeFileService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (service as any).fileService = files;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { service, files, created, revoked };
}

describe('RecipeImageService', () => {

    it('reads a local file and returns a blob URL', async () => {
        const { service, created } = createService();
        const url = await service.resolve(new URI('file:///r/Pancakes.jpg'));
        expect(url).to.equal(created[0]);
    });

    it('reads each file once and reuses the cached URL', async () => {
        const { service, files } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        const first = await service.resolve(uri);
        const second = await service.resolve(uri);
        expect(second).to.equal(first);
        expect(files.reads).to.have.length(1);
    });

    // FileService reads travel over RPC to the backend; a huge file would stall
    // the preview, so it is skipped rather than loaded.
    it('skips files over the size cap', async () => {
        const { service, files } = createService();
        files.size = 40 * 1024 * 1024;
        expect(await service.resolve(new URI('file:///r/Huge.png'))).to.be.undefined;
        expect(files.reads).to.be.empty;
    });

    it('resolves to undefined for a missing or unreadable file', async () => {
        const { service, files } = createService();
        files.missing = true;
        expect(await service.resolve(new URI('file:///r/Gone.jpg'))).to.be.undefined;
    });

    it('resolves to undefined for an unsupported extension', async () => {
        const { service, files } = createService();
        expect(await service.resolve(new URI('file:///r/notes.txt'))).to.be.undefined;
        expect(files.reads).to.be.empty;
    });

    // A file replaced in place keeps its URI, so the cache must be invalidated
    // for it or the preview keeps showing the old bytes forever.
    it('re-reads a single file after release', async () => {
        const { service, files, revoked } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        const first = await service.resolve(uri);
        service.release(uri);
        expect(revoked).to.deep.equal([first!]);
        const second = await service.resolve(uri);
        expect(second).to.not.equal(first);
        expect(files.reads).to.have.length(2);
    });

    it('ignores release for a URI it never loaded', () => {
        const { service, revoked } = createService();
        service.release(new URI('file:///r/never.jpg'));
        expect(revoked).to.be.empty;
    });

    it('revokes every object URL on releaseAll', async () => {
        const { service, revoked } = createService();
        const a = await service.resolve(new URI('file:///r/a.jpg'));
        const b = await service.resolve(new URI('file:///r/b.png'));
        service.releaseAll();
        expect(revoked).to.have.members([a!, b!]);
    });

    it('re-reads a file after releaseAll', async () => {
        const { service, files } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        await service.resolve(uri);
        service.releaseAll();
        await service.resolve(uri);
        expect(files.reads).to.have.length(2);
    });
});
