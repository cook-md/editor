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
import { CooklangUri } from './cooklang-uri';

describe('CooklangUri', () => {

    describe('isRecipe', () => {
        it('matches a lower-case .cook extension', () => {
            expect(CooklangUri.isRecipe(new URI('file:///recipes/bread.cook'))).to.be.true;
        });

        // Regression: a file recognized as Cooklang by Monaco (which matches
        // extensions case-insensitively) must also be recognized here, or the
        // preview toolbar button silently disappears. See issue #50.
        it('matches upper-case and mixed-case .cook extensions', () => {
            expect(CooklangUri.isRecipe(new URI('file:///recipes/Bread.COOK'))).to.be.true;
            expect(CooklangUri.isRecipe(new URI('file:///recipes/Bread.Cook'))).to.be.true;
        });

        it('matches names containing spaces and dashes', () => {
            expect(CooklangUri.isRecipe(new URI('file:///r/Bread - Sourdough - White.cook'))).to.be.true;
        });

        it('rejects non-recipe extensions and undefined', () => {
            expect(CooklangUri.isRecipe(new URI('file:///r/menu.menu'))).to.be.false;
            expect(CooklangUri.isRecipe(new URI('file:///r/notes.txt'))).to.be.false;
            expect(CooklangUri.isRecipe(undefined)).to.be.false;
        });
    });

    describe('isMenu', () => {
        it('matches .menu case-insensitively', () => {
            expect(CooklangUri.isMenu(new URI('file:///r/dinner.menu'))).to.be.true;
            expect(CooklangUri.isMenu(new URI('file:///r/Dinner.MENU'))).to.be.true;
        });

        it('rejects recipe and other extensions', () => {
            expect(CooklangUri.isMenu(new URI('file:///r/bread.cook'))).to.be.false;
            expect(CooklangUri.isMenu(undefined)).to.be.false;
        });
    });

    describe('isCooklang', () => {
        it('matches both recipe and menu files, any case', () => {
            expect(CooklangUri.isCooklang(new URI('file:///r/bread.COOK'))).to.be.true;
            expect(CooklangUri.isCooklang(new URI('file:///r/dinner.Menu'))).to.be.true;
            expect(CooklangUri.isCooklang(new URI('file:///r/notes.md'))).to.be.false;
        });
    });
});
