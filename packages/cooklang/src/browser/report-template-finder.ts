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
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { ReportTemplates } from '../common';

/** A Jinja2 report template file found in the workspace. */
export interface WorkspaceReportTemplate {
    /** Report-tab template id: `workspace:<uri>`. */
    id: string;
    /** File basename, e.g. `balanced-diet.jinja`. */
    label: string;
    /** URI string of the template file. */
    uri: string;
    /** Workspace-relative path (`config/reports/balanced-diet.jinja`); undefined when outside every root. */
    path?: string;
    /** Workspace-relative parent directory (`config/reports`); undefined at the root or outside every root. */
    directory?: string;
}

/**
 * Finds report template files (*.jinja|j2|jinja2) anywhere in the workspace
 * via the ripgrep-backed file search (respects .gitignore). Shared by the
 * "Render Report" QuickPick and the `listReportTemplates` AI tool.
 */
@injectable()
export class ReportTemplateFinder {

    @inject(FileSearchService)
    protected readonly fileSearchService: FileSearchService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    async findWorkspaceTemplates(): Promise<WorkspaceReportTemplate[]> {
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return [];
        }
        let matches: string[];
        try {
            matches = await this.fileSearchService.find('', {
                rootUris: roots.map(root => root.resource.toString()),
                includePatterns: ReportTemplates.FILE_EXTENSIONS.map(ext => `**/*${ext}`),
                useGitIgnore: true,
                fuzzyMatch: false,
                limit: 200,
            });
        } catch (error) {
            console.warn('[cooklang] Report template search failed:', error);
            return [];
        }
        return matches
            .filter(match => ReportTemplates.isTemplateFile(match))
            .map(match => {
                const uri = new URI(match);
                const root = roots.find(candidate => candidate.resource.isEqualOrParent(uri));
                const path = root ? root.resource.relative(uri)?.toString() : undefined;
                const directory = root ? root.resource.relative(uri.parent)?.toString() : undefined;
                return {
                    id: `workspace:${uri.toString()}`,
                    label: uri.path.base,
                    uri: uri.toString(),
                    path: path || undefined,
                    directory: directory || undefined,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    }
}
