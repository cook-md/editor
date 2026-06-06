// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CancellationToken, URI } from '@theia/core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import { GET_WORKSPACE_DIRECTORY_STRUCTURE_FUNCTION_ID } from './function-ids';

@injectable()
export class GetWorkspaceDirectoryStructure implements ToolProvider {
    static ID = GET_WORKSPACE_DIRECTORY_STRUCTURE_FUNCTION_ID;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    getTool(): ToolRequest {
        return {
            id: GetWorkspaceDirectoryStructure.ID,
            name: GetWorkspaceDirectoryStructure.ID,
            displayName: 'Get Directory Structure',
            description:
                'Retrieves the directory tree of the workspace as a compact indented-tree string ' +
                '(2-space indentation per level, directory names suffixed with "/", one per line, sorted alphabetically). ' +
                'Lists only directories (no files), excluding common non-essential directories (node_modules, etc.). ' +
                'Hidden (dotfile) directories such as .git and .vscode are excluded unless includeHidden is set to true. ' +
                'Useful for getting a high-level overview of project organization. ' +
                'For listing files within a specific directory, use getWorkspaceFileList instead. ' +
                'For finding specific files, use findFilesByPattern.',
            parameters: {
                type: 'object',
                properties: {
                    includeHidden: {
                        type: 'boolean',
                        description:
                            'Include hidden (dotfile) directories such as .git and .vscode. Defaults to false.',
                    },
                },
            },
            handler: (argString, ctx) => this.getDirectoryStructure(this.parseIncludeHidden(argString), ctx?.cancellationToken),
        };
    }

    protected parseIncludeHidden(argString: string): boolean {
        try {
            const parsed = JSON.parse(argString);
            return parsed?.includeHidden === true;
        } catch {
            return false;
        }
    }

    protected async getDirectoryStructure(includeHidden: boolean, cancellationToken?: CancellationToken): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return 'Error: Operation cancelled by user';
        }
        let workspaceRoot: URI;
        try {
            workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
        } catch (error) {
            return `Error: ${(error as Error).message}`;
        }
        const lines: string[] = [];
        await this.appendDirectoryLines(workspaceRoot, 0, includeHidden, lines, cancellationToken);
        return lines.length > 0 ? lines.join('\n') : '(empty)';
    }

    protected async appendDirectoryLines(
        uri: URI,
        depth: number,
        includeHidden: boolean,
        lines: string[],
        cancellationToken?: CancellationToken,
    ): Promise<void> {
        if (cancellationToken?.isCancellationRequested) {
            return;
        }
        const stat = await this.fileService.resolve(uri);
        if (!stat || !stat.isDirectory || !stat.children) {
            return;
        }
        const childDirs = stat.children
            .filter(child => child.isDirectory)
            .sort((a, b) => a.resource.path.base.localeCompare(b.resource.path.base));
        for (const child of childDirs) {
            if (cancellationToken?.isCancellationRequested) {
                return;
            }
            const name = child.resource.path.base;
            if (!includeHidden && name.startsWith('.')) {
                continue;
            }
            if (await this.workspaceScope.shouldExclude(child)) {
                continue;
            }
            lines.push(`${'  '.repeat(depth)}${name}/`);
            await this.appendDirectoryLines(child.resource, depth + 1, includeHidden, lines, cancellationToken);
        }
    }
}
