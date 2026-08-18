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

// `RenderTemplateTool` transitively imports `ReportConfigService` (which imports
// ApplicationShell etc., evaluating `@lumino/widgets` at require time). Set up
// jsdom and guard the FrontendApplicationConfigProvider BEFORE importing the
// tool — mirrors the sibling `report-config-service.spec.ts`.
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
import { RenderTemplateTool } from './render-template-tool';
import { ReportWidgetOptions } from './report-widget-types';

after(() => disableJSDOM());

class FakeConfigService {
    activeUri: URI | undefined;
    workspaceRoot: URI | undefined;
    lastScale: number | undefined;
    getActiveCooklangUri(): URI | undefined { return this.activeUri; }
    resolveWorkspaceUri(arg: string): URI | undefined {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) {
            return new URI(arg);
        }
        return this.workspaceRoot ? this.workspaceRoot.resolve(arg) : undefined;
    }
    async buildConfigJson(scale: number = 1): Promise<string> {
        this.lastScale = scale;
        return JSON.stringify({ scale });
    }
}

class FakeLanguageService {
    calls: Array<{ recipe: string; template: string; config: string }> = [];
    response = JSON.stringify({ output: 'RENDERED' });
    throwError: Error | undefined;
    async renderReport(recipe: string, template: string, config: string): Promise<string> {
        if (this.throwError) { throw this.throwError; }
        this.calls.push({ recipe, template, config });
        return this.response;
    }
}

class FakeFileService {
    files = new Map<string, string>();
    async read(uri: { toString(): string }): Promise<{ value: string }> {
        const key = uri.toString();
        if (!this.files.has(key)) { throw new Error('ENOENT'); }
        return { value: this.files.get(key)! };
    }
}

class FakePresenter {
    shown: ReportWidgetOptions[] = [];
    async show(options: ReportWidgetOptions): Promise<void> { this.shown.push(options); }
}

function createTool(): {
    tool: RenderTemplateTool;
    config: FakeConfigService;
    language: FakeLanguageService;
    files: FakeFileService;
    presenter: FakePresenter;
} {
    const tool = new RenderTemplateTool();
    const config = new FakeConfigService();
    const language = new FakeLanguageService();
    const files = new FakeFileService();
    const presenter = new FakePresenter();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).reportConfigService = config;
    (tool as any).languageService = language;
    (tool as any).fileService = files;
    (tool as any).reportPresenter = presenter;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, config, language, files, presenter };
}

/** Invokes the registered tool handler with a JSON argument string. */
async function invoke(tool: RenderTemplateTool, args: object): Promise<{ output?: string; error?: string }> {
    const result = await tool.getTool().handler(JSON.stringify(args));
    return JSON.parse(result as string);
}

describe('RenderTemplateTool', () => {

    it('exposes the tool under the id renderTemplate with templateContent required', () => {
        const { tool } = createTool();
        const def = tool.getTool();
        expect(def.id).to.equal('renderTemplate');
        expect(def.name).to.equal('renderTemplate');
        expect(def.parameters.required).to.deep.equal(['templateContent']);
    });

    it('errors when templateContent is missing', async () => {
        const { tool, config } = createTool();
        config.activeUri = new URI('file:///ws/recipe.cook');
        const result = await invoke(tool, {});
        expect(result.error).to.match(/templateContent is required/);
    });

    it('errors when no recipeUri is given and no recipe is active', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: '{{ scale }}' });
        expect(result.error).to.match(/No recipe/);
    });

    it('errors when recipeUri is not a .cook or .menu file', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: 'x', recipeUri: 'file:///ws/notes.txt' });
        expect(result.error).to.match(/\.cook or \.menu/);
    });

    it('resolves a workspace-relative recipeUri against the workspace root', async () => {
        const { tool, config, language, files } = createTool();
        config.workspaceRoot = new URI('file:///ws');
        files.files.set('file:///ws/Baking/Napoleon.cook', 'recipe body');
        const result = await invoke(tool, { templateContent: 't', recipeUri: 'Baking/Napoleon.cook' });
        expect(result.output).to.equal('RENDERED');
        expect(language.calls[0].recipe).to.equal('recipe body');
    });

    it('errors clearly when a relative recipeUri is given but no workspace is open', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: 't', recipeUri: 'Baking/Napoleon.cook' });
        expect(result.error).to.match(/Could not resolve recipeUri/);
    });

    it('errors when the recipe file cannot be read', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: 'x', recipeUri: 'file:///ws/missing.cook' });
        expect(result.error).to.match(/Could not read recipe/);
    });

    it('renders against the explicit recipeUri and returns the output verbatim', async () => {
        const { tool, language, files } = createTool();
        files.files.set('file:///ws/cake.cook', 'Add @flour{200%g}');
        const result = await invoke(tool, { templateContent: '{{ scale }}', recipeUri: 'file:///ws/cake.cook' });
        expect(result.output).to.equal('RENDERED');
        expect(language.calls).to.have.length(1);
        expect(language.calls[0].recipe).to.equal('Add @flour{200%g}');
        expect(language.calls[0].template).to.equal('{{ scale }}');
    });

    it('falls back to the active recipe when recipeUri is omitted', async () => {
        const { tool, config, files } = createTool();
        config.activeUri = new URI('file:///ws/active.cook');
        files.files.set('file:///ws/active.cook', 'recipe');
        const result = await invoke(tool, { templateContent: 't' });
        expect(result.output).to.equal('RENDERED');
    });

    it('passes the scale argument through to buildConfigJson', async () => {
        const { tool, config, files } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook', scale: 3 });
        expect(config.lastScale).to.equal(3);
    });

    it('does not open a report tab when show is falsy', async () => {
        const { tool, files, presenter } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook' });
        expect(presenter.shown).to.have.length(0);
    });

    it('opens a report tab with inline content + outputFormat when show is true', async () => {
        const { tool, files, presenter } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 'TPL', recipeUri: 'file:///ws/cake.cook', show: true, outputFormat: 'html' });
        expect(presenter.shown).to.have.length(1);
        expect(presenter.shown[0].inlineTemplateContent).to.equal('TPL');
        expect(presenter.shown[0].outputFormat).to.equal('html');
        expect(presenter.shown[0].uri).to.equal('file:///ws/cake.cook');
    });

    it('passes render errors through and does not open a tab', async () => {
        const { tool, language, files, presenter } = createTool();
        language.response = JSON.stringify({ error: 'template syntax error at line 2' });
        files.files.set('file:///ws/cake.cook', 'r');
        const result = await invoke(tool, { templateContent: 'bad', recipeUri: 'file:///ws/cake.cook', show: true });
        expect(result.error).to.match(/template syntax error/);
        expect(presenter.shown).to.have.length(0);
    });

    it('maps a thrown renderReport into an error result', async () => {
        const { tool, language, files } = createTool();
        language.throwError = new Error('addon crashed');
        files.files.set('file:///ws/cake.cook', 'r');
        const result = await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook' });
        expect(result.error).to.match(/Render failed: addon crashed/);
    });
});
