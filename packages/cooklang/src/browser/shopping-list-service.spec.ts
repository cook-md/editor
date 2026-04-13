// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListRecipeItem } from '../common/shopping-list-types';

after(() => disableJSDOM());

// ── Wire shapes (mirror `packages/cooklang/src/common/shopping-list-types.ts`)
type WireShoppingItem = { Recipe: { path: string; multiplier: number | null; children: WireShoppingItem[] } };
type WireCheckEntry = { Checked: string } | { Unchecked: string };

/** Minimal in-memory FileService stub — only the methods the service calls. */
class FakeFileService {
    files = new Map<string, string>();
    async read(uri: { toString(): string }): Promise<{ value: string }> {
        const key = uri.toString();
        if (!this.files.has(key)) { throw new Error('ENOENT'); }
        return { value: this.files.get(key)! };
    }
    async write(uri: { toString(): string }, content: string): Promise<void> {
        this.files.set(uri.toString(), content);
    }
    async delete(uri: { toString(): string }): Promise<void> {
        this.files.delete(uri.toString());
    }
}

/** FakeWorkspaceService with a single root. */
class FakeWorkspaceService {
    roots = Promise.resolve([{ resource: { toString: () => 'file:///ws' } }]);
    tryGetRoots(): Array<{ resource: { toString: () => string } }> {
        return [{ resource: { toString: () => 'file:///ws' } }];
    }
}

/**
 * FakeCooklangLanguageService — emits/consumes the SAME wire JSON shape that the
 * real Rust NAPI produces (externally-tagged). `CheckEntry` / `ShoppingListFile`
 * in the assertions remain the internal shape because the service marshals to/from
 * the wire inside its helpers.
 */
class FakeLanguageService {
    async parseShoppingList(text: string): Promise<string> {
        const items: WireShoppingItem[] = text
            .split('\n')
            .filter(l => l.trim().length > 0)
            .map(l => ({ Recipe: { path: l.trim(), multiplier: null, children: [] } }));
        return JSON.stringify({ items });
    }
    async writeShoppingList(json: string): Promise<string> {
        const list: { items: WireShoppingItem[] } = JSON.parse(json);
        return list.items.map(i => i.Recipe.path).join('\n') + (list.items.length > 0 ? '\n' : '');
    }
    async parseChecked(text: string): Promise<string> {
        const entries: WireCheckEntry[] = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('+ ')) { entries.push({ Checked: trimmed.slice(2) }); }
            else if (trimmed.startsWith('- ')) { entries.push({ Unchecked: trimmed.slice(2) }); }
        }
        return JSON.stringify(entries);
    }
    async writeCheckEntry(entryJson: string): Promise<string> {
        const entry: WireCheckEntry = JSON.parse(entryJson);
        return ('Checked' in entry ? '+ ' + entry.Checked : '- ' + entry.Unchecked) + '\n';
    }
    async checkedSet(entriesJson: string): Promise<string[]> {
        const entries: WireCheckEntry[] = JSON.parse(entriesJson);
        const set = new Set<string>();
        for (const e of entries) {
            if ('Checked' in e) { set.add(e.Checked.toLowerCase()); }
            else { set.delete(e.Unchecked.toLowerCase()); }
        }
        return [...set];
    }
    async compactChecked(entriesJson: string, names: string[]): Promise<string> {
        const entries: WireCheckEntry[] = JSON.parse(entriesJson);
        const lc = new Set(names.map(n => n.toLowerCase()));
        return JSON.stringify(entries.filter(e => lc.has(('Checked' in e ? e.Checked : e.Unchecked).toLowerCase())));
    }
    // Unused by the tested paths but required by the service interface.
    async generateShoppingList(_recipes: string, _a: string | null, _p: string | null): Promise<string> {
        return JSON.stringify({
            categories: [],
            other: { name: 'other', items: [{ name: 'flour', quantities: '' }] },
            pantryItems: [],
        });
    }
    async parse(_c: string): Promise<string> { return '{}'; }
    async parseMenu(_c: string, _s: number): Promise<string> { return '{}'; }
}

/**
 * Construct a ShoppingListService with injected fakes. We bypass Inversify and
 * set protected fields directly — simpler than wiring a test container.
 */
function makeService(): { svc: ShoppingListService; fs: FakeFileService; ls: FakeLanguageService } {
    const fs = new FakeFileService();
    const ls = new FakeLanguageService();
    const ws = new FakeWorkspaceService();
    const svc = new ShoppingListService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (svc as any).fileService = fs;
    (svc as any).languageService = ls;
    (svc as any).workspaceService = ws;
    (svc as any).toDispose = { push: (): void => {} };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { svc, fs, ls };
}

describe('ShoppingListService', () => {
    it('addRecipe appends to list and persists', async () => {
        const { svc, fs } = makeService();
        await svc.addRecipe('pasta.cook', 1);
        expect(svc.getItems().length).to.equal(1);
        expect(fs.files.get('file:///ws/.shopping-list')).to.contain('pasta.cook');
    });

    it('addMenu creates a nested structure', async () => {
        const { svc } = makeService();
        await svc.addMenu('weekday.menu', 1, [
            { path: 'pasta.cook', scale: 1 },
            { path: 'salad.cook', scale: 2 },
        ]);
        const items = svc.getItems() as readonly ShoppingListRecipeItem[];
        expect(items.length).to.equal(1);
        expect(items[0].children.length).to.equal(2);
        expect(items[0].children[1].multiplier).to.equal(2);
    });

    it('checkItem appends to .shopping-checked and updates the set', async () => {
        const { svc, fs } = makeService();
        await svc.checkItem('Flour');
        expect(svc.isChecked('flour')).to.equal(true);
        expect(fs.files.get('file:///ws/.shopping-checked')).to.contain('+ Flour');
    });

    it('uncheckItem reverses a prior check', async () => {
        const { svc } = makeService();
        await svc.checkItem('flour');
        await svc.uncheckItem('flour');
        expect(svc.isChecked('flour')).to.equal(false);
    });

    it('clearAll deletes both files', async () => {
        const { svc, fs } = makeService();
        await svc.addRecipe('pasta.cook', 1);
        await svc.checkItem('flour');
        await svc.clearAll();
        expect(fs.files.has('file:///ws/.shopping-list')).to.equal(false);
        expect(fs.files.has('file:///ws/.shopping-checked')).to.equal(false);
        expect(svc.getItems().length).to.equal(0);
    });

    it('removeRecipe compacts stale checks', async () => {
        const { svc, fs, ls } = makeService();
        // Seed recipe files so `regenerate()` can read them and the mock LS
        // can decide its output based on which recipes are still present.
        fs.files.set('file:///ws/pasta.cook', 'pasta');
        fs.files.set('file:///ws/bread.cook', 'bread');
        ls.generateShoppingList = async recipesJson => {
            const recipes: Array<{ content: string; scale: number }> = JSON.parse(recipesJson);
            // `milk` is only present while bread.cook is in the list.
            const hasBread = recipes.some(r => r.content === 'bread');
            const items = hasBread
                ? [{ name: 'flour', quantities: '' }, { name: 'milk', quantities: '' }]
                : [{ name: 'flour', quantities: '' }];
            return JSON.stringify({
                categories: [],
                other: { name: 'other', items },
                pantryItems: [],
            });
        };

        // Two recipes: removing the one that contributes `milk` leaves a
        // non-empty list so `regenerate()` produces a `result` and
        // `compactCheckedLog()` runs, pruning the stale `milk` entry.
        await svc.addRecipe('pasta.cook', 1);
        await svc.addRecipe('bread.cook', 1);
        await svc.checkItem('milk');
        expect(svc.isChecked('milk')).to.equal(true);

        await svc.removeRecipe(1);
        const checkedContent = fs.files.get('file:///ws/.shopping-checked') ?? '';
        expect(checkedContent.includes('milk')).to.equal(false);
    });
});
