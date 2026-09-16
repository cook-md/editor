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
import URI from '@theia/core/lib/common/uri';
import { ImageViewerContribution } from './image-viewer-contribution';

describe('ImageViewerContribution', () => {

    const contribution = new ImageViewerContribution();

    it('claims image files ahead of the recipe preview and the text editor', () => {
        expect(contribution.canHandle(new URI('file:///r/photo.jpg'))).to.be.greaterThan(200);
        expect(contribution.canHandle(new URI('file:///r/PHOTO.PNG'))).to.be.greaterThan(200);
    });

    it('leaves everything else to the other openers', () => {
        expect(contribution.canHandle(new URI('file:///r/Pancakes.cook'))).to.equal(0);
        expect(contribution.canHandle(new URI('file:///r/notes.txt'))).to.equal(0);
        expect(contribution.canHandle(new URI('untitled:/photo.png'))).to.equal(0);
    });

    it('opens one viewer per file', () => {
        expect(contribution['createWidgetOptions'](new URI('file:///r/photo.jpg'))).to.deep.equal({ uri: 'file:///r/photo.jpg' });
    });
});
