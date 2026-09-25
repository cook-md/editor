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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileOperationError, FileOperationResult } from '@theia/filesystem/lib/common/files';
import URI from '@theia/core/lib/common/uri';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ShoppingListGenerator } from './shopping-list-generator';
import { RecipeReferenceResolver, ResolvedRecipeReference, flattenReferences } from './recipe-reference-resolver';
import { ReportConfigService } from './report-config-service';
import { ShoppingListResult } from '../common/shopping-list-types';

interface GenerateShoppingListArgs {
    recipes?: unknown;
    menu?: unknown;
    addToList?: unknown;
}

interface RecipeInput {
    /** Workspace-relative path (as stored in `.shopping-list`). */
    path: string;
    scale: number;
    /** Sub-recipe references with multipliers relative to the recipe itself. */
    refs: ResolvedRecipeReference[];
}

/** A workspace file read for the tool: its canonical (workspace-relative) path and content. */
interface WorkspaceFile {
    path: string;
    content: string;
}

const EMPTY_RESULT: ShoppingListResult = { categories: [], other: { name: 'other', items: [] }, pantryItems: [] };

/** Contributed by the `cooklang.shopping-list` plugin. */
const ADD_RECIPES_COMMAND = 'shoppingList.addRecipes';
const PLUGIN_MISSING = 'The Shopping List plugin is not installed or is disabled.';

/**
 * AI tool: build a shopping list from recipes (each with a scale) or from a
 * `.menu`, aisle-grouped and pantry-subtracted — the same aggregation as the
 * Shopping List view. Headless by default; `addToList: true` hands the
 * recipes to the Shopping List plugin (`shoppingList.addRecipes`), which adds
 * them to the live list and reveals its view. Because that
 * path mutates the list the tool keeps the default confirmation behaviour
 * (no `confirmAlwaysAllow`).
 */
@injectable()
export class GenerateShoppingListTool implements ToolProvider {

    static ID = 'generateShoppingList';

    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(RecipeReferenceResolver)
    protected readonly referenceResolver: RecipeReferenceResolver;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(FileService)
    protected readonly fileService: FileService;

    getTool(): ToolRequest {
        return {
            id: GenerateShoppingListTool.ID,
            name: GenerateShoppingListTool.ID,
            displayName: 'Generate Shopping List',
            description: 'Build a shopping list from recipes (with optional scale multipliers) or from a .menu file — ingredients '
                + 'aggregated, grouped by aisle (config/aisle.conf), pantry items (config/pantry.conf) subtracted, sub-recipe references '
                + 'included — exactly like the Shopping List view / `cook shopping-list`. Pass exactly one of `recipes` or `menu`. '
                + 'By default it only returns the computed list ({ categories: [{ name, items: [{ name, quantities }] }], other, pantryItems, recipes }). '
                + 'With addToList:true it also adds the recipes to the user\'s live shopping list, opens the Shopping List view and returns the whole current list. '
                + 'Use addToList only when the user asks to add/put items on their shopping list; for "what do I need for X" stay headless. '
                + 'Paths are workspace-relative (use searchRecipes to find them).',
            parameters: {
                type: 'object',
                properties: {
                    recipes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'Workspace-relative path of a .cook file, e.g. "Dinner/Carbonara.cook".' },
                                scale: { type: 'number', description: 'Multiplier for this recipe (positive). Default 1.' },
                            },
                            required: ['path'],
                        },
                        description: 'Recipes to include. Mutually exclusive with `menu`.',
                    },
                    menu: {
                        type: 'string',
                        description: 'Workspace-relative path of a .menu file whose recipe references (with their scales) form the list. Mutually exclusive with `recipes`.',
                    },
                    addToList: {
                        type: 'boolean',
                        description: 'When true, also add to the user\'s live shopping list and open the view. Default false (headless).',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: GenerateShoppingListArgs;
        try {
            const parsed: unknown = JSON.parse(argString || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return this.fail('Invalid arguments: expected a JSON object.');
            }
            args = parsed as GenerateShoppingListArgs;
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        if (args.recipes !== undefined && !Array.isArray(args.recipes)) {
            return this.fail('`recipes` must be an array of { path, scale } objects.');
        }
        if (args.menu !== undefined && typeof args.menu !== 'string') {
            return this.fail('`menu` must be a workspace-relative path string.');
        }
        if (args.addToList !== undefined && typeof args.addToList !== 'boolean') {
            return this.fail('`addToList` must be a boolean.');
        }
        const hasRecipes = Array.isArray(args.recipes) && args.recipes.length > 0;
        const menu = typeof args.menu === 'string' ? args.menu.trim() : '';
        const hasMenu = menu.length > 0;
        if (hasRecipes === hasMenu) {
            return this.fail('Pass exactly one of `recipes` (non-empty) or `menu`.');
        }
        const root = this.generator.getWorkspaceRootUri();
        if (!root) {
            return this.fail('No workspace is open.');
        }
        const addToList = args.addToList === true;

        try {
            if (hasMenu) {
                return await this.fromMenu(root, menu, addToList);
            }
            return await this.fromRecipes(root, args.recipes as unknown[], addToList);
        } catch (e) {
            return this.fail(this.errorMessage(e));
        }
    }

    protected async fromRecipes(root: URI, requested: unknown[], addToList: boolean): Promise<string> {
        const baseDir = root.path.fsPath();
        const inputs: RecipeInput[] = [];
        for (const entry of requested) {
            const r = entry && typeof entry === 'object' && !Array.isArray(entry)
                ? entry as { path?: unknown; scale?: unknown }
                : {};
            const requestedPath = typeof r.path === 'string' ? r.path.trim() : '';
            if (!requestedPath) {
                return this.fail('Every recipe needs a `path`.');
            }
            if (r.scale !== undefined && !(typeof r.scale === 'number' && Number.isFinite(r.scale) && r.scale > 0)) {
                return this.fail(`Recipe scale must be a positive number: ${requestedPath}`);
            }
            const scale = typeof r.scale === 'number' ? r.scale : 1;
            const file = await this.readWorkspaceFile(root, requestedPath);
            if (file === undefined) {
                return this.fail(`Recipe not found: ${requestedPath}`);
            }
            const refs = addToList ? [] : await this.referenceResolver.resolve(file.content, baseDir);
            inputs.push({ path: file.path, scale, refs });
        }

        const summary = inputs.map(({ path, scale }) => ({ path, scale }));
        if (addToList) {
            return this.addToLiveList({ recipes: summary }, summary);
        }

        // The recipe itself plus each reference, multipliers multiplying down.
        const flat: Array<{ path: string; scale: number }> = [];
        for (const input of inputs) {
            flat.push({ path: input.path, scale: input.scale });
            flat.push(...flattenReferences(input.refs, input.scale));
        }
        const result = await this.generator.computeResult(flat);
        return JSON.stringify({ ...result, recipes: summary });
    }

    protected async fromMenu(root: URI, requestedPath: string, addToList: boolean): Promise<string> {
        const file = await this.readWorkspaceFile(root, requestedPath);
        if (file === undefined) {
            return this.fail(`Menu not found: ${requestedPath}`);
        }
        const recipes = await this.referenceResolver.resolve(file.content, root.path.fsPath());
        if (recipes.length === 0) {
            return this.fail(`Menu contains no recipe references: ${requestedPath}`);
        }

        if (addToList) {
            return this.addToLiveList({ menu: file.path }, recipes);
        }

        // The menu itself (own ingredients, if any) plus each referenced recipe.
        const flat = [{ path: file.path, scale: 1 }, ...flattenReferences(recipes)];
        const result = await this.generator.computeResult(flat);
        return JSON.stringify({ ...result, recipes });
    }

    /**
     * Reads a workspace-relative (or absolute / `file://`) path that must lie
     * inside the workspace. Returns the content together with the
     * workspace-relative path, or `undefined` when the file does not exist.
     * A path outside the workspace or any other read error throws.
     */
    protected async readWorkspaceFile(root: URI, path: string): Promise<WorkspaceFile | undefined> {
        const uri = this.reportConfigService.resolveWorkspaceUri(path);
        if (!uri) {
            throw new Error('No workspace is open.');
        }
        const relative = root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        if (relative === undefined) {
            throw new Error(`Path is outside the workspace: ${path}`);
        }
        try {
            const content = (await this.fileService.read(uri)).value;
            return { path: relative, content };
        } catch (e) {
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                return undefined;
            }
            throw e;
        }
    }

    /**
     * Adds through the Shopping List plugin and returns its live list. A
     * rejection from the plugin propagates and `execute` reports it as an error.
     */
    protected async addToLiveList(request: { recipes: Array<{ path: string; scale: number }> } | { menu: string }, recipes: unknown): Promise<string> {
        if (!this.commandRegistry.getCommand(ADD_RECIPES_COMMAND)) {
            return this.fail(PLUGIN_MISSING);
        }
        const live = await this.commandRegistry.executeCommand<ShoppingListResult>(ADD_RECIPES_COMMAND, request);
        return JSON.stringify({ ...(live ?? EMPTY_RESULT), added: true, recipes });
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }

    protected errorMessage(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }
}
