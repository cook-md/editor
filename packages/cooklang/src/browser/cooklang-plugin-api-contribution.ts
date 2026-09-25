// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import {
    CheckEntry,
    ShoppingListFile,
    ShoppingListRecipeItem,
    ShoppingListResult,
    fromWireCheckedLog,
    fromWireShoppingList,
    toWireCheckEntryJson,
    toWireCheckedLog,
    toWireShoppingList,
} from '../common/shopping-list-types';
import { ShoppingListGenerator } from './shopping-list-generator';
import { RecipeReferenceResolver, ResolvedRecipeReference } from './recipe-reference-resolver';
import { ReportConfigService } from './report-config-service';

/**
 * The public Cooklang API for plugins: label-less commands (hidden from the
 * palette) that plugins call with `vscode.commands.executeCommand(id, args)`.
 * Arguments and results are plain JSON; paths are workspace-relative (absolute
 * paths and `file://` URIs inside the workspace are accepted). Version 1 —
 * changes are additive; bump `VERSION` for anything breaking.
 */
export namespace CooklangPluginApi {
    export const VERSION = 1;
    export const CONTEXT_KEY = 'cooklang.apiVersion';
    export const Commands = {
        VERSION: 'cooklang.api.version',
        GENERATE_SHOPPING_LIST: 'cooklang.api.generateShoppingList',
        RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
        PARSE_SHOPPING_LIST: 'cooklang.api.parseShoppingList',
        WRITE_SHOPPING_LIST: 'cooklang.api.writeShoppingList',
        PARSE_SHOPPING_CHECKED: 'cooklang.api.parseShoppingChecked',
        WRITE_SHOPPING_CHECKED: 'cooklang.api.writeShoppingChecked',
        COMPACT_SHOPPING_CHECKED: 'cooklang.api.compactShoppingChecked',
    } as const;
}

/**
 * Registers the public `cooklang.api.*` commands (see {@link CooklangPluginApi})
 * and sets the `cooklang.apiVersion` context key on start. Every command takes
 * one plain-JSON argument, validates it strictly (rejecting with
 * `Invalid arguments: …`), and delegates the format work to the native
 * Cooklang crates through {@link CooklangLanguageService}.
 */
@injectable()
export class CooklangPluginApiContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;

    @inject(RecipeReferenceResolver)
    protected readonly resolver: RecipeReferenceResolver;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(ContextKeyService)
    protected readonly contextKeys: ContextKeyService;

    onStart(): void {
        this.contextKeys.createKey<number>(CooklangPluginApi.CONTEXT_KEY, CooklangPluginApi.VERSION);
    }

    registerCommands(registry: CommandRegistry): void {
        const { Commands } = CooklangPluginApi;
        registry.registerCommand({ id: Commands.VERSION }, { execute: () => CooklangPluginApi.VERSION });
        registry.registerCommand({ id: Commands.GENERATE_SHOPPING_LIST }, { execute: (args: unknown) => this.generateShoppingList(args) });
        registry.registerCommand({ id: Commands.RESOLVE_RECIPE_REFERENCES }, { execute: (args: unknown) => this.resolveRecipeReferences(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_LIST }, { execute: (args: unknown) => this.parseShoppingList(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_LIST }, { execute: (args: unknown) => this.writeShoppingList(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.parseShoppingChecked(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.writeShoppingChecked(args) });
        registry.registerCommand({ id: Commands.COMPACT_SHOPPING_CHECKED }, { execute: (args: unknown) => this.compactShoppingChecked(args) });
    }

    protected async generateShoppingList(args: unknown): Promise<ShoppingListResult> {
        const recipes = this.object(args).recipes;
        if (!Array.isArray(recipes)) {
            throw this.invalid('`recipes` must be an array of { path, scale? }.');
        }
        const items = recipes.map(entry => {
            const recipe = this.object(entry);
            const path = this.string(recipe.path, '`path`');
            const scale = recipe.scale === undefined ? 1 : recipe.scale;
            if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
                throw this.invalid(`Recipe scale must be a positive number: ${path}`);
            }
            return { path, scale };
        });
        const normalised = items.map(item => ({ path: this.workspacePath(item.path), scale: item.scale }));
        return this.generator.computeResult(normalised);
    }

    protected async resolveRecipeReferences(args: unknown): Promise<ResolvedRecipeReference[]> {
        const requested = this.string(this.object(args).path, '`path`');
        const path = this.workspacePath(requested);
        const baseDir = this.root().path.fsPath();
        const content = await this.languageService.findRecipe(baseDir, path);
        if (content === undefined) {
            throw new Error(`Recipe not found: ${requested}`);
        }
        return this.resolver.resolve(content, baseDir);
    }

    protected async parseShoppingList(args: unknown): Promise<ShoppingListFile> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireShoppingList(await this.languageService.parseShoppingList(text));
    }

    protected async writeShoppingList(args: unknown): Promise<string> {
        const list = this.object(this.object(args).list);
        const file: ShoppingListFile = { items: this.shoppingItems(list.items, '`list.items`') };
        return this.languageService.writeShoppingList(toWireShoppingList(file));
    }

    protected async parseShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireCheckedLog(await this.languageService.parseChecked(text));
    }

    protected async writeShoppingChecked(args: unknown): Promise<string> {
        const entries = this.entries(this.object(args).entries);
        const lines: string[] = [];
        for (const entry of entries) {
            // Every line ends with '\n' (the Rust writer uses writeln!).
            lines.push(await this.languageService.writeCheckEntry(toWireCheckEntryJson(entry)));
        }
        return lines.join('');
    }

    protected async compactShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const request = this.object(args);
        const entries = this.entries(request.entries);
        const ingredients = request.ingredients;
        if (!Array.isArray(ingredients) || !ingredients.every(name => typeof name === 'string')) {
            throw this.invalid('`ingredients` must be an array of strings.');
        }
        return fromWireCheckedLog(await this.languageService.compactChecked(toWireCheckedLog(entries), ingredients));
    }

    // --- argument helpers ---

    protected root(): URI {
        const root = this.generator.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open.');
        }
        return root;
    }

    /** Workspace-relative form of a path or URI inside the workspace. */
    protected workspacePath(path: string): string {
        const root = this.root();
        const uri = this.reportConfigService.resolveWorkspaceUri(this.portablePath(path));
        const relative = uri && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        if (!relative) {
            throw new Error(`Path is outside the workspace: ${path}`);
        }
        return relative;
    }

    /**
     * Windows absolute paths (`C:\\…`) become `file://` URIs; backslashes in
     * relative paths become `/`, so plugins may pass either separator.
     */
    protected portablePath(path: string): string {
        if (/^[a-zA-Z]:[\\/]/.test(path)) {
            return URI.fromFilePath(path.replace(/\\/g, '/')).toString();
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
            return path;
        }
        return path.replace(/\\/g, '/');
    }

    protected object(value: unknown): Record<string, unknown> {
        if (typeof value !== 'object' || value === undefined || value === null || Array.isArray(value)) { // eslint-disable-line no-null/no-null
            throw this.invalid('expected a JSON object.');
        }
        return value as Record<string, unknown>;
    }

    protected string(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw this.invalid(`${name} must be a non-empty string.`);
        }
        this.noControlCharacters(value, name);
        return value.trim();
    }

    protected text(value: unknown, name: string): string {
        if (typeof value !== 'string') {
            throw this.invalid(`${name} must be a string.`);
        }
        return value;
    }

    protected entries(value: unknown): CheckEntry[] {
        if (!Array.isArray(value)) {
            throw this.invalid('`entries` must be an array.');
        }
        return value.map(entry => {
            const candidate = this.object(entry);
            if ((candidate.type !== 'checked' && candidate.type !== 'unchecked') || typeof candidate.name !== 'string') {
                throw this.invalid('each entry must be { type: "checked" | "unchecked", name }.');
            }
            this.noControlCharacters(candidate.name, 'entry `name`');
            return { type: candidate.type, name: candidate.name };
        });
    }

    /** Validates a `.shopping-list` item tree; `type` is always `'recipe'`. */
    protected shoppingItems(value: unknown, name: string): ShoppingListRecipeItem[] {
        if (!Array.isArray(value)) {
            throw this.invalid(`${name} must be an array.`);
        }
        return value.map(entry => {
            const item = this.object(entry);
            const path = this.string(item.path, '`path`');
            const multiplier = item.multiplier;
            if (multiplier !== undefined && (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0)) {
                throw this.invalid(`Recipe multiplier must be a positive number: ${path}`);
            }
            const children = item.children === undefined ? [] : this.shoppingItems(item.children, '`children`');
            const result: ShoppingListRecipeItem = { type: 'recipe', path, children };
            if (multiplier !== undefined) {
                result.multiplier = multiplier;
            }
            return result;
        });
    }

    /** The Rust writers do not escape newlines, so control characters would corrupt the file. */
    protected noControlCharacters(value: string, name: string): void {
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(value)) {
            throw this.invalid(`${name} must not contain control characters.`);
        }
    }

    protected invalid(detail: string): Error {
        return new Error(`Invalid arguments: ${detail}`);
    }
}
