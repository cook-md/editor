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

// `ReportTemplateFinder` injects `WorkspaceService`, whose module evaluates
// browser globals at require time. Set up jsdom before importing it — mirrors
// the sibling `report-config-service.spec.ts`.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { ReportTemplateFinder } from './report-template-finder';

after(() => disableJSDOM());

class FakeFileSearchService {
    results: string[] = [];
    lastOptions: object | undefined;
    throwError: Error | undefined;
    async find(_pattern: string, options: object): Promise<string[]> {
        this.lastOptions = options;
        if (this.throwError) { throw this.throwError; }
        return this.results;
    }
}

class FakeWorkspaceService {
    constructor(protected readonly root?: URI) { }
    tryGetRoots(): Array<{ resource: URI }> {
        return this.root ? [{ resource: this.root }] : [];
    }
}

function createFinder(root: URI | undefined): { finder: ReportTemplateFinder; search: FakeFileSearchService } {
    const finder = new ReportTemplateFinder();
    const search = new FakeFileSearchService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (finder as any).fileSearchService = search;
    (finder as any).workspaceService = new FakeWorkspaceService(root);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { finder, search };
}

describe('ReportTemplateFinder', () => {

    it('returns an empty list when no workspace is open', async () => {
        const { finder, search } = createFinder(undefined);
        search.results = ['file:///ws/config/reports/cost.jinja'];
        expect(await finder.findWorkspaceTemplates()).to.deep.equal([]);
    });

    it('maps search hits to workspace templates with relative path and directory, sorted by label', async () => {
        const { finder, search } = createFinder(new URI('file:///ws'));
        search.results = [
            'file:///ws/config/reports/nutrition.md.jinja',
            'file:///ws/config/reports/balanced-diet.jinja',
            'file:///ws/root.j2',
        ];
        const templates = await finder.findWorkspaceTemplates();
        expect(templates.map(t => t.label)).to.deep.equal(['balanced-diet.jinja', 'nutrition.md.jinja', 'root.j2']);
        expect(templates[0]).to.deep.equal({
            id: 'workspace:file:///ws/config/reports/balanced-diet.jinja',
            label: 'balanced-diet.jinja',
            uri: 'file:///ws/config/reports/balanced-diet.jinja',
            path: 'config/reports/balanced-diet.jinja',
            directory: 'config/reports',
        });
        expect(templates[2].path).to.equal('root.j2');
        expect(templates[2].directory).to.equal(undefined);
    });

    it('drops hits that are not template files', async () => {
        const { finder, search } = createFinder(new URI('file:///ws'));
        search.results = ['file:///ws/notes.txt', 'file:///ws/cost.jinja'];
        const templates = await finder.findWorkspaceTemplates();
        expect(templates.map(t => t.label)).to.deep.equal(['cost.jinja']);
    });

    it('searches every template extension under the workspace roots, respecting .gitignore', async () => {
        const { finder, search } = createFinder(new URI('file:///ws'));
        await finder.findWorkspaceTemplates();
        expect(search.lastOptions).to.deep.include({
            rootUris: ['file:///ws'],
            includePatterns: ['**/*.jinja', '**/*.j2', '**/*.jinja2'],
            useGitIgnore: true,
            fuzzyMatch: false,
            limit: 200,
        });
    });

    it('returns an empty list when the search fails', async () => {
        const { finder, search } = createFinder(new URI('file:///ws'));
        search.throwError = new Error('rg missing');
        expect(await finder.findWorkspaceTemplates()).to.deep.equal([]);
    });
});
