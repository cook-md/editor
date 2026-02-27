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

@injectable()
export class CookbotListFilesTool implements ToolProvider {
    static ID = 'cookbot_list_files';

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
                },
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    private async execute(argString: string): Promise<string> {
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const root = roots[0];
        return JSON.stringify({ root: root.resource.toString(), pattern: args.pattern || '**/*' });
    }
}

@injectable()
export class CookbotReadFileTool implements ToolProvider {
    static ID = 'cookbot_read_file';

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
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = roots[0].resource.resolve(args.path);
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
    static ID = 'cookbot_write_file';

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
        const args = JSON.parse(argString);
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return 'No workspace open';
        }
        const fileUri = roots[0].resource.resolve(args.path);
        try {
            await this.fileService.write(fileUri, args.content);
            return `File written: ${args.path}`;
        } catch (e) {
            return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
