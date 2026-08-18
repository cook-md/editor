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
import { ToolProvider, ToolRequest, ToolRequestParameterProperty, ToolInvocationContext } from '@theia/ai-core/lib/common';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElementFactory } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';
import { WorkspaceFunctionScope } from './file-tools/workspace-function-scope';
import { FileChangeSetTitleProvider } from './file-tools/file-changeset-functions';

// ── Vocabulary ──────────────────────────────────────────────────────────
// Mirrors the kickstart wizard / cook.md `KickstartMatcherService` (and the
// cookbot `recipe-discovery` skill). Values the server does not know are
// silently dropped there, so keep these lists in step with Rails.

const DIETARY = ['vegetarian', 'vegan', 'pescatarian', 'flexitarian', 'keto', 'paleo', 'gluten-free', 'dairy-free', 'halal', 'kosher', 'low-fodmap'];
// No `gluten`: Rails' allergen vocabulary has no gluten entry (it would be dropped) — gluten/wheat is `dietary: gluten-free`.
const ALLERGENS = ['tree-nuts', 'peanuts', 'shellfish', 'fish', 'eggs', 'soy', 'sesame'];
// `eastern_european` keeps the underscore: that is the form UserPreference::CUISINE_OPTIONS accepts (no hyphen mapping exists).
const CUISINES = ['american', 'italian', 'french', 'spanish', 'greek', 'british', 'german', 'eastern_european', 'chinese', 'japanese', 'thai', 'indian',
    'korean', 'vietnamese', 'mexican', 'middle-eastern', 'caribbean', 'african', 'mediterranean', 'fusion'];
const EQUIPMENT = ['instant-pot', 'slow-cooker', 'air-fryer', 'rice-cooker', 'stand-mixer', 'food-processor', 'blender', 'grill', 'sous-vide',
    'bread-maker', 'pasta-maker', 'smoker', 'wok', 'cast-iron', 'dutch-oven'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack'];
const COURSES = ['main', 'side', 'drink', 'sauce', 'accompaniment', 'any'];
const COOKING_METHODS = ['one-pot', 'sheet-pan', 'no-cook', 'batch-cooking', 'slow-cooker', 'stir-fry', 'casseroles', 'soups-stews'];
const DISH_CATEGORIES = ['pasta_noodles', 'soup_stew', 'salad', 'pizza_flatbread', 'meat_main', 'seafood', 'rice_grain_bowl', 'taco_burrito',
    'sandwich_burger', 'casserole_bake', 'bread', 'baked_sweet', 'eggs', 'smoothie_drink', 'sauce_dip'];
const NUTRITIONAL_FOCUS = ['high-protein', 'low-carb', 'whole-grains', 'anti-inflammatory', 'heart-healthy', 'gut-health', 'energy-boosting', 'pregnancy-safe',
    'lower-sugar', 'lower-sodium', 'lower-glycemic', 'high-fiber'];

function stringArray(description: string, values?: string[]): ToolRequestParameterProperty {
    return {
        type: 'array',
        items: values ? { type: 'string', enum: values } : { type: 'string' },
        description,
    };
}

function fail(message: string): string {
    return JSON.stringify({ error: message });
}

/**
 * AI tool: search the cook.md curated recipe catalog with structured criteria
 * (the kickstart wizard's vocabulary) plus an optional keyword. Read-only,
 * auto-executes; the server JSON (`{ recipes, hint }`) is returned verbatim.
 */
@injectable()
export class CookbotSearchRecipeCatalogTool implements ToolProvider {
    static ID = 'searchRecipeCatalog';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotSearchRecipeCatalogTool.ID,
            name: CookbotSearchRecipeCatalogTool.ID,
            displayName: 'Search Recipe Catalog',
            description: 'Search cook.md\'s curated recipe catalog (~16k tested recipes) with structured criteria: diet, allergens to exclude, '
                + 'cuisines, meal types, course (main vs side/drink/sauce), max cook time, skill level, equipment, dish categories, plus an '
                + 'optional keyword. Use it for "find me…" requests about recipes the user does not have yet; use searchRecipes for the '
                + 'user\'s own workspace and searchWeb only when neither fits. Load the recipe-discovery skill first. '
                + 'Returns { recipes: [{ id, title, meal_type, course, cuisine, cook_time_minutes, skill_level, dietary, tags, source_url, score }], hint } '
                + '— `hint` is set only when nothing matched and names the filters to relax. To show more, repeat with the shown ids in exclude_ids. '
                + 'To add one to the workspace, call addCatalogRecipe with its id.',
            parameters: {
                type: 'object',
                properties: {
                    dietary: stringArray('Dietary requirements every result must satisfy (gluten/wheat avoidance goes here as gluten-free).', DIETARY),
                    exclude_allergens: stringArray('Allergens no result may contain.', ALLERGENS),
                    dislikes: stringArray('Ingredients to avoid, e.g. "cilantro", "olives", "mushrooms", "blue-cheese", "raw-onion".'),
                    cuisines: stringArray('Preferred cuisines (ranking preference, not a hard filter).', CUISINES),
                    equipment: stringArray('Appliances the user owns; recipes needing other appliances are excluded.', EQUIPMENT),
                    max_skill_level: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 4,
                        description: '1 beginner, 2 intermediate, 3–4 advanced (ranking preference, not a hard cap).',
                    },
                    meal_types: stringArray('Meal slots to search; empty = all.', MEAL_TYPES),
                    course: {
                        type: 'string',
                        enum: COURSES,
                        description: 'main (default) = proper meals; side/drink/sauce or accompaniment = sides & drinks; any = everything.',
                    },
                    cooking_methods: stringArray('Cooking style preferences.', COOKING_METHODS),
                    dish_categories: stringArray('Dish shapes to favour (ranking, not a filter).', DISH_CATEGORIES),
                    nutritional_focus: stringArray('Nutrition goals (pregnancy-safe is a hard filter, the rest are ranking bonuses).', NUTRITIONAL_FOCUS),
                    max_cook_time_minutes: { type: 'integer', minimum: 1, description: 'Upper bound on total cook time in minutes.' },
                    query: { type: 'string', description: 'Keyword(s) matched against title and dish type, e.g. "salmon", "carbonara".' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many recipes to return. Default 5; keep chat answers to 3–5.' },
                    exclude_ids: stringArray('Ids already shown to the user (for "show me more").'),
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let criteria: object;
        try {
            const parsed: unknown = argString && argString.trim() ? JSON.parse(argString) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return fail('Invalid arguments: expected a JSON object.');
            }
            criteria = parsed;
        } catch {
            return fail('Invalid arguments: expected a JSON object.');
        }
        try {
            const result = await this.serverTools.searchRecipeCatalog(criteria);
            return JSON.stringify(result);
        } catch (e) {
            return fail(`Catalog search failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

/**
 * AI tool: fetch one catalog recipe and stage it into the workspace through the
 * chat changeset (same review/apply UX as suggestFileContent). The recipe body
 * never round-trips through the model. Mutating (stages a change), so it is
 * not auto-allowed.
 */
@injectable()
export class CookbotAddCatalogRecipeTool implements ToolProvider {
    static ID = 'addCatalogRecipe';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceFunctionScope: WorkspaceFunctionScope;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    getTool(): ToolRequest {
        return {
            id: CookbotAddCatalogRecipeTool.ID,
            name: CookbotAddCatalogRecipeTool.ID,
            displayName: 'Add Catalog Recipe',
            description: 'Propose adding a recipe from the cook.md catalog to the user\'s workspace: fetches the .cook file by the id returned '
                + 'by searchRecipeCatalog and stages it for review (the user accepts or rejects it, like suggestFileContent). '
                + 'By default the file goes to the catalog\'s suggested path (e.g. "Dinner/<Title>.cook", "Sides & Drinks/<Title>.cook"); '
                + 'pass `path` only when the user asked for a specific location. Returns { proposedPath, title, message } — say the recipe is '
                + 'proposed/ready for review, never that it was saved.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Catalog recipe id from searchRecipeCatalog.' },
                    path: { type: 'string', description: 'Optional workspace-relative target path ending in .cook. Defaults to the catalog\'s suggested path.' },
                },
                required: ['id'],
            },
            handler: async (argString: string, ctx?: ToolInvocationContext) => this.execute(argString, ctx),
            getArgumentsShortLabel: (args: string) => {
                try {
                    const parsed: unknown = JSON.parse(args);
                    if (!parsed || typeof parsed !== 'object') {
                        return undefined;
                    }
                    const { path, id } = parsed as { path?: unknown; id?: unknown };
                    const label = (typeof path === 'string' && path.trim()) ? path : (typeof id === 'string' && id.trim()) ? id : undefined;
                    return label ? { label, hasMore: true } : undefined;
                } catch {
                    return undefined;
                }
            },
        };
    }

    protected async execute(argString: string, ctx?: ToolInvocationContext): Promise<string> {
        if (!ChatToolContext.is(ctx)) {
            return fail('This tool requires a chat context. It can only be used within a chat session.');
        }
        if (ctx.cancellationToken?.isCancellationRequested) {
            return fail('Operation cancelled by user');
        }
        let args: { id?: unknown; path?: unknown };
        try {
            const parsed: unknown = argString && argString.trim() ? JSON.parse(argString) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return fail('Invalid arguments: expected a JSON object.');
            }
            args = parsed;
        } catch {
            return fail('Invalid arguments: expected a JSON object.');
        }
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
            return fail('id is required (use the id from searchRecipeCatalog).');
        }
        const explicitPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;

        try {
            const recipe = await this.serverTools.getCatalogRecipe(id);
            const path = explicitPath ?? recipe.suggestedPath;
            const workspaceRoot = await this.workspaceFunctionScope.getWorkspaceRoot();
            const uri = (await this.workspaceFunctionScope.resolveRelativePath(path)).normalizePath();
            this.workspaceFunctionScope.ensureWithinWorkspace(uri, workspaceRoot);
            const type: 'add' | 'modify' = (await this.fileService.exists(uri)) ? 'modify' : 'add';
            ctx.request.session.changeSet.addElements(this.fileChangeFactory({
                uri,
                type,
                state: 'pending',
                targetState: recipe.content,
                requestId: ctx.request.id,
                chatSessionId: ctx.request.session.id,
            }));
            ctx.request.session.changeSet.setTitle(this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
            return JSON.stringify({
                proposedPath: path,
                title: recipe.title,
                message: `Proposed adding "${recipe.title}" at ${path} — the user will review and apply the change.`,
            });
        } catch (e) {
            return fail(`Could not add catalog recipe: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
