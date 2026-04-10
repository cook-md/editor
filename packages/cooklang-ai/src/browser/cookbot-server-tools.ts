// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CookbotServerToolsService } from '../common/cookbot-server-tools-protocol';

function parseArgs(argString: string): Record<string, string> {
    try {
        return JSON.parse(argString);
    } catch {
        throw new Error('Invalid arguments: expected JSON string');
    }
}

function validatePath(filePath: string, root: FileStat): URI {
    const fileUri = root.resource.resolve(filePath);
    const rootPath = root.resource.path.toString();
    const resolved = fileUri.path.normalize().toString();
    if (!resolved.startsWith(rootPath + '/') && resolved !== rootPath) {
        throw new Error('Path escapes workspace root');
    }
    return fileUri;
}

// ── File tools ──────────────────────────────────────────────────────────

@injectable()
export class CookbotListFilesTool implements ToolProvider {
    static ID = 'list_files';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotListFilesTool.ID,
            name: CookbotListFilesTool.ID,
            description: 'List files in the recipes directory. Use glob patterns to filter.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Glob pattern to filter files (e.g. "**/*.cook")',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of files to return',
                    },
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const root = roots[0];
        const pattern = args.pattern || '**/*';
        const limit = args.limit ? parseInt(args.limit, 10) : 500;
        const rootPath = root.resource.path.toString();

        const files: string[] = [];
        await this.collectFiles(root.resource, rootPath, pattern, files, limit);
        return JSON.stringify(files);
    }

    private async collectFiles(dirUri: URI, rootPath: string, pattern: string, files: string[], limit: number, depth: number = 0): Promise<void> {
        if (depth > 20 || files.length >= limit) {
            return;
        }
        try {
            const stat = await this.fileService.resolve(dirUri);
            if (!stat.children) {
                return;
            }
            for (const child of stat.children) {
                if (files.length >= limit) {
                    break;
                }
                const relativePath = child.resource.path.toString().substring(rootPath.length + 1);
                if (child.isDirectory) {
                    await this.collectFiles(child.resource, rootPath, pattern, files, limit, depth + 1);
                } else if (this.matchGlob(relativePath, pattern)) {
                    files.push(relativePath);
                }
            }
        } catch {
            // Directory may not exist or be inaccessible
        }
    }

    private matchGlob(filePath: string, pattern: string): boolean {
        // Simple glob matching: support *, **, and ?
        const regexStr = pattern
            .replace(/\*\*/g, '{{GLOBSTAR}}')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
            .replace(/{{GLOBSTAR}}/g, '.*');
        return new RegExp(`^${regexStr}$`).test(filePath);
    }
}

@injectable()
export class CookbotReadFileTool implements ToolProvider {
    static ID = 'read_file';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotReadFileTool.ID,
            name: CookbotReadFileTool.ID,
            description: 'Read the contents of a file in the recipes directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from workspace root',
                    },
                },
                required: ['path'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = validatePath(args.path, roots[0]);
        try {
            const content = await this.fileService.read(fileUri);
            return content.value;
        } catch (e) {
            return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

@injectable()
export class CookbotWriteFileTool implements ToolProvider {
    static ID = 'write_file';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotWriteFileTool.ID,
            name: CookbotWriteFileTool.ID,
            description: 'Create or overwrite a file in the recipes directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from workspace root',
                    },
                    content: {
                        type: 'string',
                        description: 'File content to write',
                    },
                },
                required: ['path', 'content'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = validatePath(args.path, roots[0]);
        try {
            await this.fileService.write(fileUri, args.content);
            return `File written: ${args.path}`;
        } catch (e) {
            return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

@injectable()
export class CookbotEditFileTool implements ToolProvider {
    static ID = 'edit_file';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getTool(): ToolRequest {
        return {
            id: CookbotEditFileTool.ID,
            name: CookbotEditFileTool.ID,
            description: 'Edit a file by replacing text. Use find/replace for modifications.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from workspace root',
                    },
                    find: {
                        type: 'string',
                        description: 'Text to find in the file',
                    },
                    replace: {
                        type: 'string',
                        description: 'Text to replace with',
                    },
                },
                required: ['path', 'find', 'replace'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = parseArgs(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = validatePath(args.path, roots[0]);
        try {
            const existing = await this.fileService.read(fileUri);
            const content = existing.value;
            if (!content.includes(args.find)) {
                return `Error: text to find not found in ${args.path}`;
            }
            const updated = content.replace(args.find, args.replace);
            await this.fileService.write(fileUri, updated);
            return `File edited: ${args.path}`;
        } catch (e) {
            return `Error editing file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}

// ── Server tools ────────────────────────────────────────────────────────

@injectable()
export class CookbotSearchWebTool implements ToolProvider {
    static ID = 'search_web';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotSearchWebTool.ID,
            name: CookbotSearchWebTool.ID,
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
    static ID = 'fetch_url';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotFetchUrlTool.ID,
            name: CookbotFetchUrlTool.ID,
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
    static ID = 'convert_url_to_cooklang';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotConvertUrlTool.ID,
            name: CookbotConvertUrlTool.ID,
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
    static ID = 'convert_text_to_cooklang';

    @inject(CookbotServerToolsService)
    protected readonly serverTools: CookbotServerToolsService;

    getTool(): ToolRequest {
        return {
            id: CookbotConvertTextTool.ID,
            name: CookbotConvertTextTool.ID,
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
