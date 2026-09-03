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
            return new URI(arg).normalizePath();
        }
        return this.workspaceRoot ? this.workspaceRoot.resolve(arg).normalizePath() : undefined;
    }
    async buildConfigJson(scale: number = 1): Promise<string> {
        this.lastScale = scale;
        return JSON.stringify({ scale });
    }
}

class FakeLanguageService {
    calls: Array<{ recipe: string; template: string; config: string }> = [];
    response = JSON.stringify({ output: 'RENDERED' });
    /** Overrides `response` per call when set, so a batch can vary by recipe. */
    responder: ((recipe: string) => string) | undefined;
    throwError: Error | undefined;
    async renderReport(recipe: string, template: string, config: string): Promise<string> {
        if (this.throwError) { throw this.throwError; }
        this.calls.push({ recipe, template, config });
        return this.responder ? this.responder(recipe) : this.response;
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

/** Invokes the handler and parses a batched `{ results: [...] }` envelope. */
async function invokeBatch(tool: RenderTemplateTool, args: object): Promise<{
    results?: Array<{ recipeUri: string; output?: string; error?: string }>;
    error?: string;
}> {
    const result = await tool.getTool().handler(JSON.stringify(args));
    return JSON.parse(result as string);
}

describe('RenderTemplateTool', () => {

    it('exposes the tool under the id renderTemplate with templateContent and templateUri both optional', () => {
        const { tool } = createTool();
        const def = tool.getTool();
        expect(def.id).to.equal('renderTemplate');
        expect(def.name).to.equal('renderTemplate');
        expect(def.parameters.required ?? []).to.deep.equal([]);
        expect(Object.keys(def.parameters.properties)).to.include.members(['templateContent', 'templateUri']);
    });

    it('errors when neither templateContent nor templateUri is given', async () => {
        const { tool, config } = createTool();
        config.activeUri = new URI('file:///ws/recipe.cook');
        const result = await invoke(tool, {});
        expect(result.error).to.match(/exactly one of templateContent or templateUri/);
    });

    it('errors when both templateContent and templateUri are given', async () => {
        const { tool, config } = createTool();
        config.activeUri = new URI('file:///ws/recipe.cook');
        const result = await invoke(tool, { templateContent: 'x', templateUri: 'config/reports/cost.jinja' });
        expect(result.error).to.match(/exactly one of templateContent or templateUri/);
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

    describe('templateUri', () => {

        it('renders a workspace-relative template file against the recipe', async () => {
            const { tool, config, language, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/config/reports/cost.jinja', 'COST TPL');
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: 'config/reports/cost.jinja', recipeUri: 'cake.cook' });
            expect(result.output).to.equal('RENDERED');
            expect(language.calls[0].template).to.equal('COST TPL');
            expect(language.calls[0].recipe).to.equal('recipe');
        });

        it('renders a built-in template by id', async () => {
            const { tool, language, files } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: 'builtin:ingredients', recipeUri: 'file:///ws/cake.cook' });
            expect(result.output).to.equal('RENDERED');
            expect(language.calls[0].template).to.contain('for ingredient in ingredients');
        });

        it('errors on an unknown built-in id and lists the known ones', async () => {
            const { tool, files } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: 'builtin:nope', recipeUri: 'file:///ws/cake.cook' });
            expect(result.error).to.match(/Unknown built-in template 'builtin:nope'/);
            expect(result.error).to.contain('builtin:ingredients');
        });

        it('errors when a relative templateUri is given but no workspace is open', async () => {
            const { tool, files } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: 'config/reports/cost.jinja', recipeUri: 'file:///ws/cake.cook' });
            expect(result.error).to.match(/Could not resolve templateUri/);
        });

        it('errors when templateUri is not a template file', async () => {
            const { tool, files } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            files.files.set('file:///ws/notes.txt', 'x');
            const result = await invoke(tool, { templateUri: 'file:///ws/notes.txt', recipeUri: 'file:///ws/cake.cook' });
            expect(result.error).to.match(/templateUri must be a \.jinja\/\.j2\/\.jinja2 file/);
        });

        it('errors when the template file cannot be read', async () => {
            const { tool, files } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: 'file:///ws/missing.jinja', recipeUri: 'file:///ws/cake.cook' });
            expect(result.error).to.match(/Could not read template/);
        });

        it('opens the workspace-bound report tab (no inline content, format inferred) when show is true', async () => {
            const { tool, files, presenter } = createTool();
            files.files.set('file:///ws/config/reports/nutrition.html.jinja', 'TPL');
            files.files.set('file:///ws/cake.cook', 'recipe');
            await invoke(tool, { templateUri: 'file:///ws/config/reports/nutrition.html.jinja', recipeUri: 'file:///ws/cake.cook', show: true });
            expect(presenter.shown).to.have.length(1);
            const shown = presenter.shown[0];
            expect(shown.uri).to.equal('file:///ws/cake.cook');
            expect(shown.templateId).to.equal('workspace:file:///ws/config/reports/nutrition.html.jinja');
            expect(shown.templateLabel).to.equal('nutrition.html.jinja');
            expect(shown.templateUri).to.equal('file:///ws/config/reports/nutrition.html.jinja');
            expect(shown.inlineTemplateContent).to.equal(undefined);
            expect(shown.outputFormat).to.equal(undefined);
        });

        it('uses the normalized uri in the workspace tab id so ./ paths share the QuickPick tab', async () => {
            const { tool, config, files, presenter } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/config/reports/cost.jinja', 'TPL');
            files.files.set('file:///ws/cake.cook', 'recipe');
            await invoke(tool, { templateUri: './config/reports/cost.jinja', recipeUri: 'cake.cook', show: true });
            expect(presenter.shown[0].templateId).to.equal('workspace:file:///ws/config/reports/cost.jinja');
            expect(presenter.shown[0].templateUri).to.equal('file:///ws/config/reports/cost.jinja');
        });

        it('accepts a bare absolute path as templateUri', async () => {
            const { tool, language, files } = createTool();
            files.files.set('file:///abs/cost.jinja', 'ABS TPL');
            files.files.set('file:///ws/cake.cook', 'recipe');
            const result = await invoke(tool, { templateUri: '/abs/cost.jinja', recipeUri: 'file:///ws/cake.cook' });
            expect(result.output).to.equal('RENDERED');
            expect(language.calls[0].template).to.equal('ABS TPL');
        });

        it('passes an explicit outputFormat through for a templateUri tab', async () => {
            const { tool, files, presenter } = createTool();
            files.files.set('file:///ws/cost.jinja', 'TPL');
            files.files.set('file:///ws/cake.cook', 'recipe');
            await invoke(tool, { templateUri: 'file:///ws/cost.jinja', recipeUri: 'file:///ws/cake.cook', show: true, outputFormat: 'text' });
            expect(presenter.shown[0].outputFormat).to.equal('text');
        });

        it('opens a built-in tab under the built-in id when show is true', async () => {
            const { tool, files, presenter } = createTool();
            files.files.set('file:///ws/cake.cook', 'recipe');
            await invoke(tool, { templateUri: 'builtin:shopping-list', recipeUri: 'file:///ws/cake.cook', show: true });
            const shown = presenter.shown[0];
            expect(shown.templateId).to.equal('builtin:shopping-list');
            expect(shown.templateLabel).to.equal('Shopping List (built-in)');
            expect(shown.templateUri).to.equal(undefined);
            expect(shown.inlineTemplateContent).to.equal(undefined);
        });

        it('still opens the inline tab with markdown default for templateContent', async () => {
            const { tool, files, presenter } = createTool();
            files.files.set('file:///ws/cake.cook', 'r');
            await invoke(tool, { templateContent: 'TPL', recipeUri: 'file:///ws/cake.cook', show: true });
            const shown = presenter.shown[0];
            expect(shown.templateId).to.equal('inline:renderTemplate');
            expect(shown.templateLabel).to.equal('AI Template');
            expect(shown.inlineTemplateContent).to.equal('TPL');
            expect(shown.outputFormat).to.equal('markdown');
        });
    });

    describe('recipeUris (batch)', () => {

        it('advertises recipeUris as an array parameter', () => {
            const { tool } = createTool();
            const props = tool.getTool().parameters.properties as Record<string, { type?: string }>;
            expect(props.recipeUris.type).to.equal('array');
        });

        it('renders one template against several recipes and keeps the input order', async () => {
            const { tool, config, language, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A body');
            files.files.set('file:///ws/b.cook', 'B body');
            language.responder = recipe => JSON.stringify({ output: `OUT ${recipe}` });

            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['a.cook', 'b.cook'] });

            expect(result.results).to.deep.equal([
                { recipeUri: 'a.cook', output: 'OUT A body' },
                { recipeUri: 'b.cook', output: 'OUT B body' },
            ]);
        });

        it('sends the template once per call, not once per recipe', async () => {
            const { tool, config, language, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A');
            files.files.set('file:///ws/b.cook', 'B');
            files.files.set('file:///ws/config/reports/cost.jinja', 'COST TPL');

            await invokeBatch(tool, { templateUri: 'config/reports/cost.jinja', recipeUris: ['a.cook', 'b.cook'] });

            // The template file is resolved once and reused for every recipe —
            // this is the whole point of the batch.
            expect(language.calls.map(c => c.template)).to.deep.equal(['COST TPL', 'COST TPL']);
        });

        it('reports a failing recipe in its own entry and still renders the rest', async () => {
            const { tool, config, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/good.cook', 'G');

            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['missing.cook', 'good.cook'] });

            expect(result.results).to.have.length(2);
            expect(result.results![0].error).to.match(/Could not read recipe/);
            expect(result.results![1].output).to.equal('RENDERED');
        });

        it('reports a per-recipe render error without failing the batch', async () => {
            const { tool, config, language, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A');
            files.files.set('file:///ws/b.cook', 'B');
            language.responder = recipe =>
                recipe === 'A' ? JSON.stringify({ error: 'unresolved ingredient' }) : JSON.stringify({ output: 'OK' });

            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['a.cook', 'b.cook'] });

            expect(result.results![0].error).to.equal('unresolved ingredient');
            expect(result.results![1].output).to.equal('OK');
        });

        it('rejects a non-.cook entry in its own slot', async () => {
            const { tool, config, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A');
            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['notes.txt', 'a.cook'] });
            expect(result.results![0].error).to.match(/\.cook or \.menu/);
            expect(result.results![1].output).to.equal('RENDERED');
        });

        it('collapses duplicate recipes', async () => {
            const { tool, config, language, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A');
            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['a.cook', 'a.cook'] });
            expect(result.results).to.have.length(1);
            expect(language.calls).to.have.length(1);
        });

        it('rejects recipeUri and recipeUris together', async () => {
            const { tool, config } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUri: 'a.cook', recipeUris: ['b.cook'] });
            expect(result.error).to.match(/not both/);
        });

        it('rejects show with a batch and says how to present one result', async () => {
            const { tool, config, presenter } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            const result = await invokeBatch(tool, { templateContent: 'TPL', recipeUris: ['a.cook'], show: true });
            expect(result.error).to.match(/batch is headless/);
            expect(presenter.shown).to.have.length(0);
        });

        it('rejects an empty array, a non-array, and non-string entries', async () => {
            const { tool, config } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            expect((await invokeBatch(tool, { templateContent: 'T', recipeUris: [] })).error).to.match(/must not be empty/);
            expect((await invokeBatch(tool, { templateContent: 'T', recipeUris: 'a.cook' })).error).to.match(/must be an array/);
            expect((await invokeBatch(tool, { templateContent: 'T', recipeUris: ['a.cook', 3] })).error).to.match(/non-empty strings/);
        });

        it('rejects a batch larger than the cap and says to narrow first', async () => {
            const { tool, config } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            const many = Array.from({ length: 26 }, (_, i) => `r${i}.cook`);
            const result = await invokeBatch(tool, { templateContent: 'T', recipeUris: many });
            expect(result.error).to.match(/at most 25 items, got 26/);
            expect(result.error).to.match(/Narrow the shortlist/);
        });

        it('still validates the template before touching any recipe', async () => {
            const { tool, config, language } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            const result = await invokeBatch(tool, { templateUri: 'builtin:nope', recipeUris: ['a.cook'] });
            expect(result.error).to.match(/Unknown built-in template/);
            expect(language.calls).to.have.length(0);
        });

        it('passes scale through for every recipe in the batch', async () => {
            const { tool, config, files } = createTool();
            config.workspaceRoot = new URI('file:///ws');
            files.files.set('file:///ws/a.cook', 'A');
            files.files.set('file:///ws/b.cook', 'B');
            await invokeBatch(tool, { templateContent: 'T', recipeUris: ['a.cook', 'b.cook'], scale: 4 });
            expect(config.lastScale).to.equal(4);
        });
    });
});
