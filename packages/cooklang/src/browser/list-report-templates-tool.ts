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
import { ReportTemplates } from '../common';
import { ReportTemplateFinder } from './report-template-finder';

/**
 * AI tool listing the report templates cookbot can render by reference:
 * every `*.jinja|j2|jinja2` file in the workspace plus the built-ins. Read-only,
 * so it auto-executes. Pairs with `renderTemplate`'s `templateUri` argument.
 */
@injectable()
export class ListReportTemplatesTool implements ToolProvider {

    static ID = 'listReportTemplates';

    @inject(ReportTemplateFinder)
    protected readonly templateFinder: ReportTemplateFinder;

    getTool(): ToolRequest {
        return {
            id: ListReportTemplatesTool.ID,
            name: ListReportTemplatesTool.ID,
            displayName: 'List Report Templates',
            description: 'List the Jinja2 report templates available to render: every *.jinja / *.j2 / *.jinja2 file in the '
                + 'workspace (by convention under config/reports/) plus the editor\'s built-in templates. Call this BEFORE '
                + 'authoring a new report template — if an existing one fits the request, render it with renderTemplate '
                + 'using templateUri (a workspace template\'s `path` or `uri`, or a built-in `id`) instead of writing a new one. '
                + 'Returns { templates: [{ path, uri, name, directory, outputFormat }], builtIn: [{ id, label }] }; '
                + '`outputFormat` (markdown | html | text) is inferred from the file name\'s inner extension.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => this.execute(),
        };
    }

    protected async execute(): Promise<string> {
        const templates = (await this.templateFinder.findWorkspaceTemplates()).map(template => ({
            path: template.path ?? template.uri,
            uri: template.uri,
            name: template.label,
            directory: template.directory,
            outputFormat: ReportTemplates.outputFormat(template.label),
        }));
        const builtIn = ReportTemplates.BUILT_IN.map(template => ({ id: template.id, label: template.label }));
        return JSON.stringify({ templates, builtIn });
    }
}
