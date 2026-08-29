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
import { CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';

function parseArgs(argString: string): Record<string, string> {
    try {
        return JSON.parse(argString);
    } catch {
        throw new Error('Invalid arguments: expected JSON string');
    }
}

/**
 * Ceiling for a single tool result, in characters.
 *
 * A tool result is not a one-off cost: it joins the conversation history and
 * is re-sent to the server on every later turn. One oversized result therefore
 * fails not just its own request but every request after it, with no way for
 * the user to recover except starting a new chat. The server caps what it
 * returns, and this is the second line of defence for anything that slips
 * through (or arrives from an older server).
 */
const MAX_TOOL_RESULT_CHARS = 200_000;

/**
 * Truncate an oversized tool result, telling the model what was dropped so it
 * does not mistake the remainder for the whole.
 */
function capToolResult(result: string, toolName: string): string {
    if (result.length <= MAX_TOOL_RESULT_CHARS) {
        return result;
    }
    console.warn(`[Cookbot] ${toolName} returned ${result.length} chars, truncating to ${MAX_TOOL_RESULT_CHARS}`);
    return `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n...(truncated: ${toolName} returned ${result.length} characters, showing the first ${MAX_TOOL_RESULT_CHARS})`;
}

// ── Server tools ────────────────────────────────────────────────────────

@injectable()
export class CookbotSearchWebTool implements ToolProvider {
    static ID = 'searchWeb';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotSearchWebTool.ID,
            name: CookbotSearchWebTool.ID,
            displayName: 'Search Web',
            description: 'Search the web for recipes and cooking information using semantic search.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query for finding recipes or cooking information',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5)',
                    },
                },
                required: ['query'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        if (!args.query) {
            return 'Error: query parameter is required';
        }
        try {
            const results = await this.serverTools.searchWeb(args.query, args.max_results ? parseInt(args.max_results, 10) : undefined);
            return capToolResult(JSON.stringify(results), CookbotSearchWebTool.ID);
        } catch (e) {
            return `Error searching web: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

@injectable()
export class CookbotFetchUrlTool implements ToolProvider {
    static ID = 'fetchUrl';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotFetchUrlTool.ID,
            name: CookbotFetchUrlTool.ID,
            displayName: 'Fetch URL',
            description: 'Fetch the content of a URL. Useful for reading recipe pages.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch content from',
                    },
                },
                required: ['url'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        if (!args.url) {
            return 'Error: url parameter is required';
        }
        try {
            const result = await this.serverTools.fetchUrl(args.url);
            return capToolResult(JSON.stringify(result), CookbotFetchUrlTool.ID);
        } catch (e) {
            return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

@injectable()
export class CookbotConvertUrlTool implements ToolProvider {
    static ID = 'convertUrlToCooklang';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotConvertUrlTool.ID,
            name: CookbotConvertUrlTool.ID,
            displayName: 'Convert URL to Cooklang',
            description: 'Convert a recipe from a URL into Cooklang format.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'URL of the recipe page to convert',
                    },
                },
                required: ['url'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        if (!args.url) {
            return 'Error: url parameter is required';
        }
        try {
            const result = await this.serverTools.convertUrlToCooklang(args.url);
            return capToolResult(JSON.stringify(result), CookbotConvertUrlTool.ID);
        } catch (e) {
            return `Error converting URL: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

/**
 * Surfaces what the user already told cook.md, so the assistant can confirm
 * those answers instead of re-asking them.
 *
 * Someone who filled in the kickstart quiz on the website has already answered
 * most of the COOK.md interview; making them repeat it is the fastest way to
 * look like the product does not know them.
 */
@injectable()
export class CookbotGetServerPreferencesTool implements ToolProvider {
    static ID = 'getServerPreferences';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotGetServerPreferencesTool.ID,
            name: CookbotGetServerPreferencesTool.ID,
            displayName: 'Get Saved Preferences',
            description: 'Fetch the cooking preferences this user already saved on cook.md '
                + '(the kickstart quiz from the website, merged over their account profile). '
                + 'Call this before starting the COOK.md preferences interview: if answers come '
                + 'back, confirm them instead of asking the same questions again. '
                + 'Returns hasPreferences:false when the user has saved nothing.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => this.execute(),
        };
    }

    private async execute(): Promise<string> {
        try {
            const saved = await this.serverTools.getUserPreferences();
            return capToolResult(JSON.stringify(saved), CookbotGetServerPreferencesTool.ID);
        } catch (e) {
            // Saved preferences are a shortcut, never a prerequisite - say so,
            // so the model falls back to interviewing rather than giving up.
            return `Could not load saved preferences: ${e instanceof Error ? e.message : String(e)}. `
                + 'Continue by asking the user directly.';
        }
    }
}

@injectable()
export class CookbotConvertTextTool implements ToolProvider {
    static ID = 'convertTextToCooklang';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotConvertTextTool.ID,
            name: CookbotConvertTextTool.ID,
            displayName: 'Convert Text to Cooklang',
            description: 'Convert a plain text recipe into Cooklang format.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the recipe',
                    },
                    text: {
                        type: 'string',
                        description: 'Plain text recipe content to convert',
                    },
                },
                required: ['name', 'text'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        if (!args.name || !args.text) {
            return 'Error: both name and text parameters are required';
        }
        try {
            const result = await this.serverTools.convertTextToCooklang(args.name, args.text);
            return capToolResult(JSON.stringify(result), CookbotConvertTextTool.ID);
        } catch (e) {
            return `Error converting text: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
