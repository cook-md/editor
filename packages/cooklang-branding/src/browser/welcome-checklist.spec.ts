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
import {
    computeChecklist, findFirstRecipe, isRecipePath, newlyCompleted, reconcileReportedSteps, showTrialLine, DirReader
} from './welcome-checklist';

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

describe('newlyCompleted', () => {
    it('reports nothing on the first computation', () => {
        expect(newlyCompleted(undefined, new Set(['folder', 'recipes']))).to.deep.equal([]);
    });

    it('reports steps that became done, in checklist order', () => {
        expect(newlyCompleted(new Set(['folder']), new Set(['report', 'folder', 'recipes']))).to.deep.equal(['recipes', 'report']);
    });

    it('ignores steps that stayed done or went back to not done', () => {
        expect(newlyCompleted(new Set(['folder', 'recipes']), new Set(['folder']))).to.deep.equal([]);
    });
});

describe('isRecipePath', () => {
    it('matches .cook files case-insensitively', () => {
        expect(isRecipePath('/home/me/recipes/Pasta.COOK')).to.equal(true);
        expect(isRecipePath('/c:/Users/me/soup.cook')).to.equal(true);
    });

    it('rejects other files and look-alikes', () => {
        expect(isRecipePath('/home/me/recipes/notes.md')).to.equal(false);
        expect(isRecipePath('/home/me/recipes/cook')).to.equal(false);
        expect(isRecipePath('/home/me/recipes/pasta.cook.bak')).to.equal(false);
    });
});

describe('reconcileReportedSteps', () => {
    it('seeds silently when nothing was stored yet (steps done before this feature shipped)', () => {
        const r = reconcileReportedSteps(undefined, new Set(['folder', 'recipes']));
        expect(r.report).to.deep.equal([]);
        expect([...r.store].sort()).to.deep.equal(['folder', 'recipes']);
    });

    it('reports a step completed since the stored set, even across a window reload', () => {
        const r = reconcileReportedSteps([], new Set(['folder']));
        expect(r.report).to.deep.equal(['folder']);
        expect([...r.store]).to.deep.equal(['folder']);
    });

    it('is monotonic: an unticked step stays stored and is never reported twice', () => {
        const unticked = reconcileReportedSteps(['folder', 'recipes'], new Set(['folder']));
        expect(unticked.report).to.deep.equal([]);
        expect([...unticked.store].sort()).to.deep.equal(['folder', 'recipes']);
        const retick = reconcileReportedSteps([...unticked.store], new Set(['folder', 'recipes']));
        expect(retick.report).to.deep.equal([]);
    });

    it('ignores unknown ids in storage', () => {
        const r = reconcileReportedSteps(['bogus', 'folder'], new Set(['folder', 'cookbot']));
        expect(r.report).to.deep.equal(['cookbot']);
        expect([...r.store].sort()).to.deep.equal(['cookbot', 'folder']);
    });
});

describe('showTrialLine', () => {
    it('shows for signed-out users and eligible accounts without AI', () => {
        expect(showTrialLine(undefined)).to.equal(true);
        expect(showTrialLine({ features: [], trialEligible: true })).to.equal(true);
    });

    it('hides once the account has AI or has used its trial', () => {
        expect(showTrialLine({ features: ['ai'], trialEligible: true })).to.equal(false);
        expect(showTrialLine({ features: [], trialEligible: false })).to.equal(false);
    });
});
