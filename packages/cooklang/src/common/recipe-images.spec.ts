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
import {
    RecipeImages,
    discoverRecipeImages,
    locateRecipeImage,
    lookupStepImage,
    mapRecipeImages,
    resolveImageUri,
} from './recipe-images';

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

describe('locateRecipeImage', () => {

    const local = new URI('file:///work/recipes/Pancakes.cook');
    const hub = new URI('cooklang-hub:/recipes/12/Pancakes.cook');

    it('resolves a relative path against a local recipe folder', () => {
        const location = locateRecipeImage('img/hero.jpg', local);
        expect(location?.kind).to.equal('file');
        expect(location?.kind === 'file' ? location.uri.toString() : undefined).to.equal('file:///work/recipes/img/hero.jpg');
    });

    it('keeps an absolute path for a local recipe', () => {
        const location = locateRecipeImage('/work/recipes/Pancakes.1.jpg', local);
        expect(location?.kind === 'file' ? location.uri.toString() : undefined).to.equal('file:///work/recipes/Pancakes.1.jpg');
    });

    it('keeps http and https URLs for a local recipe', () => {
        expect(locateRecipeImage('http://cdn.example/p.jpg', local)).to.deep.equal({ kind: 'remote', url: 'http://cdn.example/p.jpg' });
        expect(locateRecipeImage('https://cdn.example/p.jpg', local)).to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
    });

    it('keeps only https URLs for a recipe on another file system', () => {
        expect(locateRecipeImage('https://cdn.example/p.jpg', hub)).to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
        expect(locateRecipeImage('http://cdn.example/p.jpg', hub)).to.equal(undefined);
    });

    it('never names a file for a recipe on another file system', () => {
        for (const raw of ['Pancakes.jpg', '/etc/passwd', 'C:\\photos\\p.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
            expect(locateRecipeImage(raw, hub), raw).to.equal(undefined);
        }
    });

    it('ignores blank and missing values', () => {
        expect(locateRecipeImage('', local)).to.equal(undefined);
        expect(locateRecipeImage('   ', local)).to.equal(undefined);
        expect(locateRecipeImage(undefined, local)).to.equal(undefined);
    });
});

describe('mapRecipeImages', () => {

    it('converts the title and every section step, keeping the keys', async () => {
        const images: RecipeImages = {
            title: '/r/P.jpg',
            steps: { '0': { '0': '/r/P.1.jpg' }, '1': { '3': '/r/P.2.4.jpg' } },
        };
        expect(await mapRecipeImages(images, async raw => `x:${raw}`)).to.deep.equal({
            title: 'x:/r/P.jpg',
            steps: { '0': { '0': 'x:/r/P.1.jpg' }, '1': { '3': 'x:/r/P.2.4.jpg' } },
        });
    });

    it('drops entries the converter rejects and leaves no empty section behind', async () => {
        const images: RecipeImages = { title: 'a', steps: { '0': { '0': 'b', '1': 'c' }, '2': { '0': 'd' } } };
        const result = await mapRecipeImages(images, async raw => (raw === 'a' || raw === 'd' ? undefined : raw.toUpperCase()));
        expect(result).to.deep.equal({ steps: { '0': { '0': 'B', '1': 'C' } } });
    });

    it('treats a null native title and missing images as nothing', async () => {
        const fromNative = JSON.parse('{"title":null,"steps":{}}') as RecipeImages;
        expect(await mapRecipeImages(fromNative, async raw => raw)).to.deep.equal({ steps: {} });
        expect(await mapRecipeImages(undefined, async raw => raw)).to.deep.equal({ steps: {} });
    });

    it('starts every conversion before awaiting any, so reads overlap', async () => {
        const images: RecipeImages = { title: 't', steps: { '0': { '0': 'a', '1': 'b' } } };
        let inFlight = 0;
        let peak = 0;
        await mapRecipeImages(images, async raw => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return raw;
        });
        expect(peak).to.equal(3);
    });
});

describe('discoverRecipeImages', () => {

    function service(calls: string[]): {
        recipeImages: (path: string) => Promise<string>;
        recipeImagesFromContent: (content: string) => Promise<string>;
    } {
        return {
            recipeImages: async (path: string) => {
                calls.push(`path:${path}`);
                return '{"title":"/r/P.jpg","steps":{"0":{"0":"/r/P.1.jpg"}}}';
            },
            recipeImagesFromContent: async (content: string) => {
                calls.push(`content:${content}`);
                return '{"title":"https://cdn.example/p.jpg","steps":{}}';
            },
        };
    }

    it('asks the on-disk lookup for a local recipe, ignoring any content', async () => {
        const calls: string[] = [];
        const images = await discoverRecipeImages(service(calls), new URI('file:///r/P.cook'), 'text');
        expect(images).to.deep.equal({ title: '/r/P.jpg', steps: { '0': { '0': '/r/P.1.jpg' } } });
        expect(calls).to.deep.equal(['path:/r/P.cook']);
    });

    it('asks the content lookup for a recipe on another file system', async () => {
        const calls: string[] = [];
        const images = await discoverRecipeImages(service(calls), new URI('cooklang-hub:/recipes/12/P.cook'), 'text');
        expect(images).to.deep.equal({ title: 'https://cdn.example/p.jpg', steps: {} });
        expect(calls).to.deep.equal(['content:text']);
    });

    it('reports nothing for a recipe on another file system before its content is known', async () => {
        const calls: string[] = [];
        expect(await discoverRecipeImages(service(calls), new URI('cooklang-hub:/recipes/12/P.cook'), undefined)).to.equal(undefined);
        expect(calls).to.deep.equal([]);
    });
});
