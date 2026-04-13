// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent } from '@theia/filesystem/lib/common/files';
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
    toWireCheckEntryJson,
    toWireCheckedLog,
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

    /** Debounce window for reloading after an external file change. Overridable in tests. */
    protected reloadDebounceMs = 100;

    /** Active debounce timer, if any. */
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected async init(): Promise<void> {
        this.toDispose.push(this.onDidChangeEmitter);
        try {
            await this.workspaceService.roots;
            await this.loadFromDisk();
        } catch (err) {
            console.error('ShoppingListService: initial load failed', err);
        }
        this.setupWatcher();
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
        const baseDir = root.path.fsPath();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of flat) {
            try {
                // Use cooklang-find via RPC: auto-resolves `.cook`/`.menu` extensions
                // when paths from menu references are stored without one.
                const content = await this.languageService.findRecipe(baseDir, path);
                if (content === undefined) {
                    console.warn(`[shopping-list] Recipe not found: ${path}`);
                    continue;
                }
                recipeInputs.push({ content, scale });
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

    async checkItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'checked', name });
    }

    async uncheckItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'unchecked', name });
    }

    protected async appendCheckEntry(entry: CheckEntry): Promise<void> {
        const root = this.getWorkspaceRootUri();
        if (!root) { return; }

        const line = await this.languageService.writeCheckEntry(toWireCheckEntryJson(entry));

        // Read-modify-write. FileService has no native append; single-user
        // event-loop serialization keeps this safe.
        let existing = '';
        try {
            const content = await this.fileService.read(root.resolve(CHECKED_FILE));
            existing = content.value;
        } catch {
            existing = '';
        }
        // `line` always ends with '\n' (upstream Rust uses writeln!).
        await this.fileService.write(root.resolve(CHECKED_FILE), existing + line);

        // Update in-memory state locally — cooklang-rs normalizes names to lowercase.
        this.checkedLog.push(entry);
        const key = entry.name.toLowerCase();
        if (entry.type === 'checked') {
            this.checkedSet.add(key);
        } else {
            this.checkedSet.delete(key);
        }
        this.onDidChangeEmitter.fire();
    }

    /**
     * Adds a menu as a single top-level item with nested recipe children.
     * Each child recipe may itself have sub-recipe references as grandchildren.
     */
    async addMenu(
        menuPath: string,
        menuScale: number,
        recipes: Array<{ path: string; scale: number; includedRefs?: string[] }>,
    ): Promise<void> {
        const children: ShoppingListRecipeItem[] = recipes.map(r => ({
            type: 'recipe',
            path: r.path,
            multiplier: r.scale === 1 ? undefined : r.scale,
            children: (r.includedRefs ?? []).map(p => ({
                type: 'recipe',
                path: p.replace(/^\.\//, ''),
                multiplier: undefined,
                children: [],
            })),
        }));
        this.list.items.push({
            type: 'recipe',
            path: menuPath,
            multiplier: menuScale === 1 ? undefined : menuScale,
            children,
        });
        await this.saveList();
        await this.regenerate();
    }

    protected setupWatcher(): void {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        try {
            this.toDispose.push(this.fileService.watch(root));
        } catch (e) {
            console.error('[shopping-list] Failed to register watcher:', e);
        }
        this.toDispose.push(this.fileService.onDidFilesChange(event => this.onFilesChanged(event)));
        this.toDispose.push(Disposable.create(() => {
            if (this.reloadTimer !== undefined) {
                clearTimeout(this.reloadTimer);
                this.reloadTimer = undefined;
            }
        }));
    }

    protected onFilesChanged(event: FileChangesEvent): void {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        const listUri = root.resolve(LIST_FILE);
        const checkedUri = root.resolve(CHECKED_FILE);
        if (event.contains(listUri) || event.contains(checkedUri)) {
            this.scheduleReload();
        }
    }

    protected scheduleReload(): void {
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.loadFromDisk().catch(err =>
                console.error('[shopping-list] Reload after file change failed:', err),
            );
        }, this.reloadDebounceMs);
    }

    /**
     * Rewrite `.shopping-checked` keeping only entries whose ingredient name
     * is still present in the current aggregated result. If `this.result` is
     * missing (regeneration failed), skip — matches cookcli policy.
     */
    protected async compactCheckedLog(): Promise<void> {
        if (!this.result) { return; }
        const root = this.getWorkspaceRootUri();
        if (!root) { return; }

        const names: string[] = [];
        for (const c of this.result.categories) {
            for (const it of c.items) { names.push(it.name); }
        }
        for (const it of this.result.other.items) { names.push(it.name); }

        const compactedJson = await this.languageService.compactChecked(
            toWireCheckedLog(this.checkedLog),
            names,
        );
        const compacted: CheckEntry[] = fromWireCheckedLog(compactedJson);

        // Serialize each entry back to a line, join, write.
        // Every line ends with '\n' (upstream Rust uses writeln!).
        const lines: string[] = [];
        for (const entry of compacted) {
            lines.push(await this.languageService.writeCheckEntry(toWireCheckEntryJson(entry)));
        }
        const text = lines.join('');
        if (text.length === 0) {
            try { await this.fileService.delete(root.resolve(CHECKED_FILE)); } catch { /* already gone */ }
        } else {
            await this.fileService.write(root.resolve(CHECKED_FILE), text);
        }

        // Persist to memory only after successful write/delete.
        this.checkedLog = compacted;

        // Rebuild in-memory set locally — cooklang-rs normalizes names to lowercase.
        const rebuilt = new Set<string>();
        for (const entry of compacted) {
            const key = entry.name.toLowerCase();
            if (entry.type === 'checked') {
                rebuilt.add(key);
            } else {
                rebuilt.delete(key);
            }
        }
        this.checkedSet = rebuilt;

        this.onDidChangeEmitter.fire();
    }
}
