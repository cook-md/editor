# Directory Structure Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `GetWorkspaceDirectoryStructure` AI tool emit a compact indented-tree string instead of verbose JSON, and exclude hidden (dotfile) directories by default with an opt-in `includeHidden` parameter.

**Architecture:** Rewrite the tool's recursive builder to append indented lines directly during traversal (returning a `string`), layering a local dotfile filter on top of the existing `WorkspaceFunctionScope.shouldExclude`. The shared scope logic and sibling tools are untouched. The `includeHidden` flag is threaded from the tool handler down through the recursion.

**Tech Stack:** TypeScript, Theia `ToolProvider` API, `@theia/core` `URI`, Mocha + Chai unit tests run via `theiaext` against compiled `lib/`.

---

## File Structure

- **Modify:** `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts`
  — class `GetWorkspaceDirectoryStructure` only (`getTool`, `getDirectoryStructure`, replace `buildDirectoryStructure` with `appendDirectoryLines`).
- **Create:** `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts`
  — unit tests for the directory-structure tool with in-memory `FileService` / `WorkspaceFunctionScope` fakes.

No other files change. `workspace-function-scope.ts`, `workspace-preferences.ts`, and the other tool classes in `workspace-functions.ts` are out of scope.

---

## Task 1: Indented-tree output + dotfiles hidden by default

Rewrite the output to a sorted indented-tree string, exclude dotfile directories and `shouldExclude`d directories, keep directories-only behavior, return `(empty)` for an empty tree and `Error: <msg>` strings on failure. The recursion already accepts an `includeHidden` flag, but the handler hardcodes `false` in this task (the parameter is exposed in Task 2).

**Files:**
- Modify: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts:36-97`
- Test: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts` (create)

- [ ] **Step 1: Write the failing test file**

Create `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { URI } from '@theia/core';
import { GetWorkspaceDirectoryStructure } from './workspace-functions';

after(() => disableJSDOM());

// ── Test fakes ──────────────────────────────────────────────────────────

/** Minimal FileStat shape the tool relies on. */
interface FakeStat {
    resource: URI;
    isDirectory: boolean;
    children?: FakeStat[];
}

/** Nested tree spec: a string value 'file' marks a file, an object marks a directory. */
type TreeSpec = { [name: string]: TreeSpec | 'file' };

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/cooklang-ai && npm run compile && npx lerna run test --scope @theia/cooklang-ai --stream
```

Expected: FAIL — the current tool returns a nested object (not the indented strings), e.g. the first test reports the handler result is not equal to the expected tree string. (The `(empty)` / error tests will also fail because today it returns objects.)

- [ ] **Step 3: Rewrite the tool's output methods**

In `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts`, replace the `getTool` description and the `getDirectoryStructure` / `buildDirectoryStructure` methods (lines 45-96) with:

```ts
    getTool(): ToolRequest {
        return {
            id: GetWorkspaceDirectoryStructure.ID,
            name: GetWorkspaceDirectoryStructure.ID,
            displayName: 'Get Directory Structure',
            description:
                'Retrieves the directory tree of the workspace as a compact indented-tree string ' +
                '(2-space indentation per level, directory names suffixed with "/", one per line, sorted alphabetically). ' +
                'Lists only directories (no files), excluding hidden (dotfile) directories such as .git and .vscode, ' +
                'as well as common non-essential directories (node_modules, etc.). ' +
                'Useful for getting a high-level overview of project organization. ' +
                'For listing files within a specific directory, use getWorkspaceFileList instead. ' +
                'For finding specific files, use findFilesByPattern.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: (_, ctx) => this.getDirectoryStructure(false, ctx?.cancellationToken),
        };
    }

    protected async getDirectoryStructure(includeHidden: boolean, cancellationToken?: CancellationToken): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return 'Error: Operation cancelled by user';
        }
        let workspaceRoot: URI;
        try {
            workspaceRoot = await this.workspaceScope.getWorkspaceRoot();
        } catch (error) {
            return `Error: ${(error as Error).message}`;
        }
        const lines: string[] = [];
        await this.appendDirectoryLines(workspaceRoot, 0, includeHidden, lines, cancellationToken);
        return lines.length > 0 ? lines.join('\n') : '(empty)';
    }

    protected async appendDirectoryLines(
        uri: URI,
        depth: number,
        includeHidden: boolean,
        lines: string[],
        cancellationToken?: CancellationToken,
    ): Promise<void> {
        if (cancellationToken?.isCancellationRequested) {
            return;
        }
        const stat = await this.fileService.resolve(uri);
        if (!stat || !stat.isDirectory || !stat.children) {
            return;
        }
        const childDirs = stat.children
            .filter(child => child.isDirectory)
            .sort((a, b) => a.resource.path.base.localeCompare(b.resource.path.base));
        for (const child of childDirs) {
            if (cancellationToken?.isCancellationRequested) {
                return;
            }
            const name = child.resource.path.base;
            if (!includeHidden && name.startsWith('.')) {
                continue;
            }
            if (await this.workspaceScope.shouldExclude(child)) {
                continue;
            }
            lines.push(`${'  '.repeat(depth)}${name}/`);
            await this.appendDirectoryLines(child.resource, depth + 1, includeHidden, lines, cancellationToken);
        }
    }
```

Note: the `Record<string, unknown>` return type and the old `buildDirectoryStructure` are fully replaced. Leave the class's imports and `@inject` fields as-is.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/cooklang-ai && npm run compile && npx lerna run test --scope @theia/cooklang-ai --stream
```

Expected: PASS — all six tests in `GetWorkspaceDirectoryStructure` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts \
        packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts
git commit -m "feat(cooklang-ai): indented-tree directory structure output, hide dotfiles"
```

---

## Task 2: Add the `includeHidden` parameter

Expose `includeHidden` on the tool schema and parse it in the handler so callers can opt into seeing dotfile directories. The recursion already honors the flag; this task wires it through the handler and documents it.

**Files:**
- Modify: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts` (the `getTool` method of `GetWorkspaceDirectoryStructure`)
- Test: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('GetWorkspaceDirectoryStructure', ...)` block in `workspace-functions.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/cooklang-ai && npm run compile && npx lerna run test --scope @theia/cooklang-ai --stream
```

Expected: FAIL — the `includeHidden is true` test fails because the handler currently ignores the argument and always passes `false`, so `.github/` is omitted. (The `false` test already passes.)

- [ ] **Step 3: Parse `includeHidden` in the handler and document it**

In `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts`, update the `GetWorkspaceDirectoryStructure.getTool` method: add the schema property, update the description, and parse the argument in the handler.

Replace the `parameters` and `handler` of `getTool` with:

```ts
            parameters: {
                type: 'object',
                properties: {
                    includeHidden: {
                        type: 'boolean',
                        description:
                            'Include hidden (dotfile) directories such as .git and .vscode. Defaults to false.',
                    },
                },
            },
            handler: (argString, ctx) => this.getDirectoryStructure(this.parseIncludeHidden(argString), ctx?.cancellationToken),
```

And update the description string in the same `getTool` to mention the parameter — change the sentence that begins `'Lists only directories ...'` so the block reads:

```ts
            description:
                'Retrieves the directory tree of the workspace as a compact indented-tree string ' +
                '(2-space indentation per level, directory names suffixed with "/", one per line, sorted alphabetically). ' +
                'Lists only directories (no files), excluding common non-essential directories (node_modules, etc.). ' +
                'Hidden (dotfile) directories such as .git and .vscode are excluded unless includeHidden is set to true. ' +
                'Useful for getting a high-level overview of project organization. ' +
                'For listing files within a specific directory, use getWorkspaceFileList instead. ' +
                'For finding specific files, use findFilesByPattern.',
```

Then add this helper method to the `GetWorkspaceDirectoryStructure` class (e.g. directly after `getTool`):

```ts
    protected parseIncludeHidden(argString: string): boolean {
        try {
            const parsed = JSON.parse(argString);
            return parsed?.includeHidden === true;
        } catch {
            return false;
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/cooklang-ai && npm run compile && npx lerna run test --scope @theia/cooklang-ai --stream
```

Expected: PASS — all eight tests pass, including both `includeHidden` cases.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts \
        packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts
git commit -m "feat(cooklang-ai): add includeHidden parameter to directory structure tool"
```

---

## Task 3: Lint and final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint the package**

```bash
cd packages/cooklang-ai && npx eslint --ext .ts src/browser/file-tools/workspace-functions.ts src/browser/file-tools/workspace-functions.spec.ts
```

Expected: no errors. Fix any reported lint issues (e.g. import ordering, missing return types) inline and re-run until clean.

- [ ] **Step 2: Full compile + test for the package**

```bash
cd packages/cooklang-ai && npm run compile && npx lerna run test --scope @theia/cooklang-ai --stream
```

Expected: PASS — all `GetWorkspaceDirectoryStructure` tests green, compile succeeds with no TypeScript errors.

- [ ] **Step 3: Commit any lint fixes (if needed)**

```bash
git add packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts \
        packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts
git commit -m "chore(cooklang-ai): lint fixes for directory structure tool"
```

(Skip this commit if Step 1 reported no issues.)

---

## Self-Review Notes

- **Spec coverage:** indented-tree format (Task 1, test 1) ✓; directories-only (Task 1, test 2) ✓; dotfiles hidden by default (Task 1, test 3) ✓; `includeHidden` reveals them (Task 2) ✓; node_modules/lib still excluded (Task 1, test 4) ✓; `(empty)` (Task 1, test 5) ✓; error string (Task 1, test 6) ✓; description/schema updates (Tasks 1 & 2 Step 3) ✓.
- **Scope:** only `GetWorkspaceDirectoryStructure` and its new spec change; `shouldExclude` and sibling tools untouched, matching the spec's non-goals.
- **Type consistency:** `appendDirectoryLines` and `getDirectoryStructure(includeHidden, cancellationToken)` signatures are used identically in the implementation and exercised through the public `getTool().handler`; `parseIncludeHidden` is defined in Task 2 before its use in the handler.
