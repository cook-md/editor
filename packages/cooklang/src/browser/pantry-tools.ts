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

// The tool responses mirror the native `parsePantry`/`checkPantry` JSON,
// where absent attributes and misses are null.
/* eslint-disable no-null/no-null */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CooklangLanguageService } from '../common/cooklang-language-service';

/** Workspace-relative location of the pantry file (same convention as the shopping list). */
export const PANTRY_CONF_PATH = 'config/pantry.conf';

const MAX_CHECK_NAMES = 100;

const NO_PANTRY_MESSAGE = `No ${PANTRY_CONF_PATH} in this workspace.`;

/**
 * Shared plumbing: locate the workspace root and read the pantry file.
 * `undefined` text means "no pantry file"; a missing workspace throws.
 */
abstract class PantryToolBase {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    protected async readPantryText(): Promise<string | undefined> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) {
            throw new Error('No workspace is open.');
        }
        try {
            return (await this.fileService.read(root.resolve(PANTRY_CONF_PATH))).value;
        } catch {
            return undefined;
        }
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }

    protected errorMessage(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }
}

/**
 * AI tool: return the parsed `config/pantry.conf` (sections, items with
 * quantity/bought/expire/low, and the low-stock items). Read-only.
 */
@injectable()
export class GetPantryTool extends PantryToolBase implements ToolProvider {

    static ID = 'getPantry';

    getTool(): ToolRequest {
        return {
            id: GetPantryTool.ID,
            name: GetPantryTool.ID,
            displayName: 'Get Pantry',
            description: `Read the user's pantry inventory from ${PANTRY_CONF_PATH} (the file CookCLI's \`cook pantry\` reads). `
                + 'Returns { path, sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow }] }], lowStock: [{ name, section, quantity, low }] } '
                + '— or { pantry: null, message } when the workspace has no pantry file (that is a valid answer, not an error). '
                + 'Use checkPantry to test specific ingredients instead of scanning this list.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => this.execute(),
        };
    }

    protected async execute(): Promise<string> {
        let text: string | undefined;
        try {
            text = await this.readPantryText();
        } catch (e) {
            return this.fail(this.errorMessage(e));
        }
        if (text === undefined) {
            return JSON.stringify({ pantry: null, message: NO_PANTRY_MESSAGE });
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(await this.languageService.parsePantry(text));
        } catch (e) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: ${this.errorMessage(e)}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: unexpected result shape.`);
        }
        return JSON.stringify({ path: PANTRY_CONF_PATH, ...parsed });
    }
}

/**
 * AI tool: check whether given ingredients are in the pantry. Read-only.
 */
@injectable()
export class CheckPantryTool extends PantryToolBase implements ToolProvider {

    static ID = 'checkPantry';

    getTool(): ToolRequest {
        return {
            id: CheckPantryTool.ID,
            name: CheckPantryTool.ID,
            displayName: 'Check Pantry',
            description: `Check which ingredients the user has in stock according to ${PANTRY_CONF_PATH} (case-insensitive name match). `
                + 'Returns { results: [{ name, inStock, section, quantity, isLow }] } in the order given; when there is no pantry file every '
                + 'ingredient is inStock:false and a message says so. Use plain ingredient names ("eggs", "olive oil"), 1–100 per call.',
            parameters: {
                type: 'object',
                properties: {
                    ingredients: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ingredient names to look up, e.g. ["eggs", "olive oil"].',
                    },
                },
                required: ['ingredients'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: { ingredients?: unknown };
        try {
            const parsed: unknown = JSON.parse(argString || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return this.fail('Invalid arguments: expected a JSON object.');
            }
            args = parsed as { ingredients?: unknown };
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        const names = Array.isArray(args.ingredients)
            ? args.ingredients.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map(n => n.trim())
            : [];
        if (names.length === 0) {
            return this.fail('ingredients must be a non-empty array of ingredient names.');
        }
        if (names.length > MAX_CHECK_NAMES) {
            return this.fail(`ingredients: at most ${MAX_CHECK_NAMES} names per call.`);
        }

        let text: string | undefined;
        try {
            text = await this.readPantryText();
        } catch (e) {
            return this.fail(this.errorMessage(e));
        }
        if (text === undefined) {
            return JSON.stringify({
                results: names.map(name => ({ name, inStock: false, section: null, quantity: null, isLow: false })),
                message: NO_PANTRY_MESSAGE,
            });
        }
        let results: unknown;
        try {
            results = JSON.parse(await this.languageService.checkPantry(text, names));
        } catch (e) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: ${this.errorMessage(e)}`);
        }
        if (!Array.isArray(results)) {
            return this.fail(`Could not parse ${PANTRY_CONF_PATH}: unexpected result shape.`);
        }
        return JSON.stringify({ results });
    }
}
