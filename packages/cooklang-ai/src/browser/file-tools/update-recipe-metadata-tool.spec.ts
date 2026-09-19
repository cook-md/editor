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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { URI } from '@theia/core';
import { ToolInvocationContext } from '@theia/ai-core/lib/common';
import { UpdateRecipeMetadataTool } from './update-recipe-metadata-tool';
import { RecipeMetadataEntry, RecipeMetadataFilter } from './recipe-metadata-source';

after(() => disableJSDOM());

interface StagedElement { uri: URI; type: string; state: string; targetState: string; requestId: string; chatSessionId: string }

class FakeScope {
    root = new URI('file:///ws');
    rootError: Error | undefined;
    async getWorkspaceRoot(): Promise<URI> {
        if (this.rootError) { throw this.rootError; }
        return this.root;
    }
    ensureWithinWorkspace(targetUri: URI, workspaceRootUri: URI): void {
        if (!targetUri.normalizePath().toString().startsWith(workspaceRootUri.toString())) {
            throw new Error('Access outside of the workspace is not allowed');
        }
    }
}

class FakeMetadataSource {
    allCookPaths: string[] = [];
    /** Shared with FakeFileService so tests set file content in one place. */
    contents = new Map<string, string>();
    filterCalls: Array<{ paths: string[]; filter: RecipeMetadataFilter }> = [];
    /** Simple where support for tests: 'tags contains X' via a marker in content. */
    matches: Set<string> = new Set();

    async listCookPaths(): Promise<string[]> {
        return this.allCookPaths;
    }

    async filterByMetadata(_root: URI, paths: string[], filter: RecipeMetadataFilter): Promise<RecipeMetadataEntry[]> {
        this.filterCalls.push({ paths, filter });
        return paths.map(path => ({
            path,
            metadata: {},
            status: 'yaml',
            matched: this.matches.has(path),
        }));
    }
}

class FakeFileService {
    constructor(private readonly contents: Map<string, string>) { }
    async read(uri: URI): Promise<{ value: { toString(): string } }> {
        const key = uri.toString().replace('file:///ws/', '');
        const value = this.contents.get(key);
        if (value === undefined) { throw new Error('ENOENT'); }
        return { value: { toString: () => value } };
    }
}

class FakeMonacoWorkspace {
    open = new Map<string, string>();
    getTextDocument(uri: string): { getText(): string } | undefined {
        const value = this.open.get(uri);
        return value === undefined ? undefined : { getText: () => value };
    }
}

function createContext(): { ctx: object; staged: StagedElement[]; titles: string[]; pending: Map<string, undefined> } {
    const staged: StagedElement[] = [];
    const titles: string[] = [];
    const ctx = {
        request: {
            id: 'req-1',
            session: {
                id: 'session-1',
                changeSet: {
                    addElements: (...elements: StagedElement[]) => { staged.push(...elements); },
                    setTitle: (title: string) => { titles.push(title); },
                    getElementByURI: () => undefined,
                },
            },
        },
        response: {},
    };
    return { ctx, staged, titles, pending: new Map() };
}

function createTool(): {
    tool: UpdateRecipeMetadataTool; scope: FakeScope; metadataSource: FakeMetadataSource;
    fileService: FakeFileService; monacoWorkspace: FakeMonacoWorkspace;
} {
    const tool = new UpdateRecipeMetadataTool();
    const scope = new FakeScope();
    const metadataSource = new FakeMetadataSource();
    const fileService = new FakeFileService(metadataSource.contents);
    const monacoWorkspace = new FakeMonacoWorkspace();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).workspaceFunctionScope = scope;
    (tool as any).metadataSource = metadataSource;
    (tool as any).fileService = fileService;
    (tool as any).monacoWorkspace = monacoWorkspace;
    (tool as any).fileChangeFactory = (element: StagedElement) => element;
    (tool as any).fileChangeSetTitleProvider = { getChangeSetTitle: () => 'Changes proposed' };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, scope, metadataSource, fileService, monacoWorkspace };
}

async function invoke(tool: UpdateRecipeMetadataTool, args: object, ctx: object): Promise<Record<string, unknown>> {
    const raw = await tool.getTool().handler(JSON.stringify(args), ctx as ToolInvocationContext);
    return JSON.parse(raw as string);
}

const KIMCHI = '---\ntags: [Korean]\n---\nBody';
const NAPOLEON = '---\ntags: [French]\n---\nBody';

describe('UpdateRecipeMetadataTool', () => {

    it('exposes updateRecipeMetadata', () => {
        const def = createTool().tool.getTool();
        expect(def.id).to.equal('updateRecipeMetadata');
        expect(def.name).to.equal('updateRecipeMetadata');
    });

    describe('guards', () => {
        it('rejects when neither select nor edits is given', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { addTags: ['Korean'] }, ctx);
            expect(result.error).to.match(/select or edits/);
        });

        it('rejects when both select and edits are given', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, edits: [{ path: 'a.cook', addTags: ['x'] }] }, ctx);
            expect(result.error).to.match(/not both/);
        });

        it('rejects a select with no paths/glob/where/titleContains', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { select: {}, addTags: ['Korean'] }, ctx);
            expect(result.error).to.match(/paths, glob, where, or titleContains/);
        });

        it('rejects a select with no operation', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' } }, ctx);
            expect(result.error).to.match(/No operation given/);
        });

        it('rejects an empty edits array', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { edits: [] }, ctx);
            expect(result.error).to.match(/non-empty array/);
        });

        it('rejects edits over the 200 cap', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const edits = Array.from({ length: 201 }, (_, i) => ({ path: `r${i}.cook`, addTags: ['x'] }));
            const result = await invoke(tool, { edits }, ctx);
            expect(result.error).to.match(/at most 200/);
        });

        it('rejects an edits entry with no operation', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { edits: [{ path: 'a.cook' }] }, ctx);
            expect(result.error).to.match(/No operation given for a\.cook/);
        });

        it('rejects an edits entry with no path', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { edits: [{ addTags: ['x'] }] }, ctx);
            expect(result.error).to.match(/non-empty path/);
        });

        it('returns an error outside a chat context', async () => {
            const { tool } = createTool();
            const result = JSON.parse(await tool.getTool().handler(JSON.stringify({ select: { glob: '**/*.cook' }, addTags: ['x'] })) as string);
            expect(result.error).to.match(/chat/i);
        });

        it('returns an error on invalid JSON', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = JSON.parse(await tool.getTool().handler('nope', ctx as ToolInvocationContext) as string);
            expect(result.error).to.match(/JSON/);
        });

        it('returns an error when the request was cancelled', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const cancelled = { ...ctx, cancellationToken: { isCancellationRequested: true } };
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, cancelled);
            expect(result.error).to.match(/cancelled/i);
        });
    });

    describe('select — glob', () => {
        it('stages every matching file', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = ['Banchan/Kimchi.cook', 'Napoleon.cook'];
            metadataSource.contents.set('Banchan/Kimchi.cook', KIMCHI);
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx, staged, titles } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['Spicy'] }, ctx);
            expect(staged).to.have.length(2);
            expect(staged.map(s => s.targetState)).to.deep.equal([
                '---\ntags: [Korean, Spicy]\n---\nBody',
                '---\ntags: [French, Spicy]\n---\nBody',
            ]);
            expect(staged.every(s => s.type === 'modify')).to.equal(true);
            expect(titles).to.deep.equal(['Changes proposed']);
            expect(result.matched).to.equal(2);
            expect(result.staged).to.equal(2);
            expect(result.unchanged).to.equal(0);
            expect(result.dryRun).to.equal(false);
        });

        it('narrows by glob pattern', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = ['Banchan/Kimchi.cook', 'Napoleon.cook'];
            metadataSource.contents.set('Banchan/Kimchi.cook', KIMCHI);
            const { ctx, staged } = createContext();
            await invoke(tool, { select: { glob: 'Banchan/**/*.cook' }, addTags: ['Spicy'] }, ctx);
            expect(staged).to.have.length(1);
            expect(staged[0].uri.toString()).to.equal('file:///ws/Banchan/Kimchi.cook');
        });
    });

    describe('select — where', () => {
        it('only stages files the metadata source reports as matched', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = ['Banchan/Kimchi.cook', 'Napoleon.cook'];
            metadataSource.contents.set('Banchan/Kimchi.cook', KIMCHI);
            metadataSource.matches.add('Banchan/Kimchi.cook');
            const { ctx, staged } = createContext();
            const result = await invoke(tool, { select: { where: { tags: { has: 'Korean' } } }, addTags: ['Spicy'] }, ctx);
            expect(staged).to.have.length(1);
            expect(staged[0].uri.toString()).to.equal('file:///ws/Banchan/Kimchi.cook');
            expect(result.matched).to.equal(1);
            expect(metadataSource.filterCalls).to.have.length(1);
            expect(metadataSource.filterCalls[0].filter.where).to.deep.equal({ tags: { has: 'Korean' } });
        });

        it('does not call the metadata source when neither where nor titleContains is given', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = ['Napoleon.cook'];
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx } = createContext();
            await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, ctx);
            expect(metadataSource.filterCalls).to.deep.equal([]);
        });
    });

    describe('select — explicit paths', () => {
        it('uses the given paths without a directory walk', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx, staged } = createContext();
            await invoke(tool, { select: { paths: ['Napoleon.cook'] }, addTags: ['x'] }, ctx);
            expect(staged).to.have.length(1);
        });

        it('skips a non-.cook path with a reason, counting it in matched', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { paths: ['Napoleon.cook', 'Plans/Week.menu'] }, addTags: ['x'] }, ctx);
            expect(result.matched).to.equal(2);
            expect(result.skipped).to.deep.equal([{ path: 'Plans/Week.menu', reason: 'not a .cook file' }]);
        });

        it('caps select matches at 1000', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = Array.from({ length: 1001 }, (_, i) => `r${i}.cook`);
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, ctx);
            expect(result.error).to.match(/1001 files, over the 1000 cap/);
        });
    });

    describe('unchanged / skipped', () => {
        it('reports a no-op edit as unchanged, not staged', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx, staged } = createContext();
            const result = await invoke(tool, { select: { paths: ['Napoleon.cook'] }, addTags: ['French'] }, ctx);
            expect(staged).to.deep.equal([]);
            expect(result.unchanged).to.equal(1);
            expect(result.staged).to.equal(0);
        });

        it('skips a file using deprecated >> metadata with a reason, never rewriting it', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.contents.set('Legacy.cook', '>> title: Old\n\nBody');
            const { ctx, staged } = createContext();
            const result = await invoke(tool, { select: { paths: ['Legacy.cook'] }, addTags: ['x'] }, ctx);
            expect(staged).to.deep.equal([]);
            expect(result.skipped).to.deep.equal([{ path: 'Legacy.cook', reason: 'uses deprecated >> metadata; convert to frontmatter first' }]);
        });

        it('skips a missing file with a reason', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { paths: ['Nope.cook'] }, addTags: ['x'] }, ctx);
            expect(result.skipped).to.deep.equal([{ path: 'Nope.cook', reason: 'File not found' }]);
        });

        it('caps reported skips at 20 and reports skippedTotal', async () => {
            const { tool, metadataSource } = createTool();
            const paths = Array.from({ length: 25 }, (_, i) => `missing${i}.cook`);
            metadataSource.allCookPaths = paths;
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, ctx);
            expect((result.skipped as unknown[]).length).to.equal(20);
            expect(result.skippedTotal).to.equal(25);
        });

        it('caps the sample at 3', async () => {
            const { tool, metadataSource } = createTool();
            const paths = Array.from({ length: 5 }, (_, i) => `r${i}.cook`);
            metadataSource.allCookPaths = paths;
            for (const p of paths) { metadataSource.contents.set(p, NAPOLEON); }
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, ctx);
            expect((result.sample as unknown[]).length).to.equal(3);
            expect(result.staged).to.equal(5);
        });
    });

    describe('dryRun', () => {
        it('stages nothing but reports wouldStage and the matched paths', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.allCookPaths = ['Napoleon.cook'];
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx, staged, titles } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['Spicy'], dryRun: true }, ctx);
            expect(staged).to.deep.equal([]);
            expect(titles).to.deep.equal([]);
            expect(result.staged).to.equal(0);
            expect(result.wouldStage).to.equal(1);
            expect(result.paths).to.deep.equal(['Napoleon.cook']);
            expect(result.dryRun).to.equal(true);
        });

        it('caps the reported paths at 50', async () => {
            const { tool, metadataSource } = createTool();
            const paths = Array.from({ length: 60 }, (_, i) => `r${i}.cook`);
            metadataSource.allCookPaths = paths;
            for (const p of paths) { metadataSource.contents.set(p, NAPOLEON); }
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'], dryRun: true }, ctx);
            expect((result.paths as unknown[]).length).to.equal(50);
            expect(result.wouldStage).to.equal(60);
        });
    });

    describe('content priority', () => {
        it('edits the open-editor (unsaved) content instead of disk', async () => {
            const { tool, metadataSource, monacoWorkspace } = createTool();
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            monacoWorkspace.open.set('file:///ws/Napoleon.cook', '---\ntags: [French, Modern]\n---\nBody');
            const { ctx, staged } = createContext();
            await invoke(tool, { select: { paths: ['Napoleon.cook'] }, addTags: ['Spicy'] }, ctx);
            expect(staged[0].targetState).to.equal('---\ntags: [French, Modern, Spicy]\n---\nBody');
        });
    });

    describe('edits (per-file)', () => {
        it('applies distinct operations per file', async () => {
            const { tool, metadataSource } = createTool();
            metadataSource.contents.set('Banchan/Kimchi.cook', KIMCHI);
            metadataSource.contents.set('Napoleon.cook', NAPOLEON);
            const { ctx, staged } = createContext();
            const result = await invoke(tool, {
                edits: [
                    { path: 'Banchan/Kimchi.cook', addTags: ['Spicy'] },
                    { path: 'Napoleon.cook', set: { cuisine: 'French' } },
                ],
            }, ctx);
            expect(staged).to.have.length(2);
            expect(staged[0].targetState).to.equal('---\ntags: [Korean, Spicy]\n---\nBody');
            expect(staged[1].targetState).to.equal('---\ntags: [French]\ncuisine: French\n---\nBody');
            expect(result.matched).to.equal(2);
        });
    });

    describe('workspace access', () => {
        it('returns an error without a workspace', async () => {
            const { tool, scope } = createTool();
            scope.rootError = new Error('No workspace has been opened yet');
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { glob: '**/*.cook' }, addTags: ['x'] }, ctx);
            expect(result.error).to.match(/No workspace has been opened yet/);
        });

        it('skips a path outside the workspace', async () => {
            const { tool } = createTool();
            const { ctx } = createContext();
            const result = await invoke(tool, { select: { paths: ['../outside.cook'] }, addTags: ['x'] }, ctx);
            expect(result.skipped).to.deep.equal([{ path: '../outside.cook', reason: 'outside of the workspace' }]);
        });
    });
});
