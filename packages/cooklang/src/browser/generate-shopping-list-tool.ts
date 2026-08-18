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
import { ShoppingListService } from './shopping-list-service';
import { ShoppingListContribution } from './shopping-list-contribution';
import { RecipeReferenceResolver, ResolvedRecipeReference } from './recipe-reference-resolver';
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

/**
 * AI tool: build a shopping list from recipes (each with a scale) or from a
 * `.menu`, aisle-grouped and pantry-subtracted — the same aggregation as the
 * Shopping List view. Headless by default; `addToList: true` also adds the
 * items to the user's live shopping list and opens the view. Because that
 * path mutates the list the tool keeps the default confirmation behaviour
 * (no `confirmAlwaysAllow`).
 */
@injectable()
export class GenerateShoppingListTool implements ToolProvider {

    static ID = 'generateShoppingList';

    @inject(ShoppingListService)
    protected readonly shoppingListService: ShoppingListService;

    @inject(ShoppingListContribution)
    protected readonly shoppingListContribution: ShoppingListContribution;

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
        const hasRecipes = Array.isArray(args.recipes) && args.recipes.length > 0;
        const menu = typeof args.menu === 'string' ? args.menu.trim() : '';
        const hasMenu = menu.length > 0;
        if (hasRecipes === hasMenu) {
            return this.fail('Pass exactly one of `recipes` (non-empty) or `menu`.');
        }
        const root = this.shoppingListService.getWorkspaceRootUri();
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
            const refs = await this.referenceResolver.resolve(file.content, baseDir);
            inputs.push({ path: file.path, scale, refs });
        }

        const summary = inputs.map(({ path, scale }) => ({ path, scale }));
        if (addToList) {
            for (const input of inputs) {
                await this.shoppingListService.addRecipe(input.path, input.scale, input.refs);
            }
            await this.shoppingListContribution.openView({ activate: true });
            return JSON.stringify({ ...this.currentResult(), added: true, recipes: summary });
        }

        // Same flattening as ShoppingListService.flattenForGeneration: the
        // recipe itself plus each reference, multipliers multiplying down.
        const flat: Array<{ path: string; scale: number }> = [];
        for (const input of inputs) {
            flat.push({ path: input.path, scale: input.scale });
            for (const ref of input.refs) {
                flat.push({ path: ref.path, scale: ref.scale * input.scale });
            }
        }
        const result = await this.shoppingListService.computeResult(flat);
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
            await this.shoppingListService.addMenu(file.path, 1, recipes);
            await this.shoppingListContribution.openView({ activate: true });
            return JSON.stringify({ ...this.currentResult(), added: true, recipes });
        }

        // Same flattening as ShoppingListService.flattenForGeneration for a menu
        // item: the menu itself (own ingredients, if any) plus each referenced recipe.
        const flat = [{ path: file.path, scale: 1 }, ...recipes];
        const result = await this.shoppingListService.computeResult(flat);
        return JSON.stringify({ ...result, recipes });
    }

    /**
     * Reads a workspace-relative (or absolute / `file://`) path. Returns the
     * content together with the workspace-relative path (falling back to the
     * argument when the file lies outside the workspace), or `undefined` when
     * the file does not exist. Other read errors propagate.
     */
    protected async readWorkspaceFile(root: URI, path: string): Promise<WorkspaceFile | undefined> {
        const uri = this.reportConfigService.resolveWorkspaceUri(path);
        if (!uri) {
            throw new Error('No workspace is open.');
        }
        try {
            const content = (await this.fileService.read(uri)).value;
            return { path: root.relative(uri)?.toString() ?? path, content };
        } catch (e) {
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                return undefined;
            }
            throw e;
        }
    }

    protected currentResult(): ShoppingListResult {
        return this.shoppingListService.getResult() ?? EMPTY_RESULT;
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }

    protected errorMessage(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }
}
