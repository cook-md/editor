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
import { RecipePayload } from './recipe-payload';

const RECIPE = { '@type': 'Recipe', name: 'Pancakes', recipeIngredient: ['2 eggs'] };

describe('RecipePayload.extract', () => {

    it('returns the serialized Recipe from a plain JSON-LD block', () => {
        const result = RecipePayload.extract([JSON.stringify(RECIPE)], 'page text');
        expect(JSON.parse(result)).to.deep.equal(RECIPE);
    });

    it('finds a Recipe inside a top-level array', () => {
        const block = JSON.stringify([{ '@type': 'WebSite' }, RECIPE]);
        expect(JSON.parse(RecipePayload.extract([block], ''))).to.deep.equal(RECIPE);
    });

    it('finds a Recipe inside an @graph', () => {
        const block = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, RECIPE] });
        expect(JSON.parse(RecipePayload.extract([block], ''))).to.deep.equal(RECIPE);
    });

    it('matches @type arrays containing Recipe', () => {
        const recipe = { '@type': ['Thing', 'Recipe'], name: 'Soup' };
        expect(JSON.parse(RecipePayload.extract([JSON.stringify(recipe)], ''))).to.deep.equal(recipe);
    });

    it('skips malformed blocks and still finds a Recipe in a later block', () => {
        const result = RecipePayload.extract(['{not json', JSON.stringify(RECIPE)], '');
        expect(JSON.parse(result)).to.deep.equal(RECIPE);
    });

    it('falls back to trimmed page text when no Recipe is present', () => {
        const block = JSON.stringify({ '@type': 'NewsArticle' });
        expect(RecipePayload.extract([block], '  Grandma’s stew: brown the beef…  ')).to.equal('Grandma’s stew: brown the beef…');
    });

    it('falls back to page text when there are no blocks at all', () => {
        expect(RecipePayload.extract([], 'just text')).to.equal('just text');
    });
});
