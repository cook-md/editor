// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import {
    ShoppingListFile,
    ShoppingListRecipeItem,
    CheckEntry,
    ShoppingListResult,
    fromWireShoppingList,
    fromWireCheckedLog,
    toWireShoppingList,
} from '../common/shopping-list-types';

const LIST_FILE = '.shopping-list';
const CHECKED_FILE = '.shopping-checked';

/**
 * Manages the shopping list using the new cooklang `.shopping-list` format
 * plus a `.shopping-checked` append-only log.
 *
 * All format parse/serialize is delegated to the Rust NAPI backend via
 * CooklangLanguageService RPC. File I/O uses Theia FileService so remote /
 * virtual workspaces work transparently.
 */
@injectable()
export class ShoppingListService implements Disposable {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();
    protected list: ShoppingListFile = { items: [] };
    protected checkedLog: CheckEntry[] = [];
    protected checkedSet = new Set<string>();
    protected result: ShoppingListResult | undefined;
    /** Monotonic counter to discard stale `regenerate()` results. Used in Task 9. */
    protected regenerationSeq = 0;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.workspaceService.roots
            .then(() => this.loadFromDisk())
            .catch(err => console.error('ShoppingListService: initial load failed', err));
    }

    // -- Public getters --

    getItems(): readonly ShoppingListRecipeItem[] {
        return this.list.items;
    }

    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    isChecked(ingredientName: string): boolean {
        // cooklang-rs normalizes to lowercase for the checked set
        return this.checkedSet.has(ingredientName.toLowerCase());
    }

    getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    // -- Load / save --

    protected async loadFromDisk(): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }

        // Load recipe list (marshal from externally-tagged wire JSON → internal shape)
        try {
            const content = await this.fileService.read(root.resolve(LIST_FILE));
            const json = await this.languageService.parseShoppingList(content.value);
            this.list = fromWireShoppingList(json);
        } catch {
            this.list = { items: [] };
        }

        // Load checked log
        try {
            const content = await this.fileService.read(root.resolve(CHECKED_FILE));
            const json = await this.languageService.parseChecked(content.value);
            this.checkedLog = fromWireCheckedLog(json);
            const set = await this.languageService.checkedSet(json);
            this.checkedSet = new Set(set.map(s => s.toLowerCase()));
        } catch {
            this.checkedLog = [];
            this.checkedSet = new Set();
        }

        if (this.list.items.length > 0) {
            await this.regenerate();
        } else {
            this.onDidChangeEmitter.fire();
        }
    }

    protected async saveList(): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        const text = await this.languageService.writeShoppingList(toWireShoppingList(this.list));
        await this.fileService.write(root.resolve(LIST_FILE), text);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    /**
     * Flattens nested items into a list of `{ path, scale }` pairs that the
     * existing `generateShoppingList` RPC expects.
     *
     * Flattening rules:
     * - A top-level item with no children contributes itself.
     * - A top-level item with children contributes: itself (for its own
     *   ingredients) AND each child (for expanded references / nested recipes).
     * - Multipliers multiply down: a child under a menu scaled *2 is effectively *2.
     */
    protected flattenForGeneration(): Array<{ path: string; scale: number }> {
        const out: Array<{ path: string; scale: number }> = [];
        const walk = (item: ShoppingListRecipeItem, parentScale: number): void => {
            const scale = (item.multiplier ?? 1) * parentScale;
            out.push({ path: item.path, scale });
            for (const child of item.children) {
                walk(child, scale);
            }
        };
        for (const item of this.list.items) {
            walk(item, 1);
        }
        return out;
    }

    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;

        if (this.list.items.length === 0) {
            this.result = undefined;
            this.onDidChangeEmitter.fire();
            return;
        }

        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }

        const flat = this.flattenForGeneration();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of flat) {
            try {
                const content = await this.fileService.read(root.resolve(path));
                recipeInputs.push({ content: content.value, scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${path}:`, e);
            }
        }
        if (seq !== this.regenerationSeq) { return; }

        const aisleConf = await this.readConfigFile(root, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(root, 'config/pantry.conf');
        if (seq !== this.regenerationSeq) { return; }

        try {
            const json = await this.languageService.generateShoppingList(
                JSON.stringify(recipeInputs),
                aisleConf,
                pantryConf,
            );
            if (seq !== this.regenerationSeq) { return; }
            this.result = JSON.parse(json);
        } catch (e) {
            if (seq !== this.regenerationSeq) { return; }
            console.error('[shopping-list] Failed to generate shopping list:', e);
            this.result = undefined;
        }
        if (seq !== this.regenerationSeq) { return; }
        this.onDidChangeEmitter.fire();
    }

    async addRecipe(path: string, scale = 1, includedRefs?: string[]): Promise<void> {
        const children: ShoppingListRecipeItem[] = includedRefs
            ? includedRefs.map(p => ({
                  type: 'recipe',
                  path: p.replace(/^\.\//, ''),
                  multiplier: undefined,
                  children: [],
              }))
            : [];
        this.list.items.push({
            type: 'recipe',
            path,
            multiplier: scale === 1 ? undefined : scale,
            children,
        });
        await this.saveList();
        await this.regenerate();
    }

    async removeRecipe(index: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items.splice(index, 1);
        await this.saveList();
        await this.regenerate();
        // Compact the checked log against the now-current ingredient set.
        await this.compactCheckedLog();
    }

    async updateScale(index: number, scale: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items[index].multiplier = scale === 1 ? undefined : scale;
        await this.saveList();
        await this.regenerate();
    }

    async clearAll(): Promise<void> {
        // Invalidate any in-flight regenerate() so it won't overwrite state after we reset.
        ++this.regenerationSeq;
        this.list = { items: [] };
        this.checkedLog = [];
        this.checkedSet.clear();
        this.result = undefined;
        const root = this.getWorkspaceRootUri();
        if (root) {
            try { await this.fileService.delete(root.resolve(LIST_FILE)); } catch { /* already gone */ }
            try { await this.fileService.delete(root.resolve(CHECKED_FILE)); } catch { /* already gone */ }
        }
        this.onDidChangeEmitter.fire();
    }

    protected async readConfigFile(root: URI, relativePath: string): Promise<string | null> {
        try {
            const content = await this.fileService.read(root.resolve(relativePath));
            return content.value;
        } catch {
            return null;
        }
    }

    // Stubs — implemented in Task 10 and 11.
    async checkItem(_name: string): Promise<void> { /* Task 10 */ }
    async uncheckItem(_name: string): Promise<void> { /* Task 10 */ }
    async addMenu(
        _menuPath: string,
        _menuScale: number,
        _recipes: Array<{ path: string; scale: number; includedRefs?: string[] }>,
    ): Promise<void> { /* Task 11 */ }
    protected async compactCheckedLog(): Promise<void> { /* Task 10 */ }
}
