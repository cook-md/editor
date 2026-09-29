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
import { computeChecklist, findFirstRecipe, DirReader } from './welcome-checklist';

const none = { folderOpen: false, hasRecipes: false, cookbotUsed: false, reportRendered: false };

describe('computeChecklist', () => {
    it('only lets a new user pick a folder', () => {
        const { steps, allDone } = computeChecklist(none);
        expect(steps.map(s => [s.id, s.done, s.enabled])).to.deep.equal([
            ['folder', false, true], ['recipes', false, false], ['cookbot', false, false], ['report', false, false],
        ]);
        expect(allDone).to.equal(false);
    });

    it('unlocks CookBot and reports once there are recipes', () => {
        const { steps } = computeChecklist({ ...none, folderOpen: true, hasRecipes: true });
        expect(steps.find(s => s.id === 'cookbot')!.enabled).to.equal(true);
        expect(steps.find(s => s.id === 'report')!.enabled).to.equal(true);
    });

    it('is done when all four facts hold', () => {
        expect(computeChecklist({ folderOpen: true, hasRecipes: true, cookbotUsed: true, reportRendered: true }).allDone).to.equal(true);
    });
});

describe('findFirstRecipe', () => {
    const tree: Record<string, Array<{ name: string; dir: boolean }>> = {
        '/r': [{ name: 'notes.md', dir: false }, { name: 'mains', dir: true }, { name: '.git', dir: true }],
        '/r/mains': [{ name: 'Pasta.cook', dir: false }],
        '/r/.git': [{ name: 'Hidden.cook', dir: false }],
    };
    const reader: DirReader = async dir => tree[dir] ?? [];

    it('finds a .cook file in a subfolder and skips dot-folders', async () => {
        expect(await findFirstRecipe(reader, ['/r'])).to.equal('/r/mains/Pasta.cook');
    });

    it('returns undefined when there is none within the depth limit', async () => {
        expect(await findFirstRecipe(reader, ['/r'], 1)).to.equal(undefined);
    });
});
