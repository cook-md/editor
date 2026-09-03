// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
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
import { FileContentFunction, FindFilesByPattern, GetWorkspaceFileList } from './workspace-functions';

after(() => disableJSDOM());

// ── Test fakes ──────────────────────────────────────────────────────────

interface FakeStat {
    resource: URI;
    isDirectory: boolean;
    size?: number;
    children?: FakeStat[];
}

/** Nested tree spec: a string value is a file's content, an object is a directory. */
interface TreeSpec { [name: string]: TreeSpec | string }

function buildStats(rootUri: URI, spec: TreeSpec): { stats: Map<string, FakeStat>; contents: Map<string, string> } {
    const stats = new Map<string, FakeStat>();
    const contents = new Map<string, string>();
    const build = (uri: URI, node: TreeSpec): FakeStat => {
        const children: FakeStat[] = [];
        for (const [name, child] of Object.entries(node)) {
            const childUri = uri.resolve(name);
            if (typeof child === 'string') {
                const fileStat: FakeStat = { resource: childUri, isDirectory: false, size: child.length };
                stats.set(childUri.toString(), fileStat);
                contents.set(childUri.toString(), child);
                children.push(fileStat);
            } else {
                children.push(build(childUri, child));
            }
        }
        const stat: FakeStat = { resource: uri, isDirectory: true, children };
        stats.set(uri.toString(), stat);
        return stat;
    };
    build(rootUri, spec);
    return { stats, contents };
}

class FakeFileService {
    /** Directories walked, so a test can prove the tree is visited once. */
    resolvedDirectories: string[] = [];
    constructor(private readonly stats: Map<string, FakeStat>, private readonly contents: Map<string, string>) { }
    async resolve(uri: URI): Promise<FakeStat> {
        const stat = this.stats.get(uri.toString());
        if (!stat) {
            throw new Error('ENOENT');
        }
        if (stat.isDirectory) {
            this.resolvedDirectories.push(uri.toString());
        }
        return stat;
    }
    async read(uri: URI): Promise<{ value: string }> {
        const value = this.contents.get(uri.toString());
        if (value === undefined) {
            throw new Error('ENOENT');
        }
        return { value };
    }
}

class FakeWorkspaceScope {
    constructor(private readonly root: URI | undefined) { }
    async getWorkspaceRoot(): Promise<URI> {
        if (!this.root) {
            throw new Error('No workspace open');
        }
        return this.root;
    }
    /** Normalizes first, as the real scope does: `ws/../secrets` escapes the root. */
    ensureWithinWorkspace(target: URI, root: URI): void {
        if (!target.normalizePath().toString().startsWith(root.toString())) {
            throw new Error('Access outside of the workspace is not allowed');
        }
    }
    async shouldExclude(stat: FakeStat): Promise<boolean> {
        return stat.resource.path.base === 'node_modules';
    }
}

class FakeMonacoWorkspace {
    getTextDocument(): undefined { return undefined; }
}

class FakePreferences {
    get<T>(_key: string, fallback: T): T { return fallback; }
}

const ROOT = new URI('file:///ws');

/* eslint-disable @typescript-eslint/no-explicit-any */
function wire<T>(tool: T, spec: TreeSpec, noWorkspace = false): { tool: T; files: FakeFileService } {
    const { stats, contents } = buildStats(ROOT, spec);
    const files = new FakeFileService(stats, contents);
    (tool as any).fileService = files;
    (tool as any).workspaceScope = new FakeWorkspaceScope(noWorkspace ? undefined : ROOT);
    (tool as any).monacoWorkspace = new FakeMonacoWorkspace();
    (tool as any).preferences = new FakePreferences();
    return { tool, files };
}

async function call(tool: { getTool(): { handler: Function } }, args: object): Promise<string> {
    return await tool.getTool().handler(JSON.stringify(args), undefined as any) as string;
}

async function callJson<T>(tool: { getTool(): { handler: Function } }, args: object): Promise<T> {
    return JSON.parse(await call(tool, args)) as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const TREE: TreeSpec = {
    'Napoleon.cook': 'Add @flour{200%g}',
    Dinners: { 'Chilli.cook': 'Brown @beef{500%g}', 'notes.txt': 'not a recipe' },
    Plans: { 'Week.menu': 'Day 1' },
    node_modules: { 'ignored.cook': 'nope' },
};

// ── getFileContent ──────────────────────────────────────────────────────

describe('FileContentFunction', () => {

    it('returns raw content for a single file, unchanged by the batch support', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        expect(await call(tool, { file: 'Napoleon.cook' })).to.equal('Add @flour{200%g}');
    });

    it('reads several files in one call, in the order given', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ files: Array<{ file: string; content?: string; error?: string }> }>(
            tool, { files: ['Napoleon.cook', 'Dinners/Chilli.cook'] });
        expect(result.files).to.deep.equal([
            { file: 'Napoleon.cook', content: 'Add @flour{200%g}' },
            { file: 'Dinners/Chilli.cook', content: 'Brown @beef{500%g}' },
        ]);
    });

    it('reports a missing file in its own entry and still returns the others', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ files: Array<{ file: string; content?: string; error?: string }> }>(
            tool, { files: ['nope.cook', 'Napoleon.cook'] });
        expect(result.files[0].error).to.equal('File not found');
        expect(result.files[0].content).to.equal(undefined);
        expect(result.files[1].content).to.equal('Add @flour{200%g}');
    });

    it('collapses duplicate paths', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ files: unknown[] }>(tool, { files: ['Napoleon.cook', 'Napoleon.cook'] });
        expect(result.files).to.have.length(1);
    });

    it('rejects file and files together', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ error: string }>(tool, { file: 'a.cook', files: ['b.cook'] });
        expect(result.error).to.match(/not both/);
    });

    it('rejects offset/limit with a batch and says to use file instead', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ error: string }>(tool, { files: ['Napoleon.cook'], offset: 2 });
        expect(result.error).to.match(/page through a single file/);
    });

    it('rejects a call with neither file nor files', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        const result = await callJson<{ error: string }>(tool, {});
        expect(result.error).to.match(/either file .* or files/);
    });

    it('rejects an empty array and a batch over the cap', async () => {
        const { tool } = wire(new FileContentFunction(), TREE);
        expect((await callJson<{ error: string }>(tool, { files: [] })).error).to.match(/must not be empty/);
        const many = Array.from({ length: 26 }, (_, i) => `r${i}.cook`);
        expect((await callJson<{ error: string }>(tool, { files: many })).error).to.match(/at most 25 items/);
    });
});

// ── getWorkspaceFileList ────────────────────────────────────────────────

describe('GetWorkspaceFileList', () => {

    it('lists a single directory as a bare array, unchanged', async () => {
        const { tool } = wire(new GetWorkspaceFileList(), TREE);
        const result = await tool.getTool().handler(JSON.stringify({ path: 'Dinners' }), undefined!) as string[];
        expect(result).to.have.members(['Chilli.cook', 'notes.txt']);
    });

    it('lists several directories in one call', async () => {
        const { tool } = wire(new GetWorkspaceFileList(), TREE);
        const result = await callJson<{ directories: Array<{ path: string; entries?: string[]; error?: string }> }>(
            tool, { paths: ['Dinners', 'Plans'] });
        expect(result.directories.map(d => d.path)).to.deep.equal(['Dinners', 'Plans']);
        expect(result.directories[0].entries).to.have.members(['Chilli.cook', 'notes.txt']);
        expect(result.directories[1].entries).to.deep.equal(['Week.menu']);
    });

    it('reports a missing directory in its own entry and still lists the rest', async () => {
        const { tool } = wire(new GetWorkspaceFileList(), TREE);
        const result = await callJson<{ directories: Array<{ path: string; entries?: string[]; error?: string }> }>(
            tool, { paths: ['Nope', 'Plans'] });
        expect(result.directories[0].error).to.equal('Directory not found');
        expect(result.directories[1].entries).to.deep.equal(['Week.menu']);
    });

    it('keeps a path outside the workspace inside its own entry rather than failing the batch', async () => {
        const { tool } = wire(new GetWorkspaceFileList(), TREE);
        const result = await callJson<{ directories: Array<{ path: string; error?: string }> }>(
            tool, { paths: ['../secrets', 'Plans'] });
        expect(result.directories[0].error).to.match(/outside of the workspace/);
        expect(result.directories).to.have.length(2);
    });

    it('rejects path and paths together', async () => {
        const { tool } = wire(new GetWorkspaceFileList(), TREE);
        const result = await callJson<{ error: string }>(tool, { path: 'Dinners', paths: ['Plans'] });
        expect(result.error).to.match(/not both/);
    });
});

// ── findFilesByPattern ──────────────────────────────────────────────────

describe('FindFilesByPattern', () => {

    it('matches a single glob exactly as before', async () => {
        const { tool } = wire(new FindFilesByPattern(), TREE);
        const result = await callJson<{ files: string[] }>(tool, { pattern: '**/*.cook' });
        expect(result.files).to.have.members(['Napoleon.cook', 'Dinners/Chilli.cook']);
        expect(result.files).to.not.include('node_modules/ignored.cook');
    });

    it('matches several globs in one call, in the order given', async () => {
        const { tool } = wire(new FindFilesByPattern(), TREE);
        const result = await callJson<{ patterns: Array<{ pattern: string; files: string[] }> }>(
            tool, { patterns: ['**/*.cook', '**/*.menu'] });
        expect(result.patterns.map(p => p.pattern)).to.deep.equal(['**/*.cook', '**/*.menu']);
        expect(result.patterns[0].files).to.have.members(['Napoleon.cook', 'Dinners/Chilli.cook']);
        expect(result.patterns[1].files).to.deep.equal(['Plans/Week.menu']);
    });

    it('walks the workspace once for many globs, not once per glob', async () => {
        const single = wire(new FindFilesByPattern(), TREE);
        await call(single.tool, { pattern: '**/*.cook' });
        const walkedOnce = single.files.resolvedDirectories.length;

        const batched = wire(new FindFilesByPattern(), TREE);
        await call(batched.tool, { patterns: ['**/*.cook', '**/*.menu', '**/*.txt'] });

        // Three globs must not cost three traversals — that is the saving.
        expect(batched.files.resolvedDirectories.length).to.equal(walkedOnce);
    });

    it('returns an empty file list for a glob that matches nothing', async () => {
        const { tool } = wire(new FindFilesByPattern(), TREE);
        const result = await callJson<{ patterns: Array<{ pattern: string; files: string[] }> }>(
            tool, { patterns: ['**/*.cook', '**/*.pdf'] });
        expect(result.patterns[1].files).to.deep.equal([]);
    });

    it('rejects pattern and patterns together', async () => {
        const { tool } = wire(new FindFilesByPattern(), TREE);
        const result = await callJson<{ error: string }>(tool, { pattern: '**/*.cook', patterns: ['**/*.menu'] });
        expect(result.error).to.match(/not both/);
    });

    it('rejects a call with neither pattern nor patterns', async () => {
        const { tool } = wire(new FindFilesByPattern(), TREE);
        const result = await callJson<{ error: string }>(tool, {});
        expect(result.error).to.match(/either pattern .* or patterns/);
    });

    it('reports no workspace as an error for both forms', async () => {
        const single = wire(new FindFilesByPattern(), TREE, true);
        expect((await callJson<{ error: string }>(single.tool, { pattern: '**/*' })).error).to.match(/No workspace open/);
        const batched = wire(new FindFilesByPattern(), TREE, true);
        expect((await callJson<{ error: string }>(batched.tool, { patterns: ['**/*'] })).error).to.match(/No workspace open/);
    });
});
