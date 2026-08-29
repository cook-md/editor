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
import { RecipeImages, lookupStepImage, resolveImageUri } from './recipe-images';

describe('lookupStepImage', () => {

    const linear: RecipeImages = {
        steps: { '0': { '0': '/r/Pancakes.1.jpg', '2': '/r/Pancakes.3.jpg' } }
    };

    it('finds a linear image by its global step index', () => {
        expect(lookupStepImage(linear, 0, 0, 0)).to.equal('/r/Pancakes.1.jpg');
        expect(lookupStepImage(linear, 0, 2, 2)).to.equal('/r/Pancakes.3.jpg');
    });

    it('returns undefined for a step with no image', () => {
        expect(lookupStepImage(linear, 0, 1, 1)).to.be.undefined;
    });

    it('finds a section image at [section][step]', () => {
        // Pancakes.2.4.jpg -> section 2, step 4 -> stored at [1][3].
        const sectioned: RecipeImages = { steps: { '1': { '3': '/r/Pancakes.2.4.jpg' } } };
        expect(lookupStepImage(sectioned, 1, 3, 7)).to.equal('/r/Pancakes.2.4.jpg');
    });

    // Mirrors cookcli builders.rs: the section-specific image wins over the linear one.
    it('prefers the section image over the linear fallback', () => {
        const both: RecipeImages = {
            steps: {
                '1': { '0': '/r/Pancakes.2.1.jpg' },
                '0': { '3': '/r/Pancakes.4.jpg' }
            }
        };
        expect(lookupStepImage(both, 1, 0, 3)).to.equal('/r/Pancakes.2.1.jpg');
    });

    it('falls back to the linear image when the section has none', () => {
        const both: RecipeImages = { steps: { '0': { '3': '/r/Pancakes.4.jpg' } } };
        expect(lookupStepImage(both, 1, 0, 3)).to.equal('/r/Pancakes.4.jpg');
    });

    // StepImageCollection::get normalises section 0 and section 1 to the same
    // index, so the first section of a sectioned recipe shares keys with the
    // linear form. This collision exists upstream; it is reproduced, not fixed.
    it('treats section index 0 as section index 0, like the upstream collection', () => {
        const images: RecipeImages = { steps: { '0': { '1': '/r/Pancakes.2.jpg' } } };
        expect(lookupStepImage(images, 0, 1, 1)).to.equal('/r/Pancakes.2.jpg');
    });

    it('returns undefined when there are no images at all', () => {
        expect(lookupStepImage({ steps: {} }, 0, 0, 0)).to.be.undefined;
    });
});

describe('resolveImageUri', () => {

    const recipe = new URI('file:///work/recipes/Pancakes.cook');

    it('passes http and https URLs through untouched', () => {
        expect(resolveImageUri('https://cdn.example/p.jpg', recipe))
            .to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
        expect(resolveImageUri('http://cdn.example/p.jpg', recipe))
            .to.deep.equal({ kind: 'remote', url: 'http://cdn.example/p.jpg' });
    });

    // `cooklang-find` returns absolute paths for everything it discovers, so
    // they are used exactly as given rather than rebuilt from the recipe URI.
    it('keeps a POSIX absolute path in full', () => {
        const result = resolveImageUri('/work/images/hero.jpg', recipe);
        expect(result?.kind).to.equal('file');
        expect((result as { uri: URI }).uri.path.toString())
            .to.equal('/work/images/hero.jpg');
    });

    it('keeps an absolute path that is a sibling of the recipe', () => {
        const result = resolveImageUri('/work/recipes/Pancakes.jpg', recipe);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/Pancakes.jpg');
    });

    it('accepts a Windows-style absolute path', () => {
        const result = resolveImageUri('C:\\work\\images\\hero.jpg', recipe);
        expect(result?.kind).to.equal('file');
        expect((result as { uri: URI }).uri.path.toString().toLowerCase())
            .to.equal('/c:/work/images/hero.jpg');
    });

    it('resolves a relative sibling against the recipe folder', () => {
        const result = resolveImageUri('photo.jpg', recipe);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/photo.jpg');
    });

    // A metadata path with a separator is still relative to the recipe file,
    // not to the workspace root.
    it('resolves a relative path with a separator under the recipe folder', () => {
        const result = resolveImageUri('photos/hero.jpg', recipe);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/photos/hero.jpg');
    });

    it('returns undefined for blank input', () => {
        expect(resolveImageUri('', recipe)).to.be.undefined;
        expect(resolveImageUri('   ', recipe)).to.be.undefined;
    });
});
