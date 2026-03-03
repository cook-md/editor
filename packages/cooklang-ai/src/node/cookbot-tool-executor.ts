// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotToolRequest } from '../common/cookbot-protocol';
import { CookbotFileOperationsServer, CookbotFileOperationsClient } from '../common/cookbot-file-operations-protocol';

/**
 * Handles internal tool execution requests from the cookbot server.
 *
 * The cookbot server routes file operations (list_files, list_directory,
 * str_replace_editor, etc.) to the client via the ToolExecutionService
 * gRPC stream. This class listens for those requests, executes them
 * against the local filesystem, and sends results back.
 *
 * NOTE: Write operations (str_replace, insert) are routed through the
 * frontend via RPC when a CookbotFileOperationsClient is connected, so
 * that edits go through Monaco and participate in the editor's undo stack.
 * When no client is connected, operations fall back to direct Node.js `fs`
 * access. Read-only operations (view, list, search) always use `fs` directly.
 */
@injectable()
export class CookbotToolExecutor implements CookbotFileOperationsServer {

    @inject(CookbotGrpcClient)
    protected readonly grpcClient: CookbotGrpcClient;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    private rootDir: string | undefined;
    private client: CookbotFileOperationsClient | undefined;

    setClient(client: CookbotFileOperationsClient | undefined): void {
        this.client = client;
    }

    getClient(): CookbotFileOperationsClient | undefined {
        return this.client;
    }

    dispose(): void {
        this.client = undefined;
    }

    @postConstruct()
    protected init(): void {
        this.grpcClient.onToolRequest(request => {
            this.handleToolRequest(request);
        });
    }

    private async resolveRootDir(): Promise<string> {
        if (this.rootDir) {
            return this.rootDir;
        }
        try {
            const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
            if (workspaceUri) {
                this.rootDir = FileUri.fsPath(workspaceUri);
                return this.rootDir;
            }
        } catch {
            // Workspace may not be set yet
        }
        throw new Error('No workspace is open');
    }

    private async handleToolRequest(request: CookbotToolRequest): Promise<void> {
        try {
            const result = await this.executeTool(request.toolName, request.parameters);
            this.grpcClient.sendToolResult(request.executionId, true, result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.grpcClient.sendToolResult(request.executionId, false, '', message);
        }
    }

    private async executeTool(toolName: string, parameters: Record<string, string>): Promise<string> {
        switch (toolName) {
            case 'str_replace_editor':
                return this.strReplaceEditor(parameters);
            case 'search_files':
                return this.searchFiles(parameters);
            case 'list_files':
                return this.listFiles(parameters);
            case 'list_directory':
                return this.listDirectory(parameters);
            case 'rename_path':
                return this.renamePath(parameters);
            case 'delete_path':
                return this.deletePath(parameters);
            case 'exit_app':
            case 'clear_conversation':
                throw new Error(`Tool '${toolName}' is not supported in the Theia client`);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private resolveSafe(rootDir: string, relativePath: string): string {
        const resolved = path.resolve(rootDir, relativePath);
        if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
            throw new Error('Path escapes workspace root');
        }
        return resolved;
    }

    // ── str_replace_editor ──────────────────────────────────────────────

    private async strReplaceEditor(params: Record<string, string>): Promise<string> {
        const command = params.command;
        if (!command) {
            throw new Error("Missing 'command' parameter");
        }
        switch (command) {
            case 'view':
                return this.viewCommand(params);
            case 'str_replace':
                return this.strReplaceCommand(params);
            case 'create':
                return this.createCommand(params);
            case 'insert':
                return this.insertCommand(params);
            default:
                throw new Error(`Unknown str_replace_editor command: ${command}`);
        }
    }

    private async viewCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        const stat = await fs.promises.stat(fullPath);

        if (stat.isDirectory()) {
            return this.listDirectoryImpl(filePath);
        }

        const content = await fs.promises.readFile(fullPath, 'utf8');

        if (params.view_range) {
            const range: number[] = JSON.parse(params.view_range);
            if (range.length !== 2) {
                throw new Error('view_range must be [start_line, end_line]');
            }
            const lines = content.split('\n');
            const [start, end] = range;
            if (start < 1 || start > lines.length || end < start || end > lines.length) {
                throw new Error(`Invalid view_range: [${start}, ${end}] (file has ${lines.length} lines)`);
            }
            return lines.slice(start - 1, end).join('\n');
        }

        return content;
    }

    private async strReplaceCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        const oldStr = params.old_str;
        const newStr = params.new_str;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        if (oldStr === undefined) {
            throw new Error("Missing 'old_str' parameter");
        }
        if (newStr === undefined) {
            throw new Error("Missing 'new_str' parameter");
        }

        // Route through frontend for undo/redo support when available
        if (this.client) {
            return this.client.replaceText(filePath, oldStr, newStr);
        }

        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const idx = content.indexOf(oldStr);
        if (idx === -1) {
            throw new Error('Pattern not found in file');
        }
        const updated = content.substring(0, idx) + newStr + content.substring(idx + oldStr.length);
        await fs.promises.writeFile(fullPath, updated, 'utf8');
        return `Successfully replaced text in ${filePath}`;
    }

    private async createCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        const fileText = params.file_text;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        if (fileText === undefined) {
            throw new Error("Missing 'file_text' parameter");
        }

        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, fileText, 'utf8');
        return `File created successfully: ${filePath}`;
    }

    private async insertCommand(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        const insertLineStr = params.insert_line;
        const newStr = params.new_str;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        if (!insertLineStr) {
            throw new Error("Missing 'insert_line' parameter");
        }
        if (newStr === undefined) {
            throw new Error("Missing 'new_str' parameter");
        }
        const insertLine = parseInt(insertLineStr, 10);

        // Route through frontend for undo/redo support when available
        if (this.client) {
            return this.client.insertText(filePath, insertLine, newStr);
        }

        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const lines = content.split('\n');

        if (insertLine > lines.length) {
            throw new Error(`insert_line ${insertLine} exceeds file length ${lines.length} lines`);
        }

        let newContent: string;
        if (insertLine === 0) {
            newContent = newStr + '\n' + content;
        } else {
            lines.splice(insertLine, 0, newStr);
            newContent = lines.join('\n');
        }

        await fs.promises.writeFile(fullPath, newContent, 'utf8');
        return `Text inserted at line ${insertLine} in file: ${filePath}`;
    }

    // ── File operations ─────────────────────────────────────────────────

    private async listFiles(params: Record<string, string>): Promise<string> {
        const pattern = params.pattern;
        const recursive = params.recursive !== 'false';
        const rootDir = await this.resolveRootDir();
        const files = await this.collectFiles(rootDir, rootDir, recursive);
        const filtered = pattern ? files.filter(f => minimatch(f, pattern)) : files;
        return filtered.length > 0 ? filtered.join('\n') : 'No files found.';
    }

    private async collectFiles(dir: string, rootDir: string, recursive: boolean, depth: number = 0): Promise<string[]> {
        if (depth > 20) {
            return [];
        }
        const results: string[] = [];
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(rootDir, fullPath);
                if (entry.isFile()) {
                    results.push(relativePath);
                } else if (entry.isDirectory() && recursive) {
                    const subFiles = await this.collectFiles(fullPath, rootDir, recursive, depth + 1);
                    results.push(...subFiles);
                }
            }
        } catch {
            // Directory may not exist or be inaccessible
        }
        return results;
    }

    private async listDirectory(params: Record<string, string>): Promise<string> {
        const dirPath = params.path || '.';
        return this.listDirectoryImpl(dirPath);
    }

    private async listDirectoryImpl(dirPath: string): Promise<string> {
        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, dirPath);
        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        const results = entries
            .filter(e => !e.name.startsWith('.'))
            .map(e => e.isDirectory() ? `${e.name}/` : e.name);
        return results.length > 0 ? results.join('\n') : 'Directory is empty.';
    }

    private async searchFiles(params: Record<string, string>): Promise<string> {
        const pattern = params.pattern;
        if (!pattern) {
            throw new Error("Missing 'pattern' parameter");
        }
        if (pattern.length > 1000) {
            throw new Error('Search pattern too long (max 1000 characters)');
        }
        const globPattern = params.glob;
        const caseInsensitive = params.case_insensitive === 'true';
        let regex: RegExp;
        try {
            regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
        } catch (err) {
            throw new Error(`Invalid search pattern: ${err instanceof Error ? err.message : String(err)}`);
        }

        const rootDir = await this.resolveRootDir();
        const files = await this.collectFiles(rootDir, rootDir, true);
        const filtered = globPattern ? files.filter(f => minimatch(f, globPattern)) : files;

        const matches: string[] = [];
        for (const file of filtered) {
            if (matches.length >= 1000) {
                break;
            }
            try {
                const fullPath = path.join(rootDir, file);
                const content = await fs.promises.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        matches.push(`${file}:${i + 1}: ${lines[i]}`);
                        if (matches.length >= 1000) {
                            break;
                        }
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }
        return matches.length > 0 ? matches.join('\n') : 'No matches found.';
    }

    private async renamePath(params: Record<string, string>): Promise<string> {
        const from = params.from;
        const to = params.to;
        if (!from) {
            throw new Error("Missing 'from' parameter");
        }
        if (!to) {
            throw new Error("Missing 'to' parameter");
        }
        const rootDir = await this.resolveRootDir();
        const fromFull = this.resolveSafe(rootDir, from);
        const toFull = this.resolveSafe(rootDir, to);
        await fs.promises.mkdir(path.dirname(toFull), { recursive: true });
        await fs.promises.rename(fromFull, toFull);
        return `Renamed ${from} to ${to}`;
    }

    private async deletePath(params: Record<string, string>): Promise<string> {
        const filePath = params.path;
        if (!filePath) {
            throw new Error("Missing 'path' parameter");
        }
        const rootDir = await this.resolveRootDir();
        const fullPath = this.resolveSafe(rootDir, filePath);
        if (fullPath === rootDir) {
            throw new Error('Cannot delete workspace root');
        }
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
            // Only allow deleting empty directories to prevent accidental data loss
            const entries = await fs.promises.readdir(fullPath);
            if (entries.length > 0) {
                throw new Error('Cannot delete non-empty directory');
            }
            await fs.promises.rmdir(fullPath);
        } else {
            await fs.promises.unlink(fullPath);
        }
        return `Deleted ${filePath}`;
    }
}
