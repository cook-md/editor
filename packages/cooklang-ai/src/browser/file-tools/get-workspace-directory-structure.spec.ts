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
import { GetWorkspaceDirectoryStructure } from './get-workspace-directory-structure';

after(() => disableJSDOM());

// ── Test fakes ──────────────────────────────────────────────────────────

/** Minimal FileStat shape the tool relies on. */
interface FakeStat {
    resource: URI;
    isDirectory: boolean;
    children?: FakeStat[];
}

/** Nested tree spec: a string value 'file' marks a file, an object marks a directory. */
interface TreeSpec { [name: string]: TreeSpec | 'file' }

/** Build a flat uri-string -> FakeStat map from a nested tree spec rooted at `rootUri`. */
function buildStats(rootUri: URI, spec: TreeSpec): Map<string, FakeStat> {
    const map = new Map<string, FakeStat>();
    const build = (uri: URI, node: TreeSpec): FakeStat => {
        const children: FakeStat[] = [];
        for (const [name, child] of Object.entries(node)) {
            const childUri = uri.resolve(name);
            if (child === 'file') {
                const fileStat: FakeStat = { resource: childUri, isDirectory: false };
                map.set(childUri.toString(), fileStat);
                children.push(fileStat);
            } else {
                children.push(build(childUri, child));
            }
        }
        const stat: FakeStat = { resource: uri, isDirectory: true, children };
        map.set(uri.toString(), stat);
        return stat;
    };
    build(rootUri, spec);
    return map;
}

class FakeFileService {
    constructor(private readonly map: Map<string, FakeStat>) {}
    async resolve(uri: URI): Promise<FakeStat> {
        const stat = this.map.get(uri.toString());
        if (!stat) {
            throw new Error('ENOENT');
        }
        return stat;
    }
}

class FakeWorkspaceScope {
    constructor(private readonly root: URI | undefined, private readonly excludes: Set<string>) {}
    async getWorkspaceRoot(): Promise<URI> {
        if (!this.root) {
            throw new Error('No workspace open');
        }
        return this.root;
    }
    async shouldExclude(stat: FakeStat): Promise<boolean> {
        return this.excludes.has(stat.resource.path.base);
    }
}

/** Construct the tool with injected fakes and return its output for the given args. */
async function run(spec: TreeSpec, args: string, options?: { excludes?: string[]; noWorkspace?: boolean }): Promise<string> {
    const root = new URI('file:///root');
    const map = buildStats(root, spec);
    const tool = new GetWorkspaceDirectoryStructure();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).fileService = new FakeFileService(map);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).workspaceScope = new FakeWorkspaceScope(
        options?.noWorkspace ? undefined : root,
        new Set(options?.excludes ?? ['node_modules', 'lib']),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.getTool().handler(args, undefined as any);
    return result as string;
}

describe('GetWorkspaceDirectoryStructure', () => {

    it('renders a sorted indented tree of directories', async () => {
        const out = await run({
            src: { utils: {}, components: { widgets: {} } },
            packages: { cooklang: {}, 'cooklang-native': {} },
        }, '{}');
        expect(out).to.equal([
            'packages/',
            '  cooklang/',
            '  cooklang-native/',
            'src/',
            '  components/',
            '    widgets/',
            '  utils/',
        ].join('\n'));
    });

    it('lists directories only, never files', async () => {
        const out = await run({
            src: { 'index.ts': 'file' },
            'package.json': 'file',
        }, '{}');
        expect(out).to.equal('src/');
    });

    it('hides dotfile directories by default', async () => {
        const out = await run({
            '.git': { objects: {} },
            '.vscode': {},
            src: {},
        }, '{}');
        expect(out).to.equal('src/');
    });

    it('keeps non-hidden siblings of hidden directories in sorted order', async () => {
        const out = await run({
            '.github': {},
            zebra: {},
            apple: {},
            src: {},
        }, '{}');
        expect(out).to.equal([
            'apple/',
            'src/',
            'zebra/',
        ].join('\n'));
    });

    it('excludes directories rejected by shouldExclude regardless of args', async () => {
        const out = await run({
            node_modules: { left_pad: {} },
            lib: {},
            src: {},
        }, '{}');
        expect(out).to.equal('src/');
    });

    it('returns (empty) when there are no included directories', async () => {
        const out = await run({ 'README.md': 'file' }, '{}');
        expect(out).to.equal('(empty)');
    });

    it('returns an error string when no workspace is open', async () => {
        const out = await run({}, '{}', { noWorkspace: true });
        expect(out).to.equal('Error: No workspace open');
    });

    it('includes dotfile directories when includeHidden is true', async () => {
        const out = await run({
            '.github': {},
            src: {},
        }, '{"includeHidden": true}');
        expect(out).to.equal([
            '.github/',
            'src/',
        ].join('\n'));
    });

    it('still hides dotfiles when includeHidden is false', async () => {
        const out = await run({
            '.github': {},
            src: {},
        }, '{"includeHidden": false}');
        expect(out).to.equal('src/');
    });

    it('defaults to hiding dotfiles for malformed or non-boolean args', async () => {
        const spec: TreeSpec = { '.github': {}, src: {} };
        expect(await run(spec, 'not json')).to.equal('src/');
        expect(await run(spec, '{"includeHidden": "true"}')).to.equal('src/');
    });
});
