# Favourites Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in `cooklang.favourites` plugin: a heart button in the recipe preview, Explorer and palette commands, a Favourites view, all backed by a plain-text `.bookmarks` file at the workspace root.

**Architecture:** One small editor change exposes the preview's workspace-relative path as the `cooklangPreviewPath` context key. The plugin keeps the favourite list in `.bookmarks`, mirrors it into two context keys (`cooklang.favourites.paths`, `cooklang.favourites.uris`) so `when` clauses pick the outline or filled heart, and asks the editor to re-render open previews with `cooklang.api.refreshBadges`. All logic that does not need the `vscode` module lives in pure modules with mocha specs; `extension.ts` and the tree provider are thin wiring.

**Tech Stack:** Theia/VS Code extension API 1.100, TypeScript, mocha (plugin), mocha + chai (editor). Spec: `docs/superpowers/specs/2026-10-08-favourites-plugin-design.md`.

**Two repos:**
- Editor: `/Users/alexeydubovskoy/Cooklang/editor` (branch `feature/favourites-plugin`, already created). Tests need Node 22: prefix commands with `PATH=$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH`.
- Plugins: `/Users/alexeydubovskoy/Cooklang/plugins` (create branch `feature/favourites` from `main` in Task 2). Each plugin is its own npm package; nothing in the editor repo compiles plugin code.

**File map:**

| File | Responsibility |
|---|---|
| editor `packages/cooklang/src/browser/cooklang-outlets.ts` | `PREVIEW_PATH_CONTEXT_KEY` constant + doc |
| editor `packages/cooklang/src/browser/recipe-preview-widget.tsx` | sets the key in `setUri` |
| editor `packages/cooklang/src/browser/recipe-preview-widget.spec.ts` | two new specs |
| editor root `package.json` | `theiaPlugins` entry (Task 11) |
| plugins `favourites/package.json` | manifest: commands, menus, view, welcome |
| plugins `favourites/src/bookmarks.ts` (+spec) | pure `.bookmarks` text edits |
| plugins `favourites/src/favourites-store.ts` (+spec) | in-memory set, read-modify-write, change events; no `vscode` import |
| plugins `favourites/src/recipe-target.ts` (+spec) | command argument → recipe path; no `vscode` import |
| plugins `favourites/src/favourites-view-model.ts` (+spec) | sort + label/description for the tree; no `vscode` import |
| plugins `favourites/src/cooklang-api.ts` | typed wrapper for `cooklang.api.*` |
| plugins `favourites/src/context-sync.ts` | pushes context keys, refreshes previews |
| plugins `favourites/src/favourites-tree.ts` | `TreeDataProvider` |
| plugins `favourites/src/extension.ts` | activation, commands, toasts, watcher, rename/delete |
| plugins `favourites/media/*.svg` | heart icons |
| plugins `favourites/scripts/deploy.js`, `.vscodeignore`, `LICENSE`, `README.md`, `tsconfig.json` | boilerplate |
| plugins `README.md`, `.github/workflows/ci.yml` | table row, matrix entry |

---

### Task 1: Editor — `cooklangPreviewPath` context key

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-outlets.ts:26-34`
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx:212-215`
- Test: `packages/cooklang/src/browser/recipe-preview-widget.spec.ts:236-242`

- [ ] **Step 1: Write the failing specs**

In `recipe-preview-widget.spec.ts`, directly after the test `'updates cooklangPreviewScheme when the preview is re-bound to another URI'` (ends around line 241), add:

```ts
    it('sets cooklangPreviewPath on the preview element to the workspace-relative path', async () => {
        const local = new PreviewHarness();
        await local.open(LOCAL);
        expect(local.contextValues.get(CooklangOutlets.PREVIEW_PATH_CONTEXT_KEY)).to.equal('Breakfast/Pancakes.cook');

        const hub = new PreviewHarness();
        await hub.open(HUB);
        expect(hub.contextValues.get('cooklangPreviewPath')).to.equal('');
    });

    it('updates cooklangPreviewPath when the preview is re-bound to another URI', async () => {
        const harness = new PreviewHarness();
        await harness.open(LOCAL);
        harness.widget.setUri(HUB);
        expect(harness.contextValues.get(CooklangOutlets.PREVIEW_PATH_CONTEXT_KEY)).to.equal('');
    });
```

(`ROOT` in that spec is `file:///ws` and `LOCAL` is `file:///ws/Breakfast/Pancakes.cook`, so the relative path is `Breakfast/Pancakes.cook`. The harness builds a real `CooklangOutletService` whose `workspaceService.tryGetRoots` returns `ROOT`, so `describe()` works unmocked.)

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
export PATH=$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH
npx lerna run compile --scope @theia/cooklang
```
Expected: compile FAILS with `Property 'PREVIEW_PATH_CONTEXT_KEY' does not exist on type 'typeof CooklangOutlets'`.

- [ ] **Step 3: Add the constant**

In `cooklang-outlets.ts`, after `PREVIEW_SCHEME_CONTEXT_KEY` (line 34) add:

```ts
    /**
     * Context key set on the recipe preview element to the recipe's
     * workspace-relative path with `/` separators (the same string as
     * `PreviewOutletContext.path`), or `''` for a recipe outside the
     * workspace or with a non-`file` scheme. Lets a plugin that publishes a
     * list of paths with `setContext` pick a toolbar command per recipe, e.g.
     * `"when": "cooklangPreviewPath in myPlugin.markedPaths"`. Only the recipe
     * preview sets it; elsewhere it is undefined.
     */
    export const PREVIEW_PATH_CONTEXT_KEY = 'cooklangPreviewPath';
```

- [ ] **Step 4: Set the key in `setUri`**

In `recipe-preview-widget.tsx`, `setUri` (around line 212), after the `PREVIEW_SCHEME_CONTEXT_KEY` line add:

```ts
        this.scopedContextKeys?.setContext(CooklangOutlets.PREVIEW_PATH_CONTEXT_KEY, this.outlets.describe(uri).path);
```

Also update the `scopedContextKeys` doc comment (around line 120) to mention both keys:

```ts
    /**
     * Context keys scoped to this preview's DOM node. Outlet `when` clauses are
     * evaluated against the node, so `cooklangPreviewScheme` and
     * `cooklangPreviewPath` apply to this preview's toolbar and context menus only.
     */
```

- [ ] **Step 5: Compile and run the package tests**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
export PATH=$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH
npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang
```
Expected: compile OK; mocha output includes the two new tests passing and no failures.

- [ ] **Step 6: Lint and commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
npx eslint packages/cooklang/src/browser/cooklang-outlets.ts packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git add packages/cooklang/src/browser/cooklang-outlets.ts packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git commit -m "feat(cooklang): cooklangPreviewPath context key on the recipe preview"
```

---

### Task 2: Plugin scaffold

**Files (all under `/Users/alexeydubovskoy/Cooklang/plugins/favourites/`):**
- Create: `package.json`, `tsconfig.json`, `.vscodeignore`, `LICENSE`, `scripts/deploy.js`, `media/heart-light.svg`, `media/heart-dark.svg`, `media/heart-filled.svg`, `src/extension.ts` (placeholder that compiles)

- [ ] **Step 1: Branch the plugins repo**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git checkout main && git pull --ff-only && git checkout -b feature/favourites
mkdir -p favourites/src favourites/media favourites/scripts
```

- [ ] **Step 2: Write `package.json`** (contributions are filled in Task 9; this is the compile-able minimum)

```json
{
  "name": "favourites",
  "displayName": "Favourites",
  "description": "Heart on recipe previews and a Favourites view, stored in a plain-text .bookmarks file. Ships with Cook Editor.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "favourites" },
  "keywords": ["cooklang", "favourites", "bookmarks", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {},
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -w -p .",
    "test": "tsc -p . && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js",
    "vscode:prepublish": "npm run compile",
    "package": "vsce package --no-dependencies",
    "publish:marketplace": "ovsx publish --packagePath favourites-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^22.20.4",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^4.0.0",
    "mocha": "^12.0.2",
    "ovsx": "^1.0.0",
    "typescript": "~7.0.2"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "mocha"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `.vscodeignore`, `LICENSE`, `scripts/deploy.js`**

`.vscodeignore`:
```
src/**
scripts/**
tsconfig.json
package-lock.json
.vscodeignore
out/**/*.spec.js
out/**/*.map
**/.DS_Store
```

`LICENSE`: copy `../corevitals/LICENSE` verbatim (`cp ../corevitals/LICENSE LICENSE`).

`scripts/deploy.js`:
```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.favourites');

// Skips test specs and source maps, which the packaged plugin doesn't need.
const skipTestArtifacts = src => !/\.spec\.js$|\.map$/.test(src);

const required = ['package.json', 'out', 'media', 'LICENSE'];
const optional = ['README.md'];

for (const entry of required) {
    if (!fs.existsSync(path.join(root, entry))) {
        throw new Error(`Missing ${entry}${entry === 'out' ? '; run npm run compile first' : ''}`);
    }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of [...required, ...optional]) {
    if (!fs.existsSync(path.join(root, entry))) {
        continue;
    }
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: skipTestArtifacts });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 5: Write the icons**

`media/heart-light.svg` (outline for light themes):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#424242" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
```

`media/heart-dark.svg` (outline for dark themes):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C5C5C5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
```

`media/heart-filled.svg` (brand orange `#e15a29`, the editor's `activityBar.activeBorder`; one file for both themes):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#e15a29" stroke="#e15a29" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
```

- [ ] **Step 6: Placeholder `src/extension.ts`** (replaced in Task 8)

```ts
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    context.subscriptions.push(vscode.window.createOutputChannel('Favourites'));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 7: Install and compile**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites
npm install
npm run compile && ls out
```
Expected: `out/extension.js` exists, no errors. `npm test` at this point fails with `No test files found` — that is expected until Task 3.

- [ ] **Step 8: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/package.json favourites/package-lock.json favourites/tsconfig.json favourites/.vscodeignore favourites/LICENSE favourites/scripts/deploy.js favourites/media favourites/src/extension.ts
git commit -m "feat(favourites): scaffold the Favourites plugin"
```

(`node_modules` and `out` are ignored by the repo's root `.gitignore`; check with `git status --short` that neither shows up. If they do, add them to `favourites/.gitignore`.)

---

### Task 3: `bookmarks.ts` — pure file edits

**Files:**
- Create: `favourites/src/bookmarks.ts`
- Test: `favourites/src/bookmarks.spec.ts`

- [ ] **Step 1: Write the failing spec**

`src/bookmarks.spec.ts`:
```ts
import * as assert from 'assert';
import { add, normalizePath, parse, remove, removePrefix, rename, renamePrefix } from './bookmarks';

describe('bookmarks', () => {

    describe('normalizePath', () => {
        it('trims, uses forward slashes and drops a leading ./', () => {
            assert.strictEqual(normalizePath('  .\\Breakfast\\Pancakes.cook \n'), 'Breakfast/Pancakes.cook');
            assert.strictEqual(normalizePath('././a.cook'), 'a.cook');
        });
    });

    describe('parse', () => {
        it('returns one path per non-blank, non-comment line, deduplicated in order', () => {
            const text = '# favourites\n\nBreakfast/Pancakes.cook\n  # indented comment\r\n./Dinner/Soup.cook\nBreakfast\\Pancakes.cook\n';
            assert.deepStrictEqual(parse(text), ['Breakfast/Pancakes.cook', 'Dinner/Soup.cook']);
        });

        it('returns [] for empty text', () => {
            assert.deepStrictEqual(parse(''), []);
        });
    });

    describe('add', () => {
        it('appends as the last line with a trailing newline', () => {
            assert.strictEqual(add('# mine\na.cook\n', 'b.cook'), '# mine\na.cook\nb.cook\n');
        });

        it('starts a file from empty text', () => {
            assert.strictEqual(add('', 'a.cook'), 'a.cook\n');
        });

        it('adds a trailing newline to text that lacks one', () => {
            assert.strictEqual(add('a.cook', 'b.cook'), 'a.cook\nb.cook\n');
        });

        it('is a no-op when the path is already listed', () => {
            assert.strictEqual(add('a.cook\n', './a.cook'), 'a.cook\n');
        });
    });

    describe('remove', () => {
        it('deletes every matching line and keeps comments and order', () => {
            assert.strictEqual(remove('# c\na.cook\nb.cook\na.cook\n', 'a.cook'), '# c\nb.cook\n');
        });

        it('leaves text without the path untouched', () => {
            assert.strictEqual(remove('a.cook\n', 'b.cook'), 'a.cook\n');
        });

        it('returns empty text when the last entry goes', () => {
            assert.strictEqual(remove('a.cook\n', 'a.cook'), '');
        });
    });

    describe('rename', () => {
        it('rewrites the matching line in place', () => {
            assert.strictEqual(rename('a.cook\n# c\nb.cook\n', 'b.cook', 'Dinner/b.cook'), 'a.cook\n# c\nDinner/b.cook\n');
        });

        it('drops the old line when the target is already listed', () => {
            assert.strictEqual(rename('a.cook\nb.cook\n', 'b.cook', 'a.cook'), 'a.cook\n');
        });
    });

    describe('renamePrefix', () => {
        it('moves every entry under the folder', () => {
            assert.strictEqual(
                renamePrefix('Old/a.cook\nOld/Sub/b.cook\nOlder/c.cook\n', 'Old', 'New'),
                'New/a.cook\nNew/Sub/b.cook\nOlder/c.cook\n');
        });

        it('accepts a trailing slash on the folders', () => {
            assert.strictEqual(renamePrefix('Old/a.cook\n', 'Old/', 'New/'), 'New/a.cook\n');
        });
    });

    describe('removePrefix', () => {
        it('drops every entry under the folder but not look-alike folders', () => {
            assert.strictEqual(removePrefix('Old/a.cook\nOlder/c.cook\n# keep\n', 'Old'), 'Older/c.cook\n# keep\n');
        });
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: `tsc` fails with `Cannot find module './bookmarks'`.

- [ ] **Step 3: Implement `src/bookmarks.ts`**

```ts
// Pure edits of the `.bookmarks` text: one workspace-relative recipe path per
// line, `#` comments, blank lines. Free of the `vscode` import so it can be
// unit-tested. Comments, blank lines and the order of untouched lines survive
// every edit; output always uses LF and ends with a newline (or is empty).

/** Trims, turns `\` into `/` and drops leading `./` segments. */
export function normalizePath(raw: string): string {
    let path = raw.trim().replace(/\\/g, '/');
    while (path.startsWith('./')) {
        path = path.slice(2);
    }
    return path;
}

/** The favourite a line names, or `undefined` for blank and comment lines. */
function entryOf(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
        return undefined;
    }
    return normalizePath(trimmed);
}

function splitLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function joinLines(lines: readonly string[]): string {
    return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

/** Drops later lines naming a favourite an earlier line already names. */
function dedupe(lines: readonly string[]): string[] {
    const seen = new Set<string>();
    return lines.filter(line => {
        const entry = entryOf(line);
        if (entry === undefined) {
            return true;
        }
        if (seen.has(entry)) {
            return false;
        }
        seen.add(entry);
        return true;
    });
}

function folderPrefix(dir: string): string {
    return normalizePath(dir).replace(/\/+$/, '') + '/';
}

/** The favourites the text lists, normalised, in file order, without duplicates. */
export function parse(text: string): string[] {
    const out: string[] = [];
    for (const line of dedupe(splitLines(text))) {
        const entry = entryOf(line);
        if (entry !== undefined) {
            out.push(entry);
        }
    }
    return out;
}

export function add(text: string, path: string): string {
    const entry = normalizePath(path);
    if (parse(text).includes(entry)) {
        return text;
    }
    return joinLines([...splitLines(text), entry]);
}

export function remove(text: string, path: string): string {
    const entry = normalizePath(path);
    return joinLines(splitLines(text).filter(line => entryOf(line) !== entry));
}

export function rename(text: string, from: string, to: string): string {
    const source = normalizePath(from);
    const target = normalizePath(to);
    return joinLines(dedupe(splitLines(text).map(line => entryOf(line) === source ? target : line)));
}

/** Rewrites every favourite under `fromDir/` to live under `toDir/`. */
export function renamePrefix(text: string, fromDir: string, toDir: string): string {
    const source = folderPrefix(fromDir);
    const target = folderPrefix(toDir);
    return joinLines(dedupe(splitLines(text).map(line => {
        const entry = entryOf(line);
        return entry !== undefined && entry.startsWith(source) ? target + entry.slice(source.length) : line;
    })));
}

/** Drops every favourite under `dir/`. */
export function removePrefix(text: string, dir: string): string {
    const source = folderPrefix(dir);
    return joinLines(splitLines(text).filter(line => {
        const entry = entryOf(line);
        return entry === undefined || !entry.startsWith(source);
    }));
}
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: all `bookmarks` tests pass (15 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/bookmarks.ts favourites/src/bookmarks.spec.ts
git commit -m "feat(favourites): .bookmarks text parsing and edits"
```

---

### Task 4: `favourites-store.ts` — set, file, events

**Files:**
- Create: `favourites/src/favourites-store.ts`
- Test: `favourites/src/favourites-store.spec.ts`

- [ ] **Step 1: Write the failing spec**

`src/favourites-store.spec.ts`:
```ts
import * as assert from 'assert';
import { BookmarksFile, FavouritesStore, NoWorkspaceError } from './favourites-store';

/** An in-memory `.bookmarks`; `text === undefined` means the file does not exist. */
class FakeFile implements BookmarksFile {
    writes: string[] = [];
    constructor(public text: string | undefined) { }
    async read(): Promise<string | undefined> {
        return this.text;
    }
    async write(text: string): Promise<void> {
        this.writes.push(text);
        this.text = text;
    }
}

describe('FavouritesStore', () => {

    async function storeWith(text: string | undefined): Promise<{ store: FavouritesStore; file: FakeFile; changes: number[] }> {
        const store = new FavouritesStore();
        const file = new FakeFile(text);
        const changes: number[] = [];
        store.onDidChange(() => changes.push(store.paths().length));
        await store.setFile(file);
        return { store, file, changes };
    }

    it('starts empty when the file does not exist and does not create it', async () => {
        const { store, file } = await storeWith(undefined);
        assert.deepStrictEqual(store.paths(), []);
        assert.deepStrictEqual(file.writes, []);
    });

    it('loads the file and fires a change for the initial load', async () => {
        const { store, changes } = await storeWith('a.cook\n# c\nb.cook\n');
        assert.deepStrictEqual(store.paths(), ['a.cook', 'b.cook']);
        assert.strictEqual(store.has('b.cook'), true);
        assert.deepStrictEqual(changes, [2]);
    });

    it('add creates the file and reports whether anything changed', async () => {
        const { store, file } = await storeWith(undefined);
        assert.strictEqual(await store.add('a.cook'), true);
        assert.strictEqual(await store.add('a.cook'), false);
        assert.deepStrictEqual(file.writes, ['a.cook\n']);
        assert.deepStrictEqual(store.paths(), ['a.cook']);
    });

    it('remove reports whether anything changed', async () => {
        const { store } = await storeWith('a.cook\n');
        assert.strictEqual(await store.remove('b.cook'), false);
        assert.strictEqual(await store.remove('a.cook'), true);
        assert.deepStrictEqual(store.paths(), []);
    });

    it('toggle returns the new state', async () => {
        const { store } = await storeWith('');
        assert.strictEqual(await store.toggle('a.cook'), true);
        assert.strictEqual(await store.toggle('a.cook'), false);
        assert.deepStrictEqual(store.paths(), []);
    });

    it('keeps edits made to the file between two operations (read-modify-write)', async () => {
        const { store, file } = await storeWith('a.cook\n');
        file.text = 'a.cook\nexternal.cook\n';
        await store.add('b.cook');
        assert.strictEqual(file.text, 'a.cook\nexternal.cook\nb.cook\n');
        assert.deepStrictEqual(store.paths(), ['a.cook', 'external.cook', 'b.cook']);
    });

    it('serialises concurrent mutations', async () => {
        const { store, file } = await storeWith('');
        await Promise.all([store.add('a.cook'), store.add('b.cook'), store.remove('a.cook')]);
        assert.strictEqual(file.text, 'b.cook\n');
    });

    it('reload fires a change only when the list differs', async () => {
        const { store, file, changes } = await storeWith('a.cook\n');
        await store.reload();
        file.text = '# comment added\na.cook\n';
        await store.reload();
        file.text = 'a.cook\nb.cook\n';
        await store.reload();
        assert.deepStrictEqual(changes, [1, 2]);
    });

    it('applyRenames renames files, moves folders and drops a rename to a non-recipe', async () => {
        const { store, file } = await storeWith('a.cook\nOld/b.cook\nOld/Sub/c.cook\nd.cook\n');
        await store.applyRenames([
            { from: 'a.cook', to: 'Dinner/a.cook' },
            { from: 'Old', to: 'New' },
            { from: 'd.cook', to: 'd.txt' },
        ]);
        assert.strictEqual(file.text, 'Dinner/a.cook\nNew/b.cook\nNew/Sub/c.cook\n');
    });

    it('applyDeletes removes files and folder contents', async () => {
        const { store, file } = await storeWith('a.cook\nOld/b.cook\nOlder/c.cook\n');
        await store.applyDeletes(['a.cook', 'Old']);
        assert.strictEqual(file.text, 'Older/c.cook\n');
    });

    it('empty rename and delete lists do not touch the file', async () => {
        const { store, file } = await storeWith('a.cook\n');
        await store.applyRenames([]);
        await store.applyDeletes([]);
        assert.deepStrictEqual(file.writes, []);
    });

    it('rejects mutations without a workspace', async () => {
        const store = new FavouritesStore();
        await assert.rejects(store.add('a.cook'), NoWorkspaceError);
        assert.strictEqual(store.hasWorkspace(), false);
    });

    it('setFile(undefined) clears the list', async () => {
        const { store, changes } = await storeWith('a.cook\n');
        await store.setFile(undefined);
        assert.deepStrictEqual(store.paths(), []);
        assert.deepStrictEqual(changes, [1, 0]);
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: `tsc` fails with `Cannot find module './favourites-store'`.

- [ ] **Step 3: Implement `src/favourites-store.ts`**

```ts
// The favourite list and its `.bookmarks` file. Free of the `vscode` import
// so it can be unit-tested; extension.ts supplies a `BookmarksFile` backed by
// `workspace.fs` and calls `reload()` from a file watcher.
import * as bookmarks from './bookmarks';

export const BOOKMARKS_FILE = '.bookmarks';

export class NoWorkspaceError extends Error {
    constructor() {
        super('Open a recipe folder to use favourites.');
        this.name = 'NoWorkspaceError';
    }
}

/** The `.bookmarks` file of the current workspace root. */
export interface BookmarksFile {
    /** The file text, or `undefined` when the file does not exist. */
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
}

export interface Disposable {
    dispose(): void;
}

export interface Rename {
    from: string;
    to: string;
}

function isRecipePath(path: string): boolean {
    return /\.cook$/i.test(path);
}

export class FavouritesStore {

    private file: BookmarksFile | undefined;
    private current: readonly string[] = [];
    private readonly listeners = new Set<() => void>();
    /** Mutations run one after another so two quick toggles cannot race on the file. */
    private queue: Promise<unknown> = Promise.resolve();

    onDidChange(listener: () => void): Disposable {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    /** Normalised workspace-relative paths in file order. */
    paths(): readonly string[] {
        return this.current;
    }

    has(path: string): boolean {
        return this.current.includes(bookmarks.normalizePath(path));
    }

    hasWorkspace(): boolean {
        return this.file !== undefined;
    }

    /** Switches to another workspace root's file (or none) and reloads. */
    async setFile(file: BookmarksFile | undefined): Promise<void> {
        this.file = file;
        await this.reload();
    }

    /** Re-reads the file; fires `onDidChange` only when the list differs. */
    async reload(): Promise<void> {
        await this.enqueue(async () => {
            const text = this.file ? await this.file.read() : undefined;
            this.setCurrent(bookmarks.parse(text ?? ''));
        });
    }

    /** True when the path was not a favourite before. */
    add(path: string): Promise<boolean> {
        return this.mutate(text => bookmarks.add(text, path));
    }

    /** True when the path was a favourite before. */
    remove(path: string): Promise<boolean> {
        return this.mutate(text => bookmarks.remove(text, path));
    }

    /** Adds or removes; resolves to the new state (true = now a favourite). */
    async toggle(path: string): Promise<boolean> {
        let added = false;
        await this.mutate(text => {
            added = !bookmarks.parse(text).includes(bookmarks.normalizePath(path));
            return added ? bookmarks.add(text, path) : bookmarks.remove(text, path);
        });
        return added;
    }

    /**
     * Applies editor renames. Each covers the favourite equal to `from` and
     * every favourite under `from/`; a file renamed to a non-`.cook` name is
     * dropped. Paths are workspace-relative.
     */
    async applyRenames(renames: readonly Rename[]): Promise<void> {
        if (renames.length === 0) {
            return;
        }
        await this.mutate(text => {
            for (const { from, to } of renames) {
                text = isRecipePath(to) ? bookmarks.rename(text, from, to) : bookmarks.remove(text, from);
                text = bookmarks.renamePrefix(text, from, to);
            }
            return text;
        });
    }

    /** Drops each path and everything under it. */
    async applyDeletes(paths: readonly string[]): Promise<void> {
        if (paths.length === 0) {
            return;
        }
        await this.mutate(text => {
            for (const path of paths) {
                text = bookmarks.removePrefix(bookmarks.remove(text, path), path);
            }
            return text;
        });
    }

    /** Read-modify-write; resolves to whether the text changed. */
    private mutate(edit: (text: string) => string): Promise<boolean> {
        return this.enqueue(async () => {
            const file = this.file;
            if (!file) {
                throw new NoWorkspaceError();
            }
            const before = (await file.read()) ?? '';
            const after = edit(before);
            if (after !== before) {
                await file.write(after);
            }
            this.setCurrent(bookmarks.parse(after));
            return after !== before;
        });
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }

    private setCurrent(paths: string[]): void {
        if (paths.length === this.current.length && paths.every((path, index) => path === this.current[index])) {
            return;
        }
        this.current = paths;
        for (const listener of this.listeners) {
            listener();
        }
    }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: all tests pass (28 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/favourites-store.ts favourites/src/favourites-store.spec.ts
git commit -m "feat(favourites): favourites store with read-modify-write of .bookmarks"
```

---

### Task 5: `recipe-target.ts` — command argument → recipe

**Files:**
- Create: `favourites/src/recipe-target.ts`
- Test: `favourites/src/recipe-target.spec.ts`

- [ ] **Step 1: Write the failing spec**

`src/recipe-target.spec.ts`:
```ts
import * as assert from 'assert';
import { recipeTarget, relativePath, UriLike } from './recipe-target';

function uri(scheme: string, path: string): UriLike {
    return { scheme, path, toString: () => `${scheme}://${path}` };
}

const ROOT = uri('file', '/ws');
const PANCAKES = uri('file', '/ws/Breakfast/Pancakes.cook');

describe('relativePath', () => {
    it('returns the path under the root with / separators', () => {
        assert.strictEqual(relativePath(PANCAKES, ROOT), 'Breakfast/Pancakes.cook');
        assert.strictEqual(relativePath(uri('file', '/ws/Old'), ROOT), 'Old');
    });

    it('accepts a root with a trailing slash', () => {
        assert.strictEqual(relativePath(PANCAKES, uri('file', '/ws/')), 'Breakfast/Pancakes.cook');
    });

    it('rejects other schemes, no root, the root itself, and look-alike siblings', () => {
        assert.strictEqual(relativePath(uri('cooklang-hub', '/recipes/1.cook'), ROOT), undefined);
        assert.strictEqual(relativePath(PANCAKES, undefined), undefined);
        assert.strictEqual(relativePath(ROOT, ROOT), undefined);
        assert.strictEqual(relativePath(uri('file', '/ws2/a.cook'), ROOT), undefined);
    });
});

describe('recipeTarget', () => {
    it('uses a preview outlet context when it names a workspace recipe', () => {
        const context = { version: 1, uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook', scale: 1 };
        assert.deepStrictEqual(recipeTarget(context, ROOT, undefined), { uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook' });
    });

    it('rejects a preview context for a remote or out-of-workspace recipe', () => {
        assert.strictEqual(recipeTarget({ version: 1, uri: 'cooklang-hub:/r/1.cook', path: '', scale: 1 }, ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget({ version: 1, uri: 'file:///elsewhere/a.cook', path: '', scale: 1 }, ROOT, undefined), undefined);
    });

    it('uses a favourite tree item as is', () => {
        const item = { favouritePath: 'Dinner/Soup.cook', favouriteUri: 'file:///ws/Dinner/Soup.cook' };
        assert.deepStrictEqual(recipeTarget(item, ROOT, undefined), { uri: 'file:///ws/Dinner/Soup.cook', path: 'Dinner/Soup.cook' });
    });

    it('uses an explorer Uri when it is a .cook file in the workspace', () => {
        assert.deepStrictEqual(recipeTarget(PANCAKES, ROOT, undefined), { uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook' });
        assert.deepStrictEqual(recipeTarget(uri('file', '/ws/A.COOK'), ROOT, undefined)?.path, 'A.COOK');
        assert.strictEqual(recipeTarget(uri('file', '/ws/plan.menu'), ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget(uri('file', '/other/a.cook'), ROOT, undefined), undefined);
    });

    it('falls back to the active editor, and to nothing', () => {
        assert.deepStrictEqual(recipeTarget(undefined, ROOT, PANCAKES)?.path, 'Breakfast/Pancakes.cook');
        assert.strictEqual(recipeTarget(undefined, ROOT, uri('file', '/ws/notes.md')), undefined);
        assert.strictEqual(recipeTarget(undefined, ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget('a string', ROOT, undefined), undefined);
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: `tsc` fails with `Cannot find module './recipe-target'`.

- [ ] **Step 3: Implement `src/recipe-target.ts`**

```ts
// Which recipe a favourites command refers to. The preview toolbar passes a
// `PreviewOutletContext`, the Explorer passes a `Uri`, the Favourites view
// passes a `FavouriteItem`, the palette passes nothing (active editor).
// Free of the `vscode` import so it can be unit-tested.
import { normalizePath } from './bookmarks';

/** The parts of `vscode.Uri` used here. */
export interface UriLike {
    scheme: string;
    /** Decoded path with `/` separators, e.g. `/Users/me/recipes/a.cook` or `/c:/recipes/a.cook`. */
    path: string;
    toString(): string;
}

/** Mirrors the editor's `PreviewOutletContext` (API version 1). */
export interface PreviewOutletContext {
    version: 1;
    uri: string;
    path: string;
    scale: number;
}

/** An element of the Favourites view; plain JSON so it survives the plugin-host boundary. */
export interface FavouriteItem {
    favouritePath: string;
    favouriteUri: string;
}

export interface RecipeTarget {
    uri: string;
    /** Normalised workspace-relative path. */
    path: string;
}

export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

export function isFavouriteItem(value: unknown): value is FavouriteItem {
    const item = value as FavouriteItem;
    return typeof value === 'object' && value !== null
        && typeof item.favouritePath === 'string' && typeof item.favouriteUri === 'string';
}

function isUriLike(value: unknown): value is UriLike {
    const candidate = value as UriLike;
    return typeof value === 'object' && value !== null
        && typeof candidate.scheme === 'string' && typeof candidate.path === 'string';
}

function isRecipePath(path: string): boolean {
    return /\.cook$/i.test(path);
}

/** `uri` relative to `root` (file scheme, strictly inside), or `undefined`. Not limited to recipes. */
export function relativePath(uri: UriLike, root: UriLike | undefined): string | undefined {
    if (!root || uri.scheme !== 'file' || root.scheme !== 'file') {
        return undefined;
    }
    const prefix = root.path.replace(/\/+$/, '') + '/';
    if (!uri.path.startsWith(prefix) || uri.path.length === prefix.length) {
        return undefined;
    }
    return normalizePath(uri.path.slice(prefix.length));
}

export function recipeTarget(argument: unknown, root: UriLike | undefined, activeEditor: UriLike | undefined): RecipeTarget | undefined {
    if (isPreviewContext(argument)) {
        const path = normalizePath(argument.path);
        return argument.uri.startsWith('file:') && path !== '' && isRecipePath(path)
            ? { uri: argument.uri, path }
            : undefined;
    }
    if (isFavouriteItem(argument)) {
        return { uri: argument.favouriteUri, path: argument.favouritePath };
    }
    const uri = isUriLike(argument) ? argument : activeEditor;
    if (!uri) {
        return undefined;
    }
    const path = relativePath(uri, root);
    return path !== undefined && isRecipePath(path) ? { uri: uri.toString(), path } : undefined;
}
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: all tests pass (36 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/recipe-target.ts favourites/src/recipe-target.spec.ts
git commit -m "feat(favourites): resolve the target recipe of a command"
```

---

### Task 6: `favourites-view-model.ts` — tree ordering and labels

**Files:**
- Create: `favourites/src/favourites-view-model.ts`
- Test: `favourites/src/favourites-view-model.spec.ts`

- [ ] **Step 1: Write the failing spec**

`src/favourites-view-model.spec.ts`:
```ts
import * as assert from 'assert';
import { describeFavourite, favouriteEntries } from './favourites-view-model';

describe('favourites view model', () => {
    it('describes a favourite by recipe name and folder', () => {
        assert.deepStrictEqual(describeFavourite('Breakfast/Pancakes.cook'), { path: 'Breakfast/Pancakes.cook', name: 'Pancakes', folder: 'Breakfast' });
        assert.deepStrictEqual(describeFavourite('Soup.COOK'), { path: 'Soup.COOK', name: 'Soup', folder: '' });
    });

    it('sorts by name ignoring case, then by path', () => {
        const entries = favouriteEntries(['b/Soup.cook', 'a/soup.cook', 'Apple Pie.cook', 'zucchini.cook', 'Bread.cook']);
        assert.deepStrictEqual(entries.map(entry => entry.path), ['Apple Pie.cook', 'Bread.cook', 'a/soup.cook', 'b/Soup.cook', 'zucchini.cook']);
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: `tsc` fails with `Cannot find module './favourites-view-model'`.

- [ ] **Step 3: Implement `src/favourites-view-model.ts`**

```ts
// What the Favourites view shows for each `.bookmarks` entry. Free of the
// `vscode` import so it can be unit-tested.

export interface FavouriteEntry {
    /** Normalised workspace-relative path. */
    path: string;
    /** File name without the `.cook` extension. */
    name: string;
    /** Containing folder, `''` at the workspace root. */
    folder: string;
}

export function describeFavourite(path: string): FavouriteEntry {
    const slash = path.lastIndexOf('/');
    const file = slash === -1 ? path : path.slice(slash + 1);
    return { path, name: file.replace(/\.cook$/i, ''), folder: slash === -1 ? '' : path.slice(0, slash) };
}

/** Entries sorted by name (case-insensitive), then path. */
export function favouriteEntries(paths: readonly string[]): FavouriteEntry[] {
    return paths.map(describeFavourite).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
}
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: all tests pass (38 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/favourites-view-model.ts favourites/src/favourites-view-model.spec.ts
git commit -m "feat(favourites): view model for the Favourites tree"
```

---

### Task 7: `cooklang-api.ts`, `context-sync.ts`, `favourites-tree.ts`

These import `vscode`, so they have no mocha specs; they are exercised manually in Task 10.

**Files:**
- Create: `favourites/src/cooklang-api.ts`, `favourites/src/context-sync.ts`, `favourites/src/favourites-tree.ts`

- [ ] **Step 1: Write `src/cooklang-api.ts`**

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// extension.ts passes `vscode.commands.executeCommand` and `getCommands`.

/** Asks open previews to re-query their outlets; older editors lack it. */
export const REFRESH_BADGES_COMMAND = 'cooklang.api.refreshBadges';
export const OPEN_PREVIEW_COMMAND = 'cooklang.api.openPreview';

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** Re-renders open preview toolbars (so `when` clauses are re-evaluated). False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.listCommands()).includes(REFRESH_BADGES_COMMAND)) {
            return false;
        }
        await this.execute(REFRESH_BADGES_COMMAND);
        return true;
    }

    /** Opens the recipe preview tab for a `.cook` URI string. */
    async openPreview(uri: string): Promise<void> {
        await this.execute(OPEN_PREVIEW_COMMAND, { uri });
    }
}
```

- [ ] **Step 2: Write `src/context-sync.ts`**

```ts
// Mirrors the favourite list into context keys so `when` clauses in
// package.json pick "Add to Favourites" or "Remove from Favourites":
// `cooklang.favourites.paths` (workspace-relative paths, matched against the
// preview's `cooklangPreviewPath`) and `cooklang.favourites.uris` (URI strings,
// matched against the Explorer's `resource`).
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { FavouritesStore } from './favourites-store';

export const PATHS_CONTEXT_KEY = 'cooklang.favourites.paths';
export const URIS_CONTEXT_KEY = 'cooklang.favourites.uris';

export function favouriteUri(root: vscode.Uri, path: string): vscode.Uri {
    return vscode.Uri.joinPath(root, ...path.split('/'));
}

export async function syncContext(store: FavouritesStore, root: vscode.Uri | undefined, api: CooklangApi): Promise<void> {
    const paths = [...store.paths()];
    const uris = root ? paths.map(path => favouriteUri(root, path).toString()) : [];
    await vscode.commands.executeCommand('setContext', PATHS_CONTEXT_KEY, paths);
    await vscode.commands.executeCommand('setContext', URIS_CONTEXT_KEY, uris);
    await api.refreshBadges();
}
```

- [ ] **Step 3: Write `src/favourites-tree.ts`**

```ts
// The "Favourites" view in the Explorer: one flat list of recipes.
import * as vscode from 'vscode';
import { favouriteUri } from './context-sync';
import { FavouritesStore } from './favourites-store';
import { describeFavourite, favouriteEntries } from './favourites-view-model';
import { FavouriteItem } from './recipe-target';

export const VIEW_ID = 'cooklang.favourites.view';
export const OPEN_RECIPE_COMMAND = 'cooklang.favourites.openRecipe';

export class FavouritesTreeProvider implements vscode.TreeDataProvider<FavouriteItem>, vscode.Disposable {

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private readonly subscription: { dispose(): void };

    constructor(
        private readonly store: FavouritesStore,
        private readonly root: () => vscode.Uri | undefined,
        private readonly exists: (uri: vscode.Uri) => Promise<boolean>,
    ) {
        this.subscription = store.onDidChange(() => this.onDidChangeTreeDataEmitter.fire());
    }

    getChildren(element?: FavouriteItem): FavouriteItem[] {
        const root = this.root();
        if (element || !root) {
            return [];
        }
        return favouriteEntries(this.store.paths()).map(entry => ({
            favouritePath: entry.path,
            favouriteUri: favouriteUri(root, entry.path).toString(),
        }));
    }

    async getTreeItem(element: FavouriteItem): Promise<vscode.TreeItem> {
        const entry = describeFavourite(element.favouritePath);
        const uri = vscode.Uri.parse(element.favouriteUri);
        const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
        item.description = entry.folder;
        item.tooltip = entry.path;
        item.resourceUri = uri;
        item.contextValue = 'favourite';
        item.command = { command: OPEN_RECIPE_COMMAND, title: 'Open Recipe', arguments: [element] };
        if (!await this.exists(uri)) {
            item.iconPath = new vscode.ThemeIcon('warning');
            item.tooltip = `File not found: ${entry.path}`;
        }
        return item;
    }

    dispose(): void {
        this.subscription.dispose();
        this.onDidChangeTreeDataEmitter.dispose();
    }
}
```

- [ ] **Step 4: Compile**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm run compile
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/cooklang-api.ts favourites/src/context-sync.ts favourites/src/favourites-tree.ts
git commit -m "feat(favourites): Cooklang API wrapper, context key sync and tree provider"
```

---

### Task 8: `extension.ts` — commands, toasts, watcher, renames

**Files:**
- Modify: `favourites/src/extension.ts` (replace the placeholder)

- [ ] **Step 1: Write `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { syncContext } from './context-sync';
import { BookmarksFile, BOOKMARKS_FILE, FavouritesStore, NoWorkspaceError } from './favourites-store';
import { FavouritesTreeProvider, OPEN_RECIPE_COMMAND, VIEW_ID } from './favourites-tree';
import { recipeTarget, relativePath } from './recipe-target';

type Action = 'add' | 'remove' | 'toggle';

const COMMANDS: Record<Action, string> = {
    add: 'cooklang.favourites.add',
    remove: 'cooklang.favourites.remove',
    toggle: 'cooklang.favourites.toggle',
};

function workspaceRoot(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/** `.bookmarks` at the workspace root through `workspace.fs`; a missing file reads as `undefined`. */
function bookmarksFile(root: vscode.Uri): BookmarksFile {
    const uri = vscode.Uri.joinPath(root, BOOKMARKS_FILE);
    return {
        read: async () => (await exists(uri)) ? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) : undefined,
        write: async text => { await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text)); },
    };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Favourites');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const store = new FavouritesStore();
    const root = (): vscode.Uri | undefined => workspaceRoot()?.uri;

    const reportError = (what: string) => (error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`${what}: ${message}`);
    };

    // Context keys follow the store; the editor re-renders open previews on refreshBadges.
    context.subscriptions.push(store.onDidChange(() => {
        syncContext(store, root(), api).catch(reportError('Could not update favourites context'));
    }));

    const tree = new FavouritesTreeProvider(store, root, exists);
    context.subscriptions.push(tree);
    context.subscriptions.push(vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: false }));

    // Watch the file of the (first) workspace folder; re-bind when folders change.
    let watcher: vscode.FileSystemWatcher | undefined;
    const bindWorkspace = async (): Promise<void> => {
        watcher?.dispose();
        watcher = undefined;
        const folder = workspaceRoot();
        if (!folder) {
            await store.setFile(undefined);
            return;
        }
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, BOOKMARKS_FILE));
        const reload = (): void => { store.reload().catch(reportError('Could not reload .bookmarks')); };
        watcher.onDidCreate(reload);
        watcher.onDidChange(reload);
        watcher.onDidDelete(reload);
        await store.setFile(bookmarksFile(folder.uri));
    };
    context.subscriptions.push({ dispose: () => watcher?.dispose() });
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        bindWorkspace().catch(reportError('Could not bind the workspace'));
    }));

    const showToast = (added: boolean, path: string): void => {
        const message = added ? 'Added to Favourites' : 'Removed from Favourites';
        Promise.resolve(vscode.window.showInformationMessage(message, 'Undo')).then(async choice => {
            if (choice === 'Undo') {
                await (added ? store.remove(path) : store.add(path));
            }
        }).catch(reportError('Undo failed'));
    };

    const run = async (action: Action, argument: unknown): Promise<void> => {
        const target = recipeTarget(argument, root(), vscode.window.activeTextEditor?.document.uri);
        if (!target) {
            vscode.window.showInformationMessage('Open a recipe (.cook) to add it to Favourites.');
            return;
        }
        try {
            let nowFavourite: boolean;
            if (action === 'toggle') {
                nowFavourite = await store.toggle(target.path);
            } else if (action === 'add') {
                await store.add(target.path);
                nowFavourite = true;
            } else {
                await store.remove(target.path);
                nowFavourite = false;
            }
            showToast(nowFavourite, target.path);
        } catch (error) {
            if (error instanceof NoWorkspaceError) {
                vscode.window.showInformationMessage(error.message);
                return;
            }
            reportError('Could not update .bookmarks')(error);
            vscode.window.showErrorMessage(`Could not update .bookmarks: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const action of Object.keys(COMMANDS) as Action[]) {
        context.subscriptions.push(vscode.commands.registerCommand(COMMANDS[action], (argument: unknown) => run(action, argument)));
    }
    context.subscriptions.push(vscode.commands.registerCommand(OPEN_RECIPE_COMMAND, async (argument: unknown) => {
        const target = recipeTarget(argument, root(), undefined);
        if (target) {
            await api.openPreview(target.uri);
        }
    }));

    // Renames and deletes made through the editor keep .bookmarks pointing at the right files.
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(event => {
        const base = root();
        if (!base) {
            return;
        }
        const renames: { from: string; to: string }[] = [];
        const deletes: string[] = [];
        for (const { oldUri, newUri } of event.files) {
            const from = relativePath(oldUri, base);
            if (from === undefined) {
                continue;
            }
            const to = relativePath(newUri, base);
            if (to === undefined) {
                deletes.push(from);
            } else {
                renames.push({ from, to });
            }
        }
        store.applyRenames(renames).then(() => store.applyDeletes(deletes)).catch(reportError('Could not follow a rename in .bookmarks'));
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
        const base = root();
        if (!base) {
            return;
        }
        const deletes = event.files.map(uri => relativePath(uri, base)).filter((path): path is string => path !== undefined);
        store.applyDeletes(deletes).catch(reportError('Could not follow a delete in .bookmarks'));
    }));

    await bindWorkspace();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 2: Compile and run tests**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm test
```
Expected: compiles; 38 passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/src/extension.ts
git commit -m "feat(favourites): commands, toasts, file watcher and rename tracking"
```

---

### Task 9: `package.json` contributions

**Files:**
- Modify: `favourites/package.json` (`contributes`)

- [ ] **Step 1: Replace `"contributes": {}` with**

```json
  "contributes": {
    "commands": [
      {
        "command": "cooklang.favourites.add",
        "title": "Add to Favourites",
        "category": "Favourites",
        "icon": { "light": "media/heart-light.svg", "dark": "media/heart-dark.svg" }
      },
      {
        "command": "cooklang.favourites.remove",
        "title": "Remove from Favourites",
        "category": "Favourites",
        "icon": { "light": "media/heart-filled.svg", "dark": "media/heart-filled.svg" }
      },
      {
        "command": "cooklang.favourites.toggle",
        "title": "Toggle Favourite",
        "category": "Favourites"
      },
      {
        "command": "cooklang.favourites.openRecipe",
        "title": "Open Recipe",
        "category": "Favourites"
      }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.favourites.add", "when": "editorLangId == cooklang" },
        { "command": "cooklang.favourites.remove", "when": "editorLangId == cooklang" },
        { "command": "cooklang.favourites.openRecipe", "when": "false" }
      ],
      "cooklang/recipePreview/toolbar": [
        {
          "command": "cooklang.favourites.add",
          "when": "cooklangPreviewScheme == file && cooklangPreviewPath && cooklangPreviewPath not in cooklang.favourites.paths",
          "group": "navigation@1"
        },
        {
          "command": "cooklang.favourites.remove",
          "when": "cooklangPreviewScheme == file && cooklangPreviewPath in cooklang.favourites.paths",
          "group": "navigation@1"
        }
      ],
      "explorer/context": [
        {
          "command": "cooklang.favourites.add",
          "when": "resourceExtname =~ /^\\.cook$/i && resource not in cooklang.favourites.uris",
          "group": "navigation@80"
        },
        {
          "command": "cooklang.favourites.remove",
          "when": "resourceExtname =~ /^\\.cook$/i && resource in cooklang.favourites.uris",
          "group": "navigation@80"
        }
      ],
      "view/item/context": [
        {
          "command": "cooklang.favourites.remove",
          "when": "view == cooklang.favourites.view && viewItem == favourite",
          "group": "inline"
        }
      ]
    },
    "views": {
      "explorer": [
        { "id": "cooklang.favourites.view", "name": "Favourites", "visibility": "collapsed" }
      ]
    },
    "viewsWelcome": [
      {
        "view": "cooklang.favourites.view",
        "contents": "No favourites yet. Open a recipe and press the heart in its preview."
      }
    ]
  },
```

- [ ] **Step 2: Validate JSON and package**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"
npm run package && ls *.vsix
```
Expected: `ok`, then `favourites-0.1.0.vsix` (vsce may warn about a missing README; Task 10 adds it).

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/package.json
git commit -m "feat(favourites): commands, menus and the Favourites view"
```

---

### Task 10: README, repo table, CI, deploy and manual check

**Files:**
- Create: `favourites/README.md`
- Modify: `README.md` (plugins repo, table), `.github/workflows/ci.yml` (matrix)

- [ ] **Step 1: Write `favourites/README.md`**

```markdown
# Favourites

Mark recipes as favourites in Cook Editor. Ships with Cook Editor.

## What you see

- A heart as the first button in a recipe preview's header: outline when the
  recipe is not a favourite, filled orange when it is. Click to toggle. A
  notification confirms it, with **Undo**.
- **Add to Favourites** / **Remove from Favourites** when you right-click a
  `.cook` file in the Explorer, and **Favourites: Toggle Favourite** in the
  command palette for the recipe you are editing.
- A **Favourites** section in the Explorer sidebar listing your favourites.
  Click one to open its preview; the inline heart removes it. A warning icon
  marks a favourite whose file is missing.

## The `.bookmarks` file

Favourites live in `.bookmarks` at the root of your recipe folder, so other
Cooklang apps and sync can share them:

```
# one recipe per line, relative to this folder
Breakfast/Pancakes.cook
Dinner/Tomato Soup.cook
```

- Paths use `/` and keep the `.cook` extension; blank lines and `#` comments
  are fine, and the plugin preserves them when it edits the file.
- You can edit the file by hand; open previews and the Favourites view update.
- Renaming or deleting a recipe or folder inside Cook Editor updates the file.
  Moves made outside the editor leave an entry with a warning icon; remove it
  from the Favourites view.
- Only the first folder of a multi-folder workspace is used.

## For plugin authors

Shows how a plugin drives per-recipe toolbar state without editor code: it
publishes the favourite list with `setContext` (`cooklang.favourites.paths`,
`cooklang.favourites.uris`), contributes two commands to
`cooklang/recipePreview/toolbar` whose `when` clauses use
`cooklangPreviewPath in …` / `not in …`, and calls
`cooklang.api.refreshBadges` so open previews re-render. Also a tree view in
the `explorer` container and `cooklang.api.openPreview`.
```

- [ ] **Step 2: Add the table row to the plugins repo `README.md`**

After the `shopping-list` row (line 9) insert:

```markdown
| [`favourites`](./favourites) | Heart on recipe previews and a Favourites view, stored in a plain-text `.bookmarks` file. Ships with Cook Editor. Shows context keys driving toolbar `when` clauses, a tree view and `cooklang.api.openPreview`. |
```

- [ ] **Step 3: Add `favourites` to the CI matrix**

In `.github/workflows/ci.yml` change
`package: [allergens, corevitals, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]`
to
`package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]`.

- [ ] **Step 4: Deploy into the editor and run it**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites && npm run deploy
cd /Users/alexeydubovskoy/Cooklang/editor
export PATH=$HOME/.local/node-v22.23.2-darwin-x64/bin:$PATH
npx lerna run compile --scope @theia/cooklang && (cd app && npm run bundle) && npm run start:electron
```
(Task 1's editor change must be bundled, hence the `bundle` step. If `app/plugins` is stale, `npm run start:electron` re-copies `editor/plugins` on start.)

- [ ] **Step 5: Manual checklist** (open a workspace with a few `.cook` files)

1. Open a recipe preview: an outline heart is the first header button. Click → heart turns filled orange without reopening, "Added to Favourites" toast with Undo; `.bookmarks` appears at the root with the relative path. Click Undo → outline heart, line removed.
2. Right-click a `.cook` file in the Explorer: "Add to Favourites"; after adding, the same menu shows "Remove from Favourites".
3. The Favourites section in the Explorer lists favourites sorted by name with the folder as description; clicking opens the preview; the inline heart removes.
4. Edit `.bookmarks` by hand (add a line, save): the heart and the view update. Add a comment line, toggle a heart: the comment survives.
5. Rename a favourite recipe in the Explorer: `.bookmarks` follows. Rename its folder: entries follow. Delete it: entry gone.
6. Add a line for a file that does not exist: the view shows it with a warning icon and "File not found" tooltip.
7. Command palette → "Favourites: Toggle Favourite" with a `.cook` editor active toggles it; with no recipe open shows the info message.
8. Open a Recipe Hub (`cooklang-hub:`) preview if available: no heart.
9. Close the workspace (no folder): heart commands say "Open a recipe folder to use favourites."

If anything fails, fix in the plugin (or Task 1), re-run `npm run deploy`, restart the editor.

- [ ] **Step 6: Commit the plugins repo**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add favourites/README.md README.md .github/workflows/ci.yml
git commit -m "docs(favourites): README, repo table row and CI matrix entry"
```

---

### Task 11: Publish and bundle with the editor

**Files:**
- Modify: editor root `package.json:108-113` (`theiaPlugins`)

- [ ] **Step 1: Open the plugins PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git push -u origin feature/favourites
gh pr create --title "feat(favourites): Favourites plugin (heart on previews, .bookmarks file, Favourites view)" --body "Implements the design in editor/docs/superpowers/specs/2026-10-08-favourites-plugin-design.md. Needs editor PR for the cooklangPreviewPath context key."
```

- [ ] **Step 2: Publish 0.1.0 to plugins.cook.md** — needs the user's PAT; ask them to run:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/favourites
npm run package
OVSX_PAT=<PAT> npm run publish:marketplace
curl https://plugins.cook.md/api/cooklang/favourites
```
Expected: the API returns version `0.1.0` with a `files.download` URL.

- [ ] **Step 3: Add the `theiaPlugins` entry in the editor**

In the editor root `package.json`, after the `cooklang.shopping-list` line add:

```json
    "cooklang.favourites": "https://plugins.cook.md/api/cooklang/favourites/0.1.0/file/cooklang.favourites-0.1.0.vsix"
```

Then:
```bash
cd /Users/alexeydubovskoy/Cooklang/editor
rm -rf plugins/cooklang.favourites && npm run download:plugins && ls plugins | grep favourites
git add package.json
git commit -m "feat(app): bundle the Favourites plugin"
git push -u origin feature/favourites-plugin
gh pr create --title "feat(cooklang): cooklangPreviewPath context key; bundle the Favourites plugin" --body "See docs/superpowers/specs/2026-10-08-favourites-plugin-design.md and docs/superpowers/plans/2026-10-08-favourites-plugin.md."
```
Expected: `plugins/cooklang.favourites` exists after the download (vsix-unpacked layout with an `extension/` folder, like `cooklang.shopping-list`).
