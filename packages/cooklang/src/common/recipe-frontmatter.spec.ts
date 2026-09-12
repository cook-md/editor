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
import { RecipeFrontmatter } from './recipe-frontmatter';

describe('RecipeFrontmatter', () => {

    describe('hasRecipeFlag', () => {
        it('detects recipe: true in YAML frontmatter', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: true\n---\nMix @eggs{2}.')).to.be.true;
        });

        it('detects recipe among other frontmatter keys', () => {
            const content = '---\ntitle: Pancakes\nrecipe: true\nservings: 4\n---\nMix.';
            expect(RecipeFrontmatter.hasRecipeFlag(content)).to.be.true;
        });

        it('accepts YAML truthy spellings (yes, on, 1) case-insensitively', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: yes\n---\n')).to.be.true;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: ON\n---\n')).to.be.true;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: 1\n---\n')).to.be.true;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nRecipe: True\n---\n')).to.be.true;
        });

        it('accepts quoted truthy values', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: "true"\n---\n')).to.be.true;
            expect(RecipeFrontmatter.hasRecipeFlag("---\nrecipe: 'yes'\n---\n")).to.be.true;
        });

        it('handles CRLF line endings', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\r\nrecipe: true\r\n---\r\nMix.')).to.be.true;
        });

        it('rejects recipe: false and other falsy values', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: false\n---\n')).to.be.false;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: no\n---\n')).to.be.false;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: 0\n---\n')).to.be.false;
            expect(RecipeFrontmatter.hasRecipeFlag('---\nrecipe: \n---\n')).to.be.false;
        });

        it('rejects markdown without frontmatter', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('Mix @eggs{2}.')).to.be.false;
            expect(RecipeFrontmatter.hasRecipeFlag('recipe: true\n---\n')).to.be.false;
        });

        it('rejects frontmatter that lacks a recipe flag', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\ntitle: Notes\n---\nHello.')).to.be.false;
        });

        it('ignores recipe outside the first frontmatter block', () => {
            expect(RecipeFrontmatter.hasRecipeFlag('---\ntitle: Notes\n---\n\nrecipe: true\n')).to.be.false;
        });
    });
});
