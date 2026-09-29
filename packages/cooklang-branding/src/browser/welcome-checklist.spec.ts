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
    type Entries = Array<{ name: string; dir: boolean }>;
    const f = (name: string): { name: string; dir: boolean } => ({ name, dir: false });
    const d = (name: string): { name: string; dir: boolean } => ({ name, dir: true });
    const tree: Record<string, Entries> = {
        '/r': [f('notes.md'), d('mains'), d('.git')],
        '/r/mains': [f('Pasta.cook')],
        '/r/.git': [f('Hidden.cook')],
    };
    const reader: DirReader = async dir => tree[dir] ?? [];

    it('finds a .cook file in a subfolder and skips dot-folders', async () => {
        expect(await findFirstRecipe(reader, ['/r'])).to.equal('/r/mains/Pasta.cook');
    });

    it('returns undefined when there is none within the depth limit', async () => {
        expect(await findFirstRecipe(reader, ['/r'], { maxDepth: 1 })).to.equal(undefined);
    });

    it('finds a recipe at the root (depth 0)', async () => {
        const r: DirReader = async () => [f('Toast.cook')];
        expect(await findFirstRecipe(r, ['/r'], { maxDepth: 1 })).to.equal('/r/Toast.cook');
    });

    it('finds a recipe at the depth-2 boundary', async () => {
        expect(await findFirstRecipe(reader, ['/r'], { maxDepth: 2 })).to.equal('/r/mains/Pasta.cook');
    });

    it('accepts .cook case-insensitively', async () => {
        const r: DirReader = async () => [f('Soup.COOK')];
        expect(await findFirstRecipe(r, ['/r'])).to.equal('/r/Soup.COOK');
    });

    it('skips heavy folders', async () => {
        const skipped = ['node_modules', 'target', 'dist', 'build', 'venv', '.venv', '__pycache__',
            'Library', 'Applications', 'Pictures', 'Music', 'Movies'];
        const visited: string[] = [];
        const r: DirReader = async dir => {
            visited.push(dir);
            return dir === '/r' ? skipped.map(d0 => d(d0)) : [f('X.cook')];
        };
        expect(await findFirstRecipe(r, ['/r'])).to.equal(undefined);
        expect(visited).to.deep.equal(['/r']);
    });

    it('skips heavy folders regardless of case', async () => {
        const r: DirReader = async dir => dir === '/r' ? [d('Node_Modules')] : [f('X.cook')];
        expect(await findFirstRecipe(r, ['/r'])).to.equal(undefined);
    });

    it('skips a directory whose reader throws synchronously', async () => {
        const r: DirReader = (dir => {
            if (dir === '/r') { return Promise.resolve([d('bad'), d('good')]); }
            if (dir === '/r/bad') { throw new Error('sync'); }
            return Promise.resolve([f('Ok.cook')]);
        });
        expect(await findFirstRecipe(r, ['/r'])).to.equal('/r/good/Ok.cook');
    });

    it('stops after maxDirs reads and treats unknown as none', async () => {
        let reads = 0;
        const r: DirReader = async dir => {
            reads++;
            return dir === '/r' ? Array.from({ length: 50 }, (_, i) => d(`d${i}`)) : [];
        };
        expect(await findFirstRecipe(r, ['/r'], { maxDirs: 10 })).to.equal(undefined);
        expect(reads).to.equal(10);
    });

    it('skips a directory whose read throws', async () => {
        const r: DirReader = async dir => {
            if (dir === '/r') { return [d('bad'), d('good')]; }
            if (dir === '/r/bad') { throw new Error('EACCES'); }
            return [f('Ok.cook')];
        };
        expect(await findFirstRecipe(r, ['/r'])).to.equal('/r/good/Ok.cook');
    });

    it('keeps deterministic order within a level even if reads finish out of order', async () => {
        const r: DirReader = async dir => {
            if (dir === '/r') { return [d('a'), d('b')]; }
            if (dir === '/r/a') { await new Promise(res => setTimeout(res, 20)); }
            return [f(dir === '/r/a' ? 'A.cook' : 'B.cook')];
        };
        expect(await findFirstRecipe(r, ['/r'])).to.equal('/r/a/A.cook');
    });

    it('does not produce a double slash when the root ends with a slash', async () => {
        const r: DirReader = async dir => dir === '/' ? [d('mains')] : [f('P.cook')];
        expect(await findFirstRecipe(r, ['/'])).to.equal('/mains/P.cook');
    });
});
