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

    // Stubs — implemented in subsequent tasks.
    async regenerate(): Promise<void> { /* Task 9 */ }
}
