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
    FIND_FILES_BY_PATTERN_FUNCTION_ID,
} from './function-ids';
import { CONSIDER_GITIGNORE_PREF, FILE_CONTENT_MAX_SIZE_KB_PREF, USER_EXCLUDE_PATTERN_PREF } from './workspace-preferences';
import { MAX_BATCH_ITEMS, parseBatchArg } from './batch-args';

/** One file's outcome in a batched read. */
interface BatchFileEntry {
    file: string;
    content?: string;
    error?: string;
}

/** Maximum files reported per glob. */
const MAX_FIND_RESULTS = 200;

/** One glob and the files it has matched so far during a workspace walk. */
interface PatternBucket {
    pattern: string;
    matcher: Minimatch;
    results: string[];
}

/** One directory's outcome in a batched listing. */
interface BatchDirEntry {
    path: string;
    entries?: string[];
    error?: string;
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
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            `Read several files in one call (max ${MAX_BATCH_ITEMS}) instead of one call per file — always prefer ` +
                            'this when you already know which files you need. Returns ' +
                            '{ files: [{ file, content } | { file, error }] } in the order given; a file that cannot be read ' +
                            'reports its error in its own entry and the others still come back. Mutually exclusive with `file`, ' +
                            'and cannot be combined with offset/limit (those page through a single file).',
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
            },
            handler: (argString, ctx) => {
                const { file, files, offset, limit } = this.parseArg(argString);
                if (files !== undefined) {
                    return this.getFileContentBatch(files, file, offset, limit, ctx?.cancellationToken);
                }
                if (typeof file !== 'string' || !file) {
                    return Promise.resolve(JSON.stringify({ error: 'Pass either file (one path) or files (an array of paths).' }));
                }
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

    protected parseArg(argString: string): { file?: string; files?: unknown; offset?: number; limit?: number } {
        const result = JSON.parse(argString);
        return { file: result.file, files: result.files, offset: result.offset, limit: result.limit };
    }

    /**
     * Reads several files under one tool call.
     *
     * A file that cannot be read fails in its own slot — a shortlist where one
     * path was mistyped should not cost a retry of the whole batch, which is
     * the round trip the batch was there to save.
     *
     * `offset`/`limit` page through one file, so they are rejected here rather
     * than silently applied to every entry.
     */
    protected async getFileContentBatch(
        files: unknown,
        file: string | undefined,
        offset: number | undefined,
        limit: number | undefined,
        cancellationToken?: CancellationToken,
    ): Promise<string> {
        if (typeof file === 'string' && file) {
            return JSON.stringify({ error: 'Pass either file or files, not both.' });
        }
        if (offset !== undefined || limit !== undefined) {
            return JSON.stringify({
                error: 'offset and limit page through a single file; read that one with `file` instead of `files`.',
            });
        }
        const paths = parseBatchArg(files, 'files');
        if ('error' in paths) {
            return JSON.stringify(paths);
        }
        const results: BatchFileEntry[] = [];
        for (const path of paths) {
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            const raw = await this.getFileContent(path, cancellationToken);
            const failure = this.errorPayload(raw);
            results.push(failure !== undefined ? { file: path, error: failure } : { file: path, content: raw });
        }
        return JSON.stringify({ files: results });
    }

    /**
     * The message from a `{ "error": ... }` reply, or undefined for content.
     *
     * `getFileContent` answers with the raw file body on success and a JSON
     * error object on failure, so the batch has to tell them apart to place an
     * entry. Narrow on purpose: a recipe whose entire body happens to parse as
     * an object with a non-empty string `error` is indistinguishable, and that
     * is not a file anyone has.
     */
    protected errorPayload(raw: string): string | undefined {
        const trimmed = raw.trimStart();
        if (!trimmed.startsWith('{')) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(trimmed);
            const message = parsed?.error;
            return typeof message === 'string' && message.trim() ? message : undefined;
        } catch {
            return undefined;
        }
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
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            `List several directories in one call (max ${MAX_BATCH_ITEMS}) instead of one call each. Returns ` +
                            '{ directories: [{ path, entries } | { path, error }] } in the order given; a directory that cannot ' +
                            'be listed reports its error in its own entry. Mutually exclusive with `path`.',
                    },
                },
            },
            description:
                'Lists files and directories within a specified workspace directory. ' +
                'Returns an array of names where directories are suffixed with "/" (e.g., ["src/", "package.json", "README.md"]). ' +
                'Use this to explore directory structure step by step. ' +
                'For finding specific files by pattern, use findFilesByPattern instead.',
            handler: (argString, ctx) => {
                const args = JSON.parse(argString);
                if (args.paths !== undefined) {
                    return this.getProjectFileListBatch(args.paths, args.path, ctx?.cancellationToken);
                }
                return this.getProjectFileList(args.path, ctx?.cancellationToken);
            },
        };
    }

    /**
     * Lists several directories under one tool call.
     *
     * As with the batched read, a directory that cannot be listed fails in its
     * own slot so one bad path does not discard the rest.
     */
    protected async getProjectFileListBatch(paths: unknown, path: unknown, cancellationToken?: CancellationToken): Promise<string> {
        if (typeof path === 'string' && path) {
            return JSON.stringify({ error: 'Pass either path or paths, not both.' });
        }
        const dirs = parseBatchArg(paths, 'paths');
        if ('error' in dirs) {
            return JSON.stringify(dirs);
        }
        const directories: BatchDirEntry[] = [];
        for (const dir of dirs) {
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            let listed: string | string[];
            try {
                listed = await this.getProjectFileList(dir, cancellationToken);
            } catch (error) {
                // `ensureWithinWorkspace` throws rather than returning; in a
                // batch that must land in the entry, not abort the call.
                directories.push({ path: dir, error: (error as Error).message });
                continue;
            }
            if (Array.isArray(listed)) {
                directories.push({ path: dir, entries: listed });
            } else {
                const parsed = this.tryParseError(listed);
                directories.push({ path: dir, error: parsed ?? 'Directory not found' });
            }
        }
        return JSON.stringify({ directories });
    }

    protected tryParseError(raw: string): string | undefined {
        try {
            const parsed = JSON.parse(raw);
            return typeof parsed?.error === 'string' ? parsed.error : undefined;
        } catch {
            return undefined;
        }
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
                    patterns: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            `Match several globs in one call (max ${MAX_BATCH_ITEMS}), e.g. ['**/*.cook', '**/*.menu']. ` +
                            'Much cheaper than one call per pattern: the workspace is walked ONCE and every pattern is tested ' +
                            'against each file, rather than a fresh recursive traversal per glob. Returns ' +
                            '{ patterns: [{ pattern, files, totalFound?, truncated? }] } in the order given. ' +
                            'Mutually exclusive with `pattern`; `exclude` applies to every pattern.',
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
            },
            handler: (argString, ctx) => {
                const args = JSON.parse(argString);
                if (args.patterns !== undefined) {
                    return this.findFilesBatch(args.patterns, args.pattern, args.exclude, ctx?.cancellationToken);
                }
                if (typeof args.pattern !== 'string' || !args.pattern) {
                    return Promise.resolve(JSON.stringify({ error: 'Pass either pattern (one glob) or patterns (an array of globs).' }));
                }
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
            const excludeMatchers = allExcludes.map(ep => new Minimatch(ep, { dot: true }));
            const buckets = [this.bucketFor(pattern)];
            await this.traverseDirectory(workspaceRoot, workspaceRoot, buckets, excludeMatchers, MAX_FIND_RESULTS, cancellationToken);
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            return JSON.stringify(this.summarise(buckets[0]));
        } catch (error) {
            return JSON.stringify({ error: `Failed to find files: ${(error as Error).message}` });
        }
    }

    /**
     * Matches several globs in ONE workspace walk.
     *
     * The saving here is not just the round trip: `findFiles` traverses the
     * whole tree recursively per glob, so asking for `**​/*.cook` and
     * `**​/*.menu` separately walked it twice. Every pattern is tested against
     * each file as the walk passes it instead.
     */
    protected async findFilesBatch(
        patterns: unknown,
        pattern: unknown,
        excludePatterns?: string[],
        cancellationToken?: CancellationToken,
    ): Promise<string> {
        if (typeof pattern === 'string' && pattern) {
            return JSON.stringify({ error: 'Pass either pattern or patterns, not both.' });
        }
        const globs = parseBatchArg(patterns, 'patterns');
        if ('error' in globs) {
            return JSON.stringify(globs);
        }
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
            const allExcludes = [...ignorePatterns, ...(excludePatterns ?? [])];
            const excludeMatchers = allExcludes.map(ep => new Minimatch(ep, { dot: true }));
            const buckets = globs.map(glob => this.bucketFor(glob));
            await this.traverseDirectory(workspaceRoot, workspaceRoot, buckets, excludeMatchers, MAX_FIND_RESULTS, cancellationToken);
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            return JSON.stringify({ patterns: buckets.map(bucket => ({ pattern: bucket.pattern, ...this.summarise(bucket) })) });
        } catch (error) {
            return JSON.stringify({ error: `Failed to find files: ${(error as Error).message}` });
        }
    }

    protected bucketFor(pattern: string): PatternBucket {
        return { pattern, matcher: new Minimatch(pattern, { dot: false }), results: [] };
    }

    protected summarise(bucket: PatternBucket): Record<string, unknown> {
        const result: Record<string, unknown> = { files: bucket.results.slice(0, MAX_FIND_RESULTS) };
        if (bucket.results.length > MAX_FIND_RESULTS) {
            result.totalFound = bucket.results.length;
            result.truncated = true;
        }
        return result;
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

    /**
     * Walks the workspace once, filling every bucket whose glob matches.
     *
     * The walk stops early only when *all* buckets are full: with one bucket
     * that is the original single-pattern behaviour unchanged.
     */
    protected async traverseDirectory(
        currentUri: URI,
        workspaceRoot: URI,
        buckets: PatternBucket[],
        excludeMatchers: Minimatch[],
        maxResults: number,
        cancellationToken?: CancellationToken,
    ): Promise<void> {
        if (cancellationToken?.isCancellationRequested || this.allFull(buckets, maxResults)) {
            return;
        }
        try {
            const stat = await this.fileService.resolve(currentUri);
            if (!stat || !stat.isDirectory || !stat.children) {
                return;
            }
            for (const child of stat.children) {
                if (cancellationToken?.isCancellationRequested || this.allFull(buckets, maxResults)) {
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
                    await this.traverseDirectory(child.resource, workspaceRoot, buckets, excludeMatchers, maxResults, cancellationToken);
                } else {
                    for (const bucket of buckets) {
                        if (bucket.results.length < maxResults && bucket.matcher.match(relativePath)) {
                            bucket.results.push(relativePath);
                        }
                    }
                }
            }
        } catch {
            // If we can't access a directory, skip it
        }
    }

    protected allFull(buckets: PatternBucket[], maxResults: number): boolean {
        return buckets.every(bucket => bucket.results.length >= maxResults);
    }
}
