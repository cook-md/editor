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

import { PreferenceService, URI } from '@theia/core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import ignore, { Ignore } from 'ignore';
import { Minimatch } from 'minimatch';
import { CONSIDER_GITIGNORE_PREF, USER_EXCLUDE_PATTERN_PREF } from './workspace-preferences';

@injectable()
export class WorkspaceFunctionScope {

    protected readonly GITIGNORE_FILE_NAME = '.gitignore';
    protected gitignoreWatcherInitialized = false;
    protected gitignoreMatcher: Ignore | undefined;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    async getWorkspaceRoot(): Promise<URI> {
        const wsRoots = await this.workspaceService.roots;
        if (wsRoots.length === 0) {
            throw new Error('No workspace has been opened yet');
        }
        return wsRoots[0].resource;
    }

    ensureWithinWorkspace(targetUri: URI, workspaceRootUri: URI): void {
        if (!targetUri.toString().startsWith(workspaceRootUri.toString())) {
            throw new Error('Access outside of the workspace is not allowed');
        }
    }

    async resolveRelativePath(relativePath: string): Promise<URI> {
        const workspaceRoot = await this.getWorkspaceRoot();
        return workspaceRoot.resolve(relativePath);
    }

    async shouldExclude(stat: FileStat): Promise<boolean> {
        const shouldConsiderGitIgnore = this.preferences.get<boolean>(CONSIDER_GITIGNORE_PREF, false);
        const userExcludePatterns = this.preferences.get<string[]>(USER_EXCLUDE_PATTERN_PREF, []);
        if (this.isUserExcluded(stat.resource.path.base, userExcludePatterns)) {
            return true;
        }
        const workspaceRoot = await this.getWorkspaceRoot();
        if (shouldConsiderGitIgnore && (await this.isGitIgnored(stat, workspaceRoot))) {
            return true;
        }
        return false;
    }

    isUserExcluded(fileName: string, userExcludePatterns: string[]): boolean {
        return userExcludePatterns.some(pattern => new Minimatch(pattern, { dot: true }).match(fileName));
    }

    protected async initializeGitignoreWatcher(workspaceRoot: URI): Promise<void> {
        if (this.gitignoreWatcherInitialized) {
            return;
        }
        const gitignoreUri = workspaceRoot.resolve(this.GITIGNORE_FILE_NAME);
        this.fileService.watch(gitignoreUri);
        this.fileService.onDidFilesChange(async event => {
            if (event.contains(gitignoreUri)) {
                this.gitignoreMatcher = undefined;
            }
        });
        this.gitignoreWatcherInitialized = true;
    }

    protected async isGitIgnored(stat: FileStat, workspaceRoot: URI): Promise<boolean> {
        await this.initializeGitignoreWatcher(workspaceRoot);
        const gitignoreUri = workspaceRoot.resolve(this.GITIGNORE_FILE_NAME);
        try {
            const fileStat = await this.fileService.resolve(gitignoreUri);
            if (fileStat) {
                if (!this.gitignoreMatcher) {
                    const gitignoreContent = await this.fileService.read(gitignoreUri);
                    this.gitignoreMatcher = ignore().add(gitignoreContent.value);
                }
                const relativePath = workspaceRoot.relative(stat.resource);
                if (relativePath) {
                    const relativePathStr = relativePath.toString() + (stat.isDirectory ? '/' : '');
                    if (this.gitignoreMatcher.ignores(relativePathStr)) {
                        return true;
                    }
                }
            }
        } catch {
            // If .gitignore does not exist or cannot be read, continue without error
        }
        return false;
    }
}
