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
enableJSDOM();
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
// Other specs in the same mocha run may have set it already.
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { ImageViewerWidget, imageMimeType } from './image-viewer-widget';

const PHOTO = new URI('file:///recipes/Pancakes/photo.png');

class FakeFileService {
    readonly files = new Map<string, Uint8Array>();
    readonly sizes = new Map<string, number>();
    readonly reads: string[] = [];
    readonly changes = new Emitter<{ contains(uri: URI): boolean }>();
    readonly onDidFilesChange = this.changes.event;
    failWith: Error | undefined;

    put(uri: URI, bytes: number[]): void {
        this.files.set(uri.toString(), Uint8Array.from(bytes));
    }

    async resolve(uri: URI): Promise<{ size: number }> {
        return { size: this.sizes.get(uri.toString()) ?? this.files.get(uri.toString())?.length ?? 0 };
    }

    async readFile(uri: URI): Promise<{ value: BinaryBuffer }> {
        this.reads.push(uri.toString());
        if (this.failWith) {
            throw this.failWith;
        }
        const bytes = this.files.get(uri.toString());
        if (!bytes) {
            throw new Error(`Unable to read file '${uri.path.base}'`);
        }
        return { value: BinaryBuffer.wrap(bytes) };
    }

    changed(uri: URI): void {
        this.changes.fire({ contains: candidate => candidate.toString() === uri.toString() });
    }
}

interface Harness {
    viewer: ImageViewerWidget;
    files: FakeFileService;
    created: string[];
    revoked: string[];
    blobs: Blob[];
}

function harness(): Harness {
    const created: string[] = [];
    const revoked: string[] = [];
    const blobs: Blob[] = [];
    // jsdom has no URL.createObjectURL; stub it so the viewer is observable.
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = blob => {
        blobs.push(blob);
        const url = `blob:fake/${created.length}`;
        created.push(url);
        return url;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = url => {
        revoked.push(url);
    };
    const files = new FakeFileService();
    const viewer = new ImageViewerWidget();
    Object.assign(viewer, {
        fileService: files,
        labelProvider: { getIcon: () => 'codicon codicon-file-media' }
    });
    viewer['init']();
    return { viewer, files, created, revoked, blobs };
}

function image(viewer: ImageViewerWidget): HTMLImageElement | null {
    return viewer.node.querySelector('img');
}

function message(viewer: ImageViewerWidget): string {
    return viewer.node.querySelector('.cooklang-image-viewer-message')?.textContent ?? '';
}

/** Poll until `condition` holds; the viewer loads asynchronously and exposes no promise. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

describe('imageMimeType', () => {

    it('maps viewable image extensions regardless of case', () => {
        expect(imageMimeType(new URI('file:///r/photo.png'))).to.equal('image/png');
        expect(imageMimeType(new URI('file:///r/PHOTO.JPG'))).to.equal('image/jpeg');
        expect(imageMimeType(new URI('file:///r/anim.gif'))).to.equal('image/gif');
        expect(imageMimeType(new URI('file:///r/logo.svg'))).to.equal('image/svg+xml');
    });

    it('leaves recipes and non-image files alone', () => {
        expect(imageMimeType(new URI('file:///r/Pancakes.cook'))).to.be.undefined;
        expect(imageMimeType(new URI('file:///r/archive.zip'))).to.be.undefined;
        expect(imageMimeType(new URI('file:///r/noext'))).to.be.undefined;
    });
});

describe('ImageViewerWidget', () => {

    it('shows the file as an image and names the tab after it', async () => {
        const { viewer, files, created, blobs } = harness();
        files.put(PHOTO, [1, 2, 3]);

        viewer.setUri(PHOTO);
        await until(() => image(viewer)?.src === created[0]);

        expect(blobs[0].type).to.equal('image/png');
        expect(viewer.title.label).to.equal('photo.png');
        expect(viewer.getResourceUri()?.toString()).to.equal(PHOTO.toString());
    });

    it('revokes the object URL when disposed', async () => {
        const { viewer, files, created, revoked } = harness();
        files.put(PHOTO, [1, 2, 3]);
        viewer.setUri(PHOTO);
        await until(() => created.length === 1);

        viewer.dispose();

        expect(revoked).to.deep.equal(created);
    });

    it('tells the user when the file cannot be read', async () => {
        // Sentry EDITOR-R/EDITOR-Y: the explorer used to route these into the text
        // editor, which threw out of an unhandled promise.
        const { viewer, files, created } = harness();
        files.failWith = new Error("Unable to read file 'photo.png'");

        viewer.setUri(PHOTO);
        await until(() => message(viewer) !== '');

        expect(message(viewer)).to.contain('photo.png');
        expect(created).to.deep.equal([]);
    });

    it('refuses a file too large to ship to the renderer', async () => {
        const { viewer, files, created } = harness();
        files.put(PHOTO, [1]);
        files.sizes.set(PHOTO.toString(), ImageViewerWidget.MAX_BYTES + 1);

        viewer.setUri(PHOTO);
        await until(() => message(viewer) !== '');

        expect(files.reads).to.deep.equal([]);
        expect(created).to.deep.equal([]);
    });

    it('reloads when the file changes on disk', async () => {
        const { viewer, files, created, revoked } = harness();
        files.put(PHOTO, [1, 2, 3]);
        viewer.setUri(PHOTO);
        await until(() => created.length === 1);

        files.put(PHOTO, [4, 5, 6]);
        files.changed(PHOTO);
        await until(() => created.length === 2);

        expect(image(viewer)?.src).to.equal(created[1]);
        expect(revoked).to.deep.equal([created[0]]);
    });
});
