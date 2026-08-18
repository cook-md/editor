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

// The tool transitively imports `ReportTemplateFinder` → `WorkspaceService`,
// which needs browser globals at require time. Same jsdom preamble as the
// sibling report specs.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { ListReportTemplatesTool } from './list-report-templates-tool';
import { WorkspaceReportTemplate } from './report-template-finder';

after(() => disableJSDOM());

class FakeFinder {
    templates: WorkspaceReportTemplate[] = [];
    async findWorkspaceTemplates(): Promise<WorkspaceReportTemplate[]> {
        return this.templates;
    }
}

interface ListResult {
    templates: Array<{ path: string; uri: string; name: string; directory?: string; outputFormat: string }>;
    builtIn: Array<{ id: string; label: string }>;
}

function createTool(): { tool: ListReportTemplatesTool; finder: FakeFinder } {
    const tool = new ListReportTemplatesTool();
    const finder = new FakeFinder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).templateFinder = finder;
    return { tool, finder };
}

async function invoke(tool: ListReportTemplatesTool): Promise<ListResult> {
    const result = await tool.getTool().handler('{}');
    return JSON.parse(result as string);
}

describe('ListReportTemplatesTool', () => {

    it('exposes the tool under the id listReportTemplates with no required parameters', () => {
        const { tool } = createTool();
        const def = tool.getTool();
        expect(def.id).to.equal('listReportTemplates');
        expect(def.name).to.equal('listReportTemplates');
        expect(def.parameters.required ?? []).to.deep.equal([]);
    });

    it('lists workspace templates with path, name, directory and inferred outputFormat', async () => {
        const { tool, finder } = createTool();
        finder.templates = [
            {
                id: 'workspace:file:///ws/config/reports/balanced-diet.jinja',
                label: 'balanced-diet.jinja',
                uri: 'file:///ws/config/reports/balanced-diet.jinja',
                path: 'config/reports/balanced-diet.jinja',
                directory: 'config/reports',
            },
            {
                id: 'workspace:file:///ws/menu.html.jinja',
                label: 'menu.html.jinja',
                uri: 'file:///ws/menu.html.jinja',
                path: 'menu.html.jinja',
            },
        ];
        const result = await invoke(tool);
        expect(result.templates).to.deep.equal([
            {
                path: 'config/reports/balanced-diet.jinja',
                uri: 'file:///ws/config/reports/balanced-diet.jinja',
                name: 'balanced-diet.jinja',
                directory: 'config/reports',
                outputFormat: 'markdown',
            },
            {
                path: 'menu.html.jinja',
                uri: 'file:///ws/menu.html.jinja',
                name: 'menu.html.jinja',
                outputFormat: 'html',
            },
        ]);
    });

    it('falls back to the uri as path for templates outside every workspace root', async () => {
        const { tool, finder } = createTool();
        finder.templates = [{
            id: 'workspace:file:///elsewhere/cost.jinja',
            label: 'cost.jinja',
            uri: 'file:///elsewhere/cost.jinja',
        }];
        const result = await invoke(tool);
        expect(result.templates[0].path).to.equal('file:///elsewhere/cost.jinja');
    });

    it('always includes the built-in templates', async () => {
        const { tool } = createTool();
        const result = await invoke(tool);
        expect(result.templates).to.deep.equal([]);
        expect(result.builtIn).to.deep.equal([
            { id: 'builtin:ingredients', label: 'Ingredients List (built-in)' },
            { id: 'builtin:shopping-list', label: 'Shopping List (built-in)' },
        ]);
    });
});
