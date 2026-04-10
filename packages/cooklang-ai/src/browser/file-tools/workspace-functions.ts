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

import { CancellationToken, PreferenceService, URI } from '@theia/core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileOperationError, FileOperationResult } from '@theia/filesystem/lib/common/files';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { Minimatch } from 'minimatch';
import { WorkspaceFunctionScope } from './workspace-function-scope';
import {
    FILE_CONTENT_FUNCTION_ID,
    GET_WORKSPACE_FILE_LIST_FUNCTION_ID,
    GET_WORKSPACE_DIRECTORY_STRUCTURE_FUNCTION_ID,
    FIND_FILES_BY_PATTERN_FUNCTION_ID,
} from './function-ids';
import { CONSIDER_GITIGNORE_PREF, FILE_CONTENT_MAX_SIZE_KB_PREF, USER_EXCLUDE_PATTERN_PREF } from './workspace-preferences';

// ── GetWorkspaceDirectoryStructure ──────────────────────────────────────

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
                'Retrieves the complete directory tree structure of the workspace as a nested JSON object. ' +
                'Lists only directories (no files), excluding common non-essential directories (node_modules, hidden files, etc.). ' +
                'Useful for getting a high-level overview of project organization. ' +
                'For listing files within a specific directory, use getWorkspaceFileList instead. ' +
                'For finding specific files, use findFilesByPattern.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: (_, ctx) => this.getDirectoryStructure(ctx?.cancellationToken),
        };
    }

    protected async getDirectoryStructure(cancellationToken?: CancellationToken): Promise<Record<string, unknown> | string> {
        if (cancellationToken?.isCancellationRequested) {
            return { error: 'Operation cancelled by user' };
        }
        let workspaceRoot: URI;
        try {
            workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
        } catch (error) {
            return { error: (error as Error).message };
        }
        return this.buildDirectoryStructure(workspaceRoot, cancellationToken);
    }

    protected async buildDirectoryStructure(uri: URI, cancellationToken?: CancellationToken): Promise<Record<string, unknown>> {
        if (cancellationToken?.isCancellationRequested) {
            return { error: 'Operation cancelled by user' };
        }
        const stat = await this.fileService.resolve(uri);
        const result: Record<string, unknown> = {};
        if (stat && stat.isDirectory && stat.children) {
            for (const child of stat.children) {
                if (cancellationToken?.isCancellationRequested) {
                    return { error: 'Operation cancelled by user' };
                }
                if (!child.isDirectory || (await this.workspaceScope.shouldExclude(child))) {
                    continue;
                }
                const dirName = child.resource.path.base;
                result[dirName] = await this.buildDirectoryStructure(child.resource, cancellationToken);
            }
        }
        return result;
    }
}

// ── FileContentFunction ─────────────────────────────────────────────────

@injectable()
export class FileContentFunction implements ToolProvider {
    static ID = FILE_CONTENT_FUNCTION_ID;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    getTool(): ToolRequest {
        return {
            id: FileContentFunction.ID,
            name: FileContentFunction.ID,
            displayName: 'Read File',
            description:
                'Returns the content of a specified file within the workspace as a raw string. ' +
                'The file path must be provided relative to the workspace root. Only files within ' +
                'workspace boundaries are accessible; attempting to access files outside the workspace will return an error. ' +
                'If the file is currently open in an editor with unsaved changes, returns the editor\'s current content (not the saved file on disk). ' +
                'Binary files may not be readable and will return an error. ' +
                'Use this tool to read file contents before making any edits with replacement functions. ' +
                'Do NOT use this for files you haven\'t located yet - use findFilesByPattern first. ' +
                'Files exceeding the configured size limit will return an error. ' +
                'It is recommended to read the whole file by not providing offset or limit parameters, ' +
                'unless you expect it to be very large. ' +
                'If the size limit is hit, do NOT attempt to read the full file in chunks using offset and limit \u2014 ' +
                'this wastes context window.',
            parameters: {
                type: 'object',
                properties: {
                    file: {
                        type: 'string',
                        description:
                            'The relative path to the target file within the workspace (e.g., "src/index.ts", "package.json"). ' +
                            'Must be relative to the workspace root. Absolute paths and paths outside the workspace will result in an error.',
                    },
                    offset: {
                        type: 'number',
                        description: 'Zero-based line offset to start reading from (default: 0). ' +
                            'Use together with limit to page through large files.',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of lines to return. Defaults to the rest of the file.',
                    },
                },
                required: ['file'],
            },
            handler: (argString, ctx) => {
                const { file, offset, limit } = this.parseArg(argString);
                return this.getFileContent(file, ctx?.cancellationToken, offset, limit);
            },
            providerName: undefined,
            getArgumentsShortLabel: (args: string) => {
                try {
                    const parsed = JSON.parse(args);
                    if (parsed && typeof parsed === 'object' && 'file' in parsed) {
                        const hasMore = 'offset' in parsed || 'limit' in parsed;
                        return { label: String(parsed.file), hasMore };
                    }
                } catch {
                    // ignore parse errors
                }
                return undefined;
            },
        };
    }

    protected parseArg(argString: string): { file: string; offset?: number; limit?: number } {
        const result = JSON.parse(argString);
        return { file: result.file, offset: result.offset, limit: result.limit };
    }

    async getFileContent(file: string, cancellationToken?: CancellationToken, offset?: number, limit?: number): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
            return JSON.stringify({ error: 'offset must be a non-negative integer.' });
        }
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
            return JSON.stringify({ error: 'limit must be a positive integer.' });
        }
        let targetUri: URI;
        try {
            const workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
            targetUri = workspaceRoot.resolve(file);
            this.workspaceScope.ensureWithinWorkspace(targetUri, workspaceRoot);
        } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
        }
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        const openEditorValue = this.monacoWorkspace.getTextDocument(targetUri.toString())?.getText();
        const maxSizeKB = this.preferences.get<number>(FILE_CONTENT_MAX_SIZE_KB_PREF, 256);
        const isEditorOpen = openEditorValue !== undefined;
        const isPaginated = offset !== undefined || limit !== undefined;

        if (isEditorOpen) {
            return this.handleEditorContent(openEditorValue, maxSizeKB, offset, limit);
        } else if (isPaginated) {
            return this.readStreamedSlice(targetUri, maxSizeKB, offset, limit);
        } else {
            return this.handleFullDiskRead(targetUri, maxSizeKB);
        }
    }

    protected handleEditorContent(content: string, maxSizeKB: number, offset?: number, limit?: number): string {
        if (offset === undefined && limit === undefined) {
            const sizeKB = this.sizeInKB(content);
            if (sizeKB > maxSizeKB) {
                return this.buildFileSizeLimitError(sizeKB, maxSizeKB);
            }
            return content;
        }
        const lines = content.split('\n');
        const startOffset = offset ?? 0;
        const sliced = limit !== undefined ? lines.slice(startOffset, startOffset + limit) : lines.slice(startOffset);
        const result = sliced.join('\n');
        const resultSizeKB = this.sizeInKB(result);
        if (resultSizeKB > maxSizeKB) {
            return this.buildSliceSizeLimitError(resultSizeKB, maxSizeKB);
        }
        const startLine = startOffset + 1;
        const endLine = startOffset + sliced.length;
        const header = `[Lines ${startLine}\u2013${endLine} of ${lines.length} total. Use offset and limit to read other ranges.]`;
        return `${header}\n${result}`;
    }

    protected async handleFullDiskRead(targetUri: URI, maxSizeKB: number): Promise<string> {
        try {
            const stat = await this.fileService.resolve(targetUri);
            if (stat.size !== undefined) {
                const statSizeKB = Math.round(stat.size / 1024);
                if (statSizeKB > maxSizeKB) {
                    return this.buildFileSizeLimitError(statSizeKB, maxSizeKB);
                }
            } else {
                return this.readStreamedSlice(targetUri, maxSizeKB);
            }
            const rawContent = (await this.fileService.read(targetUri)).value;
            const sizeKB = this.sizeInKB(rawContent);
            if (sizeKB > maxSizeKB) {
                return this.buildFileSizeLimitError(sizeKB, maxSizeKB);
            }
            return rawContent;
        } catch (error) {
            if (error instanceof FileOperationError) {
                if (error.fileOperationResult === FileOperationResult.FILE_TOO_LARGE ||
                    error.fileOperationResult === FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT) {
                    return this.buildFileSizeLimitError(undefined, maxSizeKB);
                }
            }
            return JSON.stringify({ error: 'File not found' });
        }
    }

    protected async readStreamedSlice(targetUri: URI, maxSizeKB: number, startLine?: number, limit?: number): Promise<string> {
        const isPaginated = startLine !== undefined || limit !== undefined;
        const effectiveStartLine = startLine ?? 0;
        let streamValue;
        try {
            streamValue = (await this.fileService.readStream(targetUri, { limits: { size: Number.MAX_SAFE_INTEGER } })).value;
        } catch (e) {
            if (e instanceof FileOperationError &&
                (e.fileOperationResult === FileOperationResult.FILE_TOO_LARGE ||
                    e.fileOperationResult === FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT)) {
                return JSON.stringify({
                    error: 'File exceeds the configured ' + maxSizeKB + 'KB size limit. ' +
                        'Use the \'offset\' (0-based) and \'limit\' parameters to read specific line ranges.',
                    maxSizeKB
                });
            }
            return JSON.stringify({ error: 'File not found' });
        }
        return new Promise<string>(resolve => {
            let pending = '';
            let lineIndex = 0;
            const sliceLines: string[] = [];
            streamValue.on('data', (chunk: string) => {
                const parts = (pending + chunk).split('\n');
                pending = parts.pop()!;
                for (const line of parts) {
                    if (lineIndex >= effectiveStartLine && (limit === undefined || lineIndex < effectiveStartLine + limit)) {
                        sliceLines.push(line);
                    }
                    lineIndex++;
                }
            });
            streamValue.on('end', () => {
                if (pending.length > 0) {
                    if (lineIndex >= effectiveStartLine && (limit === undefined || lineIndex < effectiveStartLine + limit)) {
                        sliceLines.push(pending);
                    }
                    lineIndex++;
                }
                const result = sliceLines.join('\n');
                const resultSizeKB = this.sizeInKB(result);
                if (resultSizeKB > maxSizeKB) {
                    const sizeError = isPaginated
                        ? this.buildSliceSizeLimitError(resultSizeKB, maxSizeKB)
                        : this.buildFileSizeLimitError(resultSizeKB, maxSizeKB);
                    resolve(sizeError);
                    return;
                }
                if (isPaginated) {
                    const header = `[Lines ${effectiveStartLine + 1}\u2013${effectiveStartLine + sliceLines.length} of ${lineIndex} total. ` +
                        'Use offset and limit to read other ranges.]';
                    resolve(`${header}\n${result}`);
                } else {
                    resolve(result);
                }
            });
            streamValue.on('error', () => resolve(JSON.stringify({ error: 'File not found' })));
        });
    }

    protected sizeInKB(content: string): number {
        return Math.round(Buffer.byteLength(content, 'utf8') / 1024);
    }

    protected buildFileSizeLimitError(sizeKB: number | undefined, maxSizeKB: number): string {
        const sizeInfo = sizeKB !== undefined ? ` (${sizeKB}KB)` : '';
        const result: Record<string, unknown> = {
            error: `File exceeds the configured ${maxSizeKB}KB size limit${sizeInfo}. ` +
                'Use the \'offset\' (0-based) and \'limit\' parameters to read specific line ranges.',
            maxSizeKB
        };
        if (sizeKB !== undefined) {
            result.sizeKB = sizeKB;
        }
        return JSON.stringify(result);
    }

    protected buildSliceSizeLimitError(resultSizeKB: number, maxSizeKB: number): string {
        return JSON.stringify({
            error: 'Requested range exceeds the configured ' + maxSizeKB + 'KB size limit (' + resultSizeKB + 'KB). ' +
                'Use a smaller limit to read fewer lines at a time.',
            resultSizeKB,
            maxSizeKB
        });
    }
}

// ── GetWorkspaceFileList ────────────────────────────────────────────────

@injectable()
export class GetWorkspaceFileList implements ToolProvider {
    static ID = GET_WORKSPACE_FILE_LIST_FUNCTION_ID;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    getTool(): ToolRequest {
        return {
            id: GetWorkspaceFileList.ID,
            name: GetWorkspaceFileList.ID,
            displayName: 'List Files',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description:
                            'Relative path to a directory within the workspace (e.g., "src", "src/components"). ' +
                            'Use "" or "." to list the workspace root. Paths outside the workspace will result in an error.',
                    },
                },
                required: ['path'],
            },
            description:
                'Lists files and directories within a specified workspace directory. ' +
                'Returns an array of names where directories are suffixed with "/" (e.g., ["src/", "package.json", "README.md"]). ' +
                'Use this to explore directory structure step by step. ' +
                'For finding specific files by pattern, use findFilesByPattern instead.',
            handler: (argString, ctx) => {
                const args = JSON.parse(argString);
                return this.getProjectFileList(args.path, ctx?.cancellationToken);
            },
        };
    }

    async getProjectFileList(path?: string, cancellationToken?: CancellationToken): Promise<string | string[]> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        let workspaceRoot: URI;
        try {
            workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
        } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
        }
        const targetUri = path ? workspaceRoot.resolve(path) : workspaceRoot;
        this.workspaceScope.ensureWithinWorkspace(targetUri, workspaceRoot);
        try {
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const stat = await this.fileService.resolve(targetUri);
            if (!stat || !stat.isDirectory) {
                return JSON.stringify({ error: 'Directory not found' });
            }
            return await this.listFilesDirectly(targetUri, cancellationToken);
        } catch {
            return JSON.stringify({ error: 'Directory not found' });
        }
    }

    protected async listFilesDirectly(uri: URI, cancellationToken?: CancellationToken): Promise<string | string[]> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        const stat = await this.fileService.resolve(uri);
        const result: string[] = [];
        if (stat && stat.isDirectory) {
            if (await this.workspaceScope.shouldExclude(stat)) {
                return result;
            }
            const children = await this.fileService.resolve(uri);
            if (children.children) {
                for (const child of children.children) {
                    if (cancellationToken?.isCancellationRequested) {
                        return JSON.stringify({ error: 'Operation cancelled by user' });
                    }
                    if (await this.workspaceScope.shouldExclude(child)) {
                        continue;
                    }
                    const itemName = child.resource.path.base;
                    result.push(child.isDirectory ? `${itemName}/` : itemName);
                }
            }
        }
        return result;
    }
}

// ── FindFilesByPattern ──────────────────────────────────────────────────

@injectable()
export class FindFilesByPattern implements ToolProvider {
    static ID = FIND_FILES_BY_PATTERN_FUNCTION_ID;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    getTool(): ToolRequest {
        return {
            id: FindFilesByPattern.ID,
            name: FindFilesByPattern.ID,
            displayName: 'Find Files',
            description:
                'Find files in the workspace that match a given glob pattern. ' +
                'This function allows efficient discovery of files using patterns like \'**/*.ts\' for all TypeScript files or ' +
                '\'src/**/*.js\' for JavaScript files in the src directory. The function respects gitignore patterns and user exclusions, ' +
                'returns relative paths from the workspace root, and limits results to 200 files maximum. ' +
                'Performance note: This traverses directories recursively which may be slow in large workspaces. ' +
                'For better performance, use specific subdirectory patterns (e.g., \'src/**/*.ts\' instead of \'**/*.ts\'). ' +
                'Use this to find files by name/extension.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description:
                            'Glob pattern to match files against. ' +
                            'Examples: \'**/*.ts\' (all TypeScript files), \'src/**/*.js\' (JS files in src), ' +
                            '\'**/*.{js,ts}\' (JS or TS files), \'**/test/**/*.spec.ts\' (test files). ' +
                            'Use specific subdirectory prefixes for better performance.',
                    },
                    exclude: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional glob patterns to exclude. ' +
                            'Examples: [\'**/*.spec.ts\', \'**/node_modules/**\']. ' +
                            'Common exclusions (node_modules, .git) are applied automatically via gitignore.',
                    },
                },
                required: ['pattern'],
            },
            handler: (argString, ctx) => {
                const args = JSON.parse(argString);
                return this.findFiles(args.pattern, args.exclude, ctx?.cancellationToken);
            },
            providerName: undefined,
            getArgumentsShortLabel: (args: string) => {
                try {
                    const parsed = JSON.parse(args);
                    if (parsed && typeof parsed === 'object' && 'pattern' in parsed) {
                        const keys = Object.keys(parsed);
                        return { label: String(parsed.pattern), hasMore: keys.length > 1 };
                    }
                } catch {
                    // ignore parse errors
                }
                return undefined;
            },
        };
    }

    protected async findFiles(pattern: string, excludePatterns?: string[], cancellationToken?: CancellationToken): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        let workspaceRoot: URI;
        try {
            workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
        } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
        }
        try {
            const ignorePatterns = await this.buildIgnorePatterns(workspaceRoot);
            const allExcludes = [...ignorePatterns];
            if (excludePatterns && excludePatterns.length > 0) {
                allExcludes.push(...excludePatterns);
            }
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const patternMatcher = new Minimatch(pattern, { dot: false });
            const excludeMatchers = allExcludes.map(ep => new Minimatch(ep, { dot: true }));
            const files: string[] = [];
            const maxResults = 200;
            await this.traverseDirectory(workspaceRoot, workspaceRoot, patternMatcher, excludeMatchers, files, maxResults, cancellationToken);
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const result: Record<string, unknown> = {
                files: files.slice(0, maxResults),
            };
            if (files.length > maxResults) {
                result.totalFound = files.length;
                result.truncated = true;
            }
            return JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({ error: `Failed to find files: ${(error as Error).message}` });
        }
    }

    protected async buildIgnorePatterns(workspaceRoot: URI): Promise<string[]> {
        const patterns: string[] = [];
        const userExcludePatterns = this.preferences.get<string[]>(USER_EXCLUDE_PATTERN_PREF, []);
        patterns.push(...userExcludePatterns);
        const shouldConsiderGitIgnore = this.preferences.get<boolean>(CONSIDER_GITIGNORE_PREF, false);
        if (shouldConsiderGitIgnore) {
            try {
                const gitignoreUri = workspaceRoot.resolve('.gitignore');
                const gitignoreContent = await this.fileService.read(gitignoreUri);
                const gitignoreLines = gitignoreContent.value
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));
                patterns.push(...gitignoreLines);
            } catch {
                // Gitignore file doesn't exist or can't be read
            }
        }
        return patterns;
    }

    protected async traverseDirectory(
        currentUri: URI,
        workspaceRoot: URI,
        patternMatcher: Minimatch,
        excludeMatchers: Minimatch[],
        results: string[],
        maxResults: number,
        cancellationToken?: CancellationToken,
    ): Promise<void> {
        if (cancellationToken?.isCancellationRequested || results.length >= maxResults) {
            return;
        }
        try {
            const stat = await this.fileService.resolve(currentUri);
            if (!stat || !stat.isDirectory || !stat.children) {
                return;
            }
            for (const child of stat.children) {
                if (cancellationToken?.isCancellationRequested || results.length >= maxResults) {
                    break;
                }
                const relativePath = workspaceRoot.relative(child.resource)?.toString();
                if (!relativePath) {
                    continue;
                }
                const shouldExclude =
                    excludeMatchers.some(matcher => matcher.match(relativePath)) ||
                    (await this.workspaceScope.shouldExclude(child));
                if (shouldExclude) {
                    continue;
                }
                if (child.isDirectory) {
                    await this.traverseDirectory(child.resource, workspaceRoot, patternMatcher, excludeMatchers, results, maxResults, cancellationToken);
                } else if (patternMatcher.match(relativePath)) {
                    results.push(relativePath);
                }
            }
        } catch {
            // If we can't access a directory, skip it
        }
    }
}
