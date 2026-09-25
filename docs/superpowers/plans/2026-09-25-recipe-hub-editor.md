# Recipe Hub — Editor Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give plugins what the `cooklang.recipe-hub` plugin (PR 3) needs from Cook Editor: a `cooklang.api.saveDraft` command, a recipe preview that works for `cooklang-hub:` (non-`file`) URIs, remote `https:` hero images for those recipes, a `cooklangPreviewScheme` context key on the preview element, and a `cooklang.api.openPreview` command so a plugin can open that preview at all.

**Architecture:** `cooklang.api.saveDraft` is a label-less command in `@theia/cooklang-import`, next to the `DraftSaver` it wraps. It validates the argument, then calls the new `DraftSaver.saveContent`, which writes a YAML-frontmatter draft through the new `DraftName.mergeFrontmatter`. The recipe preview already reads through `FileService`, and Theia's `FileSystemMainImpl` registers plugin `FileSystemProvider`s with that same `FileService`, so `cooklang-hub:` URIs load without a new widget. The preview only needs its `file`-only steps skipped for other schemes: the sibling-image lookup, the folder watch and reference links. Images for a non-`file` recipe come from a new native `recipeImagesFromContent`, which asks `cooklang-find`'s content-based `RecipeEntry` for its metadata image. The preview creates a scoped context-key store on its DOM node and hands that node to `CooklangOutletService`, so outlet `when` clauses read `cooklangPreviewScheme` from the preview itself, not from whatever element has focus.

**Tech Stack:** Theia 1.70 (InversifyJS property injection, `CommandRegistry`, `ContextKeyService.createScoped`, `MenuModelRegistry`), React 18, TypeScript 5.4, mocha + chai with jsdom, Rust (NAPI-RS, `cooklang-find` 0.8).

**Spec:** `docs/superpowers/specs/2026-09-25-recipe-hub-plugin-design.md`, section 2 and the Editor bullet of section 4.

---

## Working environment

- Work in the main checkout `/Users/alexeydubovskoy/Cooklang/editor` on the existing branch `feat/recipe-hub-plugin`. Before Task 1, confirm: `git -C /Users/alexeydubovskoy/Cooklang/editor branch --show-current` prints `feat/recipe-hub-plugin` and `git status --short` is empty.
- **Every** shell that compiles or tests needs Node 22 on `PATH`. The default `node` is 20, and on it mocha dies with `ERR_UNKNOWN_FILE_EXTENSION ... .css`. Start every shell with the line below. Do not install Node.

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/editor
```

- Compile one package: `npx tsc -b packages/cooklang-import` or `npx tsc -b packages/cooklang`.
- Run one spec: `(cd packages/<pkg> && npx mocha --config ../../configs/mocharc.yml lib/browser/<name>.spec.js)`.
- Run a package's specs: `npx lerna run test --scope @theia/<pkg>`.
- Lint: `npx lerna run lint --scope @theia/<pkg>`.
- Every new `.ts`/`.tsx` file starts with this licence header. The code blocks below leave it out, so add it to each new file:

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
```

- A browser spec that imports anything that pulls in `FileService`, `WorkspaceService` or `@theia/monaco` starts with the jsdom preamble **before any other import**. Never call `disableJSDOM()` in a new spec: mocha loads every spec first, so a teardown breaks sibling specs.

```ts
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}
```

- Cooklang frontmatter is **always YAML** (`---` fences). Never write the deprecated `>>` metadata syntax, in code or in test fixtures.
- Never make a `@postConstruct` method `async`: with Inversify 6.2.2 that breaks synchronous DI and the frontend with it.
- `.cook` checks go through the case-insensitive `CooklangUri.isRecipe`, never `uri.path.ext === '.cook'`.

## Decisions that differ from the spec (read before starting)

1. **`CooklangPluginApi.VERSION` is not bumped.** It is the integer `1`, not a semver, so it has no "minor" to bump. The shipped `shopping-list` plugin does `if (version !== SUPPORTED_API_VERSION)` with `SUPPORTED_API_VERSION = 1` and turns itself off on any other value, so a bump would break it. The new commands are additive. Plugins detect them with `vscode.commands.getCommands(true)`, which reaches the frontend `CommandRegistry` through `CommandRegistryMainImpl.$getCommands`. The API doc comment says this (Task 9).
2. **`saveDraft` gets its own command-id namespace (`CooklangImportApi`) in `@theia/cooklang-import`.** `@theia/cooklang-import` does not depend on `@theia/cooklang`, and adding that dependency just for one string would pull the whole preview, monaco and native stack into its dependency graph. The id keeps the public `cooklang.api.` prefix.
3. **There is no `cooklang.openPreview` command.** Spec §3.4 relies on one, and `RecipePreviewContribution.canHandle` returns `0` for every non-`file` URI on purpose, because `git:` and other schemes should keep opening in the text editor. Task 9 adds `cooklang.api.openPreview({ uri })`, a validated wrapper around `RecipePreviewContribution.open`. PR 3 must call that id.
4. **There is no CSP on the recipe preview.** It is a `ReactWidget` in the main renderer, not a webview, and nothing in `app/`, `packages/cooklang*` or `dev-packages/application-manager` sets `Content-Security-Policy` or `img-src`. `https:` `<img>` sources already load, and `image: https://…` already shows for local recipes: `cooklang-find`'s `title_image()` checks metadata first and `resolveImageUri` passes `http(s)` through. §2.3 therefore needs only the non-`file` path (Tasks 4 and 8), and no CSP change is made.
5. **Images for a remote recipe come from `cooklang-find`, not from TypeScript.** Following the "delegate to cooklang crates" rule, the new native `recipeImagesFromContent` wraps `RecipeEntry::from_content(..).title_image()`. For a non-`file` recipe the preview keeps only `http(s)` results, because a relative path has no folder to resolve against.
6. **"References render as plain text when they cannot be resolved" is implemented as "for non-`file` previews".** Resolving references is a workspace lookup (`findRecipePath`), so it cannot succeed for a remote recipe, and a click could open a same-named local recipe by mistake. Local previews keep their links, and an unresolved one still warns "Recipe not found" on click, as today. Pre-resolving every local reference at render time is out of scope.
7. **`PreviewOutletContext.path` becomes `''` for everything outside the workspace**, as the spec says, including a `file:` recipe opened from another folder. Until now it was the bare file name, which named a file that is not in the workspace. This affects the recipe preview, menu preview and report outlets. The shopping-list plugin then shows "Invalid arguments: `path` must be a non-empty string." instead of silently adding a wrong recipe. PR 3 should give its shopping-list entries `when: cooklangPreviewScheme == file` (spec §3.5).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/cooklang-import/src/browser/draft-name.ts` | modify | add `DraftName.isFrontmatterKey` and `DraftName.mergeFrontmatter` |
| `packages/cooklang-import/src/browser/draft-name.spec.ts` | modify | tests for both |
| `packages/cooklang-import/src/browser/draft-saver.ts` | modify | add `saveContent(cooklang, fallbackTitle, frontmatter)`; `saveRaw` delegates to it |
| `packages/cooklang-import/src/browser/test/draft-saver-fixture.ts` | create | `DraftSaverFixture`: a real `DraftSaver` over stubbed workspace, file and opener services |
| `packages/cooklang-import/src/browser/draft-saver.spec.ts` | create | `saveContent` tests |
| `packages/cooklang-import/src/browser/cooklang-import-api-contribution.ts` | create | `CooklangImportApi` ids + `CooklangImportApiContribution` (`cooklang.api.saveDraft`) |
| `packages/cooklang-import/src/browser/cooklang-import-api-contribution.spec.ts` | create | shape validation, delegation, frontmatter merge, no-workspace |
| `packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts` | modify | bind the contribution as a `CommandContribution` |
| `packages/cooklang-native/src/lib.rs` | modify | `recipeImagesFromContent` NAPI function + Rust tests |
| `packages/cooklang-native/index.js`, `index.d.ts` | regenerate | NAPI build output (tracked) |
| `packages/cooklang/src/common/cooklang-language-service.ts` | modify | `recipeImagesFromContent` on the RPC interface |
| `packages/cooklang/src/node/cooklang-language-service-impl.ts` | modify | pass-through to the native addon |
| `packages/cooklang/src/browser/cooklang-outlets.ts` | modify | `CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY` |
| `packages/cooklang/src/browser/cooklang-outlet-service.ts` | modify | optional `element` on `getItems`/`run`; `describe` returns `path: ''` outside the workspace |
| `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts` | modify | tests |
| `packages/cooklang/src/common/cooklang-outlet-context.ts` | modify | doc comments: `uri` keeps its scheme, `path` may be `''` |
| `packages/cooklang/src/browser/recipe-image-service.ts` | modify | `resolve` returns `undefined` for non-`file` URIs |
| `packages/cooklang/src/browser/recipe-image-service.spec.ts` | modify | test |
| `packages/cooklang/src/browser/recipe-preview-widget.tsx` | modify | scoped `cooklangPreviewScheme` key, outlet element, non-`file` images/watch/reference links |
| `packages/cooklang/src/browser/recipe-preview-widget.spec.ts` | create | widget tests for all of the above |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` | modify | `cooklang.api.openPreview`; API doc comment |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | modify | tests |

---

### Task 1: `DraftName.mergeFrontmatter`

**Files:**
- Modify: `packages/cooklang-import/src/browser/draft-name.ts`
- Test: `packages/cooklang-import/src/browser/draft-name.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `draft-name.spec.ts`, add these two `describe` blocks inside `describe('DraftName', …)`, right after the `ensureTitleFrontmatter` block:

```ts
    describe('isFrontmatterKey', () => {
        it('accepts plain YAML keys', () => {
            expect(DraftName.isFrontmatterKey('source')).to.equal(true);
            expect(DraftName.isFrontmatterKey('prep_time')).to.equal(true);
            expect(DraftName.isFrontmatterKey('source.url')).to.equal(true);
            expect(DraftName.isFrontmatterKey('_private-key2')).to.equal(true);
        });
        it('rejects keys that would need quoting or break the line', () => {
            expect(DraftName.isFrontmatterKey('')).to.equal(false);
            expect(DraftName.isFrontmatterKey('bad key')).to.equal(false);
            expect(DraftName.isFrontmatterKey('a\nb')).to.equal(false);
            expect(DraftName.isFrontmatterKey('a:b')).to.equal(false);
            expect(DraftName.isFrontmatterKey('2nd')).to.equal(false);
            expect(DraftName.isFrontmatterKey('>>')).to.equal(false);
        });
    });

    describe('mergeFrontmatter', () => {
        it('adds a key to an existing frontmatter before the closing fence', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: Pancakes\n---\nMix.', { source: 'https://example.com/p' }))
                .to.equal('---\ntitle: Pancakes\nsource: https://example.com/p\n---\nMix.');
        });
        it('never overwrites a key the recipe already has', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: P\nsource: mine\n---\nMix.', { source: 'https://x.example', servings: '2' }))
                .to.equal('---\ntitle: P\nsource: mine\nservings: 2\n---\nMix.');
        });
        it('creates a YAML frontmatter when there is none', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { source: 'https://example.com/p' }))
                .to.equal('---\nsource: https://example.com/p\n---\n\nMix.');
        });
        it('never writes the deprecated >> metadata syntax', () => {
            const merged = DraftName.mergeFrontmatter('Mix @eggs{2}.', { source: 'https://example.com/p', author: 'Ann' });
            expect(merged).to.not.contain('>>');
            expect(merged.startsWith('---\n')).to.equal(true);
        });
        it('normalizes CRLF content to LF when it adds keys', () => {
            expect(DraftName.mergeFrontmatter('---\r\ntitle: P\r\n---\r\nMix.', { author: 'Ann' }))
                .to.equal('---\ntitle: P\nauthor: Ann\n---\nMix.');
        });
        it('quotes values YAML would misread', () => {
            expect(DraftName.mergeFrontmatter('Mix.', {
                a: 'Pancakes: the best',
                b: 'yes',
                c: '#1 pick',
                d: 'https://example.com/p#top',
                e: '',
            })).to.equal('---\na: "Pancakes: the best"\nb: "yes"\nc: "#1 pick"\nd: "https://example.com/p#top"\ne: ""\n---\n\nMix.');
        });
        it('collapses newlines in values so they cannot inject frontmatter lines', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { note: 'line one\nservings: 99' }))
                .to.equal('---\nnote: "line one servings: 99"\n---\n\nMix.');
        });
        it('skips keys that are not plain YAML keys', () => {
            expect(DraftName.mergeFrontmatter('Mix.', { 'bad key': 'x', 'a\nb': 'y', '': 'z' })).to.equal('Mix.');
        });
        it('treats only top-level lines as existing keys', () => {
            expect(DraftName.mergeFrontmatter('---\ntags:\n  - source: x\n---\nMix.', { source: 'https://e.example' }))
                .to.equal('---\ntags:\n  - source: x\nsource: https://e.example\n---\nMix.');
        });
        it('leaves an unterminated frontmatter unchanged', () => {
            expect(DraftName.mergeFrontmatter('---\ntitle: P\nMix.', { source: 'x' })).to.equal('---\ntitle: P\nMix.');
        });
        it('returns the content unchanged when there is nothing to add', () => {
            const src = '---\r\ntitle: P\r\nsource: s\r\n---\r\nMix.';
            expect(DraftName.mergeFrontmatter(src, {})).to.equal(src);
            expect(DraftName.mergeFrontmatter(src, { source: 'other' })).to.equal(src);
        });
    });
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx tsc -b packages/cooklang-import
```

Expected: FAIL, with `error TS2339: Property 'isFrontmatterKey' does not exist on type 'typeof DraftName'` and the same for `mergeFrontmatter`.

- [ ] **Step 3: Implement**

In `draft-name.ts`, add these functions inside `export namespace DraftName`, right after `uniqueBaseName`:

```ts
    /**
     * Whether `key` can be written as a plain top-level YAML frontmatter key:
     * a letter or underscore, then letters, digits, `_`, `-` or `.`.
     */
    export function isFrontmatterKey(key: string): boolean {
        return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
    }

    /**
     * Adds `entries` to the recipe's YAML frontmatter, creating the block when
     * there is none. Keys the frontmatter already has are left alone (the
     * recipe's own values always win), and keys that are not plain YAML keys
     * are skipped. Values become single-line YAML scalars, double-quoted when
     * YAML would otherwise misread them. Never writes the deprecated `>>`
     * metadata syntax. An unterminated frontmatter is returned unchanged.
     */
    export function mergeFrontmatter(cooklang: string, entries: Record<string, string>): string {
        const additions = Object.entries(entries).filter(([key]) => isFrontmatterKey(key));
        if (additions.length === 0) {
            return cooklang;
        }
        const lines = cooklang.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return ['---', ...additions.map(([key, value]) => frontmatterLine(key, value)), '---', '', cooklang].join('\n');
        }
        const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
        if (end === -1) {
            return cooklang;
        }
        const existing = new Set<string>();
        for (const line of lines.slice(1, end)) {
            const match = line.match(/^([^\s#:][^:]*):/);
            if (match) {
                existing.add(match[1].trim());
            }
        }
        const missing = additions.filter(([key]) => !existing.has(key));
        if (missing.length === 0) {
            return cooklang;
        }
        return [
            ...lines.slice(0, end),
            ...missing.map(([key, value]) => frontmatterLine(key, value)),
            ...lines.slice(end),
        ].join('\n');
    }

    function frontmatterLine(key: string, value: string): string {
        return `${key}: ${yamlScalar(value)}`;
    }

    /**
     * A single-line YAML scalar for `value`. Whitespace, newlines included,
     * collapses to single spaces, since a newline would start a new frontmatter
     * line. Anything YAML would read as another type, a comment or a mapping is
     * double-quoted; JSON string syntax is valid YAML double-quoted syntax.
     */
    function yamlScalar(value: string): string {
        const single = sanitizeTitleValue(value);
        const plain = /^[A-Za-z0-9_(][^#]*$/.test(single)
            && !/:(\s|$)/.test(single)
            && !/^(true|false|yes|no|on|off|y|n|null)$/i.test(single);
        return plain ? single : JSON.stringify(single);
    }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang-import
(cd packages/cooklang-import && npx mocha --config ../../configs/mocharc.yml lib/browser/draft-name.spec.js)
```

Expected: PASS. The old `DraftName` tests pass too, and the new `isFrontmatterKey` and `mergeFrontmatter` tests show as passing.

- [ ] **Step 5: Lint**

```bash
npx lerna run lint --scope @theia/cooklang-import
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-import/src/browser/draft-name.ts packages/cooklang-import/src/browser/draft-name.spec.ts
git commit -m "feat(cooklang-import): DraftName.mergeFrontmatter adds YAML frontmatter keys without overwriting"
```

---

### Task 2: `DraftSaver.saveContent`

**Files:**
- Modify: `packages/cooklang-import/src/browser/draft-saver.ts`
- Create: `packages/cooklang-import/src/browser/test/draft-saver-fixture.ts`
- Test (create): `packages/cooklang-import/src/browser/draft-saver.spec.ts`

- [ ] **Step 1: Write the fixture**

Create `packages/cooklang-import/src/browser/test/draft-saver-fixture.ts` (licence header, then):

```ts
import URI from '@theia/core/lib/common/uri';
import { DraftSaver } from '../draft-saver';

/**
 * A real {@link DraftSaver} over stubbed workspace, file and opener services.
 * Importers must enable jsdom first: `DraftSaver` pulls in browser modules.
 */
export class DraftSaverFixture {

    /** File or folder URI string -> content written (`''` for folders). */
    readonly created = new Map<string, string>();
    /** URI strings opened after saving, in order. */
    readonly opened: string[] = [];
    readonly saver = new DraftSaver();

    constructor(roots: URI[], existing: string[] = []) {
        Object.assign(this.saver, {
            workspaceService: { roots: Promise.resolve(roots.map(resource => ({ resource }))) },
            fileService: {
                exists: async (uri: URI) => existing.includes(uri.toString()) || this.created.has(uri.toString()),
                createFolder: async (uri: URI) => { this.created.set(uri.toString(), ''); },
                create: async (uri: URI, content: string) => { this.created.set(uri.toString(), content); },
            },
            openerService: {
                getOpener: async (uri: URI) => ({
                    canHandle: () => 1,
                    open: async () => { this.opened.push(uri.toString()); },
                }),
            },
        });
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/cooklang-import/src/browser/draft-saver.spec.ts` (licence header, then):

```ts
// `DraftSaver` injects `FileService` and `WorkspaceService`, whose modules
// evaluate browser globals at require time. jsdom stays up for the whole run.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { DraftSaverFixture } from './test/draft-saver-fixture';

const ROOT = new URI('file:///Users/alex/Recipes');
const DRAFTS = ROOT.resolve('Drafts');

describe('DraftSaver.saveContent', () => {

    it('names the draft after the fallback title and adds the extra frontmatter', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const uri = await fixture.saver.saveContent('Mix @eggs{2}.', 'Pancakes', { source: 'https://example.com/p' });
        expect(uri.toString()).to.equal(DRAFTS.resolve('Pancakes.cook').toString());
        expect(fixture.created.get(uri.toString()))
            .to.equal('---\ntitle: Pancakes\nsource: https://example.com/p\n---\n\nMix @eggs{2}.');
        expect(fixture.opened).to.deep.equal([uri.toString()]);
    });

    it('keeps the recipe\'s own title and frontmatter values', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const cooklang = '---\ntitle: Grandma Pancakes\nsource: mine\n---\nMix.';
        const uri = await fixture.saver.saveContent(cooklang, 'Other', { source: 'https://x.example', servings: '2' });
        expect(uri.path.base).to.equal('Grandma Pancakes.cook');
        expect(fixture.created.get(uri.toString()))
            .to.equal('---\ntitle: Grandma Pancakes\nsource: mine\nservings: 2\n---\nMix.');
    });

    it('falls back to "Imported Recipe" when there is no title at all', async () => {
        const fixture = new DraftSaverFixture([ROOT]);
        const uri = await fixture.saver.saveContent('Mix.', undefined);
        expect(uri.path.base).to.equal('Imported Recipe.cook');
        expect(fixture.created.get(uri.toString())).to.equal('---\ntitle: Imported Recipe\n---\n\nMix.');
    });

    it('de-duplicates the file name', async () => {
        const fixture = new DraftSaverFixture([ROOT], [DRAFTS.toString(), DRAFTS.resolve('Pancakes.cook').toString()]);
        const uri = await fixture.saver.saveContent('Mix.', 'Pancakes');
        expect(uri.path.base).to.equal('Pancakes-2.cook');
    });

    it('rejects with the no-workspace message when no folder is open', async () => {
        const fixture = new DraftSaverFixture([]);
        let message: string | undefined;
        try {
            await fixture.saver.saveContent('Mix.', 'Pancakes');
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).to.equal('Open a folder before importing recipes.');
        expect(fixture.created.size).to.equal(0);
    });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
npx tsc -b packages/cooklang-import
```

Expected: FAIL with `error TS2339: Property 'saveContent' does not exist on type 'DraftSaver'`.

- [ ] **Step 4: Implement**

In `draft-saver.ts`, replace `saveRaw` and the first two lines of `writeDraft` (from `async saveRaw` through `protected async writeDraft(...): Promise<URI> {`) with:

```ts
    /**
     * Writes cooklang text that is already in hand — a `.cook` file opened from
     * outside the collection — into `<workspace root>/Drafts/`, de-duplicating the
     * name, and opens it. The recipe's own frontmatter title names the draft;
     * `suggestedTitle` (usually the source file's name) is the fallback.
     */
    async saveRaw(cooklang: string, suggestedTitle: string): Promise<URI> {
        return this.saveContent(cooklang, suggestedTitle);
    }

    /**
     * Writes cooklang text handed over by a plugin (`cooklang.api.saveDraft`) into
     * `<workspace root>/Drafts/` and opens it. The recipe's own frontmatter title
     * names the draft; `fallbackTitle` is used when it has none. `frontmatter`
     * entries are added to the YAML frontmatter only for keys the recipe does not
     * already have.
     */
    async saveContent(cooklang: string, fallbackTitle: string | undefined, frontmatter: Record<string, string> = {}): Promise<URI> {
        return this.writeDraft(cooklang, DraftName.resolveTitle(cooklang, undefined) ?? fallbackTitle, frontmatter);
    }

    protected async writeDraft(cooklang: string, suggestedTitle: string | undefined, frontmatter: Record<string, string> = {}): Promise<URI> {
```

Then, in `writeDraft`, replace

```ts
        const content = DraftName.ensureTitleFrontmatter(cooklang, title);
```

with

```ts
        const content = DraftName.mergeFrontmatter(DraftName.ensureTitleFrontmatter(cooklang, title), frontmatter);
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang-import
(cd packages/cooklang-import && npx mocha --config ../../configs/mocharc.yml lib/browser/draft-saver.spec.js lib/browser/external-recipe-contribution.spec.js)
```

Expected: PASS. The 5 new `DraftSaver.saveContent` tests pass, and so do the existing `ExternalRecipeContribution` and `DraftSaver.saveRaw` tests.

- [ ] **Step 6: Lint**

```bash
npx lerna run lint --scope @theia/cooklang-import
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-import/src/browser/draft-saver.ts packages/cooklang-import/src/browser/draft-saver.spec.ts packages/cooklang-import/src/browser/test/draft-saver-fixture.ts
git commit -m "feat(cooklang-import): DraftSaver.saveContent with fallback title and extra frontmatter"
```

---

### Task 3: `cooklang.api.saveDraft` command

**Files:**
- Create: `packages/cooklang-import/src/browser/cooklang-import-api-contribution.ts`
- Modify: `packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts`
- Test (create): `packages/cooklang-import/src/browser/cooklang-import-api-contribution.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `cooklang-import-api-contribution.spec.ts` (licence header, then):

```ts
// The contribution injects `DraftSaver`, which pulls in `FileService` and
// `WorkspaceService`; their modules need browser globals. jsdom stays up.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { CooklangImportApi, CooklangImportApiContribution } from './cooklang-import-api-contribution';
import { DraftSaver } from './draft-saver';
import { DraftSaverFixture } from './test/draft-saver-fixture';

const ROOT = new URI('file:///Users/alex/Recipes');
const SAVE_DRAFT = CooklangImportApi.Commands.SAVE_DRAFT;

interface Handler { execute: (...args: unknown[]) => unknown }

class ApiFixture {
    readonly handlers = new Map<string, Handler>();
    readonly labels = new Map<string, string | undefined>();
    /** `[content, fallbackTitle, frontmatter]` handed to `saveContent`. */
    readonly calls: Array<[string, string | undefined, Record<string, string>]> = [];

    constructor(saver?: DraftSaver) {
        const contribution = new CooklangImportApiContribution();
        const calls = this.calls;
        Object.assign(contribution, {
            draftSaver: saver ?? {
                saveContent: async (content: string, title: string | undefined, frontmatter: Record<string, string>) => {
                    calls.push([content, title, frontmatter]);
                    return ROOT.resolve(`Drafts/${title ?? 'Imported Recipe'}.cook`);
                },
            },
        });
        contribution.registerCommands({
            registerCommand: (command: { id: string; label?: string }, handler: Handler) => {
                this.handlers.set(command.id, handler);
                this.labels.set(command.id, command.label);
            },
        } as never);
    }

    async run(args: unknown): Promise<unknown> {
        return this.handlers.get(SAVE_DRAFT)!.execute(args);
    }

    async error(args: unknown): Promise<string> {
        try {
            await this.run(args);
        } catch (e) {
            return (e as Error).message;
        }
        throw new Error('saveDraft did not reject');
    }
}

describe('CooklangImportApiContribution', () => {

    it('registers cooklang.api.saveDraft without a label, so it stays out of the palette', () => {
        const fixture = new ApiFixture();
        expect(SAVE_DRAFT).to.equal('cooklang.api.saveDraft');
        expect([...fixture.handlers.keys()]).to.deep.equal([SAVE_DRAFT]);
        expect(fixture.labels.get(SAVE_DRAFT)).to.equal(undefined);
    });

    it('saves the draft and returns its URI as a string', async () => {
        const fixture = new ApiFixture();
        const result = await fixture.run({ version: 1, content: 'Mix.', title: 'Pancakes', frontmatter: { source: 'https://example.com/p' } });
        expect(result).to.equal(ROOT.resolve('Drafts/Pancakes.cook').toString());
        expect(fixture.calls).to.deep.equal([['Mix.', 'Pancakes', { source: 'https://example.com/p' }]]);
    });

    it('treats title and frontmatter as optional', async () => {
        const fixture = new ApiFixture();
        await fixture.run({ version: 1, content: 'Mix.' });
        expect(fixture.calls).to.deep.equal([['Mix.', undefined, {}]]);
    });

    it('rejects arguments of the wrong shape without saving', async () => {
        const fixture = new ApiFixture();
        const bad: unknown[] = [
            undefined,
            'Mix.',
            [],
            { content: 'Mix.' },
            { version: 2, content: 'Mix.' },
            { version: 1 },
            { version: 1, content: '   ' },
            { version: 1, content: 42 },
            { version: 1, content: 'Mix.', title: 5 },
            { version: 1, content: 'Mix.', frontmatter: 'source: x' },
            { version: 1, content: 'Mix.', frontmatter: ['x'] },
            { version: 1, content: 'Mix.', frontmatter: { source: 5 } },
            { version: 1, content: 'Mix.', frontmatter: { 'bad key': 'x' } },
            { version: 1, content: 'Mix.', frontmatter: { 'a\nb': 'x' } },
        ];
        for (const args of bad) {
            expect(await fixture.error(args), JSON.stringify(args)).to.match(/^Invalid arguments: /);
        }
        expect(fixture.calls).to.deep.equal([]);
    });

    it('merges frontmatter into the saved draft without overwriting the recipe\'s own keys', async () => {
        const saverFixture = new DraftSaverFixture([ROOT]);
        const fixture = new ApiFixture(saverFixture.saver);
        const result = await fixture.run({
            version: 1,
            content: '---\ntitle: Soup\nsource: mine\n---\nBoil @water{1%l}.',
            title: 'Ignored',
            frontmatter: { source: 'https://example.com/soup', author: 'Ann' },
        });
        expect(result).to.equal(ROOT.resolve('Drafts/Soup.cook').toString());
        expect(saverFixture.created.get(result as string))
            .to.equal('---\ntitle: Soup\nsource: mine\nauthor: Ann\n---\nBoil @water{1%l}.');
        expect(saverFixture.opened).to.deep.equal([result]);
    });

    it('rejects with the no-workspace message when no folder is open', async () => {
        const saverFixture = new DraftSaverFixture([]);
        const fixture = new ApiFixture(saverFixture.saver);
        expect(await fixture.error({ version: 1, content: 'Mix.' })).to.equal('Open a folder before importing recipes.');
        expect(saverFixture.created.size).to.equal(0);
    });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx tsc -b packages/cooklang-import
```

Expected: FAIL with `error TS2307: Cannot find module './cooklang-import-api-contribution'`.

- [ ] **Step 3: Implement the contribution**

Create `packages/cooklang-import/src/browser/cooklang-import-api-contribution.ts` (licence header, then):

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { DraftName } from './draft-name';
import { DraftSaver } from './draft-saver';

/**
 * The part of the public Cooklang plugin API that `@theia/cooklang-import`
 * owns. It follows the conventions of `CooklangPluginApi` in `@theia/cooklang`:
 * label-less commands, one plain-JSON argument, strict validation that rejects
 * with `Invalid arguments: …`.
 */
export namespace CooklangImportApi {
    export const Commands = {
        SAVE_DRAFT: 'cooklang.api.saveDraft',
    } as const;
}

/** Argument of `cooklang.api.saveDraft`. */
export interface SaveDraftArgs {
    version: 1;
    /** Cooklang text of the recipe. */
    content: string;
    /** Draft name when `content` has no frontmatter `title`. */
    title?: string;
    /** YAML frontmatter entries, added only for keys `content` does not already have. */
    frontmatter?: Record<string, string>;
}

/**
 * Registers `cooklang.api.saveDraft`: writes a plugin's recipe text to
 * `Drafts/<Title>.cook` (unique name, `title:` frontmatter), opens it, and
 * resolves to the saved file's URI string. Rejects with the no-workspace
 * message when no folder is open.
 */
@injectable()
export class CooklangImportApiContribution implements CommandContribution {

    @inject(DraftSaver)
    protected readonly draftSaver: DraftSaver;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: CooklangImportApi.Commands.SAVE_DRAFT }, {
            execute: (args: unknown) => this.saveDraft(args),
        });
    }

    protected async saveDraft(args: unknown): Promise<string> {
        const request = this.parseSaveDraftArgs(args);
        const uri = await this.draftSaver.saveContent(request.content, request.title, request.frontmatter ?? {});
        return uri.toString();
    }

    protected parseSaveDraftArgs(args: unknown): SaveDraftArgs {
        const request = this.object(args, 'expected a JSON object.');
        if (request.version !== 1) {
            throw this.invalid('`version` must be 1.');
        }
        const content = request.content;
        if (typeof content !== 'string' || content.trim() === '') {
            throw this.invalid('`content` must be a non-empty string.');
        }
        const title = request.title;
        if (title !== undefined && typeof title !== 'string') {
            throw this.invalid('`title` must be a string.');
        }
        return { version: 1, content, title, frontmatter: this.frontmatter(request.frontmatter) };
    }

    protected frontmatter(value: unknown): Record<string, string> {
        if (value === undefined) {
            return {};
        }
        const entries = this.object(value, '`frontmatter` must be an object of strings.');
        const result: Record<string, string> = {};
        for (const [key, entry] of Object.entries(entries)) {
            if (!DraftName.isFrontmatterKey(key)) {
                throw this.invalid(`frontmatter key ${JSON.stringify(key)} is not a plain YAML key.`);
            }
            if (typeof entry !== 'string') {
                throw this.invalid(`frontmatter value for \`${key}\` must be a string.`);
            }
            result[key] = entry;
        }
        return result;
    }

    protected object(value: unknown, detail: string): Record<string, unknown> {
        if (typeof value !== 'object' || value === undefined || value === null || Array.isArray(value)) { // eslint-disable-line no-null/no-null
            throw this.invalid(detail);
        }
        return value as Record<string, unknown>;
    }

    protected invalid(detail: string): Error {
        return new Error(`Invalid arguments: ${detail}`);
    }
}
```

- [ ] **Step 4: Bind it**

In `cooklang-import-frontend-module.ts`, add the imports next to the existing ones:

```ts
import { CommandContribution } from '@theia/core/lib/common/command';
import { CooklangImportApiContribution } from './cooklang-import-api-contribution';
```

and replace

```ts
    bind(DraftSaver).toSelf().inSingletonScope();
```

with

```ts
    bind(DraftSaver).toSelf().inSingletonScope();

    // `cooklang.api.saveDraft` for plugins, registered next to the saver it wraps.
    bind(CooklangImportApiContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CooklangImportApiContribution);
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang-import
(cd packages/cooklang-import && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-import-api-contribution.spec.js)
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole package and lint**

```bash
npx lerna run test --scope @theia/cooklang-import
npx lerna run lint --scope @theia/cooklang-import
```

Expected: all specs pass and lint reports no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-import/src/browser/cooklang-import-api-contribution.ts packages/cooklang-import/src/browser/cooklang-import-api-contribution.spec.ts packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts
git commit -m "feat(cooklang-import): cooklang.api.saveDraft plugin command"
```

---

### Task 4: native `recipeImagesFromContent`

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs`
- Regenerate: `packages/cooklang-native/index.js`, `packages/cooklang-native/index.d.ts`
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts`
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts`

- [ ] **Step 1: Write the failing Rust tests**

In `packages/cooklang-native/src/lib.rs`, add these tests at the end of `mod recipe_images_tests` (before its closing `}`):

```rust
    #[test]
    fn content_reports_the_metadata_image_verbatim() {
        let json = napi_recipe_images_from_content(
            "---\ntitle: Pancakes\nimage: https://cdn.example/p.jpg\n---\nMix @eggs{2}.\n".to_string(),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["title"], "https://cdn.example/p.jpg");
        assert_eq!(value["steps"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn content_takes_the_first_entry_of_an_images_list() {
        let json = napi_recipe_images_from_content(
            "---\nimages:\n  - https://cdn.example/a.jpg\n  - https://cdn.example/b.jpg\n---\nMix.\n".to_string(),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["title"], "https://cdn.example/a.jpg");
    }

    #[test]
    fn content_without_an_image_has_no_title_image() {
        let json = napi_recipe_images_from_content("Mix @eggs{2}.\n".to_string()).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["title"].is_null());
        assert_eq!(value["steps"].as_object().unwrap().len(), 0);
    }
```

- [ ] **Step 2: Run them and watch them fail**

```bash
(cd packages/cooklang-native && cargo test recipe_images_tests)
```

Expected: FAIL to compile with `error[E0425]: cannot find function `napi_recipe_images_from_content` in this scope`.

- [ ] **Step 3: Implement the NAPI function**

In `lib.rs`, directly after `napi_recipe_images`, add:

```rust
/// Title image for recipe text that has no file on disk, such as a recipe a
/// plugin serves from its own file system, using `cooklang-find`'s
/// content-based entry. Only metadata (`image:`, `images:`, `picture:`,
/// `pictures:`) can name an image, and it comes back verbatim. Same JSON shape
/// as `recipeImages`; `steps` is always empty.
#[napi(js_name = "recipeImagesFromContent")]
pub fn napi_recipe_images_from_content(content: String) -> napi::Result<String> {
    let entry = cooklang_find::RecipeEntry::from_content(content, None)
        .map_err(|e| napi::Error::from_reason(format!("recipeImagesFromContent: {e}")))?;
    let payload = serde_json::json!({
        "title": entry.title_image(),
        "steps": entry.step_images().images,
    });
    serde_json::to_string(&payload)
        .map_err(|e| napi::Error::from_reason(format!("recipeImagesFromContent serialize: {e}")))
}
```

- [ ] **Step 4: Run the Rust tests and watch them pass**

```bash
(cd packages/cooklang-native && cargo test recipe_images_tests)
```

Expected: PASS. The old `recipe_images_tests` tests and the 3 new `content_*` tests all pass.

- [ ] **Step 5: Rebuild the addon and its generated bindings**

```bash
(cd packages/cooklang-native && npm run build)
git diff --stat packages/cooklang-native/index.js packages/cooklang-native/index.d.ts
grep -n "recipeImagesFromContent" packages/cooklang-native/index.js packages/cooklang-native/index.d.ts
```

Expected: the build finishes after a few minutes and rewrites `cooklang-native.darwin-x64.node`, which is gitignored. `index.d.ts` gains `export declare function recipeImagesFromContent(content: string): string` with the doc comment, and `index.js` exports `recipeImagesFromContent`. If the diff also changes unrelated lines, stop and compare them with `git diff` before going on: they must be pure generator output.

- [ ] **Step 6: Add it to the RPC interface**

In `packages/cooklang/src/common/cooklang-language-service.ts`, directly after the `recipeImages(recipePath: string): Promise<string>;` declaration, add:

```ts

    /**
     * Title image for recipe *text*, for recipes that are not files on disk
     * (e.g. a `cooklang-hub:` recipe served by a plugin). Asks `cooklang-find`'s
     * content-based entry, so only frontmatter (`image:`, `images:`, `picture:`,
     * `pictures:`) can name one; the value is returned verbatim.
     *
     * Returns the same JSON shape as {@link recipeImages}; `steps` is always empty.
     */
    recipeImagesFromContent(content: string): Promise<string>;
```

- [ ] **Step 7: Implement it in the backend service**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`, directly after the `recipeImages` method, add:

```ts

    async recipeImagesFromContent(content: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.recipeImagesFromContent(content);
    }
```

- [ ] **Step 8: Compile**

```bash
npx tsc -b packages/cooklang
```

Expected: no errors. `CooklangLanguageServiceImpl` is the only implementer of the interface.

- [ ] **Step 9: Commit**

```bash
git add packages/cooklang-native/src/lib.rs packages/cooklang-native/index.js packages/cooklang-native/index.d.ts packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang-native): recipeImagesFromContent for recipes without a file on disk"
```

---

### Task 5: outlets take a scoping element; `path` is `''` outside the workspace

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-outlets.ts`
- Modify: `packages/cooklang/src/browser/cooklang-outlet-service.ts`
- Modify: `packages/cooklang/src/common/cooklang-outlet-context.ts`
- Test: `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `cooklang-outlet-service.spec.ts`, replace the test `'describes a resource with its URI and workspace-relative path'` with:

```ts
    it('describes a resource with its URI and workspace-relative path', () => {
        const service = new Fixture().create();
        expect(service.describe(new URI('file:///ws/Dinner/Soup.cook'))).to.deep.equal({ uri: 'file:///ws/Dinner/Soup.cook', path: 'Dinner/Soup.cook' });
    });

    it('describes a resource outside the workspace with an empty path', () => {
        const service = new Fixture().create();
        expect(service.describe(new URI('file:///elsewhere/Cake.cook'))).to.deep.equal({ uri: 'file:///elsewhere/Cake.cook', path: '' });
    });

    it('keeps the real scheme of a non-file resource and gives it an empty path', () => {
        const service = new Fixture().create();
        expect(service.describe(new URI('cooklang-hub:/recipes/12/Pancakes.cook')))
            .to.deep.equal({ uri: 'cooklang-hub:/recipes/12/Pancakes.cook', path: '' });
    });

    it('evaluates visibility against the element it is given', async () => {
        const fixture = new Fixture();
        const seen: unknown[] = [];
        fixture.root!.children = [{
            ...fixture.command('save', '1'),
            isVisible: (_path: MenuPath, _matcher: unknown, element: unknown) => {
                seen.push(element);
                return true;
            },
        }];
        const element = document.createElement('div');
        const service = fixture.create();
        expect(service.getItems(PATH, CONTEXT, element).map(item => item.id)).to.deep.equal(['save']);
        await service.run(PATH, 'save', CONTEXT, element);
        expect(seen).to.deep.equal([element, element]);
        expect(fixture.runs.map(run => run.id)).to.deep.equal(['save']);
    });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx tsc -b packages/cooklang
```

Expected: FAIL with `error TS2554: Expected 2 arguments, but got 3.` for `getItems` and `Expected 3 arguments, but got 4.` for `run`.

- [ ] **Step 3: Implement the element parameter and the empty path**

In `cooklang-outlet-service.ts`, replace the `getItems` and `run` methods with:

```ts
    /**
     * The outlet's visible entries. `element` scopes `when` clauses: context keys
     * set on it or on an ancestor (like the recipe preview's
     * `cooklangPreviewScheme`) apply. Without it, `when` clauses are evaluated
     * against the focused element.
     */
    getItems(menuPath: MenuPath, context: object, element?: HTMLElement): OutletItem[] {
        return this.visibleCommands(menuPath, context, element).map(node => {
            const item: OutletItem = { id: node.id, label: node.label };
            if (node.icon) {
                item.iconClass = node.icon;
            }
            return item;
        });
    }

    /** Runs one visible entry with `context`; `element` scopes `when` clauses as in {@link getItems}. */
    async run(menuPath: MenuPath, id: string, context: object, element?: HTMLElement): Promise<void> {
        const node = this.visibleCommands(menuPath, context, element).find(candidate => candidate.id === id);
        if (!node) {
            return;
        }
        try {
            await node.run(menuPath, context);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            console.error(`[cooklang] outlet command ${id} failed:`, e);
            this.messages.error(nls.localize('theia/cooklang/outletCommandFailed', '{0} failed: {1}', node.label, reason));
        }
    }
```

and replace `describe` with:

```ts
    /**
     * `uri` (with its real scheme) and workspace-relative `path` for an outlet
     * context. `path` is `''` when the resource is outside the workspace:
     * another folder, or a non-`file` URI such as `cooklang-hub:`.
     */
    describe(uri: URI): { uri: string; path: string } {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const relative = root && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        return { uri: uri.toString(), path: relative ?? '' };
    }
```

- [ ] **Step 4: Add the context key constant**

In `cooklang-outlets.ts`, add inside `export namespace CooklangOutlets`, right after `VERSION`:

```ts
    /**
     * Context key set on the recipe preview element to the scheme of the
     * recipe's URI: `file`, or e.g. `cooklang-hub` for a recipe served by a
     * plugin's file system. Outlet `when` clauses can target or exclude remote
     * previews, e.g. `"when": "cooklangPreviewScheme == file"`. Only the recipe
     * preview sets it; elsewhere it is undefined.
     */
    export const PREVIEW_SCHEME_CONTEXT_KEY = 'cooklangPreviewScheme';
```

- [ ] **Step 5: Update the context docs**

In `packages/cooklang/src/common/cooklang-outlet-context.ts`, replace the file-level comment block

```ts
/*
 * Contexts passed as the single argument to commands contributed to the
 * Cooklang outlets (see `CooklangOutlets`). Plain JSON so they cross the
 * plugin-host boundary unchanged. Version 1; later versions only add optional
 * fields. Paths are workspace-relative; URIs are `file://` strings.
 */
```

with

```ts
/*
 * Contexts passed as the single argument to commands contributed to the
 * Cooklang outlets (see `CooklangOutlets`). Plain JSON so they cross the
 * plugin-host boundary unchanged. Version 1; later versions only add optional
 * fields. Paths are workspace-relative, or `''` for a resource outside the
 * workspace (another folder, or a non-`file` URI such as `cooklang-hub:`).
 * URIs are strings that keep their real scheme.
 */
```

and, inside `PreviewOutletContext`, replace

```ts
    /** `file://` URI string of the recipe or menu. */
    uri: string;
    /** Workspace-relative path of the recipe or menu. */
    path: string;
```

with

```ts
    /** URI string of the recipe or menu, with its real scheme (`file:`, or e.g. `cooklang-hub:`). */
    uri: string;
    /** Workspace-relative path of the recipe or menu; `''` when it is outside the workspace. */
    path: string;
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-outlet-service.spec.js)
```

Expected: PASS, including the 4 new or rewritten tests.

- [ ] **Step 7: Lint**

```bash
npx lerna run lint --scope @theia/cooklang
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-outlets.ts packages/cooklang/src/browser/cooklang-outlet-service.ts packages/cooklang/src/browser/cooklang-outlet-service.spec.ts packages/cooklang/src/common/cooklang-outlet-context.ts
git commit -m "feat(cooklang): outlets evaluate when-clauses against a given element; empty path outside the workspace"
```

---

### Task 6: `RecipeImageService` reads local files only

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-image-service.ts`
- Test: `packages/cooklang/src/browser/recipe-image-service.spec.ts`

- [ ] **Step 1: Write the failing test**

In `recipe-image-service.spec.ts`, add inside `describe('RecipeImageService', …)`, after `'reads a local file and returns a blob URL'`:

```ts
    it('never reads an image through a non-file file system', async () => {
        const { service, files, created } = createService();
        const url = await service.resolve(new URI('cooklang-hub:/recipes/12/Pancakes.jpg'));
        expect(url).to.be.undefined;
        expect(files.reads).to.deep.equal([]);
        expect(created).to.deep.equal([]);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-image-service.spec.js)
```

Expected: FAIL on `never reads an image through a non-file file system` with `expected 'blob:fake/0' to be undefined`.

- [ ] **Step 3: Implement**

In `recipe-image-service.ts`, replace the `resolve` doc comment and the start of its body (from `/**` through `const type = …`) with:

```ts
    /**
     * A `blob:` URL for `uri`, or `undefined` when the file is missing,
     * unreadable, too large, not a supported image type, or not a local
     * (`file`) file. Recipes from other file systems (plugins such as the Recipe
     * Hub) have no sibling images, and their metadata images are remote URLs the
     * preview loads directly. Repeated calls for the same URI reuse one object
     * URL, and concurrent calls share one read.
     */
    resolve(uri: URI): Promise<string | undefined> {
        if (uri.scheme !== 'file') {
            return Promise.resolve(undefined);
        }
        const key = uri.toString();
        const inFlight = this.pending.get(key);
        if (inFlight) {
            return inFlight;
        }
        const type = RECIPE_IMAGE_MIME_TYPES[uri.path.ext.replace(/^\./, '').toLowerCase()];
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-image-service.spec.js)
```

Expected: PASS, all `RecipeImageService` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/recipe-image-service.ts packages/cooklang/src/browser/recipe-image-service.spec.ts
git commit -m "fix(cooklang): recipe image service reads local files only"
```

---

### Task 7: preview sets `cooklangPreviewScheme` and scopes its outlets to its element

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`
- Test (create): `packages/cooklang/src/browser/recipe-preview-widget.spec.ts`

- [ ] **Step 1: Write the harness and the failing tests**

Create `packages/cooklang/src/browser/recipe-preview-widget.spec.ts` (licence header, then):

```ts
/* eslint-disable no-null/no-null */

// The widget module imports `MonacoWorkspace` and `FileService`, which need
// browser globals at require time. jsdom stays up for the whole run.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { Recipe } from '../common/recipe-types';
import { ResolvedRecipeImages } from '../common/recipe-images';
import { CooklangOutletService, OutletItem } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { RecipePreviewWidget } from './recipe-preview-widget';

const ROOT = new URI('file:///ws');
const HUB = new URI('cooklang-hub:/recipes/12/Pancakes.cook');
const LOCAL = new URI('file:///ws/Breakfast/Pancakes.cook');
const CONTENT = 'Mix @eggs{2}.';
const REMOTE_IMAGE = 'https://cdn.example/pancakes.jpg';

/** One ingredient that references another recipe, so link rendering is observable. */
const RECIPE: Recipe = {
    metadata: { map: {} },
    sections: [{ name: null, content: [] }],
    ingredients: [{ name: 'Syrup', alias: null, quantity: null, note: null, reference: { name: 'Syrup', components: ['Sauces'] } }],
    cookware: [],
    timers: [],
    inline_quantities: [],
};

interface PreviewInternals {
    init(): void;
    render(): React.ReactNode;
    previewContext(): unknown;
    handleRunToolbarItem(id: string): void;
    recipe: Recipe | undefined;
    images: ResolvedRecipeImages;
}

/** Poll until `condition` holds; the preview parses asynchronously and exposes no promise. */
async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition(), 'condition never became true').to.be.true;
}

/** A real preview widget over stubbed services, recording what it asked them. */
class PreviewHarness {
    readonly contextValues = new Map<string, unknown>();
    scopedTarget: HTMLElement | undefined;
    readonly watched: string[] = [];
    readonly nativeImageLookups: string[] = [];
    readonly contentImageLookups: string[] = [];
    readonly imageReads: string[] = [];
    readonly itemElements: Array<HTMLElement | undefined> = [];
    readonly runElements: Array<HTMLElement | undefined> = [];
    /** What `recipeImagesFromContent` reports as the title image. */
    contentImage: string | undefined = REMOTE_IMAGE;
    readonly widget: RecipePreviewWidget;

    constructor() {
        const never = new Emitter<unknown>().event;
        const outlets = new CooklangOutletService();
        Object.assign(outlets, {
            menus: { getMenu: () => undefined },
            workspaceService: { tryGetRoots: () => [{ resource: ROOT }] },
            getItems: (_path: MenuPath, _context: object, element?: HTMLElement): OutletItem[] => {
                this.itemElements.push(element);
                return [];
            },
            run: async (_path: MenuPath, _id: string, _context: object, element?: HTMLElement): Promise<void> => {
                this.runElements.push(element);
            },
        });
        const widget = new RecipePreviewWidget();
        Object.assign(widget, {
            service: {
                parse: async () => JSON.stringify({ recipe: RECIPE, title: 'Pancakes', errors: [], warnings: [] }),
                recipeImages: async (path: string) => {
                    this.nativeImageLookups.push(path);
                    return JSON.stringify({ title: null, steps: {} });
                },
                recipeImagesFromContent: async (content: string) => {
                    this.contentImageLookups.push(content);
                    return JSON.stringify({ title: this.contentImage ?? null, steps: {} });
                },
            },
            monacoWorkspace: { onDidChangeTextDocument: never, onDidOpenTextDocument: never, getTextDocument: () => undefined },
            fileService: {
                watch: (uri: URI) => {
                    this.watched.push(uri.toString());
                    return Disposable.NULL;
                },
                onDidFilesChange: never,
                read: async () => ({ value: CONTENT }),
            },
            imageService: {
                resolve: async (uri: URI) => {
                    this.imageReads.push(uri.toString());
                    return 'blob:fake/0';
                },
                release: () => undefined,
                releaseAll: () => undefined,
            },
            timerService: { onDidChangeTimers: never, list: () => [] },
            outlets,
            contextKeyService: {
                createScoped: (target: HTMLElement) => {
                    this.scopedTarget = target;
                    return {
                        setContext: (key: string, value: unknown) => { this.contextValues.set(key, value); },
                        dispose: () => undefined,
                    };
                },
            },
            // Markup is asserted with renderToStaticMarkup; the widget's own async render is not needed.
            update: () => undefined,
        });
        (widget as unknown as PreviewInternals).init();
        this.widget = widget;
    }

    get internals(): PreviewInternals {
        return this.widget as unknown as PreviewInternals;
    }

    /** Bind the preview to `uri` and wait until it parsed and refreshed its images. */
    async open(uri: URI): Promise<void> {
        this.widget.setUri(uri);
        await until(() => this.internals.recipe !== undefined);
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    markup(): string {
        return renderToStaticMarkup(this.internals.render() as React.ReactElement);
    }
}

describe('RecipePreviewWidget context key and outlets', () => {

    it('sets cooklangPreviewScheme on the preview element to the source scheme', async () => {
        const hub = new PreviewHarness();
        await hub.open(HUB);
        expect(hub.scopedTarget).to.equal(hub.widget.node);
        expect(hub.contextValues.get(CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY)).to.equal('cooklang-hub');

        const local = new PreviewHarness();
        await local.open(LOCAL);
        expect(local.contextValues.get('cooklangPreviewScheme')).to.equal('file');
    });

    it('evaluates toolbar outlets against the preview element', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        harness.internals.render();
        harness.internals.handleRunToolbarItem('recipeHub.saveToDrafts');
        expect(harness.itemElements).to.deep.equal([harness.widget.node]);
        expect(harness.runElements).to.deep.equal([harness.widget.node]);
    });

    it('describes a remote recipe with its real URI and an empty path', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        expect(harness.internals.previewContext())
            .to.deep.equal({ version: 1, uri: 'cooklang-hub:/recipes/12/Pancakes.cook', path: '', scale: 1 });
    });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js)
```

Expected: FAIL on `sets cooklangPreviewScheme…` (`expected undefined to equal <div …>`) and on `evaluates toolbar outlets…` (`expected [ undefined ] to deeply equal [ <div …> ]`). `describes a remote recipe…` already passes after Task 5; it pins the wiring.

- [ ] **Step 3: Implement**

In `recipe-preview-widget.tsx`:

1. Add the import next to the other `@theia/core` imports:

```ts
import { ContextKeyService, ScopedValueStore } from '@theia/core/lib/browser/context-key-service';
```

2. Add this injection after the `outlets` injection:

```ts
    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;
```

3. Add these fields after `protected resolvedImageUris …`:

```ts
    /**
     * Context keys scoped to this preview's DOM node. Outlet `when` clauses are
     * evaluated against the node, so `cooklangPreviewScheme` applies to this
     * preview's toolbar and context menus only.
     */
    protected scopedContextKeys: ScopedValueStore | undefined;
```

4. In `init()`, after `this.node.tabIndex = 0;`, add:

```ts
        this.scopedContextKeys = this.contextKeyService.createScoped(this.node);
        this.toDispose.push(this.scopedContextKeys);
```

5. In `setUri`, directly after `this.uri = uri;`, add:

```ts
        this.scopedContextKeys?.setContext(CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY, uri.scheme);
```

6. Replace `handleRunToolbarItem` with:

```ts
    protected handleRunToolbarItem = (id: string): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.run(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, id, context, this.node);
        }
    };
```

7. In `render()`, replace

```ts
            const toolbarItems = context ? this.outlets.getItems(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, context) : [];
```

with

```ts
            const toolbarItems = context ? this.outlets.getItems(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, context, this.node) : [];
```

No change is needed for the ingredient context menu. `showContextMenu` already passes the clicked element, and monaco finds the scoped context on that element's ancestor, the preview node.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js)
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Lint**

```bash
npx lerna run lint --scope @theia/cooklang
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git commit -m "feat(cooklang): cooklangPreviewScheme context key scoped to the recipe preview"
```

---

### Task 8: preview for non-`file` recipes: remote image, no folder watch, plain-text references

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`
- Test: `packages/cooklang/src/browser/recipe-preview-widget.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `recipe-preview-widget.spec.ts`:

```ts
describe('RecipePreviewWidget for non-file recipes', () => {

    it('shows the metadata image of a remote recipe without touching the file system', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        expect(harness.internals.images.title).to.equal(REMOTE_IMAGE);
        expect(harness.contentImageLookups).to.deep.equal([CONTENT]);
        expect(harness.nativeImageLookups).to.deep.equal([]);
        expect(harness.watched).to.deep.equal([]);
        expect(harness.imageReads).to.deep.equal([]);
    });

    it('ignores a relative image path in a remote recipe', async () => {
        const harness = new PreviewHarness();
        harness.contentImage = 'Pancakes.jpg';
        await harness.open(HUB);
        expect(harness.contentImageLookups).to.deep.equal([CONTENT]);
        expect(harness.internals.images.title).to.be.undefined;
        expect(harness.imageReads).to.deep.equal([]);
    });

    it('keeps the on-disk image lookup and folder watch for local recipes', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        expect(harness.nativeImageLookups).to.include(LOCAL.path.fsPath());
        expect(harness.contentImageLookups).to.deep.equal([]);
        expect(harness.watched).to.deep.equal(['file:///ws/Breakfast']);
    });

    it('renders recipe references as plain text in a remote recipe', async () => {
        const harness = new PreviewHarness();
        await harness.open(HUB);
        const markup = harness.markup();
        expect(markup).to.contain('Syrup');
        expect(markup).to.not.contain('ingredient-ref-link');
    });

    it('keeps recipe reference links in a local recipe', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        expect(harness.markup()).to.contain('ingredient-ref-link');
    });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js)
```

Expected: 3 tests FAIL, `shows the metadata image…` (`expected undefined to equal 'https://cdn.example/pancakes.jpg'`), `ignores a relative image path…` (`contentImageLookups` is empty) and `renders recipe references as plain text…` (markup contains `ingredient-ref-link`). The two local-recipe tests pass; they guard against regressions.

- [ ] **Step 3: Implement**

In `recipe-preview-widget.tsx`:

1. Add this field after `scopedContextKeys`:

```ts
    /** The recipe text last parsed. A non-`file` recipe takes its images from it. */
    protected content: string | undefined;
```

2. Add this helper right after `hasOwnTimer()`:

```ts
    /**
     * Whether the recipe is a local file. Recipes from other file systems (a
     * plugin's `cooklang-hub:` provider, say) are read through `FileService` like
     * any other, but have no folder to find sibling images in or to watch, and
     * their recipe references cannot be resolved against the workspace.
     */
    protected hasLocalSource(): boolean {
        return this.uri?.scheme === 'file';
    }
```

3. In `parseContent`, make the first line of the body:

```ts
        this.content = content;
```

(before `const sequence = ++this.parseSequence;`).

4. In `watchImageFolder`, make the first lines of the body:

```ts
        if (!this.hasLocalSource()) {
            return;
        }
```

5. Replace the whole `refreshImages` method with the version below. It also adds a new `discoverImages` method:

```ts
    /**
     * Ask `cooklang-find` which images exist for this recipe and turn each one
     * into an `<img>` src. Guarded by `imageSequence` so a slow refresh cannot
     * overwrite a newer one.
     */
    protected async refreshImages(): Promise<void> {
        if (!this.uri) {
            return;
        }
        const sequence = ++this.imageSequence;
        const resolved: ResolvedRecipeImages = { steps: {} };
        const fileUris = new Set<string>();
        try {
            const discovered = await this.discoverImages();
            // Every entry is a `FileService` read over RPC, so they are flattened
            // and awaited together: a 20-image recipe should not pay for forty
            // sequential round-trips before anything renders.
            const entries: Array<{ section?: string; step?: string; raw: string }> = [];
            if (discovered?.title) {
                entries.push({ raw: discovered.title });
            }
            for (const [section, steps] of Object.entries(discovered?.steps ?? {})) {
                for (const [step, raw] of Object.entries(steps)) {
                    entries.push({ section, step, raw });
                }
            }
            await Promise.all(entries.map(async entry => {
                const src = await this.toImageSrc(entry.raw, fileUris);
                if (!src) {
                    return;
                }
                if (entry.section === undefined || entry.step === undefined) {
                    resolved.title = src;
                } else {
                    (resolved.steps[entry.section] ??= {})[entry.step] = src;
                }
            }));
        } catch (e) {
            // Usually harmless: no images, an unsaved file, or an unreadable
            // folder. But it also catches a native addon that predates
            // `recipeImages` and needs rebuilding, so say what happened.
            console.debug('Recipe image refresh failed', e);
        }
        if (this.isDisposed || sequence !== this.imageSequence) {
            return;
        }
        this.images = resolved;
        this.resolvedImageUris = fileUris;
        this.update();
    }

    /**
     * The recipe's images as `cooklang-find` reports them. A local recipe is
     * looked up on disk (metadata first, then sibling files). Any other recipe
     * has no folder, so only its metadata can name an image, which is read from
     * the parsed text; before the first parse there is nothing to report.
     */
    protected async discoverImages(): Promise<RecipeImages | undefined> {
        if (this.hasLocalSource()) {
            return JSON.parse(await this.service.recipeImages(this.uri.path.fsPath())) as RecipeImages;
        }
        if (this.content === undefined) {
            return undefined;
        }
        return JSON.parse(await this.service.recipeImagesFromContent(this.content)) as RecipeImages;
    }
```

6. In `toImageSrc`, replace

```ts
        if (location.kind === 'remote') {
            return location.url;
        }
```

with

```ts
        if (location.kind === 'remote') {
            return location.url;
        }
        // A non-`file` recipe has no folder: a relative or absolute path in its
        // metadata names nothing the preview may read.
        if (!this.hasLocalSource()) {
            return undefined;
        }
```

7. In `render()`, replace

```ts
                            onNavigateToRecipe={this.handleNavigateToRecipe}
```

with

```ts
                            onNavigateToRecipe={this.hasLocalSource() ? this.handleNavigateToRecipe : undefined}
```

Without a handler, `IngredientRow` already renders the reference name as plain text.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js lib/browser/recipe-preview-contribution.spec.js lib/browser/recipe-preview-links.spec.js lib/browser/recipe-preview-components.spec.js)
```

Expected: PASS, the 8 widget tests plus the existing preview specs.

- [ ] **Step 5: Lint**

```bash
npx lerna run lint --scope @theia/cooklang
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git commit -m "feat(cooklang): recipe preview for non-file URIs: metadata image, no folder watch, plain-text references"
```

---

### Task 9: `cooklang.api.openPreview` and the API doc comment

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `cooklang-plugin-api-contribution.spec.ts`:

1. In `class Fixture`, add after `keys: …`:

```ts
    opened: string[] = [];
```

2. In `create()`, add after the `(contribution as any).contextKeys = …` line:

```ts
        (contribution as any).recipePreview = { open: async (uri: URI) => { this.opened.push(uri.toString()); } };
```

3. Add these tests at the end of `describe('CooklangPluginApiContribution', …)`:

```ts
    it('opens the recipe preview for a .cook URI of any scheme', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(CooklangPluginApi.Commands.OPEN_PREVIEW, { uri: 'cooklang-hub:/recipes/12/Pancakes.cook' });
        await fixture.run(CooklangPluginApi.Commands.OPEN_PREVIEW, { uri: 'file:///ws/Dinner/SOUP.COOK' });
        expect(fixture.opened).to.deep.equal(['cooklang-hub:/recipes/12/Pancakes.cook', 'file:///ws/Dinner/SOUP.COOK']);
    });

    it('rejects anything but an absolute .cook URI', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.OPEN_PREVIEW;
        expect(await fixture.error(id, undefined)).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: '' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'Pancakes.cook' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'cooklang-hub:/recipes/12/notes.md' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { uri: 'cooklang-hub:/recipes/12/Pan\ncakes.cook' })).to.match(/^Invalid arguments/);
        expect(fixture.opened).to.deep.equal([]);
    });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx tsc -b packages/cooklang
```

Expected: FAIL with `error TS2339: Property 'OPEN_PREVIEW' does not exist on type '{ readonly VERSION: …`.

- [ ] **Step 3: Implement**

In `cooklang-plugin-api-contribution.ts`:

1. Add imports:

```ts
import { CooklangUri } from '../common/cooklang-uri';
import { RecipePreviewContribution } from './recipe-preview-contribution';
```

2. Replace the `CooklangPluginApi` doc comment and namespace with:

```ts
/**
 * The public Cooklang API for plugins: label-less commands (hidden from the
 * palette) that plugins call with `vscode.commands.executeCommand(id, args)`.
 * Arguments and results are plain JSON; paths are workspace-relative (absolute
 * paths and `file://` URIs inside the workspace are accepted). Version 1.
 * Changes are additive and leave `VERSION` alone, because plugins compare it
 * for equality; bump it only for a breaking change. Plugins detect commands
 * added later with `vscode.commands.getCommands(true)`.
 * `cooklang.api.saveDraft` belongs to this API too, but `@theia/cooklang-import`
 * registers it (`CooklangImportApi`), next to the `DraftSaver` it wraps.
 */
export namespace CooklangPluginApi {
    export const VERSION = 1;
    export const CONTEXT_KEY = 'cooklang.apiVersion';
    export const Commands = {
        VERSION: 'cooklang.api.version',
        GENERATE_SHOPPING_LIST: 'cooklang.api.generateShoppingList',
        RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
        PARSE_SHOPPING_LIST: 'cooklang.api.parseShoppingList',
        WRITE_SHOPPING_LIST: 'cooklang.api.writeShoppingList',
        PARSE_SHOPPING_CHECKED: 'cooklang.api.parseShoppingChecked',
        WRITE_SHOPPING_CHECKED: 'cooklang.api.writeShoppingChecked',
        COMPACT_SHOPPING_CHECKED: 'cooklang.api.compactShoppingChecked',
        /** `{ uri }`: open the recipe preview for a `.cook` URI of any scheme (e.g. `cooklang-hub:`). */
        OPEN_PREVIEW: 'cooklang.api.openPreview',
    } as const;
}
```

3. Add this injection after `contextKeys`:

```ts
    @inject(RecipePreviewContribution)
    protected readonly recipePreview: RecipePreviewContribution;
```

4. In `registerCommands`, add after the `COMPACT_SHOPPING_CHECKED` registration:

```ts
        registry.registerCommand({ id: Commands.OPEN_PREVIEW }, { execute: (args: unknown) => this.openPreview(args) });
```

5. Add this method after `compactShoppingChecked`:

```ts
    /**
     * Opens the recipe preview for any `.cook` URI whose scheme `FileService`
     * can read, such as a plugin's `FileSystemProvider`. The preview open
     * handler only claims `file` URIs on its own, so `git:` and other schemes
     * keep opening in the text editor; plugins ask for the preview explicitly.
     */
    protected async openPreview(args: unknown): Promise<void> {
        const raw = this.string(this.object(args).uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !CooklangUri.isRecipe(uri)) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe.');
        }
        await this.recipePreview.open(uri);
    }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx tsc -b packages/cooklang
(cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js)
```

Expected: PASS. That includes `registers every API command without a label` (it now also covers `OPEN_PREVIEW`) and the 2 new tests.

- [ ] **Step 5: Lint**

```bash
npx lerna run lint --scope @theia/cooklang
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.openPreview for recipes on plugin file systems"
```

---

### Task 10: full test and lint pass

**Files:** none changed. If anything fails, fix it in the files of the task that introduced it and commit the fix separately (`git commit -m "fix(<pkg>): <what>"`). Do not amend or rewrite earlier commits.

- [ ] **Step 1: Compile everything the app needs**

```bash
npm run compile
```

Expected: finishes without TypeScript errors.

- [ ] **Step 2: Run both packages' specs**

```bash
npx lerna run test --scope @theia/cooklang --scope @theia/cooklang-import
```

Expected: every spec passes. No `document is not defined`: new specs never call `disableJSDOM()`.

- [ ] **Step 3: Lint both packages**

```bash
npx lerna run lint --scope @theia/cooklang --scope @theia/cooklang-import
```

Expected: no errors.

- [ ] **Step 4: Rust tests**

```bash
(cd packages/cooklang-native && cargo test)
```

Expected: all tests pass.

---

### Task 11: manual verification in Electron

**Files:**
- Create, temporarily and never committed: `/Users/alexeydubovskoy/Cooklang/editor/plugins/zz-hub-smoke/extension/package.json` and `/Users/alexeydubovskoy/Cooklang/editor/plugins/zz-hub-smoke/extension/extension.js`. The root `plugins/` directory is gitignored, and `npm run start:electron` copies it into `app/plugins`.

The real Recipe Hub plugin only arrives in PR 3, so this smoke plugin stands in for it. It serves one read-only `cooklang-hub:` recipe, opens it with `cooklang.api.openPreview`, and puts a Save button on the preview toolbar that calls `cooklang.api.saveDraft`.

- [ ] **Step 1: Create the smoke plugin**

`plugins/zz-hub-smoke/extension/package.json`:

```json
{
  "name": "hub-smoke",
  "publisher": "cooklang-dev",
  "displayName": "Hub Smoke",
  "version": "0.0.1",
  "engines": { "vscode": "^1.50.0" },
  "main": "./extension.js",
  "activationEvents": ["onStartupFinished", "onFileSystem:cooklang-hub"],
  "contributes": {
    "commands": [
      { "command": "hubSmoke.open", "title": "Hub Smoke: Open Remote Recipe" },
      { "command": "hubSmoke.save", "title": "Hub Smoke: Save to Drafts", "icon": "$(save)" }
    ],
    "menus": {
      "cooklang/recipePreview/toolbar": [
        { "command": "hubSmoke.save", "group": "navigation@1", "when": "cooklangPreviewScheme == cooklang-hub" }
      ]
    }
  }
}
```

`plugins/zz-hub-smoke/extension/extension.js`:

```js
const vscode = require('vscode');

const RECIPE = [
    '---',
    'title: Smoke Pancakes',
    'image: https://cooklang.org/images/logo.png',
    'source: https://example.com/pancakes',
    '---',
    '',
    'Mix @flour{200%g} with @eggs{2} and @./Sauces/Syrup{}.',
    ''
].join('\n');

class HubFileSystem {
    constructor() {
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this.emitter.event;
    }
    watch() { return new vscode.Disposable(() => undefined); }
    stat() { return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: Buffer.byteLength(RECIPE) }; }
    readDirectory() { return []; }
    readFile() { return Buffer.from(RECIPE, 'utf8'); }
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    writeFile() { throw vscode.FileSystemError.NoPermissions(); }
    delete() { throw vscode.FileSystemError.NoPermissions(); }
    rename() { throw vscode.FileSystemError.NoPermissions(); }
}

exports.activate = context => {
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('cooklang-hub', new HubFileSystem(), { isReadonly: true }),
        vscode.commands.registerCommand('hubSmoke.open', () =>
            vscode.commands.executeCommand('cooklang.api.openPreview', { uri: 'cooklang-hub:/recipes/1/SmokePancakes.cook' })),
        vscode.commands.registerCommand('hubSmoke.save', async outlet => {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(outlet.uri));
            const saved = await vscode.commands.executeCommand('cooklang.api.saveDraft', {
                version: 1,
                content: Buffer.from(bytes).toString('utf8'),
                title: 'Smoke Pancakes',
                frontmatter: { source: 'https://example.org/other', author: 'Smoke Test' }
            });
            vscode.window.showInformationMessage(`Saved ${saved} (outlet path: "${outlet.path}")`);
        })
    );
};

exports.deactivate = () => undefined;
```

- [ ] **Step 2: Build and start**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/editor
npm run compile
(cd app && npm run bundle)
npm run start:electron
```

Expected: Cook Editor opens. Open a recipe collection folder if none is open.

- [ ] **Step 3: Check the remote preview**

Run **Hub Smoke: Open Remote Recipe** from the command palette. Check all of these:
- A preview tab titled `Preview: Smoke Pancakes` opens. It is an italic preview-mode tab, and no text editor opens.
- The hero image is the cooklang.org logo, loaded over `https:`.
- The ingredients list shows `flour 200 g`, `eggs 2` and `Syrup`. `Syrup` is plain text, with no link icon and no hover underline.
- The toolbar next to Scale shows the save icon, whose tooltip is `Hub Smoke: Save to Drafts`.
- DevTools (View → Toggle Developer Tools → Console, "Verbose" level on) show no `Recipe image refresh failed` message for this preview.

- [ ] **Step 4: Check the context key on local previews**

Open any local recipe's preview. The save icon must **not** be there. Any other toolbar plugin buttons (e.g. the shopping list's, if it is installed) still show. Click a recipe reference (`@./…`) in a local recipe: it still opens the referenced recipe.

- [ ] **Step 5: Check Save to Drafts**

Back on the Smoke Pancakes preview, click the save icon. Check all of these:
- `Drafts/Smoke Pancakes.cook` opens in the editor. If that name is taken, it is `Smoke Pancakes-2.cook`.
- Its frontmatter is YAML (`---` fences, no `>>` lines) and reads, in this order: `title: Smoke Pancakes`, `image: https://cooklang.org/images/logo.png`, `source: https://example.com/pancakes` (the recipe's own `source` survives, not `https://example.org/other`), then the added `author: Smoke Test`.
- The notification reads `Saved file:///…/Drafts/Smoke%20Pancakes.cook (outlet path: "")`. The empty path confirms `PreviewOutletContext.path` is `''` for the hub URI.

- [ ] **Step 6: Check the no-workspace error**

Run **File → Close Folder**, then **Hub Smoke: Open Remote Recipe** again and click the save icon. Expected: an error notification `Hub Smoke: Save to Drafts failed: Open a folder before importing recipes.` No file is written.

- [ ] **Step 7: Check that local recipe images still work**

Reopen the collection. On a local recipe with a sibling `Recipe.jpg`, the hero image still shows. On a local recipe with `image: https://…` in its frontmatter, the remote hero still shows.

- [ ] **Step 8: Remove the smoke plugin**

```bash
rm -rf /Users/alexeydubovskoy/Cooklang/editor/plugins/zz-hub-smoke /Users/alexeydubovskoy/Cooklang/editor/app/plugins/zz-hub-smoke
git -C /Users/alexeydubovskoy/Cooklang/editor status --short
```

Expected: `git status` shows no smoke-plugin files, since both directories are gitignored. Nothing is left to commit from this task.

---

## Self-review against spec section 2 and the section 4 Editor bullet

| Spec item | Where | Notes |
|---|---|---|
| 2.1 label-less `cooklang.api.saveDraft` next to `DraftSaver` in `packages/cooklang-import` | Task 3 | `CooklangImportApiContribution`, bound in the cooklang-import frontend module |
| 2.1 `SaveDraftArgs { version: 1; content; title?; frontmatter? }`, returns URI string | Task 3 | `saveDraft` returns `uri.toString()` |
| 2.1 validates shape and rejects with a clear error | Task 3 | `Invalid arguments: …`, 14 bad shapes tested |
| 2.1 delegates to `DraftSaver` (`Drafts/<Title>.cook`, unique name, `title:` frontmatter, opens) | Task 2 | `saveContent` reuses `writeDraft` |
| 2.1 `DraftName.mergeFrontmatter`, only keys not present, never `>>` | Task 1 | tested, including `not.contain('>>')` |
| 2.1 no workspace rejects with `theia/cooklang-import/noWorkspace` | Tasks 2, 3 | asserted through the real `DraftSaver` |
| 2.1 bump `CooklangPluginApi.VERSION` minor | Task 9 (doc) | **Deliberately not done.** See decision 1: `VERSION` is an integer and a bump breaks the shipped shopping-list plugin. Feature detection is via `getCommands`. |
| 2.2 preview loads non-`file` URIs through `FileService` | verified | `FileSystemMainImpl` registers plugin providers with the frontend `FileService`; `onFileSystem:<scheme>` activates the plugin. The widget already reads via `fileService.read`. |
| 2.2 audit `recipe-preview-widget.tsx` | Tasks 7, 8 | fixed: native disk lookup, folder watch, reference links, outlet element. Unchanged: title, timers and model listeners, which are scheme-agnostic. |
| 2.2 audit `recipe-preview-contribution.ts` | Task 9 | `canHandle` stays `file`-only on purpose (decision 3); `cooklang.api.openPreview` calls its `open`. `togglePreview` → `openSource` → `EditorManager.open` works for any `FileService` scheme and opens read-only. |
| 2.2 `PreviewOutletContext.path` is `''` outside the workspace, `uri` keeps its scheme, doc updated | Task 5 | also changes `file:` recipes outside the workspace (decision 7) |
| 2.2 `RecipeImageService`: no sibling lookup for non-`file` | Tasks 6, 8 | the sibling lookup was the widget's native call, skipped in Task 8; the service also refuses non-`file` reads |
| 2.2 references as plain text when unresolvable | Task 8 | for non-`file` previews (decision 6) |
| 2.3 remote `image:`/`images:` https fallback | Tasks 4, 8 | already worked for local recipes; non-`file` now works via `recipeImagesFromContent` (first entry of `images:`) |
| 2.3 preview CSP allows `https:` | verified, no change | no CSP exists on the preview (decision 4) |
| 2.4 `cooklangPreviewScheme` on the preview element | Tasks 5, 7 | scoped store on `widget.node`; outlets evaluated against the node |
| §4 saveDraft shape validation / merge without overwriting / no-workspace | Tasks 1–3 | |
| §4 `DraftName.mergeFrontmatter` | Task 1 | |
| §4 preview outlet context for a non-`file` URI | Tasks 5, 7 | |
| §4 context key value | Task 7 | `cooklang-hub` and `file` both asserted |
| gap: spec §3.4 needs a way to open a hub preview | Task 9 | `cooklang.api.openPreview`; PR 3 must use this id, not `cooklang.openPreview` |

Name consistency across tasks: `DraftName.isFrontmatterKey`, `DraftName.mergeFrontmatter`, `DraftSaver.saveContent`, `DraftSaverFixture`, `CooklangImportApi.Commands.SAVE_DRAFT`, `CooklangImportApiContribution`, `recipeImagesFromContent` (native, RPC and stubs), `CooklangOutlets.PREVIEW_SCHEME_CONTEXT_KEY`, `hasLocalSource`, `discoverImages`, `scopedContextKeys`, `CooklangPluginApi.Commands.OPEN_PREVIEW`.
