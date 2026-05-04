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

/* eslint-disable no-null/no-null */

// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListRecipeItem } from '../common/shopping-list-types';

after(() => disableJSDOM());

// ── Wire shapes (mirror `packages/cooklang/src/common/shopping-list-types.ts`)
interface WireShoppingItem { Recipe: { path: string; multiplier: number | null; children: WireShoppingItem[] } }
type WireCheckEntry = { Checked: string } | { Unchecked: string };

/** Minimal shape the service uses from `FileChangesEvent`. */
interface FakeFileChangesEvent {
    contains(resource: { toString(): string }): boolean;
}

/** Minimal in-memory FileService stub — only the methods the service calls. */
class FakeFileService {
    files = new Map<string, string>();
    readonly onDidFilesChangeEmitter = new Emitter<FakeFileChangesEvent>();
    readonly onDidFilesChange = this.onDidFilesChangeEmitter.event;

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
    watch(_uri: { toString(): string }): Disposable {
        return Disposable.create(() => { /* no-op */ });
    }

    /** Test helper: fire a synthetic change event for a URI string. */
    fireChange(uriString: string): void {
        this.onDidFilesChangeEmitter.fire({
            contains: (resource: { toString(): string }) => resource.toString() === uriString,
        });
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
    /** Recipe content keyed by name (with or without extension). */
    recipes = new Map<string, string>();
    async findRecipe(_baseDir: string, name: string): Promise<string | undefined> {
        return this.recipes.get(name) ?? this.recipes.get(`${name}.cook`);
    }
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
            if (trimmed.startsWith('+ ')) { entries.push({ Checked: trimmed.slice(2) }); } else if (trimmed.startsWith('- ')) { entries.push({ Unchecked: trimmed.slice(2) }); }
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
            if ('Checked' in e) { set.add(e.Checked.toLowerCase()); } else { set.delete(e.Unchecked.toLowerCase()); }
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
    (svc as any).toDispose = new DisposableCollection();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { svc, fs, ls };
}

/**
 * Like `makeService()` but also drives the service through its initial load +
 * watcher registration. Done by calling the protected methods directly — we
 * intentionally do not call `init()`, which is a fire-and-forget `@postConstruct`
 * (must return `void` so InversifyJS treats the binding as sync).
 */
async function makeServiceReady(): Promise<{ svc: ShoppingListService; fs: FakeFileService; ls: FakeLanguageService }> {
    const { svc, fs, ls } = makeService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Shrink the debounce so tests don't wait 100ms per reload.
    (svc as any).reloadDebounceMs = 5;
    // Mirror init()'s steps awaitably: toDispose bookkeeping + load + watcher.
    (svc as any).toDispose.push((svc as any).onDidChangeEmitter);
    await (svc as any).loadFromDisk();
    (svc as any).setupWatcher();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { svc, fs, ls };
}

/** Sleep helper — used to let the debounce timer elapse in tests. */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ShoppingListService', () => {
    it('addRecipe appends to list and persists', async () => {
        const { svc, fs } = makeService();
        await svc.addRecipe('pasta.cook', 1);
        expect(svc.getItems().length).to.equal(1);
        expect(fs.files.get('file:///ws/.shopping-list')).to.equal('pasta.cook\n');
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
        expect(fs.files.get('file:///ws/.shopping-checked')).to.equal('+ Flour\n');
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
        // Seed recipe content via the language service (which now resolves
        // recipes through cooklang-find on the backend) so `regenerate()` can
        // read them and the mock LS can decide its output based on which
        // recipes are still present.
        ls.recipes.set('pasta.cook', 'pasta');
        ls.recipes.set('bread.cook', 'bread');
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
        await svc.checkItem('flour');
        await svc.checkItem('milk');
        expect(svc.isChecked('milk')).to.equal(true);

        await svc.removeRecipe(1);
        const checkedContent = fs.files.get('file:///ws/.shopping-checked') ?? '';
        expect(checkedContent.includes('milk')).to.equal(false);
        expect(checkedContent.includes('+ flour')).to.equal(true);
    });
    it('reloads when .shopping-list is updated externally', async () => {
        const { svc, fs } = await makeServiceReady();
        expect(svc.getItems().length).to.equal(0);

        let changeFires = 0;
        svc.onDidChange(() => { changeFires += 1; });

        // External write (simulates cloud sync / another process).
        fs.files.set('file:///ws/.shopping-list', 'pasta.cook\nsoup.cook\n');
        fs.fireChange('file:///ws/.shopping-list');

        // Wait past the debounce window.
        await sleep(30);

        expect(svc.getItems().length).to.equal(2);
        expect(svc.getItems()[0].path).to.equal('pasta.cook');
        expect(changeFires).to.be.greaterThan(0);
    });

    it('resets to empty when .shopping-list is deleted externally', async () => {
        const { svc, fs } = await makeServiceReady();
        // Seed an existing list, reload so in-memory state catches up.
        fs.files.set('file:///ws/.shopping-list', 'pasta.cook\n');
        fs.fireChange('file:///ws/.shopping-list');
        await sleep(30);
        expect(svc.getItems().length).to.equal(1);

        // External delete.
        fs.files.delete('file:///ws/.shopping-list');
        fs.fireChange('file:///ws/.shopping-list');
        await sleep(30);

        expect(svc.getItems().length).to.equal(0);
        expect(svc.getResult()).to.equal(undefined);
    });

    it('reloads when .shopping-checked is updated externally', async () => {
        const { svc, fs } = await makeServiceReady();
        expect(svc.isChecked('flour')).to.equal(false);

        fs.files.set('file:///ws/.shopping-checked', '+ flour\n');
        fs.fireChange('file:///ws/.shopping-checked');
        await sleep(30);
        expect(svc.isChecked('flour')).to.equal(true);

        // An external unchecked entry wins.
        fs.files.set('file:///ws/.shopping-checked', '+ flour\n- flour\n');
        fs.fireChange('file:///ws/.shopping-checked');
        await sleep(30);
        expect(svc.isChecked('flour')).to.equal(false);
    });

    it('coalesces rapid file change events into one reload', async () => {
        const { svc, fs } = await makeServiceReady();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const original = (svc as any).loadFromDisk.bind(svc);
        let reloadCount = 0;
        (svc as any).loadFromDisk = async () => {
            reloadCount += 1;
            return original();
        };
        /* eslint-enable @typescript-eslint/no-explicit-any */

        fs.files.set('file:///ws/.shopping-list', 'a.cook\n');
        // Fire 5 events back-to-back within the 5ms debounce window.
        for (let i = 0; i < 5; i += 1) {
            fs.fireChange('file:///ws/.shopping-list');
        }
        await sleep(30);

        expect(reloadCount).to.equal(1);
        expect(svc.getItems().length).to.equal(1);
    });

    it('stops reloading after dispose()', async () => {
        const { svc, fs } = await makeServiceReady();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const original = (svc as any).loadFromDisk.bind(svc);
        let reloadCount = 0;
        (svc as any).loadFromDisk = async () => {
            reloadCount += 1;
            return original();
        };
        /* eslint-enable @typescript-eslint/no-explicit-any */

        fs.files.set('file:///ws/.shopping-list', 'a.cook\n');
        fs.fireChange('file:///ws/.shopping-list');

        // Dispose before the debounce window elapses — the queued reload must be cancelled.
        svc.dispose();

        await sleep(30);
        expect(reloadCount).to.equal(0);

        // A fresh event after dispose must also not reload.
        fs.fireChange('file:///ws/.shopping-list');
        await sleep(30);
        expect(reloadCount).to.equal(0);
    });

    it('handles self-write echo idempotently', async () => {
        const { svc, fs } = await makeServiceReady();
        await svc.addRecipe('pasta.cook', 1);
        expect(svc.getItems().length).to.equal(1);

        // Simulate the watcher firing for our own write.
        fs.fireChange('file:///ws/.shopping-list');
        await sleep(30);

        // State is unchanged — still exactly one item with the same path.
        expect(svc.getItems().length).to.equal(1);
        expect(svc.getItems()[0].path).to.equal('pasta.cook');

        // Checks survive a spurious .shopping-checked echo too.
        await svc.checkItem('flour');
        fs.fireChange('file:///ws/.shopping-checked');
        await sleep(30);
        expect(svc.isChecked('flour')).to.equal(true);
    });
});
