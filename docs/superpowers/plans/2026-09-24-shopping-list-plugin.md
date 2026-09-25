# Shopping List Plugin (`cooklang.shopping-list`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Cook Editor's shopping list as a VS Code-style extension in `cook-md/plugins`, with the same behaviour, using only the public `cooklang.api.*` commands and outlets.

**Architecture:** Pure, `vscode`-free modules (`cooklang-api.ts`, `shopping-list-store.ts`, `command-args.ts`, `view-model.ts`) carry all logic and are unit-tested with mocha. `shopping-list-controller.ts` is the only `vscode` glue: it adapts `workspace.fs` to the store, watches files, registers commands and hosts a webview view. The webview script (`webview/main.ts`) renders plain DOM from state messages and is bundled with esbuild.

**Tech Stack:** VS Code extension API 1.100 (Theia supports 1.110), TypeScript 5.4, mocha, esbuild (webview bundle only), `@vscode/vsce`, `ovsx`.

**Spec:** `editor/docs/superpowers/specs/2026-09-24-shopping-list-plugin-design.md` (Part 3).

**Prerequisite:** editor plan `2026-09-24-plugin-outlets-editor.md` Tasks 1–9 done in the worktree `/Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets` (the `cooklang.api.*` commands and outlets exist there).

---

## Working environment

- Repo: `/Users/alexeydubovskoy/Cooklang/plugins` (github.com/cook-md/plugins). Start the branch from the up-to-date main:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git fetch origin
git switch -c feature/shopping-list origin/main
```

- Node: any Node ≥ 18 works for the plugin; use the Node 22 on `PATH` anyway so editor commands in the same shell work: `export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"`.
- The reference plugin is `meal-journal/` — copy its conventions (MIT licence, `engines.vscode ^1.100.0`, `@types/vscode ~1.100.0`, mocha over compiled `out/**/*.spec.js`).
- The deploy script copies the plugin into the **editor worktree**: `/Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets/plugins/cooklang.shopping-list`.

## File map (all under `shopping-list/`)

| File | Responsibility |
|---|---|
| `package.json` | manifest: views, commands, menus (incl. Cooklang outlets), scripts |
| `tsconfig.json` | tsc for extension + tests (`out/`) |
| `.vscodeignore`, `LICENSE`, `README.md` | packaging |
| `scripts/deploy.js` | copy build into the editor's `plugins/` |
| `media/cart.svg`, `media/cart-light.svg`, `media/cart-dark.svg` | icons (Lucide, ISC) |
| `media/shopping-list.css` | webview styles (`--vscode-*` theme variables) |
| `src/cooklang-api.ts` (+ `.spec.ts`) | typed wrapper over `cooklang.api.*` |
| `src/shopping-list-store.ts` (+ `.spec.ts`) | list model, checked log, regeneration, debounced reload |
| `src/command-args.ts` (+ `.spec.ts`) | normalise outlet context / Uri / no-arg invocations; validate `addRecipes` |
| `src/view-model.ts` (+ `.spec.ts`) | display rows and categories for the webview |
| `src/protocol.ts` | messages between extension and webview |
| `src/webview/main.ts` | webview DOM rendering |
| `src/shopping-list-controller.ts` | vscode glue: files adapter, watcher, commands, webview view provider |
| `src/extension.ts` | `activate`: API version check, start controller |

---

### Task 1: Scaffold the package

**Files:** create `shopping-list/package.json`, `tsconfig.json`, `.vscodeignore`, `LICENSE`, `README.md`, `scripts/deploy.js`, `media/cart.svg`, `media/cart-light.svg`, `media/cart-dark.svg`

- [ ] **Step 1: Manifest**

`shopping-list/package.json`:

```json
{
  "name": "shopping-list",
  "displayName": "Shopping List",
  "description": "Aisle-grouped shopping lists from Cooklang recipes and menus, with pantry subtraction. Ships with Cook Editor.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "icon": "media/icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/cook-md/plugins.git",
    "directory": "shopping-list"
  },
  "keywords": ["cooklang", "shopping list", "groceries", "recipes", "meal-planning"],
  "engines": {
    "vscode": "^1.100.0"
  },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "shoppingList", "title": "Shopping List", "icon": "media/cart.svg" }
      ]
    },
    "views": {
      "shoppingList": [
        { "type": "webview", "id": "shoppingList.view", "name": "Shopping List" }
      ]
    },
    "commands": [
      {
        "command": "shoppingList.show",
        "title": "Show Shopping List",
        "category": "Shopping List"
      },
      {
        "command": "shoppingList.addRecipe",
        "title": "Add to Shopping List",
        "category": "Shopping List",
        "icon": { "light": "media/cart-light.svg", "dark": "media/cart-dark.svg" }
      },
      {
        "command": "shoppingList.addMenu",
        "title": "Add Menu to Shopping List",
        "category": "Shopping List",
        "icon": { "light": "media/cart-light.svg", "dark": "media/cart-dark.svg" }
      },
      {
        "command": "shoppingList.addRecipes",
        "title": "Add Recipes to Shopping List",
        "category": "Shopping List"
      },
      {
        "command": "shoppingList.clear",
        "title": "Clear Shopping List",
        "category": "Shopping List"
      }
    ],
    "menus": {
      "commandPalette": [
        { "command": "shoppingList.addRecipes", "when": "false" },
        { "command": "shoppingList.addRecipe", "when": "editorLangId == cooklang" },
        { "command": "shoppingList.addMenu", "when": "resourceExtname =~ /^\\.menu$/i" }
      ],
      "cooklang/recipePreview/toolbar": [
        { "command": "shoppingList.addRecipe", "group": "navigation@10" }
      ],
      "cooklang/menuPreview/toolbar": [
        { "command": "shoppingList.addMenu", "group": "navigation@10" }
      ],
      "explorer/context": [
        { "command": "shoppingList.addRecipe", "when": "resourceExtname =~ /^\\.cook$/i", "group": "navigation@90" },
        { "command": "shoppingList.addMenu", "when": "resourceExtname =~ /^\\.menu$/i", "group": "navigation@90" }
      ],
      "editor/title": [
        { "command": "shoppingList.addRecipe", "when": "editorLangId == cooklang", "group": "navigation@10" },
        { "command": "shoppingList.addMenu", "when": "resourceExtname =~ /^\\.menu$/i", "group": "navigation@10" }
      ],
      "view/title": [
        { "command": "shoppingList.clear", "when": "view == shoppingList.view" }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p . && npm run bundle:webview",
    "bundle:webview": "esbuild src/webview/main.ts --bundle --format=iife --target=es2020 --outfile=out/webview.js",
    "watch": "tsc -w -p .",
    "test": "tsc -p . && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js",
    "vscode:prepublish": "npm run compile",
    "package": "vsce package --no-dependencies",
    "publish:marketplace": "ovsx publish --packagePath shopping-list-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^3.3.0",
    "esbuild": "^0.23.0",
    "mocha": "^10.4.0",
    "ovsx": "^1.0.0",
    "typescript": "~5.4.5"
  }
}
```

Check `meal-journal/package.json` for an `icon` field: if meal-journal has none, drop `"icon"` here too (vsce fails on a missing file). The `shoppingList.clear` command replaces the old "Clear All" button's discoverability from the palette; the webview keeps its own Clear All button.

- [ ] **Step 2: Config, licence, deploy script**

`shopping-list/tsconfig.json`:

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

`shopping-list/.vscodeignore`:

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

Copy the licence: `cp meal-journal/LICENSE shopping-list/LICENSE`.

`shopping-list/scripts/deploy.js`:

```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor-worktrees/plugin-outlets');
const target = path.join(editor, 'plugins/cooklang.shopping-list');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'media', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 3: Icons**

The Lucide shopping-cart path (ISC licence — the editor uses the same one today):

`shopping-list/media/cart.svg` (activity bar; used as a mask, colour does not matter):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
```

`media/cart-light.svg`: the same with `stroke="#424242"`. `media/cart-dark.svg`: the same with `stroke="#C5C5C5"`.

- [ ] **Step 4: README**

`shopping-list/README.md`:

```markdown
# Shopping List

Aisle-grouped shopping lists from [Cooklang](https://cooklang.org) recipes and
menus. Ships with Cook Editor; also a reference for plugins that use the
Cooklang API and outlets.

- Add a recipe or a whole `.menu` from the preview's cart button, the explorer
  context menu, or the editor title bar. Sub-recipe references are included.
- Change each entry's scale, remove entries, check items off.
- Items are grouped by `config/aisle.conf`; anything in `config/pantry.conf`
  is subtracted.
- The list lives in `.shopping-list` and `.shopping-checked` at the root of
  your recipe folder — the same files CookCLI uses.

User guide: https://cook.md/help/plugins/shopping-list

## For plugin authors

This plugin uses:

- the `cooklang.api.*` commands (`generateShoppingList`,
  `resolveRecipeReferences`, `parse/writeShoppingList`,
  `parse/write/compactShoppingChecked`) — see `src/cooklang-api.ts`;
- the `cooklang/recipePreview/toolbar` and `cooklang/menuPreview/toolbar`
  outlets in `package.json` → `contributes.menus`;
- a webview view (`src/shopping-list-controller.ts`, `src/webview/main.ts`).

Reference: https://cook.md/help/plugins/api and https://cook.md/help/plugins/outlets
```

- [ ] **Step 5: Install and commit**

Run: `cd shopping-list && npm install`
Expected: installs; `package-lock.json` created.

```bash
git add shopping-list
git commit -m "feat(shopping-list): scaffold the plugin package"
```

---

### Task 2: Cooklang API wrapper

**Files:** create `shopping-list/src/cooklang-api.ts`, `shopping-list/src/cooklang-api.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';

function recorder(result: unknown): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    });
    return { api, calls };
}

describe('CooklangApi', () => {
    it('calls each cooklang.api command with one JSON argument', async () => {
        const { api, calls } = recorder(undefined);
        await api.version();
        await api.generateShoppingList([{ path: 'a.cook', scale: 2 }]);
        await api.resolveRecipeReferences('week.menu');
        await api.parseShoppingList('text');
        await api.writeShoppingList({ items: [] });
        await api.parseShoppingChecked('log');
        await api.writeShoppingChecked([{ type: 'checked', name: 'flour' }]);
        await api.compactShoppingChecked([{ type: 'checked', name: 'flour' }], ['flour']);
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.version', args: [] },
            { command: 'cooklang.api.generateShoppingList', args: [{ recipes: [{ path: 'a.cook', scale: 2 }] }] },
            { command: 'cooklang.api.resolveRecipeReferences', args: [{ path: 'week.menu' }] },
            { command: 'cooklang.api.parseShoppingList', args: [{ text: 'text' }] },
            { command: 'cooklang.api.writeShoppingList', args: [{ list: { items: [] } }] },
            { command: 'cooklang.api.parseShoppingChecked', args: [{ text: 'log' }] },
            { command: 'cooklang.api.writeShoppingChecked', args: [{ entries: [{ type: 'checked', name: 'flour' }] }] },
            { command: 'cooklang.api.compactShoppingChecked', args: [{ entries: [{ type: 'checked', name: 'flour' }], ingredients: ['flour'] }] },
        ]);
    });

    it('returns what the command returns', async () => {
        const { api } = recorder(1);
        assert.strictEqual(await api.version(), 1);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd shopping-list && npm test`
Expected: FAIL — `Cannot find module './cooklang-api'`.

- [ ] **Step 3: Implement**

`src/cooklang-api.ts`:

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// The types mirror the editor's `shopping-list-types.ts` and
// `recipe-reference-resolver.ts`. Kept free of the `vscode` import so it can
// be unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;

export interface ShoppingListItem {
    name: string;
    /** Pre-formatted quantities, e.g. "500 g, 2 cups". */
    quantities: string;
}

export interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

export interface ShoppingListResult {
    /** Categories from aisle.conf, in aisle order. */
    categories: ShoppingListCategory[];
    /** Items with no aisle. */
    other: ShoppingListCategory;
    /** Ingredients subtracted because they are in pantry.conf. */
    pantryItems: string[];
}

export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    /** Undefined means 1. */
    multiplier?: number;
    children: ShoppingListRecipeItem[];
}

export interface ShoppingListFile {
    items: ShoppingListRecipeItem[];
}

export interface CheckEntry {
    type: 'checked' | 'unchecked';
    name: string;
}

export interface ResolvedRecipeReference {
    path: string;
    /** Multiplier relative to the recipe holding the reference. */
    scale: number;
    children?: ResolvedRecipeReference[];
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    generateShoppingList(recipes: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        return this.call('cooklang.api.generateShoppingList', { recipes });
    }

    resolveRecipeReferences(path: string): Promise<ResolvedRecipeReference[]> {
        return this.call('cooklang.api.resolveRecipeReferences', { path });
    }

    parseShoppingList(text: string): Promise<ShoppingListFile> {
        return this.call('cooklang.api.parseShoppingList', { text });
    }

    writeShoppingList(list: ShoppingListFile): Promise<string> {
        return this.call('cooklang.api.writeShoppingList', { list });
    }

    parseShoppingChecked(text: string): Promise<CheckEntry[]> {
        return this.call('cooklang.api.parseShoppingChecked', { text });
    }

    writeShoppingChecked(entries: readonly CheckEntry[]): Promise<string> {
        return this.call('cooklang.api.writeShoppingChecked', { entries });
    }

    compactShoppingChecked(entries: readonly CheckEntry[], ingredients: readonly string[]): Promise<CheckEntry[]> {
        return this.call('cooklang.api.compactShoppingChecked', { entries, ingredients });
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, 2 passing.

- [ ] **Step 5: Commit**

```bash
git add shopping-list/src/cooklang-api.ts shopping-list/src/cooklang-api.spec.ts
git commit -m "feat(shopping-list): typed wrapper over the cooklang.api commands"
```

---

### Task 3: Shopping list store (port of the editor's ShoppingListService)

**Files:** create `shopping-list/src/shopping-list-store.ts`, `shopping-list/src/shopping-list-store.spec.ts`

- [ ] **Step 1: Write the failing test**

These are the editor's `shopping-list-service.spec.ts` cases, re-targeted at the store's ports.

`src/shopping-list-store.spec.ts`:

```ts
import * as assert from 'assert';
import { CheckEntry, CooklangApi, ShoppingListFile, ShoppingListResult } from './cooklang-api';
import { CHECKED_FILE, LIST_FILE, ListFiles, ShoppingListStore } from './shopping-list-store';

class FakeFiles implements ListFiles {
    files = new Map<string, string>();
    async read(name: string): Promise<string | undefined> { return this.files.get(name); }
    async write(name: string, text: string): Promise<void> { this.files.set(name, text); }
    async delete(name: string): Promise<void> { this.files.delete(name); }
}

/** Line formats mimic the real ones closely enough for the store's logic. */
class FakeApi extends CooklangApi {
    generate: (recipes: ReadonlyArray<{ path: string; scale: number }>) => Promise<ShoppingListResult> = async () => ({
        categories: [], other: { name: 'other', items: [{ name: 'flour', quantities: '' }] }, pantryItems: [],
    });
    generateCalls: Array<ReadonlyArray<{ path: string; scale: number }>> = [];

    constructor() { super(async () => undefined); }

    override async generateShoppingList(recipes: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        this.generateCalls.push(recipes);
        return this.generate(recipes);
    }
    override async parseShoppingList(text: string): Promise<ShoppingListFile> {
        return { items: text.split('\n').filter(line => line.trim()).map(line => ({ type: 'recipe', path: line.trim(), children: [] })) };
    }
    override async writeShoppingList(list: ShoppingListFile): Promise<string> {
        return list.items.map(item => item.path).join('\n') + (list.items.length > 0 ? '\n' : '');
    }
    override async parseShoppingChecked(text: string): Promise<CheckEntry[]> {
        const entries: CheckEntry[] = [];
        for (const line of text.split('\n')) {
            if (line.startsWith('+ ')) { entries.push({ type: 'checked', name: line.slice(2) }); }
            if (line.startsWith('- ')) { entries.push({ type: 'unchecked', name: line.slice(2) }); }
        }
        return entries;
    }
    override async writeShoppingChecked(entries: readonly CheckEntry[]): Promise<string> {
        return entries.map(entry => `${entry.type === 'checked' ? '+' : '-'} ${entry.name}\n`).join('');
    }
    override async compactShoppingChecked(entries: readonly CheckEntry[], ingredients: readonly string[]): Promise<CheckEntry[]> {
        const present = new Set(ingredients.map(name => name.toLowerCase()));
        return entries.filter(entry => present.has(entry.name.toLowerCase()));
    }
}

function makeStore(): { store: ShoppingListStore; files: FakeFiles; api: FakeApi } {
    const files = new FakeFiles();
    const api = new FakeApi();
    const store = new ShoppingListStore(files, api);
    store.reloadDebounceMs = 5;
    return { store, files, api };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ShoppingListStore', () => {
    it('addRecipe appends to the list, persists it and regenerates', async () => {
        const { store, files, api } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        assert.strictEqual(store.getItems().length, 1);
        assert.strictEqual(files.files.get(LIST_FILE), 'pasta.cook\n');
        assert.deepStrictEqual(api.generateCalls, [[{ path: 'pasta.cook', scale: 1 }]]);
        assert.strictEqual(store.getResult()?.other.items[0].name, 'flour');
    });

    it('stores a scale other than 1 as the multiplier', async () => {
        const { store } = makeStore();
        await store.addRecipe('pasta.cook', 2);
        assert.strictEqual(store.getItems()[0].multiplier, 2);
    });

    it('addMenu creates a nested structure', async () => {
        const { store } = makeStore();
        await store.addMenu('weekday.menu', 1, [{ path: 'pasta.cook', scale: 1 }, { path: 'salad.cook', scale: 2 }]);
        const items = store.getItems();
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].children.length, 2);
        assert.strictEqual(items[0].children[1].multiplier, 2);
    });

    it('addMenu keeps references nested below the menu recipes (cookcli#509)', async () => {
        const { store } = makeStore();
        await store.addMenu('week.menu', 1, [
            { path: 'Dinner', scale: 1, children: [{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }] },
        ]);
        const dinner = store.getItems()[0].children[0];
        assert.strictEqual(dinner.path, 'Dinner');
        assert.strictEqual(dinner.children[0].path, 'Sauce');
        assert.strictEqual(dinner.children[0].multiplier, 0.5);
        assert.strictEqual(dinner.children[0].children[0].path, 'Prep');
        assert.strictEqual(dinner.children[0].children[0].multiplier, 2);
    });

    it('addRecipe strips ./ from references at every depth', async () => {
        const { store } = makeStore();
        await store.addRecipe('a.cook', 1, [{ path: './b', scale: 1, children: [{ path: './c', scale: 1, children: [{ path: 'd', scale: 1 }] }] }]);
        const b = store.getItems()[0].children[0];
        assert.strictEqual(b.path, 'b');
        assert.strictEqual(b.children[0].path, 'c');
        assert.strictEqual(b.children[0].children[0].path, 'd');
    });

    it('generates from the flattened tree with multipliers applied down', async () => {
        const { store, api } = makeStore();
        await store.addMenu('week.menu', 2, [{ path: 'Dinner', scale: 1, children: [{ path: 'Sauce', scale: 0.5 }] }]);
        assert.deepStrictEqual(api.generateCalls.at(-1), [
            { path: 'week.menu', scale: 2 }, { path: 'Dinner', scale: 2 }, { path: 'Sauce', scale: 1 },
        ]);
    });

    it('updateScale and removeRecipe persist and ignore bad indexes', async () => {
        const { store, files } = makeStore();
        await store.addRecipe('a.cook', 1);
        await store.addRecipe('b.cook', 1);
        await store.updateScale(0, 3);
        assert.strictEqual(store.getItems()[0].multiplier, 3);
        await store.updateScale(0, 1);
        assert.strictEqual(store.getItems()[0].multiplier, undefined);
        await store.removeRecipe(5);
        await store.removeRecipe(0);
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['b.cook']);
        assert.strictEqual(files.files.get(LIST_FILE), 'b.cook\n');
    });

    it('checkItem appends to .shopping-checked and updates the set case-insensitively', async () => {
        const { store, files } = makeStore();
        await store.checkItem('Flour');
        assert.strictEqual(store.isChecked('flour'), true);
        assert.strictEqual(files.files.get(CHECKED_FILE), '+ Flour\n');
    });

    it('uncheckItem reverses a prior check', async () => {
        const { store } = makeStore();
        await store.checkItem('flour');
        await store.uncheckItem('flour');
        assert.strictEqual(store.isChecked('flour'), false);
    });

    it('clearAll deletes both files and resets state', async () => {
        const { store, files } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        await store.checkItem('flour');
        await store.clearAll();
        assert.strictEqual(files.files.has(LIST_FILE), false);
        assert.strictEqual(files.files.has(CHECKED_FILE), false);
        assert.strictEqual(store.getItems().length, 0);
        assert.strictEqual(store.getResult(), undefined);
    });

    it('removeRecipe compacts stale checks', async () => {
        const { store, files, api } = makeStore();
        api.generate = async recipes => ({
            categories: [],
            other: {
                name: 'other',
                items: recipes.some(recipe => recipe.path === 'bread.cook')
                    ? [{ name: 'flour', quantities: '' }, { name: 'milk', quantities: '' }]
                    : [{ name: 'flour', quantities: '' }],
            },
            pantryItems: [],
        });
        await store.addRecipe('pasta.cook', 1);
        await store.addRecipe('bread.cook', 1);
        await store.checkItem('flour');
        await store.checkItem('milk');
        await store.removeRecipe(1);
        const checked = files.files.get(CHECKED_FILE) ?? '';
        assert.strictEqual(checked.includes('milk'), false);
        assert.strictEqual(checked.includes('+ flour'), true);
        assert.strictEqual(store.isChecked('milk'), false);
    });

    it('keeps the error when generation fails and clears it on success', async () => {
        const { store, api } = makeStore();
        api.generate = async () => { throw new Error('native exploded'); };
        await store.addRecipe('a.cook', 1);
        assert.strictEqual(store.getResult(), undefined);
        assert.match(store.getError() ?? '', /native exploded/);
        api.generate = async () => ({ categories: [], other: { name: 'other', items: [] }, pantryItems: [] });
        await store.regenerate();
        assert.strictEqual(store.getError(), undefined);
    });

    it('load reads both files', async () => {
        const { store, files } = makeStore();
        files.files.set(LIST_FILE, 'pasta.cook\nsoup.cook\n');
        files.files.set(CHECKED_FILE, '+ flour\n');
        await store.load();
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['pasta.cook', 'soup.cook']);
        assert.strictEqual(store.isChecked('flour'), true);
    });

    it('reloads after an external change and resets when the list is deleted', async () => {
        const { store, files } = makeStore();
        await store.load();
        let changes = 0;
        store.onDidChange(() => { changes += 1; });
        files.files.set(LIST_FILE, 'pasta.cook\n');
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.getItems().length, 1);
        assert.ok(changes > 0);
        files.files.delete(LIST_FILE);
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.getItems().length, 0);
        assert.strictEqual(store.getResult(), undefined);
    });

    it('an external unchecked entry wins', async () => {
        const { store, files } = makeStore();
        files.files.set(CHECKED_FILE, '+ flour\n- flour\n');
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.isChecked('flour'), false);
    });

    it('coalesces rapid reload requests into one load', async () => {
        const { store } = makeStore();
        let loads = 0;
        const original = store.load.bind(store);
        store.load = async () => { loads += 1; return original(); };
        for (let i = 0; i < 5; i += 1) { store.scheduleReload(); }
        await sleep(30);
        assert.strictEqual(loads, 1);
    });

    it('stops reloading after dispose()', async () => {
        const { store } = makeStore();
        let loads = 0;
        const original = store.load.bind(store);
        store.load = async () => { loads += 1; return original(); };
        store.scheduleReload();
        store.dispose();
        await sleep(30);
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(loads, 0);
    });

    it('handles the echo of its own write idempotently', async () => {
        const { store } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        await store.checkItem('flour');
        store.scheduleReload();
        await sleep(30);
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['pasta.cook']);
        assert.strictEqual(store.isChecked('flour'), true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './shopping-list-store'`.

- [ ] **Step 3: Implement**

`src/shopping-list-store.ts`:

```ts
import { CheckEntry, CooklangApi, ResolvedRecipeReference, ShoppingListFile, ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

export const LIST_FILE = '.shopping-list';
export const CHECKED_FILE = '.shopping-checked';

/** File access at the workspace root, by file name. `read` returns undefined for a missing file. */
export interface ListFiles {
    read(name: string): Promise<string | undefined>;
    write(name: string, text: string): Promise<void>;
    /** Must not throw when the file is already gone. */
    delete(name: string): Promise<void>;
}

export interface StoreDisposable {
    dispose(): void;
}

/**
 * The shopping list for one workspace root: the `.shopping-list` recipe tree,
 * the append-only `.shopping-checked` log, and the aggregated result. All
 * format work goes through the Cooklang API (the editor's Rust crates).
 */
export class ShoppingListStore {

    /** Debounce for `scheduleReload`. Overridable in tests. */
    reloadDebounceMs = 100;

    protected list: ShoppingListFile = { items: [] };
    protected checkedLog: CheckEntry[] = [];
    protected checkedSet = new Set<string>();
    protected result: ShoppingListResult | undefined;
    protected error: string | undefined;
    /** Discards results of superseded `regenerate()` calls. */
    protected regenerationSeq = 0;
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly files: ListFiles, protected readonly api: CooklangApi) { }

    onDidChange(listener: () => void): StoreDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    getItems(): readonly ShoppingListRecipeItem[] {
        return this.list.items;
    }

    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    getError(): string | undefined {
        return this.error;
    }

    /** Lower-cased names of checked ingredients. */
    getCheckedNames(): string[] {
        return [...this.checkedSet];
    }

    isChecked(name: string): boolean {
        return this.checkedSet.has(name.toLowerCase());
    }

    async load(): Promise<void> {
        try {
            const text = await this.files.read(LIST_FILE);
            this.list = text === undefined ? { items: [] } : await this.api.parseShoppingList(text);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-list:', e);
            this.list = { items: [] };
        }
        try {
            const text = await this.files.read(CHECKED_FILE);
            this.checkedLog = text === undefined ? [] : await this.api.parseShoppingChecked(text);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-checked:', e);
            this.checkedLog = [];
        }
        this.checkedSet = checkedSetOf(this.checkedLog);
        if (this.list.items.length > 0) {
            await this.regenerate();
        } else {
            this.result = undefined;
            this.error = undefined;
            this.fire();
        }
    }

    async addRecipe(path: string, scale = 1, references?: readonly ResolvedRecipeReference[]): Promise<void> {
        this.list.items.push({
            type: 'recipe',
            path,
            multiplier: scale === 1 ? undefined : scale,
            children: (references ?? []).map(toRecipeItem),
        });
        await this.save();
        await this.regenerate();
    }

    /** A menu is one top-level item whose children are its recipes (each with its own references). */
    async addMenu(path: string, scale: number, recipes: readonly ResolvedRecipeReference[]): Promise<void> {
        await this.addRecipe(path, scale, recipes);
    }

    async removeRecipe(index: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items.splice(index, 1);
        await this.save();
        await this.regenerate();
        await this.compactCheckedLog();
    }

    async updateScale(index: number, scale: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items[index].multiplier = scale === 1 ? undefined : scale;
        await this.save();
        await this.regenerate();
    }

    async clearAll(): Promise<void> {
        // Invalidate any in-flight regenerate() so it cannot resurrect the result.
        ++this.regenerationSeq;
        this.list = { items: [] };
        this.checkedLog = [];
        this.checkedSet = new Set();
        this.result = undefined;
        this.error = undefined;
        await this.files.delete(LIST_FILE);
        await this.files.delete(CHECKED_FILE);
        this.fire();
    }

    async checkItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'checked', name });
    }

    async uncheckItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'unchecked', name });
    }

    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;
        if (this.list.items.length === 0) {
            this.result = undefined;
            this.error = undefined;
            this.fire();
            return;
        }
        let result: ShoppingListResult | undefined;
        let error: string | undefined;
        try {
            result = await this.api.generateShoppingList(this.flattenForGeneration());
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            console.error('[shopping-list] Failed to generate shopping list:', e);
        }
        if (seq !== this.regenerationSeq) {
            return;
        }
        this.result = result;
        this.error = error;
        this.fire();
    }

    /** Debounced `load()` — call on any external change to the list, log or config files. */
    scheduleReload(): void {
        if (this.disposed) {
            return;
        }
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.load().catch(err => console.error('[shopping-list] Reload failed:', err));
        }, this.reloadDebounceMs);
    }

    dispose(): void {
        this.disposed = true;
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = undefined;
        }
        this.listeners.clear();
    }

    /**
     * `{ path, scale }` for every node: a parent contributes its own
     * ingredients and each child is scaled by its parent's multiplier.
     */
    protected flattenForGeneration(): Array<{ path: string; scale: number }> {
        const out: Array<{ path: string; scale: number }> = [];
        const walk = (item: ShoppingListRecipeItem, parentScale: number): void => {
            const scale = (item.multiplier ?? 1) * parentScale;
            out.push({ path: item.path, scale });
            item.children.forEach(child => walk(child, scale));
        };
        this.list.items.forEach(item => walk(item, 1));
        return out;
    }

    protected async save(): Promise<void> {
        await this.files.write(LIST_FILE, await this.api.writeShoppingList(this.list));
    }

    protected async appendCheckEntry(entry: CheckEntry): Promise<void> {
        const line = await this.api.writeShoppingChecked([entry]);
        const existing = (await this.files.read(CHECKED_FILE)) ?? '';
        await this.files.write(CHECKED_FILE, existing + line);
        this.checkedLog.push(entry);
        applyEntry(this.checkedSet, entry);
        this.fire();
    }

    /** Keep only log entries whose ingredient is still in the result (cookcli policy). */
    protected async compactCheckedLog(): Promise<void> {
        if (!this.result) {
            return;
        }
        const names = [
            ...this.result.categories.flatMap(category => category.items.map(item => item.name)),
            ...this.result.other.items.map(item => item.name),
        ];
        const compacted = await this.api.compactShoppingChecked(this.checkedLog, names);
        if (compacted.length === 0) {
            await this.files.delete(CHECKED_FILE);
        } else {
            await this.files.write(CHECKED_FILE, await this.api.writeShoppingChecked(compacted));
        }
        this.checkedLog = compacted;
        this.checkedSet = checkedSetOf(compacted);
        this.fire();
    }

    protected fire(): void {
        this.listeners.forEach(listener => listener());
    }
}

function toRecipeItem(reference: ResolvedRecipeReference): ShoppingListRecipeItem {
    return {
        type: 'recipe',
        path: reference.path.replace(/^\.\//, ''),
        multiplier: reference.scale === 1 ? undefined : reference.scale,
        children: (reference.children ?? []).map(toRecipeItem),
    };
}

/** Last write wins; names compare lower-cased, as in cooklang-rs. */
function checkedSetOf(entries: readonly CheckEntry[]): Set<string> {
    const set = new Set<string>();
    entries.forEach(entry => applyEntry(set, entry));
    return set;
}

function applyEntry(set: Set<string>, entry: CheckEntry): void {
    const key = entry.name.toLowerCase();
    if (entry.type === 'checked') {
        set.add(key);
    } else {
        set.delete(key);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS — 2 (api) + 18 (store) passing.

- [ ] **Step 5: Commit**

```bash
git add shopping-list/src/shopping-list-store.ts shopping-list/src/shopping-list-store.spec.ts
git commit -m "feat(shopping-list): list store ported from the editor's shopping-list service"
```

---

### Task 4: Command argument handling

**Files:** create `shopping-list/src/command-args.ts`, `shopping-list/src/command-args.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/command-args.spec.ts`:

```ts
import * as assert from 'assert';
import { isMenuPath, parseAddRecipesRequest, resolveTarget, ResourceUri } from './command-args';

const uri = (path: string): ResourceUri => ({ scheme: 'file', path });
const resolver = (active?: ResourceUri) => ({
    relativePath: (resource: ResourceUri) => resource.path.startsWith('/ws/') ? resource.path.slice('/ws/'.length) : undefined,
    activeUri: () => active,
});

describe('resolveTarget', () => {
    it('uses an outlet context as-is, keeping its scale', () => {
        assert.deepStrictEqual(resolveTarget([{ version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 3 }], resolver()),
            { path: 'a.cook', scale: 3 });
    });

    it('falls back to scale 1 for a missing or invalid context scale', () => {
        assert.deepStrictEqual(resolveTarget([{ version: 1, uri: 'x', path: 'a.cook', scale: -1 }], resolver()), { path: 'a.cook', scale: 1 });
    });

    it('turns an explorer / editor-title Uri into a workspace-relative path', () => {
        assert.deepStrictEqual(resolveTarget([uri('/ws/Dinner/Soup.cook'), [uri('/ws/Dinner/Soup.cook')]], resolver()),
            { path: 'Dinner/Soup.cook', scale: 1 });
    });

    it('uses the active editor when invoked without arguments', () => {
        assert.deepStrictEqual(resolveTarget([], resolver(uri('/ws/Soup.cook'))), { path: 'Soup.cook', scale: 1 });
    });

    it('returns undefined outside the workspace or with nothing to add', () => {
        assert.strictEqual(resolveTarget([uri('/elsewhere/Cake.cook')], resolver()), undefined);
        assert.strictEqual(resolveTarget([], resolver()), undefined);
    });
});

describe('isMenuPath', () => {
    it('matches .menu case-insensitively', () => {
        assert.strictEqual(isMenuPath('Plans/Week.MENU'), true);
        assert.strictEqual(isMenuPath('Soup.cook'), false);
    });
});

describe('parseAddRecipesRequest', () => {
    it('accepts recipes with optional scales', () => {
        assert.deepStrictEqual(parseAddRecipesRequest({ recipes: [{ path: 'a.cook', scale: 2 }, { path: 'b.cook' }] }),
            { recipes: [{ path: 'a.cook', scale: 2 }, { path: 'b.cook', scale: 1 }] });
    });

    it('accepts a menu', () => {
        assert.deepStrictEqual(parseAddRecipesRequest({ menu: 'Week.menu' }), { menu: 'Week.menu' });
    });

    it('rejects anything else with a message', () => {
        for (const bad of [undefined, {}, { recipes: [] }, { recipes: [{ scale: 1 }] }, { recipes: [{ path: 'a', scale: 0 }] }, { menu: '' }]) {
            assert.strictEqual(typeof (parseAddRecipesRequest(bad) as { error?: string }).error, 'string', JSON.stringify(bad));
        }
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './command-args'`.

- [ ] **Step 3: Implement**

`src/command-args.ts`:

```ts
/** Minimal shape of `vscode.Uri` this module needs. */
export interface ResourceUri {
    readonly scheme: string;
    readonly path: string;
}

export interface RecipeTarget {
    /** Workspace-relative. */
    path: string;
    scale: number;
}

export interface TargetResolver {
    /** Workspace-relative path, or undefined outside the workspace. */
    relativePath(uri: ResourceUri): string | undefined;
    activeUri(): ResourceUri | undefined;
}

export type AddRecipesRequest = { recipes: RecipeTarget[] } | { menu: string };

interface OutletContext {
    version: number;
    path: string;
    scale?: unknown;
}

function isOutletContext(arg: unknown): arg is OutletContext {
    return typeof arg === 'object' && arg !== null
        && typeof (arg as OutletContext).version === 'number'
        && typeof (arg as OutletContext).path === 'string';
}

function isResourceUri(arg: unknown): arg is ResourceUri {
    return typeof arg === 'object' && arg !== null
        && typeof (arg as ResourceUri).scheme === 'string'
        && typeof (arg as ResourceUri).path === 'string';
}

function positive(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The recipe or menu a command should act on, from how it was invoked:
 * a Cooklang outlet context (preview buttons), a `vscode.Uri` (explorer and
 * editor title; the explorer also passes the selection as a second argument),
 * or nothing (command palette → active editor).
 */
export function resolveTarget(args: readonly unknown[], resolver: TargetResolver): RecipeTarget | undefined {
    const [first] = args;
    if (isOutletContext(first)) {
        return { path: first.path, scale: positive(first.scale) ?? 1 };
    }
    const uri = isResourceUri(first) ? first : resolver.activeUri();
    if (!uri) {
        return undefined;
    }
    const path = resolver.relativePath(uri);
    return path === undefined ? undefined : { path, scale: 1 };
}

export function isMenuPath(path: string): boolean {
    return /\.menu$/i.test(path);
}

/** Validates the argument of `shoppingList.addRecipes` (used by Cookbot). */
export function parseAddRecipesRequest(arg: unknown): AddRecipesRequest | { error: string } {
    if (typeof arg !== 'object' || arg === null) {
        return { error: 'Expected { recipes: [{ path, scale? }] } or { menu: path }.' };
    }
    const request = arg as { recipes?: unknown; menu?: unknown };
    if (typeof request.menu === 'string' && request.menu.trim() !== '') {
        return { menu: request.menu.trim() };
    }
    if (!Array.isArray(request.recipes) || request.recipes.length === 0) {
        return { error: 'Expected { recipes: [{ path, scale? }] } or { menu: path }.' };
    }
    const recipes: RecipeTarget[] = [];
    for (const entry of request.recipes) {
        const recipe = (typeof entry === 'object' && entry !== null ? entry : {}) as { path?: unknown; scale?: unknown };
        if (typeof recipe.path !== 'string' || recipe.path.trim() === '') {
            return { error: 'Every recipe needs a `path`.' };
        }
        const scale = recipe.scale === undefined ? 1 : positive(recipe.scale);
        if (scale === undefined) {
            return { error: `Recipe scale must be a positive number: ${recipe.path}` };
        }
        recipes.push({ path: recipe.path.trim(), scale });
    }
    return { recipes };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (new: 9 tests).

- [ ] **Step 5: Commit**

```bash
git add shopping-list/src/command-args.ts shopping-list/src/command-args.spec.ts
git commit -m "feat(shopping-list): normalise command arguments from outlets, explorer and palette"
```

---

### Task 5: View model and message protocol

**Files:** create `shopping-list/src/view-model.ts`, `shopping-list/src/view-model.spec.ts`, `shopping-list/src/protocol.ts`

- [ ] **Step 1: Write the failing test**

`src/view-model.spec.ts`:

```ts
import * as assert from 'assert';
import { displayCategories, displayNameFromPath, recipeRows } from './view-model';

describe('view model', () => {
    it('names entries after the file, without extension or folders', () => {
        assert.strictEqual(displayNameFromPath('Dinner/Carbonara.cook'), 'Carbonara');
        assert.strictEqual(displayNameFromPath('Plans/Week.MENU'), 'Week');
        assert.strictEqual(displayNameFromPath('Bread'), 'Bread');
    });

    it('builds recipe rows with scale and a menu summary', () => {
        assert.deepStrictEqual(recipeRows([
            { type: 'recipe', path: 'Soup.cook', children: [] },
            { type: 'recipe', path: 'Week.menu', multiplier: 2, children: [
                { type: 'recipe', path: 'a', children: [] }, { type: 'recipe', path: 'b', children: [] },
            ] },
        ]), [
            { index: 0, name: 'Soup', scale: 1 },
            { index: 1, name: 'Week', scale: 2, detail: 'menu (2 recipes)' },
        ]);
    });

    it('drops empty aisles and appends sorted uncategorised items', () => {
        assert.deepStrictEqual(displayCategories({
            categories: [{ name: 'produce', items: [{ name: 'garlic', quantities: '3' }] }, { name: 'dairy', items: [] }],
            other: { name: 'other', items: [{ name: 'salt', quantities: '' }, { name: 'flour', quantities: '1 kg' }] },
            pantryItems: [],
        }), [
            { name: 'produce', items: [{ name: 'garlic', quantities: '3' }] },
            { name: 'other', items: [{ name: 'flour', quantities: '1 kg' }, { name: 'salt', quantities: '' }] },
        ]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './view-model'`.

- [ ] **Step 3: Implement**

`src/view-model.ts` (browser-safe: no Node or `vscode` imports — it is bundled into the webview):

```ts
import type { ShoppingListCategory, ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

export interface RecipeRow {
    index: number;
    name: string;
    scale: number;
    /** e.g. "menu (3 recipes)" */
    detail?: string;
}

export function displayNameFromPath(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.(cook|menu)$/i, '');
}

export function recipeRows(items: readonly ShoppingListRecipeItem[]): RecipeRow[] {
    return items.map((item, index) => {
        const row: RecipeRow = { index, name: displayNameFromPath(item.path), scale: item.multiplier ?? 1 };
        if (item.children.length > 0 && /\.menu$/i.test(item.path)) {
            row.detail = `menu (${item.children.length} recipes)`;
        }
        return row;
    });
}

/** Aisles in aisle.conf order (empty ones dropped), then uncategorised items sorted by name. */
export function displayCategories(result: ShoppingListResult): ShoppingListCategory[] {
    const categories = result.categories.filter(category => category.items.length > 0);
    if (result.other.items.length > 0) {
        categories.push({ ...result.other, items: [...result.other.items].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return categories;
}
```

`src/protocol.ts`:

```ts
import type { ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

/** Everything the webview renders. */
export interface ViewState {
    /** False when no folder is open. */
    hasWorkspace: boolean;
    items: ShoppingListRecipeItem[];
    result?: ShoppingListResult;
    /** Lower-cased checked ingredient names. */
    checked: string[];
    error?: string;
}

export type ToWebview = { type: 'state'; state: ViewState };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'remove'; index: number }
    | { type: 'scale'; index: number; scale: number }
    | { type: 'clear' }
    | { type: 'toggle'; name: string };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shopping-list/src/view-model.ts shopping-list/src/view-model.spec.ts shopping-list/src/protocol.ts
git commit -m "feat(shopping-list): view model and webview message protocol"
```

---

### Task 6: Webview UI

**Files:** create `shopping-list/src/webview/main.ts`, `shopping-list/media/shopping-list.css`

- [ ] **Step 1: Webview script**

`src/webview/main.ts` — plain DOM, `textContent` only (no HTML injection from file content):

```ts
import type { FromWebview, ToWebview, ViewState } from '../protocol';
import { displayCategories, recipeRows } from '../view-model';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
let pantryExpanded = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function renderRecipes(state: ViewState): HTMLElement {
    if (state.items.length === 0) {
        return element('div', 'empty', 'No recipes yet. Add recipes from the preview, the explorer, or the editor title bar.');
    }
    const section = element('div', 'recipes');
    const header = element('div', 'recipes-header');
    header.append(element('span', 'section-title', 'Selected Recipes'));
    const clear = element('button', 'clear', 'Clear All');
    clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    header.append(clear);
    section.append(header);
    for (const row of recipeRows(state.items)) {
        const line = element('div', 'recipe-row');
        const main = element('div', 'recipe-main');
        main.append(element('span', 'recipe-name', row.name));
        if (row.detail) { main.append(element('span', 'recipe-detail', row.detail)); }
        const scale = element('input', 'scale');
        scale.type = 'number';
        scale.min = '0.5';
        scale.max = '100';
        scale.step = '0.5';
        scale.value = String(row.scale);
        scale.title = 'Scale factor';
        scale.addEventListener('change', () => {
            const value = parseFloat(scale.value);
            if (Number.isFinite(value) && value > 0) {
                vscode.postMessage({ type: 'scale', index: row.index, scale: value });
            }
        });
        const remove = element('button', 'remove', '×');
        remove.title = 'Remove from shopping list';
        remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', index: row.index }));
        line.append(main, scale, remove);
        section.append(line);
    }
    return section;
}

function renderResult(state: ViewState): HTMLElement[] {
    if (state.error) {
        return [element('div', 'error', `Could not build the list: ${state.error}`)];
    }
    if (!state.result) {
        return [];
    }
    const checked = new Set(state.checked);
    const nodes: HTMLElement[] = [];
    for (const category of displayCategories(state.result)) {
        const block = element('div', 'category');
        block.append(element('h3', 'section-title', category.name));
        for (const item of category.items) {
            const isChecked = checked.has(item.name.toLowerCase());
            const label = element('label', isChecked ? 'ingredient checked' : 'ingredient');
            const box = element('input');
            box.type = 'checkbox';
            box.checked = isChecked;
            box.addEventListener('change', () => vscode.postMessage({ type: 'toggle', name: item.name }));
            label.append(box, element('span', 'ingredient-name', item.name));
            if (item.quantities) { label.append(element('span', 'ingredient-qty', item.quantities)); }
            block.append(label);
        }
        nodes.push(block);
    }
    if (state.result.pantryItems.length > 0) {
        const pantry = element('div', 'pantry');
        const toggle = element('button', 'pantry-toggle', `${pantryExpanded ? '▼' : '▶'} In Pantry (${state.result.pantryItems.length})`);
        toggle.addEventListener('click', () => { pantryExpanded = !pantryExpanded; render(state); });
        pantry.append(toggle);
        if (pantryExpanded) {
            const list = element('ul', 'pantry-list');
            state.result.pantryItems.forEach(name => list.append(element('li', undefined, name)));
            pantry.append(list);
        }
        nodes.push(pantry);
    }
    return nodes;
}

function render(state: ViewState): void {
    if (!state.hasWorkspace) {
        root.replaceChildren(element('div', 'empty', 'Open a recipe folder to use the shopping list.'));
        return;
    }
    root.replaceChildren(renderRecipes(state), ...renderResult(state));
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    if (event.data?.type === 'state') {
        render(event.data.state);
    }
});
vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 2: Styles**

`media/shopping-list.css` (port of the editor's `shopping-list.css`, `--theia-*` → `--vscode-*`):

```css
body {
    padding: 0;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.6;
}

#root { padding: 12px 16px; }

.empty {
    padding: 16px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    text-align: center;
}

.error { padding: 8px 0; color: var(--vscode-errorForeground); }

.section-title {
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 4px 0;
}

.recipes {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
}

.recipes-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }

.clear {
    background: none;
    border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
}

.clear:hover { color: var(--vscode-foreground); border-color: var(--vscode-foreground); }

.recipe-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
}

.recipe-row:last-child { border-bottom: none; }
.recipe-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.recipe-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recipe-detail { font-size: 0.85em; color: var(--vscode-descriptionForeground); }

.scale {
    width: 48px;
    padding: 2px 4px;
    font-size: 0.85em;
    text-align: center;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 3px;
}

.remove {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    line-height: 1;
}

.remove:hover { color: var(--vscode-errorForeground); }

.category { margin-bottom: 12px; }
.category .section-title { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }

.ingredient { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
.ingredient input { margin: 0; accent-color: var(--vscode-focusBorder); }
.ingredient-name { flex: 1; }
.ingredient-qty { color: var(--vscode-descriptionForeground); font-size: 0.85em; white-space: nowrap; }
.ingredient.checked { opacity: 0.5; }
.ingredient.checked .ingredient-name { text-decoration: line-through; }

.pantry { margin-top: 16px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }

.pantry-toggle {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 0.85em;
    font-weight: 600;
    padding: 4px 0;
}

.pantry-toggle:hover { text-decoration: underline; color: var(--vscode-foreground); }
.pantry-list { list-style: none; margin: 4px 0 0 0; padding: 0 0 0 20px; }
.pantry-list li { font-size: 0.85em; color: var(--vscode-descriptionForeground); padding: 2px 0; }
```

- [ ] **Step 3: Build**

Run: `npm run compile && ls out/webview.js`
Expected: tsc passes, esbuild writes `out/webview.js`.

- [ ] **Step 4: Commit**

```bash
git add shopping-list/src/webview/main.ts shopping-list/media/shopping-list.css
git commit -m "feat(shopping-list): webview UI"
```

---

### Task 7: Controller and activation (vscode glue)

**Files:** create `shopping-list/src/shopping-list-controller.ts`, `shopping-list/src/extension.ts`

- [ ] **Step 1: Controller**

`src/shopping-list-controller.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { isMenuPath, parseAddRecipesRequest, RecipeTarget, resolveTarget, TargetResolver } from './command-args';
import { FromWebview, ToWebview, ViewState } from './protocol';
import { ListFiles, ShoppingListStore } from './shopping-list-store';

const VIEW_ID = 'shoppingList.view';

/** `workspace.fs` at one root, by file name. */
class WorkspaceListFiles implements ListFiles {
    constructor(protected readonly root: vscode.Uri) { }

    async read(name: string): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, name)));
        } catch (e) {
            if (isNotFound(e)) { return undefined; }
            throw e;
        }
    }

    async write(name: string, text: string): Promise<void> {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.root, name), new TextEncoder().encode(text));
    }

    async delete(name: string): Promise<void> {
        try {
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, name));
        } catch (e) {
            if (!isNotFound(e)) { throw e; }
        }
    }
}

function isNotFound(e: unknown): boolean {
    const code = (e as { code?: string }).code;
    return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

/** Owns the store for the first workspace folder, the webview view and the commands. */
export class ShoppingListController implements vscode.WebviewViewProvider {

    protected store: ShoppingListStore | undefined;
    protected storeDisposables: vscode.Disposable[] = [];
    protected view: vscode.WebviewView | undefined;

    constructor(protected readonly context: vscode.ExtensionContext, protected readonly api: CooklangApi) { }

    start(): void {
        const { subscriptions } = this.context;
        subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEW_ID, this),
            vscode.commands.registerCommand('shoppingList.show', () => this.reveal()),
            vscode.commands.registerCommand('shoppingList.addRecipe', (...args: unknown[]) => this.run(() => this.addRecipe(args))),
            vscode.commands.registerCommand('shoppingList.addMenu', (...args: unknown[]) => this.run(() => this.addMenu(args))),
            vscode.commands.registerCommand('shoppingList.addRecipes', (arg: unknown) => this.addRecipes(arg)),
            vscode.commands.registerCommand('shoppingList.clear', () => this.run(async () => this.requireStore().clearAll())),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.openStore()),
            { dispose: () => this.closeStore() },
        );
        this.openStore();
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const out = vscode.Uri.joinPath(this.context.extensionUri, 'out');
        view.webview.options = { enableScripts: true, localResourceRoots: [media, out] };
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'shopping-list.css'));
        const script = view.webview.asWebviewUri(vscode.Uri.joinPath(out, 'webview.js'));
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
        view.webview.onDidReceiveMessage((message: FromWebview) => this.onMessage(message));
        view.onDidDispose(() => { this.view = undefined; });
    }

    protected openStore(): void {
        this.closeStore();
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.postState();
            return;
        }
        const store = new ShoppingListStore(new WorkspaceListFiles(folder.uri), this.api);
        this.store = store;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, '{.shopping-list,.shopping-checked,config/aisle.conf,config/pantry.conf}'));
        const reload = (): void => store.scheduleReload();
        this.storeDisposables = [
            watcher,
            watcher.onDidChange(reload),
            watcher.onDidCreate(reload),
            watcher.onDidDelete(reload),
            store.onDidChange(() => this.postState()),
        ];
        store.load().catch(err => console.error('[shopping-list] initial load failed:', err));
    }

    protected closeStore(): void {
        this.storeDisposables.forEach(disposable => disposable.dispose());
        this.storeDisposables = [];
        this.store?.dispose();
        this.store = undefined;
    }

    protected requireStore(): ShoppingListStore {
        if (!this.store) {
            throw new Error('Open a recipe folder to use the shopping list.');
        }
        return this.store;
    }

    protected resolver(): TargetResolver {
        return {
            relativePath: uri => {
                const resource = vscode.Uri.from({ scheme: uri.scheme, path: uri.path });
                return vscode.workspace.getWorkspaceFolder(resource) ? vscode.workspace.asRelativePath(resource, false) : undefined;
            },
            activeUri: () => vscode.window.activeTextEditor?.document.uri,
        };
    }

    protected async addRecipe(args: unknown[]): Promise<void> {
        const target = resolveTarget(args, this.resolver());
        if (!target || isMenuPath(target.path)) {
            return;
        }
        await this.addTarget(target);
        await this.reveal();
    }

    protected async addMenu(args: unknown[]): Promise<void> {
        const target = resolveTarget(args, this.resolver());
        if (!target || !isMenuPath(target.path)) {
            return;
        }
        await this.addTarget(target);
        await this.reveal();
    }

    protected async addTarget(target: RecipeTarget): Promise<void> {
        const store = this.requireStore();
        const references = await this.api.resolveRecipeReferences(target.path);
        if (isMenuPath(target.path)) {
            if (references.length === 0) {
                vscode.window.showWarningMessage(`${target.path} has no recipe references to add.`);
                return;
            }
            await store.addMenu(target.path, target.scale, references);
        } else {
            await store.addRecipe(target.path, target.scale, references);
        }
    }

    /** Programmatic entry point (Cookbot). Returns the live list; throws with a message on bad input. */
    protected async addRecipes(arg: unknown): Promise<unknown> {
        const request = parseAddRecipesRequest(arg);
        if ('error' in request) {
            throw new Error(request.error);
        }
        const targets = 'menu' in request ? [{ path: request.menu, scale: 1 }] : request.recipes;
        for (const target of targets) {
            await this.addTarget(target);
        }
        await this.reveal();
        return this.store?.getResult();
    }

    protected async onMessage(message: FromWebview): Promise<void> {
        if (message.type === 'ready') {
            this.postState();
            return;
        }
        const store = this.store;
        if (!store) {
            return;
        }
        await this.run(async () => {
            switch (message.type) {
                case 'remove': return store.removeRecipe(message.index);
                case 'scale': return store.updateScale(message.index, message.scale);
                case 'clear': return store.clearAll();
                case 'toggle': return store.isChecked(message.name) ? store.uncheckItem(message.name) : store.checkItem(message.name);
            }
        });
    }

    protected postState(): void {
        if (!this.view) {
            return;
        }
        const store = this.store;
        const state: ViewState = store
            ? {
                hasWorkspace: true,
                items: [...store.getItems()],
                result: store.getResult(),
                checked: store.getCheckedNames(),
                error: store.getError(),
            }
            : { hasWorkspace: false, items: [], checked: [] };
        const message: ToWebview = { type: 'state', state };
        this.view.webview.postMessage(message);
    }

    protected async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.shoppingList');
        }
    }

    /** Runs a user action, surfacing failures as an error notification. */
    protected async run(action: () => Promise<unknown>): Promise<void> {
        try {
            await action();
        } catch (e) {
            vscode.window.showErrorMessage(`Shopping List: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
```

- [ ] **Step 2: Activation**

`src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { ShoppingListController } from './shopping-list-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi((command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)));
    let version: number | undefined;
    try {
        version = await api.version();
    } catch {
        version = undefined;
    }
    if (version !== SUPPORTED_API_VERSION) {
        vscode.window.showWarningMessage(
            `Shopping List needs Cook Editor's Cooklang API version ${SUPPORTED_API_VERSION}` +
            ` (found ${version ?? 'none'}). Update Cook Editor to use it.`);
        return;
    }
    new ShoppingListController(context, api).start();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 3: Build and test**

Run: `npm test && npm run compile`
Expected: all specs pass; `out/extension.js` and `out/webview.js` exist.

- [ ] **Step 4: Commit**

```bash
git add shopping-list/src/shopping-list-controller.ts shopping-list/src/extension.ts
git commit -m "feat(shopping-list): commands, file watching and the webview view"
```

---

### Task 8: Deploy into the editor and verify end to end

**Files:** none new (manual/E2E verification; fixes go into the relevant task's files)

- [ ] **Step 1: Deploy**

Run: `npm run deploy`
Expected: `Deployed to /Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets/plugins/cooklang.shopping-list`.

- [ ] **Step 2: Prepare a test workspace**

```bash
mkdir -p ~/tmp/sl-e2e/config ~/tmp/sl-e2e/Plans
cat > ~/tmp/sl-e2e/Sauce.cook <<'EOF'
---
servings: 2
---
Melt @butter{30%g} and whisk in @flour{2%tbsp}.
EOF
cat > ~/tmp/sl-e2e/Pasta.cook <<'EOF'
---
servings: 4
---
Boil @pasta{400%g} with @salt. Serve with @./Sauce{4%servings}.
EOF
cat > ~/tmp/sl-e2e/Plans/Week.menu <<'EOF'
Monday:
- @./Pasta{2}
EOF
cat > ~/tmp/sl-e2e/config/aisle.conf <<'EOF'
[dry goods]
pasta
flour
[dairy]
butter
EOF
cat > ~/tmp/sl-e2e/config/pantry.conf <<'EOF'
[pantry]
salt = "1%kg"
EOF
```

(Frontmatter is YAML — never the deprecated `>>` metadata syntax. If the menu reference syntax differs in this workspace's parser, copy an existing `.menu` from the editor's test fixtures: `find ~/Cooklang/editor-worktrees/plugin-outlets -name "*.menu" -not -path "*/node_modules/*" | head`.)

- [ ] **Step 3: Launch the editor**

Quit Cook Editor.app (single-instance lock). Then:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets/app
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npm run bundle && npm run start -- --log-level=debug --remote-debugging-port=9222 ~/tmp/sl-e2e
```

Dismiss the workspace-trust dialog ("Yes, I trust the authors") before clicking anything.

- [ ] **Step 4: Check every behaviour**

Verify by hand (drive with CDP/puppeteer if running unattended — `NODE_PATH=<editor>/node_modules node script.js` with `puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })`; the webview lives in an iframe, reach it via `page.frames()`):

1. Activity bar shows the cart; the Shopping List view says "No recipes yet…".
2. Open `Pasta.cook` preview → the header shows the cart (plugin) and Show Source. Set scale 2, click the cart → the view reveals; `.shopping-list` contains `Pasta.cook` with `*2` and `Sauce` nested; items grouped under `dry goods` and `dairy`; "In Pantry (1)" lists salt.
3. Check `pasta` → struck through; `.shopping-checked` gains a line. Uncheck → reversed.
4. Change the entry's scale in the view → quantities update; `.shopping-list` updated.
5. Explorer right-click `Plans/Week.menu` → "Add Menu to Shopping List" adds it as one entry "Week — menu (1 recipes)".
6. Open `Week.menu` preview → cart in its header adds the menu.
7. Edit `.shopping-list` in the editor and save → view reloads. Edit `config/aisle.conf` → grouping changes.
8. Remove an entry → checked items no longer present disappear from `.shopping-checked`.
9. Clear All → both files deleted.
10. Command palette: "Shopping List: Add to Shopping List" is listed only with a `.cook` editor active; "Add Recipes to Shopping List" is never listed; no `cooklang.api` entries.
11. Cookbot: "add Pasta to my shopping list" → confirm the tool call; the view shows it.
12. Right-click an ingredient in the preview → the native default menu appears (no outlet items contributed) — confirms the outlet stays out of the way.
13. Disable the plugin (Extensions view) and reload → cart buttons gone from both previews.

If `shoppingList.view.focus` does not exist in Theia (step 2 reveals nothing), check `vscode.commands.getCommands()` output in the plugin host log and switch `reveal()` to the command that exists; if the `RelativePattern` watcher ignores dotfiles (step 7 fails), watch `'**/*'` filtered to the four names in the handler instead.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A shopping-list
git commit -m "fix(shopping-list): <what the E2E run found>"
```

(Skip if nothing changed.)

---

### Task 9: Document, package and publish

**Files:** modify `README.md` (repo root)

- [ ] **Step 1: List the plugin**

In the root `README.md` table add:

```markdown
| [`shopping-list`](./shopping-list) | Aisle-grouped shopping lists with pantry subtraction. Ships with Cook Editor. Shows the Cooklang API and outlets. |
```

- [ ] **Step 2: Package**

Run: `cd shopping-list && npm run package`
Expected: `shopping-list-0.1.0.vsix` created with no vsce errors. `unzip -l shopping-list-0.1.0.vsix | grep -E "out/(extension|webview).js|media/"` lists the bundle and media, and no `src/` or `.spec.js`.

- [ ] **Step 3: Push and open the PR**

```bash
git add README.md
git commit -m "docs: list the shopping-list plugin"
git push -u origin feature/shopping-list
gh pr create --title "feat: shopping-list plugin" --body "Cook Editor's shopping list as a plugin, built on the cooklang.api commands and Cooklang outlets. Spec: cook-md/editor docs/superpowers/specs/2026-09-24-shopping-list-plugin-design.md"
```

- [ ] **Step 4: Publish (needs the user)**

Ask the user to run, with their plugins.cook.md PAT:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/shopping-list
OVSX_PAT=<PAT> npm run publish:marketplace
```

Then verify: `curl -sI https://plugins.cook.md/api/cooklang/shopping-list/0.1.0/file/cooklang.shopping-list-0.1.0.vsix | head -1` → 200/302. Continue with editor plan Task 10.
