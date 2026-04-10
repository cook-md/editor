// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
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
            return JSON.stringify(results);
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
            return JSON.stringify(result);
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
            return JSON.stringify(result);
        } catch (e) {
            return `Error converting URL: ${e instanceof Error ? e.message : String(e)}`;
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
            return JSON.stringify(result);
        } catch (e) {
            return `Error converting text: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
