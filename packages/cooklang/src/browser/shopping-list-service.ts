// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { ShoppingListRecipe, ShoppingListResult } from '../common/shopping-list-types';

/**
 * Manages the shopping list state: the set of recipes contributing to the list,
 * the aggregated result from the backend, and which items have been checked off.
 *
 * Persists the recipe list to `.shopping_list.txt` in the workspace root so that
 * it survives application restarts.
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
    protected recipes: ShoppingListRecipe[] = [];
    protected result: ShoppingListResult | undefined;
    protected checkedItems = new Set<string>();
    protected regenerationSeq = 0;

    protected readonly onDidChangeEmitter = new Emitter<void>();

    /** Fired whenever the recipe list, result, or checked-item state changes. */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.workspaceService.roots.then(() => this.loadFromFile());
    }

    /** Returns the current ordered list of recipes. */
    getRecipes(): readonly ShoppingListRecipe[] {
        return this.recipes;
    }

    /** Returns the most recently generated shopping list result, or `undefined` if not yet generated. */
    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    /** Returns `true` if the ingredient with the given name has been checked off. */
    isChecked(ingredientName: string): boolean {
        return this.checkedItems.has(ingredientName);
    }

    /**
     * Toggles the checked state of an ingredient and fires `onDidChange`.
     * Checked state is intentionally not persisted — it is ephemeral per session.
     */
    toggleChecked(ingredientName: string): void {
        if (this.checkedItems.has(ingredientName)) {
            this.checkedItems.delete(ingredientName);
        } else {
            this.checkedItems.add(ingredientName);
        }
        this.onDidChangeEmitter.fire();
    }

    /**
     * Adds a recipe to the list, persists the updated list, and regenerates the
     * shopping list via RPC.
     */
    async addRecipe(path: string, name: string, scale: number = 1): Promise<void> {
        this.recipes.push({ path, name, scale });
        await this.saveToFile();
        await this.regenerate();
    }

    /**
     * Removes the recipe at `index` from the list, persists, and regenerates.
     * Does nothing when the index is out of range.
     */
    async removeRecipe(index: number): Promise<void> {
        if (index >= 0 && index < this.recipes.length) {
            this.recipes.splice(index, 1);
            await this.saveToFile();
            await this.regenerate();
        }
    }

    /**
     * Updates the scale factor for the recipe at `index`, persists, and regenerates.
     * Does nothing when the index is out of range.
     */
    async updateScale(index: number, scale: number): Promise<void> {
        if (index >= 0 && index < this.recipes.length) {
            this.recipes[index].scale = scale;
            await this.saveToFile();
            await this.regenerate();
        }
    }

    /**
     * Removes all recipes, clears the result and checked items, persists the empty
     * state, and fires `onDidChange`.
     */
    async clearAll(): Promise<void> {
        this.recipes = [];
        this.result = undefined;
        this.checkedItems.clear();
        await this.saveToFile();
        this.onDidChangeEmitter.fire();
    }

    /**
     * Reads recipe file contents from disk, calls the backend RPC to generate the
     * aggregated shopping list, stores the result, and fires `onDidChange`.
     *
     * Silently skips recipes whose files cannot be read (e.g. deleted from disk).
     */
    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;

        if (this.recipes.length === 0) {
            this.result = undefined;
            this.onDidChangeEmitter.fire();
            return;
        }

        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const recipe of this.recipes) {
            try {
                const fileUri = rootUri.resolve(recipe.path);
                const content = await this.fileService.read(fileUri);
                recipeInputs.push({ content: content.value, scale: recipe.scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${recipe.path}:`, e);
            }
        }

        if (seq !== this.regenerationSeq) {
            return;
        }

        const aisleConf = await this.readConfigFile(rootUri, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(rootUri, 'config/pantry.conf');

        if (seq !== this.regenerationSeq) {
            return;
        }

        try {
            const json = await this.languageService.generateShoppingList(
                JSON.stringify(recipeInputs),
                aisleConf,
                pantryConf
            );
            if (seq !== this.regenerationSeq) {
                return;
            }
            this.result = JSON.parse(json);
        } catch (e) {
            console.error('[shopping-list] Failed to generate shopping list:', e);
            this.result = undefined;
        }

        this.onDidChangeEmitter.fire();
    }

    // --- File I/O ---

    /**
     * Attempts to read `.shopping_list.txt` from the workspace root and restore the
     * recipe list from it. Triggers a `regenerate()` call if any recipes were loaded.
     * Silently no-ops when the file does not exist yet.
     */
    protected async loadFromFile(): Promise<void> {
        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        const fileUri = rootUri.resolve('.shopping_list.txt');
        try {
            const content = await this.fileService.read(fileUri);
            this.recipes = this.parseShoppingListFile(content.value);
            if (this.recipes.length > 0) {
                await this.regenerate();
            }
        } catch {
            // File does not exist yet; start with an empty list.
        }
    }

    /**
     * Parses the tab-delimited `.shopping_list.txt` format.
     * Each non-blank, non-comment line is expected to be: `path\tname\tscale`.
     */
    protected parseShoppingListFile(content: string): ShoppingListRecipe[] {
        const recipes: ShoppingListRecipe[] = [];
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            const parts = trimmed.split('\t');
            if (parts.length >= 3) {
                recipes.push({
                    path: parts[0],
                    name: parts[1],
                    scale: Number.isFinite(parseFloat(parts[2])) && parseFloat(parts[2]) > 0 ? parseFloat(parts[2]) : 1,
                });
            }
        }
        return recipes;
    }

    /**
     * Serialises the current recipe list to `.shopping_list.txt` in tab-delimited
     * format and writes it to the workspace root via `FileService`.
     */
    protected async saveToFile(): Promise<void> {
        const rootUri = this.getWorkspaceRootUri();
        if (!rootUri) {
            return;
        }

        const fileUri = rootUri.resolve('.shopping_list.txt');
        const lines = this.recipes.map(r => `${r.path}\t${r.name}\t${r.scale}`);
        const content = lines.length > 0 ? lines.join('\n') + '\n' : '';

        try {
            await this.fileService.write(fileUri, content);
        } catch (e) {
            console.error('[shopping-list] Failed to save shopping list:', e);
        }
    }

    /**
     * Reads a config file at `relativePath` relative to the workspace root.
     * Returns `null` when the file does not exist or cannot be read.
     */
    protected async readConfigFile(rootUri: URI, relativePath: string): Promise<string | null> {
        try {
            const fileUri = rootUri.resolve(relativePath);
            const content = await this.fileService.read(fileUri);
            return content.value;
        } catch {
            return null;
        }
    }

    /**
     * Returns a `URI` pointing to the first workspace root, or `undefined` when no
     * workspace is open.
     */
    getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    dispose(): void {
        this.toDispose.dispose();
    }
}
