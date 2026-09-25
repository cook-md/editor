# Recipe Hub — Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `cooklang.recipe-hub` plugin (PR 3 of the spec). It searches recipes.cooklang.org from a Cook Editor side panel with structured filters, opens any result in the standard recipe preview through a read-only `cooklang-hub:` file system, and saves it to `Drafts/` with `cooklang.api.saveDraft`. It then ships by default with the editor, the way `shopping-list` does.

**Architecture:** Pure modules with no `vscode` import hold all the logic and are unit-tested with mocha:
- `search-query.ts`: filter state and the query string.
- `hub-urls.ts`: URL helpers.
- `hub-client.ts`: typed `fetch` client that maps errors to kinds.
- `hub-uri.ts`: `cooklang-hub:` paths.
- `hub-file-system-core.ts`: LRU cache, fallback to `enclosure_url`, read-only errors.
- `recipe-draft.ts`: `saveDraft` arguments, YAML frontmatter.
- `cooklang-api.ts`: editor commands.
- `protocol.ts`: webview messages.

Only three thin files touch `vscode`, mirroring `shopping-list`'s split between controller and view provider:
- `hub-file-system.ts`: adapts the core to `vscode.FileSystemProvider`.
- `search-view-provider.ts`: the webview view that runs searches in the extension host.
- `recipe-hub-controller.ts`: commands, settings, and registration of the file system.

The webview (`webview/main.ts`) renders plain DOM and is bundled with esbuild. It makes no network requests; the only remote content it loads is thumbnails (`img-src https:` plus the server origin).

**Tech Stack:** VS Code extension API 1.100 (Theia supports 1.110), TypeScript 5.4, Node's global `fetch` in the extension host, mocha, esbuild (webview bundle only), `@vscode/vsce`, `ovsx`.

**Spec:** `editor/docs/superpowers/specs/2026-09-25-recipe-hub-plugin-design.md`. This plan covers §3 (3.1–3.5), the Plugin and E2E bullets of §4, and shipping the plugin by default.

**Prerequisites:**
- **PR 1 (federation)** is deployed to recipes.cooklang.org, with the structured search params, richer cards and `/api/facets`. Tasks 1–12 and the stub-server part of Task 13 don't need it.
- **PR 2 (editor)**, per `editor/docs/superpowers/plans/2026-09-25-recipe-hub-editor.md`, provides:
  - `cooklang.api.saveDraft({ version: 1, content, title?, frontmatter? })`. It returns the saved URI string, writes only YAML, and never overwrites an existing frontmatter key.
  - `cooklang.api.openPreview({ uri })`.
  - Previews of non-`file` URIs that render `image: https://…` frontmatter natively. The plugin does not rewrite images.
  - The `cooklangPreviewScheme` context key, scoped to the preview node and usable in `cooklang/recipePreview/toolbar` `when` clauses.

  PR 2 is required for Task 13 onwards. If it is still in a worktree, set `COOK_EDITOR_DIR` to that worktree for `npm run deploy`.

**Facts checked against the code and the editor plan (they differ from the spec):**
1. **There is no `cooklang.openPreview`.** Today's hidden `cooklang.openPreviewAtScale` is not public API, and the preview's open handler refuses non-`file` URIs on purpose. PR 2 adds `cooklang.api.openPreview({ uri })`, and the plugin calls only that.
2. **`CooklangPluginApi.VERSION` stays `1`.** It is an integer, and the shipped shopping-list checks `version !== 1`, so a bump would disable it. The plugin does **not** gate on a version. Instead it detects the new commands by looking for `cooklang.api.saveDraft` and `cooklang.api.openPreview` in `vscode.commands.getCommands(true)`. If one is missing, the plugin says "Update Cook Editor to save drafts" (or "…to preview Recipe Hub recipes").
3. The recipe preview passes its outlet commands a `PreviewOutletContext { version, uri, path, scale }` (`packages/cooklang/src/common/cooklang-outlet-context.ts`). Outside the workspace, `path` is `''`. Hub commands read `uri`.
4. Today the federation returns **500 "Search error"** for an invalid `q`, not 400. The plugin maps 400 to the inline "bad query" state and 5xx to the server-error state with Retry. PR 1 should turn query-parse errors into `Error::Validation` (400) so the inline message shows the parser's text.

---

## Working environment

- Plugins repo: `/Users/alexeydubovskoy/Cooklang/plugins` (github.com/cook-md/plugins). Task 1 creates the branch.
- Node: use Node 22 in every shell, because mocha and the editor both need it:

  ```bash
  export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
  ```

- Conventions copied from `shopping-list/`:
  - MIT licence;
  - `engines.vscode ^1.100.0` and `@types/vscode ~1.100.0`;
  - mocha over the compiled `out/**/*.spec.js`;
  - webview CSS uses `--vscode-*` variables only;
  - `scripts/deploy.js` copies into `<editor>/plugins/<publisher>.<name>`.
- Frontmatter is always YAML. Never write the deprecated `>>` metadata syntax, in code, tests or fixtures (the one exception is the test input that exercises converting it).

## File Structure

All paths are under `recipe-hub/` unless stated otherwise.

| File | Responsibility | `vscode`? |
|---|---|---|
| `package.json` | Manifest: activity-bar container, webview view, `recipeHub.serverUrl`, three commands, preview-toolbar outlet entries, scripts | — |
| `tsconfig.json`, `.vscodeignore`, `LICENSE`, `README.md` | Build and packaging (same as shopping-list) | — |
| `scripts/deploy.js` | Copies the build into `<editor>/plugins/cooklang.recipe-hub` | — |
| `media/recipe-hub.svg` | Activity-bar icon (Lucide `globe`, `currentColor`) | — |
| `media/save-light.svg`, `media/save-dark.svg` | "Save to Drafts" toolbar icon (Lucide `file-down`) | — |
| `media/external-light.svg`, `media/external-dark.svg` | "Open Original Recipe" toolbar icon (Lucide `external-link`) | — |
| `media/recipe-hub.css` | Webview styles | — |
| `src/search-query.ts` (+ spec) | `SearchFilters`, filter helpers, filters → `/api/search` params, default-locale logic | No |
| `src/hub-urls.ts` (+ spec) | Server-URL trimming, http(s) validation, origin for the CSP, original-recipe URL, thumbnail allow-check | No |
| `src/hub-client.ts` (+ spec) | `HubClient.search/facets/recipe/download/fetchText`; timeout; `HubError` kinds; tolerant normalisation | No |
| `src/hub-uri.ts` (+ spec) | `cooklang-hub:/recipes/<id>/<Title>.cook` paths; outlet-context URI | No |
| `src/hub-file-system-core.ts` (+ spec) | `RecipeContentCache` (LRU 50), `HubFileSystemCore` (stat/read/readDirectory/denyWrite), `loadRecipeContent` (download, falling back to `enclosure_url`) | No |
| `src/recipe-draft.ts` (+ spec) | `SaveDraftArgs`, `buildSaveDraftArgs` (`source:`), legacy `>>` → YAML frontmatter, `yamlScalar` | No |
| `src/cooklang-api.ts` (+ spec) | `cooklang.api.saveDraft`, `cooklang.api.openPreview`; feature detection over the command list | No |
| `src/protocol.ts` (+ spec) | `ToWebview` / `FromWebview` and `parseFromWebview` (validates untrusted messages) | No |
| `src/webview/main.ts` | Panel UI: search box, filters, cards, Load more, states; `setState` persistence | No (DOM) |
| `src/hub-file-system.ts` | `vscode.FileSystemProvider` adapter over `HubFileSystemCore` | Yes |
| `src/search-view-provider.ts` | `WebviewViewProvider`: HTML and CSP, message handling, request sequence, facets | Yes |
| `src/recipe-hub-controller.ts` | Settings, `HubClient` factory, FS registration, commands (`search`, `saveToDrafts`, `openSource`), preview opening | Yes |
| `src/extension.ts` | `activate()`: start the controller, then warn if the editor lacks `saveDraft`/`openPreview` | Yes |

Other repos:

| File | Change |
|---|---|
| `plugins/shopping-list/package.json` | `when: cooklangPreviewScheme == file` on the preview-toolbar cart (§3.5); version 0.1.2 |
| `plugins/shopping-list/README.md` | One line about hub previews |
| `plugins/README.md` | Table row for `recipe-hub` |
| `editor/package.json` | `theiaPlugins`: add `cooklang.recipe-hub` 0.1.0, bump `cooklang.shopping-list` to 0.1.2 |

---

### Task 1: Branch, and hide the shopping-list cart on hub previews (§3.5)

**Decision (§3.5): hide the cart on hub previews.** The shopping list does **not** read recipes through `workspace.fs` by URI. `shoppingList.addRecipe` takes `context.path` from the outlet context (`command-args.ts` → `resolveTarget`) and passes that workspace-relative path to `cooklang.api.resolveRecipeReferences` and `cooklang.api.generateShoppingList`, which read from disk through the native crate. It also stores the path in `.shopping-list`.

For a recipe outside the workspace, PR 2 sets the outlet `path` to `''`, so `addRecipe` would fail validation. The fix is `when: cooklangPreviewScheme == file` on the cart's `cooklang/recipePreview/toolbar` entry, plus a patch version bump. No code changes: `CooklangPluginApi.VERSION` stays `1`, so shopping-list's version check is unaffected.

**Files:**
- Modify: `shopping-list/package.json`
- Modify: `shopping-list/README.md`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git fetch origin
git switch -c feat/recipe-hub origin/main
```

- [ ] **Step 2: Scope the cart to `file` previews and bump the version**

In `shopping-list/package.json`:
- change `"version": "0.1.1"` to `"version": "0.1.2"`;
- replace the `cooklang/recipePreview/toolbar` block with:

```json
      "cooklang/recipePreview/toolbar": [
        {
          "command": "shoppingList.addRecipe",
          "when": "cooklangPreviewScheme == file",
          "group": "navigation@10"
        }
      ],
```

The menu-preview toolbar entry is unchanged, because menus only come from the workspace.

In `shopping-list/README.md`, after the bullet that starts `- Add a recipe or a whole`, add:

```markdown
- The cart is hidden on Recipe Hub previews: remote recipes are not in your
  folder, so save one to Drafts first.
```

- [ ] **Step 3: Check nothing else changed**

Run: `cd shopping-list && npm test && node -e "const p=require('./package.json'); console.log(p.version, JSON.stringify(p.contributes.menus['cooklang/recipePreview/toolbar']))"`
Expected:
- `40 passing`;
- `0.1.2 [{"command":"shoppingList.addRecipe","when":"cooklangPreviewScheme == file","group":"navigation@10"}]`.

Task 13 checks the behaviour by hand: the cart shows on a local preview and is hidden on a hub preview.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add shopping-list
git commit -m "fix(shopping-list): hide the cart on non-file (Recipe Hub) previews (0.1.2)"
```

---

### Task 2: Scaffold the `recipe-hub` package

**Files:**
- Create: `recipe-hub/package.json`
- Create: `recipe-hub/tsconfig.json`
- Create: `recipe-hub/.vscodeignore`
- Create: `recipe-hub/LICENSE`
- Create: `recipe-hub/scripts/deploy.js`
- Create: `recipe-hub/media/recipe-hub.svg`
- Create: `recipe-hub/media/save-light.svg`
- Create: `recipe-hub/media/save-dark.svg`
- Create: `recipe-hub/media/external-light.svg`
- Create: `recipe-hub/media/external-dark.svg`

- [ ] **Step 1: Manifest**

Create `recipe-hub/package.json`:

```json
{
  "name": "recipe-hub",
  "displayName": "Recipe Hub",
  "description": "Search the public Cooklang recipe index (recipes.cooklang.org), preview any recipe, and save it to your Drafts. Ships with Cook Editor.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cook-md/plugins.git",
    "directory": "recipe-hub"
  },
  "keywords": [
    "cooklang",
    "recipes",
    "search",
    "recipe hub",
    "federation"
  ],
  "engines": {
    "vscode": "^1.100.0"
  },
  "categories": [
    "Other"
  ],
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartupFinished",
    "onFileSystem:cooklang-hub"
  ],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "recipeHub",
          "title": "Recipe Hub",
          "icon": "media/recipe-hub.svg"
        }
      ]
    },
    "views": {
      "recipeHub": [
        {
          "type": "webview",
          "id": "recipeHub.view",
          "name": "Recipe Hub"
        }
      ]
    },
    "configuration": {
      "title": "Recipe Hub",
      "properties": {
        "recipeHub.serverUrl": {
          "type": "string",
          "default": "https://recipes.cooklang.org",
          "description": "Address of the Recipe Hub server to search."
        }
      }
    },
    "commands": [
      {
        "command": "recipeHub.search",
        "title": "Search Recipes",
        "category": "Recipe Hub"
      },
      {
        "command": "recipeHub.saveToDrafts",
        "title": "Save to Drafts",
        "category": "Recipe Hub",
        "icon": {
          "light": "media/save-light.svg",
          "dark": "media/save-dark.svg"
        }
      },
      {
        "command": "recipeHub.openSource",
        "title": "Open Original Recipe",
        "category": "Recipe Hub",
        "icon": {
          "light": "media/external-light.svg",
          "dark": "media/external-dark.svg"
        }
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "recipeHub.saveToDrafts",
          "when": "false"
        },
        {
          "command": "recipeHub.openSource",
          "when": "false"
        }
      ],
      "cooklang/recipePreview/toolbar": [
        {
          "command": "recipeHub.saveToDrafts",
          "when": "cooklangPreviewScheme == cooklang-hub",
          "group": "navigation@5"
        },
        {
          "command": "recipeHub.openSource",
          "when": "cooklangPreviewScheme == cooklang-hub",
          "group": "navigation@6"
        }
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
    "publish:marketplace": "ovsx publish --packagePath recipe-hub-$npm_package_version.vsix -r https://plugins.cook.md"
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

`onFileSystem:cooklang-hub` activates the plugin as soon as Theia needs the scheme. That covers a hub preview restored from the previous session's layout before `onStartupFinished` fires.

- [ ] **Step 2: tsconfig, .vscodeignore, LICENSE**

Create `recipe-hub/tsconfig.json`:

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

Create `recipe-hub/.vscodeignore`:

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

Copy the licence (MIT, © 2026 Alexey Dubovskoy, identical to shopping-list's):

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
cp shopping-list/LICENSE recipe-hub/LICENSE
```

- [ ] **Step 3: Deploy script**

Create `recipe-hub/scripts/deploy.js`:

```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. a worktree holding PR 2).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.recipe-hub');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'media', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 4: Icons (Lucide, ISC)**

Create `recipe-hub/media/recipe-hub.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
```

Create `recipe-hub/media/save-light.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#424242" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
```

Create `recipe-hub/media/save-dark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C5C5C5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
```

Create `recipe-hub/media/external-light.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#424242" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/></svg>
```

Create `recipe-hub/media/external-dark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C5C5C5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/></svg>
```

- [ ] **Step 5: Install**

Run: `cd recipe-hub && npm install`
Expected: installs with no errors, creates `package-lock.json` and `node_modules/`, both ignored or committed as in shopping-list (the lock file is committed). `npx tsc --version` prints `Version 5.4.x`.

- [ ] **Step 6: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub
git commit -m "feat(recipe-hub): scaffold the package"
```

---

### Task 3: `search-query.ts`: filters to API params (TDD)

**Files:**
- Create: `recipe-hub/src/search-query.ts`
- Test: `recipe-hub/src/search-query.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/search-query.spec.ts`:

```ts
import * as assert from 'assert';
import {
    activeFilterCount, addTerm, clearFilters, emptyFilters, parseFilters, primaryLanguage, resolveDefaultLocale,
    SearchFilters, toSearchParams,
} from './search-query';

const FULL: SearchFilters = {
    q: 'tags:dinner pasta',
    tags: ['vegan', 'dessert'],
    includeIngredients: ['garlic', 'lemon'],
    excludeIngredients: ['peanut'],
    maxTime: 30,
    difficulty: 'Easy',
    minServings: 2,
    maxServings: 6,
    locale: 'de',
    sort: 'newest',
    feed: { id: 12, title: 'Anna' },
};

function entries(params: URLSearchParams): Record<string, string> {
    const out: Record<string, string> = {};
    params.forEach((value, key) => { out[key] = value; });
    return out;
}

describe('toSearchParams', () => {
    it('sends only paging for empty filters', () => {
        assert.deepStrictEqual(entries(toSearchParams(emptyFilters(), 1)), { page: '1', limit: '20' });
    });

    it('maps every filter to its API parameter', () => {
        assert.deepStrictEqual(entries(toSearchParams(FULL, 3, 20)), {
            q: 'tags:dinner pasta',
            tags: 'vegan,dessert',
            include_ingredients: 'garlic,lemon',
            exclude_ingredients: 'peanut',
            max_time: '30',
            min_servings: '2',
            max_servings: '6',
            difficulty: 'easy',
            feed_id: '12',
            locale: 'de',
            sort: 'newest',
            page: '3',
            limit: '20',
        });
    });

    it('normalises and de-duplicates list values', () => {
        const params = toSearchParams({ ...emptyFilters(), tags: [' Vegan ', 'vegan', 'a,b', '  '] }, 1);
        assert.strictEqual(params.get('tags'), 'vegan,a b');
    });

    it('drops invalid numbers and falls back to page 1', () => {
        const filters: SearchFilters = { ...emptyFilters(), maxTime: 0, minServings: 2.5, maxServings: -1 };
        assert.deepStrictEqual(entries(toSearchParams(filters, 0, 0)), { page: '1', limit: '20' });
    });

    it('omits sort=relevance', () => {
        assert.strictEqual(toSearchParams(emptyFilters(), 1).has('sort'), false);
    });
});

describe('parseFilters', () => {
    it('accepts a complete filter object', () => {
        assert.deepStrictEqual(parseFilters(FULL), FULL);
    });

    it('rejects malformed input', () => {
        for (const bad of [undefined, null, 'x', {}, { ...emptyFilters(), sort: 'best' }, { ...emptyFilters(), tags: [1] }, { ...emptyFilters(), q: 5 }]) {
            assert.strictEqual(parseFilters(bad), undefined, JSON.stringify(bad));
        }
    });

    it('drops invalid optional fields', () => {
        assert.deepStrictEqual(
            parseFilters({ ...emptyFilters('en'), maxTime: -5, minServings: 'two', difficulty: ' ', feed: { id: 0, title: 'x' }, tags: [' Vegan', 'vegan'] }),
            { ...emptyFilters('en'), tags: ['vegan'] });
    });
});

describe('filter helpers', () => {
    it('addTerm normalises and ignores duplicates', () => {
        assert.deepStrictEqual(addTerm(['vegan'], ' Vegan '), ['vegan']);
        assert.deepStrictEqual(addTerm(['vegan'], 'Gluten, free'), ['vegan', 'gluten free']);
        assert.deepStrictEqual(addTerm([], '  '), []);
    });

    it('activeFilterCount counts structured filters only', () => {
        assert.strictEqual(activeFilterCount(emptyFilters()), 0);
        assert.strictEqual(activeFilterCount({ ...emptyFilters('en'), q: 'x', sort: 'newest' }), 1);
        assert.strictEqual(activeFilterCount({ ...emptyFilters(), tags: ['a', 'b'], minServings: 2, maxServings: 4, maxTime: 15 }), 4);
        assert.strictEqual(activeFilterCount(FULL), 10);
    });

    it('clearFilters keeps the query and sort', () => {
        assert.deepStrictEqual(clearFilters(FULL, 'en'), { ...emptyFilters('en'), q: 'tags:dinner pasta', sort: 'newest' });
    });
});

describe('default locale', () => {
    it('primaryLanguage takes the language subtag', () => {
        assert.strictEqual(primaryLanguage('en-US'), 'en');
        assert.strictEqual(primaryLanguage('pt_BR'), 'pt');
        assert.strictEqual(primaryLanguage('DE'), 'de');
        assert.strictEqual(primaryLanguage(''), '');
    });

    it('resolveDefaultLocale keeps the display language only when recipes exist in it', () => {
        assert.strictEqual(resolveDefaultLocale('de-AT', undefined), 'de');
        assert.strictEqual(resolveDefaultLocale('de-AT', []), 'de');
        assert.strictEqual(resolveDefaultLocale('de-AT', [{ code: 'en' }, { code: 'DE' }]), 'de');
        assert.strictEqual(resolveDefaultLocale('fr', [{ code: 'en' }]), '');
    });
});
```

(`activeFilterCount(FULL)` = 2 tags + 2 include + 1 exclude + time + difficulty + servings + locale + feed = 10.)

- [ ] **Step 2: Run and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/recipe-hub && npm test`
Expected: tsc error `Cannot find module './search-query'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/search-query.ts`:

```ts
// Filter state shared by the webview and the extension host, and its mapping
// to the Recipe Hub `GET /api/search` query string. No `vscode` import: the
// webview bundle and the mocha specs both use it.

export type SortOrder = 'relevance' | 'newest';

/** Results per page; "Load more" fetches the next page. */
export const PAGE_SIZE = 20;

/** Max-time presets in minutes; `maxTime` undefined means any. */
export const MAX_TIME_PRESETS: readonly number[] = [15, 30, 60];

export interface FeedFilter {
    id: number;
    title: string;
}

export interface SearchFilters {
    /** Free text; the full `q` syntax (e.g. `tags:vegan`) is passed through. */
    q: string;
    /** Recipe has all of these tags. */
    tags: string[];
    /** Recipe uses all of these. */
    includeIngredients: string[];
    /** Recipe uses none of these. */
    excludeIngredients: string[];
    /** Total time at most this many minutes. */
    maxTime?: number;
    difficulty?: string;
    minServings?: number;
    maxServings?: number;
    /** Language code such as `en`; empty means any language. */
    locale: string;
    sort: SortOrder;
    /** Only recipes from this feed. */
    feed?: FeedFilter;
}

export function emptyFilters(locale = ''): SearchFilters {
    return { q: '', tags: [], includeIngredients: [], excludeIngredients: [], locale, sort: 'relevance' };
}

/** Keeps the query text and sort order; resets every filter, the language back to `defaultLocale`. */
export function clearFilters(filters: SearchFilters, defaultLocale: string): SearchFilters {
    return { ...emptyFilters(defaultLocale), q: filters.q, sort: filters.sort };
}

/** How many filters are set. The query text and the sort order are not filters. */
export function activeFilterCount(filters: SearchFilters): number {
    return filters.tags.length + filters.includeIngredients.length + filters.excludeIngredients.length
        + (filters.maxTime !== undefined ? 1 : 0)
        + (filters.difficulty !== undefined ? 1 : 0)
        + (filters.minServings !== undefined || filters.maxServings !== undefined ? 1 : 0)
        + (filters.locale !== '' ? 1 : 0)
        + (filters.feed !== undefined ? 1 : 0);
}

/** A tag or ingredient as typed: trimmed, lower-cased, commas removed (they separate list items on the wire). */
export function normalizeTerm(term: string): string {
    return term.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `list` plus the normalised `term`; unchanged when the term is empty or already present. */
export function addTerm(list: readonly string[], term: string): string[] {
    const normalized = normalizeTerm(term);
    if (normalized === '' || list.includes(normalized)) {
        return [...list];
    }
    return [...list, normalized];
}

function positiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function terms(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
        return undefined;
    }
    return [...new Set((value as string[]).map(normalizeTerm).filter(term => term !== ''))];
}

/** Query parameters for `GET /api/search`; empty and invalid filters are left out. */
export function toSearchParams(filters: SearchFilters, page: number, limit: number = PAGE_SIZE): URLSearchParams {
    const params = new URLSearchParams();
    const q = filters.q.trim();
    if (q !== '') {
        params.set('q', q);
    }
    const list = (key: string, values: readonly string[]): void => {
        const cleaned = [...new Set(values.map(normalizeTerm).filter(value => value !== ''))];
        if (cleaned.length > 0) {
            params.set(key, cleaned.join(','));
        }
    };
    const number = (key: string, value: number | undefined): void => {
        const valid = positiveInteger(value);
        if (valid !== undefined) {
            params.set(key, String(valid));
        }
    };
    list('tags', filters.tags);
    list('include_ingredients', filters.includeIngredients);
    list('exclude_ingredients', filters.excludeIngredients);
    number('max_time', filters.maxTime);
    number('min_servings', filters.minServings);
    number('max_servings', filters.maxServings);
    if (filters.difficulty !== undefined && filters.difficulty.trim() !== '') {
        params.set('difficulty', filters.difficulty.trim().toLowerCase());
    }
    number('feed_id', filters.feed?.id);
    if (filters.locale.trim() !== '') {
        params.set('locale', filters.locale.trim());
    }
    if (filters.sort === 'newest') {
        params.set('sort', 'newest');
    }
    params.set('page', String(positiveInteger(page) ?? 1));
    params.set('limit', String(positiveInteger(limit) ?? PAGE_SIZE));
    return params;
}

/**
 * Filters from untrusted input (webview messages, persisted webview state).
 * Undefined when the required fields are missing; invalid optional fields are dropped.
 */
export function parseFilters(value: unknown): SearchFilters | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const tags = terms(raw.tags);
    const includeIngredients = terms(raw.includeIngredients);
    const excludeIngredients = terms(raw.excludeIngredients);
    if (typeof raw.q !== 'string' || typeof raw.locale !== 'string' || !tags || !includeIngredients || !excludeIngredients) {
        return undefined;
    }
    if (raw.sort !== 'relevance' && raw.sort !== 'newest') {
        return undefined;
    }
    const filters: SearchFilters = { q: raw.q, tags, includeIngredients, excludeIngredients, locale: raw.locale, sort: raw.sort };
    const maxTime = positiveInteger(raw.maxTime);
    if (maxTime !== undefined) {
        filters.maxTime = maxTime;
    }
    const minServings = positiveInteger(raw.minServings);
    if (minServings !== undefined) {
        filters.minServings = minServings;
    }
    const maxServings = positiveInteger(raw.maxServings);
    if (maxServings !== undefined) {
        filters.maxServings = maxServings;
    }
    if (typeof raw.difficulty === 'string' && raw.difficulty.trim() !== '') {
        filters.difficulty = raw.difficulty.trim();
    }
    const feed = raw.feed as { id?: unknown; title?: unknown } | undefined;
    const feedId = typeof feed === 'object' && feed !== null ? positiveInteger(feed.id) : undefined;
    if (feedId !== undefined && typeof feed?.title === 'string') {
        filters.feed = { id: feedId, title: feed.title };
    }
    return filters;
}

/** `en-US` → `en`. */
export function primaryLanguage(displayLanguage: string): string {
    return displayLanguage.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * The language filter to start with: the editor's display language, unless the
 * index is known to have no recipes in it (then any language).
 */
export function resolveDefaultLocale(displayLanguage: string, locales?: ReadonlyArray<{ code: string }>): string {
    const primary = primaryLanguage(displayLanguage);
    if (!locales || locales.length === 0) {
        return primary;
    }
    return locales.some(locale => locale.code.toLowerCase() === primary) ? primary : '';
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `13 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/search-query.ts recipe-hub/src/search-query.spec.ts
git commit -m "feat(recipe-hub): search filters and their API parameters"
```

---

### Task 4: `hub-urls.ts`: URL helpers (TDD)

**Files:**
- Create: `recipe-hub/src/hub-urls.ts`
- Test: `recipe-hub/src/hub-urls.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/hub-urls.spec.ts`:

```ts
import * as assert from 'assert';
import { httpUrl, isDisplayableImageUrl, originalRecipeUrl, serverOrigin, trimServerUrl } from './hub-urls';

describe('hub URLs', () => {
    it('trimServerUrl drops whitespace and trailing slashes', () => {
        assert.strictEqual(trimServerUrl(' https://hub.example// '), 'https://hub.example');
    });

    it('httpUrl accepts only http(s) URLs', () => {
        assert.strictEqual(httpUrl('https://blog.example/pasta'), 'https://blog.example/pasta');
        assert.strictEqual(httpUrl(' http://localhost:8080/x '), 'http://localhost:8080/x');
        assert.strictEqual(httpUrl('javascript:alert(1)'), undefined);
        assert.strictEqual(httpUrl('not a url'), undefined);
        assert.strictEqual(httpUrl(undefined), undefined);
    });

    it('serverOrigin is the origin of an http(s) server URL', () => {
        assert.strictEqual(serverOrigin('http://localhost:8080/'), 'http://localhost:8080');
        assert.strictEqual(serverOrigin('https://recipes.cooklang.org'), 'https://recipes.cooklang.org');
        assert.strictEqual(serverOrigin('ftp://hub.example'), undefined);
    });

    it('originalRecipeUrl prefers the source and falls back to the Recipe Hub page', () => {
        assert.strictEqual(originalRecipeUrl('https://blog.example/pasta', 'https://hub.example/', 7), 'https://blog.example/pasta');
        assert.strictEqual(originalRecipeUrl(undefined, 'https://hub.example/', 7), 'https://hub.example/recipes/7');
        assert.strictEqual(originalRecipeUrl('javascript:x', 'https://hub.example', 7), 'https://hub.example/recipes/7');
    });

    it('isDisplayableImageUrl allows https images and images from the server', () => {
        assert.strictEqual(isDisplayableImageUrl('https://img.example/a.jpg', ''), true);
        assert.strictEqual(isDisplayableImageUrl('http://localhost:8765/a.jpg', 'http://localhost:8765'), true);
        assert.strictEqual(isDisplayableImageUrl('http://img.example/a.jpg', 'http://localhost:8765'), false);
        assert.strictEqual(isDisplayableImageUrl('data:image/png;base64,AAAA', ''), false);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './hub-urls'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/hub-urls.ts`:

```ts
// URL helpers shared by the extension host and the webview bundle. No `vscode` import.

/** `serverUrl` without surrounding whitespace or trailing slashes. */
export function trimServerUrl(serverUrl: string): string {
    return serverUrl.trim().replace(/\/+$/, '');
}

/** `value` as a normalised http(s) URL; undefined for anything else. */
export function httpUrl(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

/** Origin of the configured server, for the webview CSP and thumbnail checks. */
export function serverOrigin(serverUrl: string): string | undefined {
    const url = httpUrl(trimServerUrl(serverUrl));
    return url === undefined ? undefined : new URL(url).origin;
}

/** The recipe's page on the Recipe Hub website. */
export function hubRecipePageUrl(serverUrl: string, id: number): string {
    return `${trimServerUrl(serverUrl)}/recipes/${id}`;
}

/**
 * Where "Open Original Recipe" goes and what a draft's `source:` records: the
 * recipe's own page when it has an http(s) `source_url`, else its Recipe Hub page.
 */
export function originalRecipeUrl(sourceUrl: string | undefined, serverUrl: string, id: number): string {
    return httpUrl(sourceUrl) ?? hubRecipePageUrl(serverUrl, id);
}

/** Card thumbnails: any https image, or one from the configured server (plain http in development). */
export function isDisplayableImageUrl(url: string, origin: string): boolean {
    const valid = httpUrl(url);
    if (valid === undefined) {
        return false;
    }
    const parsed = new URL(valid);
    return parsed.protocol === 'https:' || (origin !== '' && parsed.origin === origin);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `18 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/hub-urls.ts recipe-hub/src/hub-urls.spec.ts
git commit -m "feat(recipe-hub): URL helpers"
```

---

### Task 5: `hub-client.ts`: typed client with error kinds (TDD)

**Files:**
- Create: `recipe-hub/src/hub-client.ts`
- Test: `recipe-hub/src/hub-client.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/hub-client.spec.ts`:

```ts
import * as assert from 'assert';
import { FetchLike, FetchResponseLike, HubClient, HubError, HubErrorKind } from './hub-client';
import { emptyFilters } from './search-query';

const BASE = 'https://hub.example';

interface Call {
    url: string;
    accept: string;
}

function stubFetch(reply: (url: string) => FetchResponseLike): { fetch: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, accept: init.headers.Accept });
        return reply(url);
    };
    return { fetch, calls };
}

function response(status: number, body: string): FetchResponseLike {
    return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function json(status: number, value: unknown): FetchResponseLike {
    return response(status, JSON.stringify(value));
}

async function rejection(promise: Promise<unknown>): Promise<HubError> {
    try {
        await promise;
    } catch (e) {
        assert.ok(e instanceof HubError, `expected a HubError, got ${String(e)}`);
        return e;
    }
    return assert.fail('expected a rejection');
}

describe('HubClient', () => {
    it('searches with the filter params and maps a full card', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            results: [{
                id: 7, title: 'Pasta Bake', summary: 'Cheesy', tags: ['pasta'], locale: 'en',
                total_time_minutes: 40, servings: 4, difficulty: 'easy', image_url: 'https://img.example/p.jpg',
                feed: { id: 3, title: 'Anna\'s Kitchen' },
            }],
            pagination: { page: 1, limit: 20, total: 41, total_pages: 3 },
        }));
        const page = await new HubClient({ baseUrl: `${BASE}/`, fetch }).search({ ...emptyFilters('en'), q: 'pasta', tags: ['vegan'] }, 1);
        assert.deepStrictEqual(calls, [{ url: `${BASE}/api/search?q=pasta&tags=vegan&locale=en&page=1&limit=20`, accept: 'application/json' }]);
        assert.deepStrictEqual(page, {
            cards: [{
                id: 7, title: 'Pasta Bake', summary: 'Cheesy', tags: ['pasta'], locale: 'en', totalTimeMinutes: 40,
                servings: 4, difficulty: 'easy', imageUrl: 'https://img.example/p.jpg', feed: { id: 3, title: 'Anna\'s Kitchen' },
            }],
            page: 1, total: 41, totalPages: 3, hasMore: true,
        });
    });

    it('tolerates cards without the optional fields (older servers)', async () => {
        const { fetch } = stubFetch(() => json(200, {
            results: [{ id: 1, title: 'Soup', summary: null, tags: ['a', 3], locale: null }, { id: 'x' }],
            pagination: { page: 2, limit: 20, total: 21, total_pages: 2 },
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 2), {
            cards: [{ id: 1, title: 'Soup', tags: ['a'] }], page: 2, total: 21, totalPages: 2, hasMore: false,
        });
    });

    it('maps HTTP errors to kinds', async () => {
        const cases: Array<[number, string, HubErrorKind, string]> = [
            [400, JSON.stringify({ error: 'Invalid query: expected \':\'' }), 'badQuery', 'Invalid query: expected \':\''],
            [404, JSON.stringify({ error: 'Recipe not found' }), 'notFound', 'Recipe not found'],
            [429, 'Too Many Requests! Wait for 2s', 'rateLimited', 'Too many searches — try again shortly.'],
            [500, JSON.stringify({ error: 'Search error' }), 'server', 'Recipe Hub error: Search error'],
            [502, '<html>Bad gateway</html>', 'server', 'Recipe Hub error (HTTP 502).'],
        ];
        for (const [status, body, kind, message] of cases) {
            const { fetch } = stubFetch(() => response(status, body));
            const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1));
            assert.deepStrictEqual([error.kind, error.message, error.status], [kind, message, status]);
        }
    });

    it('reports an unreachable server as a network error', async () => {
        const fetch: FetchLike = async () => {
            throw Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') });
        };
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).facets());
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'Could not reach Recipe Hub (connect ECONNREFUSED 127.0.0.1:9).');
    });

    it('reports a timeout as a network error', async () => {
        const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch, timeoutMs: 20 }).download(1));
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'Recipe Hub did not respond in time.');
    });

    it('treats a non-JSON success as a server error', async () => {
        const { fetch } = stubFetch(() => response(200, '<html>maintenance</html>'));
        assert.strictEqual((await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1))).kind, 'server');
    });

    it('treats a search response without results as a server error', async () => {
        const { fetch } = stubFetch(() => json(200, { hello: 1 }));
        assert.strictEqual((await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1))).kind, 'server');
    });

    it('rejects an invalid server URL without a request', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {}));
        const error = await rejection(new HubClient({ baseUrl: 'recipes.cooklang.org', fetch }).search(emptyFilters(), 1));
        assert.strictEqual(error.kind, 'network');
        assert.ok(error.message.includes('recipeHub.serverUrl'), error.message);
        assert.strictEqual(calls.length, 0);
    });

    it('normalises facets', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            tags: [{ name: 'dessert', count: 12 }, { name: 5 }],
            locales: [{ code: 'en', name: 'English', count: 900 }, { code: 'de', count: 3 }],
            difficulties: [{ name: 'easy', count: 4 }],
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).facets(), {
            tags: [{ name: 'dessert', count: 12 }],
            locales: [{ code: 'en', name: 'English', count: 900 }, { code: 'de', name: 'de', count: 3 }],
            difficulties: [{ name: 'easy', count: 4 }],
        });
        assert.strictEqual(calls[0].url, `${BASE}/api/facets`);
    });

    it('normalises recipe details', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            id: 7, title: 'Pasta Bake', summary: null, source_url: 'https://blog.example/pasta',
            enclosure_url: 'https://feed.example/pasta.cook', image_url: null, feed: { id: 3, title: 'Anna', author: null },
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).recipe(7), {
            id: 7, title: 'Pasta Bake', sourceUrl: 'https://blog.example/pasta',
            enclosureUrl: 'https://feed.example/pasta.cook', feed: { id: 3, title: 'Anna' },
        });
        assert.strictEqual(calls[0].url, `${BASE}/api/recipes/7`);
    });

    it('downloads recipe text', async () => {
        const { fetch, calls } = stubFetch(() => response(200, 'Boil @pasta{400%g}.\n'));
        assert.strictEqual(await new HubClient({ baseUrl: BASE, fetch }).download(7), 'Boil @pasta{400%g}.\n');
        assert.deepStrictEqual(calls, [{ url: `${BASE}/api/recipes/7/download`, accept: 'text/plain' }]);
    });

    it('fetchText only follows http(s) URLs', async () => {
        const { fetch, calls } = stubFetch(() => response(200, 'from the feed'));
        const client = new HubClient({ baseUrl: BASE, fetch });
        assert.strictEqual((await rejection(client.fetchText('file:///etc/passwd'))).kind, 'notFound');
        assert.strictEqual(calls.length, 0);
        assert.strictEqual(await client.fetchText('https://feed.example/pasta.cook'), 'from the feed');
        assert.deepStrictEqual(calls, [{ url: 'https://feed.example/pasta.cook', accept: 'text/plain' }]);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './hub-client'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/hub-client.ts`:

```ts
// Typed client for the Recipe Hub (recipes.cooklang.org) public API. Runs in
// the extension host on Node's global `fetch`; no `vscode` import, so the
// specs stub `fetch`. Optional response fields may be missing (older
// servers): cards simply come back without them.

import { httpUrl, trimServerUrl } from './hub-urls';
import { PAGE_SIZE, SearchFilters, toSearchParams } from './search-query';

export const DEFAULT_SERVER_URL = 'https://recipes.cooklang.org';
export const DEFAULT_TIMEOUT_MS = 15000;

export type HubErrorKind = 'network' | 'badQuery' | 'rateLimited' | 'server' | 'notFound';

/** Every failure of a Recipe Hub request, with a message fit for the UI. */
export class HubError extends Error {
    constructor(readonly kind: HubErrorKind, message: string, readonly status?: number) {
        super(message);
        this.name = 'HubError';
    }
}

export interface HubFeed {
    id: number;
    title?: string;
    author?: string;
}

export interface RecipeCard {
    id: number;
    title: string;
    summary?: string;
    tags: string[];
    locale?: string;
    totalTimeMinutes?: number;
    servings?: number;
    difficulty?: string;
    imageUrl?: string;
    feed?: HubFeed;
}

export interface SearchPage {
    cards: RecipeCard[];
    page: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
}

export interface FacetCount {
    name: string;
    count: number;
}

export interface LocaleFacet {
    code: string;
    name: string;
    count: number;
}

export interface Facets {
    tags: FacetCount[];
    locales: LocaleFacet[];
    difficulties: FacetCount[];
}

export interface RecipeDetail {
    id: number;
    title: string;
    summary?: string;
    sourceUrl?: string;
    enclosureUrl?: string;
    imageUrl?: string;
    feed?: HubFeed;
}

/** The part of a fetch `Response` the client reads. */
export interface FetchResponseLike {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
}

export interface FetchInitLike {
    signal: AbortSignal;
    headers: Record<string, string>;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface HubClientOptions {
    baseUrl: string;
    fetch?: FetchLike;
    timeoutMs?: number;
}

export class HubClient {

    readonly baseUrl: string;
    protected readonly fetchImpl: FetchLike;
    protected readonly timeoutMs: number;

    constructor(options: HubClientOptions) {
        this.baseUrl = trimServerUrl(options.baseUrl);
        this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async search(filters: SearchFilters, page: number, limit: number = PAGE_SIZE): Promise<SearchPage> {
        return normalizeSearchPage(await this.getJson(`/api/search?${toSearchParams(filters, page, limit).toString()}`));
    }

    async facets(): Promise<Facets> {
        return normalizeFacets(await this.getJson('/api/facets'));
    }

    async recipe(id: number): Promise<RecipeDetail> {
        return normalizeDetail(await this.getJson(`/api/recipes/${id}`));
    }

    /** The recipe's Cooklang source. */
    async download(id: number): Promise<string> {
        return this.get(this.apiUrl(`/api/recipes/${id}/download`), 'text/plain');
    }

    /** Text at an absolute http(s) URL, e.g. a feed's `enclosure_url`. */
    async fetchText(url: string): Promise<string> {
        const valid = httpUrl(url);
        if (valid === undefined) {
            throw new HubError('notFound', 'The recipe file is not at an http(s) address.');
        }
        return this.get(valid, 'text/plain');
    }

    protected apiUrl(pathAndQuery: string): string {
        if (httpUrl(this.baseUrl) === undefined) {
            throw new HubError('network', `Invalid Recipe Hub server URL "${this.baseUrl}". Check the recipeHub.serverUrl setting.`);
        }
        return this.baseUrl + pathAndQuery;
    }

    protected async getJson(pathAndQuery: string): Promise<unknown> {
        const body = await this.get(this.apiUrl(pathAndQuery), 'application/json');
        try {
            return JSON.parse(body);
        } catch {
            throw new HubError('server', 'Recipe Hub sent an unexpected response.');
        }
    }

    protected async get(url: string, accept: string): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            let response: FetchResponseLike;
            let body: string;
            try {
                response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: accept } });
                body = await response.text();
            } catch (e) {
                throw networkError(e, controller.signal.aborted);
            }
            if (!response.ok) {
                throw httpError(response.status, body);
            }
            return body;
        } finally {
            clearTimeout(timer);
        }
    }
}

function networkError(e: unknown, timedOut: boolean): HubError {
    if (timedOut) {
        return new HubError('network', 'Recipe Hub did not respond in time.');
    }
    const cause = typeof e === 'object' && e !== null ? (e as { cause?: { message?: unknown } }).cause?.message : undefined;
    const reason = typeof cause === 'string' ? cause : e instanceof Error ? e.message : String(e);
    return new HubError('network', `Could not reach Recipe Hub (${reason}).`);
}

/** The `{ "error": "…" }` message the server puts in error bodies. */
function serverMessage(body: string): string | undefined {
    try {
        const parsed = JSON.parse(body) as { error?: unknown };
        return typeof parsed.error === 'string' && parsed.error.trim() !== '' ? parsed.error : undefined;
    } catch {
        return undefined;
    }
}

function httpError(status: number, body: string): HubError {
    const message = serverMessage(body);
    switch (status) {
        case 400: return new HubError('badQuery', message ?? 'Recipe Hub could not understand this search.', status);
        case 404: return new HubError('notFound', message ?? 'Not found on Recipe Hub.', status);
        case 429: return new HubError('rateLimited', 'Too many searches — try again shortly.', status);
        default: return new HubError('server', message ? `Recipe Hub error: ${message}` : `Recipe Hub error (HTTP ${status}).`, status);
    }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

/** `value` without its undefined properties, so results compare and serialise cleanly. */
function compact<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function unexpected(): HubError {
    return new HubError('server', 'Recipe Hub sent an unexpected response.');
}

function normalizeFeed(value: unknown): HubFeed | undefined {
    const raw = asObject(value);
    const id = optionalNumber(raw?.id);
    if (!raw || id === undefined) {
        return undefined;
    }
    return compact({ id, title: optionalString(raw.title), author: optionalString(raw.author) });
}

function normalizeCard(value: unknown): RecipeCard | undefined {
    const raw = asObject(value);
    const id = optionalNumber(raw?.id);
    const title = optionalString(raw?.title);
    if (!raw || id === undefined || title === undefined) {
        return undefined;
    }
    return compact({
        id,
        title,
        summary: optionalString(raw.summary),
        tags: stringList(raw.tags),
        locale: optionalString(raw.locale),
        totalTimeMinutes: optionalNumber(raw.total_time_minutes),
        servings: optionalNumber(raw.servings),
        difficulty: optionalString(raw.difficulty),
        imageUrl: optionalString(raw.image_url),
        feed: normalizeFeed(raw.feed),
    });
}

function normalizeSearchPage(body: unknown): SearchPage {
    const raw = asObject(body);
    if (!raw || !Array.isArray(raw.results)) {
        throw unexpected();
    }
    const cards = raw.results.map(normalizeCard).filter((card): card is RecipeCard => card !== undefined);
    const pagination = asObject(raw.pagination);
    const page = optionalNumber(pagination?.page) ?? 1;
    const total = optionalNumber(pagination?.total) ?? cards.length;
    const totalPages = optionalNumber(pagination?.total_pages) ?? page;
    return { cards, page, total, totalPages, hasMore: page < totalPages };
}

function facetCounts(value: unknown): FacetCount[] {
    const counts: FacetCount[] = [];
    for (const item of Array.isArray(value) ? value : []) {
        const raw = asObject(item);
        const name = optionalString(raw?.name);
        if (name !== undefined) {
            counts.push({ name, count: optionalNumber(raw?.count) ?? 0 });
        }
    }
    return counts;
}

function normalizeFacets(body: unknown): Facets {
    const raw = asObject(body) ?? {};
    const locales: LocaleFacet[] = [];
    for (const item of Array.isArray(raw.locales) ? raw.locales : []) {
        const locale = asObject(item);
        const code = optionalString(locale?.code);
        if (code !== undefined) {
            locales.push({ code, name: optionalString(locale?.name) ?? code, count: optionalNumber(locale?.count) ?? 0 });
        }
    }
    return { tags: facetCounts(raw.tags), locales, difficulties: facetCounts(raw.difficulties) };
}

function normalizeDetail(body: unknown): RecipeDetail {
    const raw = asObject(body);
    const id = optionalNumber(raw?.id);
    const title = optionalString(raw?.title);
    if (!raw || id === undefined || title === undefined) {
        throw unexpected();
    }
    return compact({
        id,
        title,
        summary: optionalString(raw.summary),
        sourceUrl: optionalString(raw.source_url),
        enclosureUrl: optionalString(raw.enclosure_url),
        imageUrl: optionalString(raw.image_url),
        feed: normalizeFeed(raw.feed),
    });
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `30 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/hub-client.ts recipe-hub/src/hub-client.spec.ts
git commit -m "feat(recipe-hub): typed Recipe Hub client with error kinds"
```

---

### Task 6: `hub-uri.ts`: `cooklang-hub:` paths (TDD)

**Files:**
- Create: `recipe-hub/src/hub-uri.ts`
- Test: `recipe-hub/src/hub-uri.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/hub-uri.spec.ts`:

```ts
import * as assert from 'assert';
import { fileNameForTitle, isDirectoryPath, outletContextUri, parseRecipePath, recipePath, titleFromFileName } from './hub-uri';

describe('hub URIs', () => {
    it('fileNameForTitle makes a safe .cook file name', () => {
        assert.strictEqual(fileNameForTitle('Pasta: Bake / Mom\'s?', 7), 'Pasta Bake Mom\'s.cook');
        assert.strictEqual(fileNameForTitle('  ...  ', 7), 'Recipe 7.cook');
        assert.strictEqual(fileNameForTitle('a'.repeat(150), 7), `${'a'.repeat(100)}.cook`);
    });

    it('recipePath and parseRecipePath round-trip', () => {
        assert.strictEqual(recipePath(7, 'Pasta Bake'), '/recipes/7/Pasta Bake.cook');
        assert.deepStrictEqual(parseRecipePath('/recipes/7/Pasta Bake.cook'), { id: 7, fileName: 'Pasta Bake.cook' });
    });

    it('parseRecipePath rejects anything that is not a recipe file', () => {
        for (const path of ['/recipes/7', '/recipes/x/a.cook', '/recipes/0/a.cook', '/other/7/a.cook', '/recipes/7/a/b.cook']) {
            assert.strictEqual(parseRecipePath(path), undefined, path);
        }
    });

    it('isDirectoryPath covers the root, /recipes and /recipes/<id>', () => {
        for (const path of ['/', '/recipes', '/recipes/', '/recipes/7']) {
            assert.strictEqual(isDirectoryPath(path), true, path);
        }
        for (const path of ['/recipes/7/a.cook', '/x']) {
            assert.strictEqual(isDirectoryPath(path), false, path);
        }
    });

    it('titleFromFileName drops the extension', () => {
        assert.strictEqual(titleFromFileName('Pasta Bake.cook'), 'Pasta Bake');
        assert.strictEqual(titleFromFileName('Soup.COOK'), 'Soup');
    });

    it('outletContextUri reads the uri of a Cooklang outlet context', () => {
        assert.strictEqual(outletContextUri({ version: 1, uri: 'cooklang-hub:/recipes/7/A.cook', path: '', scale: 1 }), 'cooklang-hub:/recipes/7/A.cook');
        for (const bad of [undefined, null, {}, 'cooklang-hub:/recipes/7/A.cook', { uri: 5 }]) {
            assert.strictEqual(outletContextUri(bad), undefined, JSON.stringify(bad));
        }
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './hub-uri'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/hub-uri.ts`:

```ts
// Paths of the read-only `cooklang-hub:` file system:
// `cooklang-hub:/recipes/<id>/<Title>.cook`. Only the id matters for reading;
// the file name gives the preview tab its title and the `.cook` extension
// makes the editor treat it as a recipe. No `vscode` import.

export const HUB_SCHEME = 'cooklang-hub';

const RECIPE_PATH = /^\/recipes\/(\d+)\/([^/]+)$/;
const DIRECTORY_PATH = /^\/(recipes(\/\d+)?)?\/?$/;
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|#%\u0000-\u001f]/g;
const MAX_TITLE_LENGTH = 100;

export interface HubRecipeRef {
    id: number;
    fileName: string;
}

/** `<Title>.cook` without characters that are unsafe in file names or URIs; `Recipe <id>.cook` when nothing is left. */
export function fileNameForTitle(title: string, id: number): string {
    const cleaned = title
        .replace(UNSAFE_FILE_NAME_CHARACTERS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '')
        .trim()
        .slice(0, MAX_TITLE_LENGTH)
        .trim();
    return `${cleaned === '' ? `Recipe ${id}` : cleaned}.cook`;
}

export function recipePath(id: number, title: string): string {
    return `/recipes/${id}/${fileNameForTitle(title, id)}`;
}

export function parseRecipePath(path: string): HubRecipeRef | undefined {
    const match = RECIPE_PATH.exec(path);
    if (!match) {
        return undefined;
    }
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? { id, fileName: match[2] } : undefined;
}

export function isDirectoryPath(path: string): boolean {
    return DIRECTORY_PATH.test(path);
}

export function titleFromFileName(fileName: string): string {
    return fileName.replace(/\.cook$/i, '');
}

/** The `uri` of a Cooklang outlet context (`{ version, uri, path, scale }`); undefined for anything else. */
export function outletContextUri(arg: unknown): string | undefined {
    if (typeof arg !== 'object' || arg === null) {
        return undefined;
    }
    const uri = (arg as { uri?: unknown }).uri;
    return typeof uri === 'string' ? uri : undefined;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `36 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/hub-uri.ts recipe-hub/src/hub-uri.spec.ts
git commit -m "feat(recipe-hub): cooklang-hub URI paths"
```

---

### Task 7: `hub-file-system-core.ts`: cache, read-only errors, content fallback (TDD)

**Files:**
- Create: `recipe-hub/src/hub-file-system-core.ts`
- Test: `recipe-hub/src/hub-file-system-core.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/hub-file-system-core.spec.ts`:

```ts
import * as assert from 'assert';
import { HubError } from './hub-client';
import { ContentSource, HubFileSystemCore, HubFsError, loadRecipeContent, RecipeContentCache } from './hub-file-system-core';

function counting(content: (id: number) => string = id => `recipe ${id}`): { load: (id: number) => Promise<string>; loads: number[] } {
    const loads: number[] = [];
    return { loads, load: async id => { loads.push(id); return content(id); } };
}

function isFsError(code: string): (e: unknown) => boolean {
    return e => e instanceof HubFsError && e.code === code;
}

function source(download: () => Promise<string>, enclosureUrl?: string): { client: ContentSource; calls: string[] } {
    const calls: string[] = [];
    const client: ContentSource = {
        download: async id => { calls.push(`download ${id}`); return download(); },
        recipe: async id => { calls.push(`recipe ${id}`); return enclosureUrl ? { id, title: 'Pasta', enclosureUrl } : { id, title: 'Pasta' }; },
        fetchText: async url => { calls.push(`fetch ${url}`); return 'from enclosure'; },
    };
    return { client, calls };
}

describe('RecipeContentCache', () => {
    it('loads once and serves from the cache', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load);
        assert.strictEqual(await cache.get(1), 'recipe 1');
        assert.strictEqual(await cache.get(1), 'recipe 1');
        assert.deepStrictEqual(loads, [1]);
    });

    it('evicts the least recently used entry beyond capacity', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load, 2);
        await cache.get(1);
        await cache.get(2);
        await cache.get(1);
        await cache.get(3);
        assert.deepStrictEqual([cache.has(1), cache.has(2), cache.has(3), cache.size], [true, false, true, 2]);
        await cache.get(2);
        assert.deepStrictEqual(loads, [1, 2, 3, 2]);
    });

    it('shares one load between concurrent reads', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load);
        assert.deepStrictEqual(await Promise.all([cache.get(5), cache.get(5)]), ['recipe 5', 'recipe 5']);
        assert.deepStrictEqual(loads, [5]);
    });

    it('does not cache failures', async () => {
        let attempts = 0;
        const cache = new RecipeContentCache(async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('offline');
            }
            return 'ok';
        });
        await assert.rejects(cache.get(1), /offline/);
        assert.strictEqual(await cache.get(1), 'ok');
        assert.strictEqual(attempts, 2);
    });

    it('drops loads that finish after clear()', async () => {
        let finishLoad: (content: string) => void = () => undefined;
        const cache = new RecipeContentCache(() => new Promise<string>(resolve => { finishLoad = resolve; }));
        const pending = cache.get(1);
        cache.clear();
        finishLoad('from the old server');
        assert.strictEqual(await pending, 'from the old server');
        assert.strictEqual(cache.has(1), false);
    });
});

describe('HubFileSystemCore', () => {
    it('reads a recipe as UTF-8 and stats its byte size', async () => {
        const core = new HubFileSystemCore(async () => 'Crème brûlée');
        const bytes = await core.readFile('/recipes/7/Crème brûlée.cook');
        assert.strictEqual(new TextDecoder().decode(bytes), 'Crème brûlée');
        assert.deepStrictEqual(await core.stat('/recipes/7/Crème brûlée.cook'), { type: 'file', size: 15 });
    });

    it('treats the root, /recipes and /recipes/<id> as directories', async () => {
        const core = new HubFileSystemCore(async () => 'x');
        assert.deepStrictEqual(await core.stat('/'), { type: 'directory', size: 0 });
        assert.deepStrictEqual(await core.stat('/recipes/7'), { type: 'directory', size: 0 });
        assert.deepStrictEqual(core.readDirectory('/'), [['recipes', 'directory']]);
        assert.deepStrictEqual(core.readDirectory('/recipes/7'), []);
        assert.throws(() => core.readDirectory('/recipes/7/A.cook'), isFsError('FileNotFound'));
    });

    it('maps load failures to file-system errors', async () => {
        const core = new HubFileSystemCore(async id => {
            if (id === 1) {
                throw new HubError('notFound', 'Recipe not found');
            }
            throw new HubError('network', 'Could not reach Recipe Hub (connect ECONNREFUSED).');
        });
        await assert.rejects(core.readFile('/recipes/1/A.cook'), isFsError('FileNotFound'));
        await assert.rejects(core.readFile('/recipes/2/B.cook'),
            (e: unknown) => isFsError('Unavailable')(e) && (e as Error).message.includes('ECONNREFUSED'));
        await assert.rejects(core.readFile('/nope'), isFsError('FileNotFound'));
    });

    it('refuses every write with NoPermissions', () => {
        const core = new HubFileSystemCore(async () => 'x');
        for (const path of ['/recipes/1/A.cook', '/recipes/2', '/']) {
            assert.throws(() => core.denyWrite(path), isFsError('NoPermissions'));
        }
    });
});

describe('loadRecipeContent', () => {
    it('uses the download endpoint', async () => {
        const { client, calls } = source(async () => 'downloaded');
        assert.strictEqual(await loadRecipeContent(client, 7), 'downloaded');
        assert.deepStrictEqual(calls, ['download 7']);
    });

    it('falls back to enclosure_url when the download is missing', async () => {
        const { client, calls } = source(async () => { throw new HubError('notFound', 'Recipe content not found'); }, 'https://feed.example/pasta.cook');
        assert.strictEqual(await loadRecipeContent(client, 7), 'from enclosure');
        assert.deepStrictEqual(calls, ['download 7', 'recipe 7', 'fetch https://feed.example/pasta.cook']);
    });

    it('rethrows when there is no fallback', async () => {
        const missing = source(async () => { throw new HubError('notFound', 'Recipe content not found'); });
        await assert.rejects(loadRecipeContent(missing.client, 7), /Recipe content not found/);
        const offline = source(async () => { throw new HubError('network', 'Could not reach Recipe Hub (offline).'); }, 'https://feed.example/pasta.cook');
        await assert.rejects(loadRecipeContent(offline.client, 7), /offline/);
        assert.deepStrictEqual(offline.calls, ['download 7']);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './hub-file-system-core'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/hub-file-system-core.ts`:

```ts
// The logic behind the read-only `cooklang-hub:` file system, free of the
// `vscode` import so it can be unit-tested; hub-file-system.ts adapts it to
// `vscode.FileSystemProvider`.

import { HubClient, HubError } from './hub-client';
import { isDirectoryPath, parseRecipePath } from './hub-uri';

export const CACHE_CAPACITY = 50;

export type HubFsErrorCode = 'FileNotFound' | 'NoPermissions' | 'Unavailable';

/** A file-system failure, translated to `vscode.FileSystemError` by the adapter. */
export class HubFsError extends Error {
    constructor(readonly code: HubFsErrorCode, message: string) {
        super(message);
        this.name = 'HubFsError';
    }
}

export type HubFsEntryType = 'file' | 'directory';

export interface HubFsStat {
    type: HubFsEntryType;
    size: number;
}

/** Recipe sources by id: least-recently-used eviction, one load per id at a time, failures not cached. */
export class RecipeContentCache {

    protected readonly entries = new Map<number, string>();
    protected readonly pending = new Map<number, Promise<string>>();
    /** Bumped by `clear()`, so loads started before it are not stored. */
    protected generation = 0;

    constructor(protected readonly load: (id: number) => Promise<string>, readonly capacity: number = CACHE_CAPACITY) { }

    get(id: number): Promise<string> {
        const cached = this.entries.get(id);
        if (cached !== undefined) {
            this.remember(id, cached);
            return Promise.resolve(cached);
        }
        const inFlight = this.pending.get(id);
        if (inFlight) {
            return inFlight;
        }
        const generation = this.generation;
        const promise: Promise<string> = this.load(id)
            .then(content => {
                if (generation === this.generation) {
                    this.remember(id, content);
                }
                return content;
            })
            .finally(() => {
                if (this.pending.get(id) === promise) {
                    this.pending.delete(id);
                }
            });
        this.pending.set(id, promise);
        return promise;
    }

    has(id: number): boolean {
        return this.entries.has(id);
    }

    get size(): number {
        return this.entries.size;
    }

    clear(): void {
        this.generation += 1;
        this.entries.clear();
        this.pending.clear();
    }

    /** Stores `content` as the most recently used entry, evicting the oldest beyond capacity. */
    protected remember(id: number, content: string): void {
        this.entries.delete(id);
        this.entries.set(id, content);
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value as number;
            this.entries.delete(oldest);
        }
    }
}

/** `cooklang-hub:` operations on URI paths. */
export class HubFileSystemCore {

    readonly cache: RecipeContentCache;

    constructor(load: (id: number) => Promise<string>, capacity: number = CACHE_CAPACITY) {
        this.cache = new RecipeContentCache(load, capacity);
    }

    async stat(path: string): Promise<HubFsStat> {
        if (isDirectoryPath(path)) {
            return { type: 'directory', size: 0 };
        }
        return { type: 'file', size: (await this.readFile(path)).byteLength };
    }

    async readFile(path: string): Promise<Uint8Array> {
        const ref = parseRecipePath(path);
        if (!ref) {
            throw new HubFsError('FileNotFound', `No Recipe Hub recipe at ${path}.`);
        }
        try {
            return new TextEncoder().encode(await this.cache.get(ref.id));
        } catch (e) {
            throw toFsError(e);
        }
    }

    /** Folders are never listed with recipes: only the id in a path is meaningful. */
    readDirectory(path: string): Array<[string, HubFsEntryType]> {
        if (path === '' || path === '/') {
            return [['recipes', 'directory']];
        }
        if (isDirectoryPath(path)) {
            return [];
        }
        throw new HubFsError('FileNotFound', `No Recipe Hub folder at ${path}.`);
    }

    denyWrite(path: string): never {
        throw new HubFsError('NoPermissions', `Recipe Hub recipes are read-only (${path}). Use "Save to Drafts" to get an editable copy.`);
    }

    clear(): void {
        this.cache.clear();
    }
}

function toFsError(e: unknown): HubFsError {
    if (e instanceof HubFsError) {
        return e;
    }
    if (e instanceof HubError && e.kind === 'notFound') {
        return new HubFsError('FileNotFound', e.message);
    }
    return new HubFsError('Unavailable', e instanceof Error ? e.message : String(e));
}

export type ContentSource = Pick<HubClient, 'download' | 'recipe' | 'fetchText'>;

/**
 * A recipe's Cooklang source: `GET /api/recipes/:id/download`, falling back to
 * the feed's `enclosure_url` when the index has no stored content (404) or
 * fails (5xx). Network errors are not retried elsewhere.
 */
export async function loadRecipeContent(client: ContentSource, id: number): Promise<string> {
    try {
        return await client.download(id);
    } catch (e) {
        if (!(e instanceof HubError) || (e.kind !== 'notFound' && e.kind !== 'server')) {
            throw e;
        }
        const detail = await client.recipe(id);
        if (detail.enclosureUrl === undefined) {
            throw e;
        }
        return client.fetchText(detail.enclosureUrl);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `48 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/hub-file-system-core.ts recipe-hub/src/hub-file-system-core.spec.ts
git commit -m "feat(recipe-hub): cooklang-hub file system core with LRU cache"
```

---

### Task 8: `recipe-draft.ts`: `saveDraft` arguments with YAML frontmatter (TDD)

**Files:**
- Create: `recipe-hub/src/recipe-draft.ts`
- Test: `recipe-hub/src/recipe-draft.spec.ts`

The editor's `saveDraft` merges `frontmatter` into the draft's YAML frontmatter, adding only keys that are not already present. Some feed recipes still carry the deprecated `>> key: value` metadata. So that drafts never contain it, the plugin converts that metadata into a YAML frontmatter block before saving.

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/recipe-draft.spec.ts`:

```ts
import * as assert from 'assert';
import { buildSaveDraftArgs, legacyMetadataToFrontmatter, yamlScalar } from './recipe-draft';

const LEGACY = '>> servings: 4\n>> source: https://blog.example/pasta\n>> servings: 6\n\nBoil @pasta{400%g}.\n';

describe('buildSaveDraftArgs', () => {
    it('uses the recipe title and its original source', () => {
        assert.deepStrictEqual(buildSaveDraftArgs({
            id: 7,
            fileTitle: 'Pasta Bake',
            content: 'Boil @pasta{400%g}.\n',
            detail: { title: 'Pasta Bake (Mum\'s)', sourceUrl: 'https://blog.example/pasta' },
            serverUrl: 'https://hub.example',
        }), {
            version: 1,
            content: 'Boil @pasta{400%g}.\n',
            title: 'Pasta Bake (Mum\'s)',
            frontmatter: { source: 'https://blog.example/pasta' },
        });
    });

    it('falls back to the file title and the Recipe Hub page', () => {
        assert.deepStrictEqual(buildSaveDraftArgs({ id: 7, fileTitle: 'Pasta Bake', content: 'x', serverUrl: 'https://hub.example/' }), {
            version: 1, content: 'x', title: 'Pasta Bake', frontmatter: { source: 'https://hub.example/recipes/7' },
        });
    });

    it('ignores a blank title and a non-http source_url', () => {
        const args = buildSaveDraftArgs({
            id: 7, fileTitle: 'Pasta Bake', content: 'x', detail: { title: '  ', sourceUrl: 'javascript:alert(1)' }, serverUrl: 'https://hub.example',
        });
        assert.deepStrictEqual([args.title, args.frontmatter], ['Pasta Bake', { source: 'https://hub.example/recipes/7' }]);
    });

    it('never emits the deprecated >> metadata syntax', () => {
        const args = buildSaveDraftArgs({ id: 7, fileTitle: 'Pasta', content: LEGACY, serverUrl: 'https://hub.example' });
        assert.strictEqual(/^>>/m.test(args.content), false, args.content);
        assert.ok(args.content.startsWith('---\n'), args.content);
    });
});

describe('legacyMetadataToFrontmatter', () => {
    it('turns >> metadata into YAML frontmatter, keeping the first value of a key', () => {
        assert.strictEqual(legacyMetadataToFrontmatter(LEGACY),
            '---\nservings: 4\nsource: "https://blog.example/pasta"\n---\nBoil @pasta{400%g}.\n');
    });

    it('leaves YAML frontmatter and metadata-free recipes unchanged', () => {
        const yaml = '---\ntitle: Soup\n---\n>> not: converted\nBoil @water.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(yaml), yaml);
        assert.strictEqual(legacyMetadataToFrontmatter('Boil @water.\n'), 'Boil @water.\n');
    });
});

describe('yamlScalar', () => {
    it('quotes only when needed', () => {
        assert.strictEqual(yamlScalar('4'), '4');
        assert.strictEqual(yamlScalar('Pasta Bake'), 'Pasta Bake');
        assert.strictEqual(yamlScalar('Crème brûlée'), 'Crème brûlée');
        assert.strictEqual(yamlScalar('yes'), '"yes"');
        assert.strictEqual(yamlScalar('a: b'), '"a: b"');
        assert.strictEqual(yamlScalar('#tag'), '"#tag"');
        assert.strictEqual(yamlScalar(''), '""');
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './recipe-draft'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/recipe-draft.ts`:

```ts
// Arguments for the editor's `cooklang.api.saveDraft`. No `vscode` import.
// Metadata is always YAML frontmatter; the deprecated `>>` syntax is converted, never written.

import type { RecipeDetail } from './hub-client';
import { originalRecipeUrl } from './hub-urls';

/** Argument of `cooklang.api.saveDraft`. The editor writes YAML only and never overwrites an existing frontmatter key. */
export interface SaveDraftArgs {
    version: 1;
    /** Cooklang text. */
    content: string;
    /** Used when the content has no title. */
    title?: string;
    /** Added to the draft's YAML frontmatter, only for keys not already present. */
    frontmatter?: Record<string, string>;
}

export interface DraftSource {
    id: number;
    /** Title from the hub URI's file name, used when the recipe details are unavailable. */
    fileTitle: string;
    content: string;
    detail?: Pick<RecipeDetail, 'title' | 'sourceUrl'>;
    serverUrl: string;
}

export function buildSaveDraftArgs(source: DraftSource): SaveDraftArgs {
    const title = source.detail?.title.trim() || source.fileTitle;
    return {
        version: 1,
        content: legacyMetadataToFrontmatter(source.content),
        title,
        frontmatter: { source: originalRecipeUrl(source.detail?.sourceUrl, source.serverUrl, source.id) },
    };
}

const LEGACY_METADATA = /^>>\s*([^:]+?)\s*:\s*(.*?)\s*$/;
const YAML_FRONTMATTER_START = /^﻿?---\r?\n/;

/**
 * Moves deprecated `>> key: value` metadata lines into a YAML frontmatter
 * block. Recipes that already start with YAML frontmatter, or have no
 * metadata lines, are returned unchanged. The first value of a repeated key wins.
 */
export function legacyMetadataToFrontmatter(content: string): string {
    if (YAML_FRONTMATTER_START.test(content)) {
        return content;
    }
    const entries = new Map<string, string>();
    const body: string[] = [];
    for (const line of content.replace(/^﻿/, '').split(/\r?\n/)) {
        const match = LEGACY_METADATA.exec(line);
        if (match) {
            if (!entries.has(match[1])) {
                entries.set(match[1], match[2]);
            }
        } else {
            body.push(line);
        }
    }
    if (entries.size === 0) {
        return content;
    }
    while (body.length > 0 && body[0].trim() === '') {
        body.shift();
    }
    const yaml = [...entries].map(([key, value]) => `${yamlScalar(key)}: ${yamlScalar(value)}`);
    return ['---', ...yaml, '---', ...body].join('\n');
}

const PLAIN_SCALAR = /^[\p{L}\p{N}][\p{L}\p{N} _.()\/-]*$/u;
const YAML_KEYWORDS = /^(true|false|yes|no|on|off|null|~)$/i;

/** `value` as a YAML scalar: plain when unambiguous, otherwise double-quoted (JSON strings are valid YAML). */
export function yamlScalar(value: string): string {
    return PLAIN_SCALAR.test(value) && !YAML_KEYWORDS.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `55 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/recipe-draft.ts recipe-hub/src/recipe-draft.spec.ts
git commit -m "feat(recipe-hub): saveDraft arguments with YAML frontmatter"
```

---

### Task 9: `cooklang-api.ts`: editor commands (TDD)

`CooklangPluginApi.VERSION` stays `1`, so the plugin detects PR 2's commands by name in `vscode.commands.getCommands(true)`, never by version.

**Files:**
- Create: `recipe-hub/src/cooklang-api.ts`
- Test: `recipe-hub/src/cooklang-api.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, CooklangApiCommands, ListCommands } from './cooklang-api';
import { SaveDraftArgs } from './recipe-draft';

function recorder(reply: (command: string) => unknown, listCommands: ListCommands = async () => []):
    { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return reply(command);
    }, listCommands);
    return { api, calls };
}

const ARGS: SaveDraftArgs = { version: 1, content: 'Boil @pasta{400%g}.\n', title: 'Pasta', frontmatter: { source: 'https://blog.example/pasta' } };

describe('CooklangApi', () => {
    it('calls the editor commands with the documented arguments', async () => {
        const { api, calls } = recorder(command => command === CooklangApiCommands.SAVE_DRAFT ? 'file:///ws/Drafts/Pasta.cook' : undefined);
        assert.strictEqual(await api.saveDraft(ARGS), 'file:///ws/Drafts/Pasta.cook');
        await api.openPreview('cooklang-hub:/recipes/7/Pasta.cook');
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.saveDraft', args: [ARGS] },
            { command: 'cooklang.api.openPreview', args: [{ uri: 'cooklang-hub:/recipes/7/Pasta.cook' }] },
        ]);
    });

    it('detects the commands from the command list, not a version number', async () => {
        const full = recorder(() => undefined, async () => ['cooklang.api.version', 'cooklang.api.saveDraft', 'cooklang.api.openPreview']);
        assert.deepStrictEqual([await full.api.canSaveDrafts(), await full.api.canOpenPreviews()], [true, true]);
        const old = recorder(() => 1, async () => ['cooklang.api.version', 'cooklang.api.generateShoppingList']);
        assert.deepStrictEqual([await old.api.canSaveDrafts(), await old.api.canOpenPreviews()], [false, false]);
        const failing = recorder(() => undefined, async () => { throw new Error('no command registry'); });
        assert.strictEqual(await failing.api.canSaveDrafts(), false);
        assert.deepStrictEqual(full.calls, []);
    });

    it('rejects when the editor returns no draft URI', async () => {
        const { api } = recorder(() => undefined);
        await assert.rejects(api.saveDraft(ARGS), /did not return/);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './cooklang-api'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/cooklang-api.ts`:

```ts
// Typed wrapper over the Cook Editor commands this plugin calls. Kept free of
// the `vscode` import so it can be unit-tested; extension.ts passes
// `vscode.commands.executeCommand` and `vscode.commands.getCommands(true)`.
//
// `cooklang.api.version` stays 1 while the API grows additively, so newer
// commands are detected by name, never by version.

import type { SaveDraftArgs } from './recipe-draft';

export const CooklangApiCommands = {
    /** `{ version: 1, content, title?, frontmatter? }` → saved URI string; saves into `Drafts/` and opens it. */
    SAVE_DRAFT: 'cooklang.api.saveDraft',
    /** `{ uri }` → opens (or reveals) the recipe preview for any recipe URI, including `cooklang-hub:`. */
    OPEN_PREVIEW: 'cooklang.api.openPreview',
} as const;

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** Whether this Cook Editor has `cooklang.api.saveDraft`. */
    canSaveDrafts(): Promise<boolean> {
        return this.has(CooklangApiCommands.SAVE_DRAFT);
    }

    /** Whether this Cook Editor has `cooklang.api.openPreview`. */
    canOpenPreviews(): Promise<boolean> {
        return this.has(CooklangApiCommands.OPEN_PREVIEW);
    }

    /** Saves into `Drafts/` and opens the file; resolves to its URI string. */
    async saveDraft(args: SaveDraftArgs): Promise<string> {
        const uri = await this.execute(CooklangApiCommands.SAVE_DRAFT, args);
        if (typeof uri !== 'string') {
            throw new Error('Cook Editor did not return the saved draft.');
        }
        return uri;
    }

    async openPreview(uri: string): Promise<void> {
        await this.execute(CooklangApiCommands.OPEN_PREVIEW, { uri });
    }

    protected async has(command: string): Promise<boolean> {
        try {
            return (await this.listCommands()).includes(command);
        } catch {
            return false;
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `58 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/cooklang-api.ts recipe-hub/src/cooklang-api.spec.ts
git commit -m "feat(recipe-hub): Cooklang editor API wrapper with feature detection"
```

---

### Task 10: `protocol.ts`: webview messages (TDD)

**Files:**
- Create: `recipe-hub/src/protocol.ts`
- Test: `recipe-hub/src/protocol.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `recipe-hub/src/protocol.spec.ts`:

```ts
import * as assert from 'assert';
import { parseFromWebview } from './protocol';
import { emptyFilters } from './search-query';

describe('parseFromWebview', () => {
    it('accepts well-formed messages', () => {
        assert.deepStrictEqual(parseFromWebview({ type: 'ready' }), { type: 'ready' });
        assert.deepStrictEqual(parseFromWebview({ type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } }),
            { type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } });
        assert.deepStrictEqual(parseFromWebview({ type: 'open', id: 7, title: 'Pasta Bake' }), { type: 'open', id: 7, title: 'Pasta Bake' });
    });

    it('rejects malformed messages', () => {
        const bad: unknown[] = [
            undefined, null, 'ready', {}, { type: 'delete' },
            { type: 'search', seq: 0, page: 1, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1.5, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1, filters: { q: 1 } },
            { type: 'open', id: -1, title: 'x' },
            { type: 'open', id: 7 },
        ];
        for (const message of bad) {
            assert.strictEqual(parseFromWebview(message), undefined, JSON.stringify(message));
        }
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: tsc error `Cannot find module './protocol'`.

- [ ] **Step 3: Implement**

Create `recipe-hub/src/protocol.ts`:

```ts
// Messages between the extension host (search-view-provider.ts) and the
// webview (webview/main.ts). The webview is untrusted: every message from it
// goes through parseFromWebview.

import type { Facets, HubErrorKind, RecipeCard } from './hub-client';
import { parseFilters, SearchFilters } from './search-query';

export type ToWebview =
    /** Reply to `ready`. `defaultLocale` is the editor display language's subtag; `serverOrigin` may be ''. */
    | { type: 'init'; defaultLocale: string; serverOrigin: string }
    | { type: 'facets'; facets: Facets }
    | { type: 'results'; seq: number; page: number; cards: RecipeCard[]; total: number; hasMore: boolean }
    | { type: 'error'; seq: number; kind: HubErrorKind; message: string }
    /** From the `recipeHub.search` command. */
    | { type: 'focusSearch' };

export type FromWebview =
    | { type: 'ready' }
    /** `seq` grows with every request; responses carry it back so stale ones are dropped. */
    | { type: 'search'; seq: number; page: number; filters: SearchFilters }
    | { type: 'open'; id: number; title: string };

function positiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseFromWebview(message: unknown): FromWebview | undefined {
    if (typeof message !== 'object' || message === null) {
        return undefined;
    }
    const raw = message as Record<string, unknown>;
    switch (raw.type) {
        case 'ready':
            return { type: 'ready' };
        case 'search': {
            const filters = parseFilters(raw.filters);
            return filters && positiveInteger(raw.seq) && positiveInteger(raw.page)
                ? { type: 'search', seq: raw.seq as number, page: raw.page as number, filters }
                : undefined;
        }
        case 'open':
            return positiveInteger(raw.id) && typeof raw.title === 'string'
                ? { type: 'open', id: raw.id as number, title: raw.title as string }
                : undefined;
        default:
            return undefined;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `60 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/protocol.ts recipe-hub/src/protocol.spec.ts
git commit -m "feat(recipe-hub): webview message protocol"
```

---

### Task 11: Webview UI and styles

**Files:**
- Create: `recipe-hub/src/webview/main.ts`
- Create: `recipe-hub/media/recipe-hub.css`

The webview renders from state and asks the extension host to run searches; it makes no network requests. Filters and the "Filters" open/closed state persist through `setState`. Results are not persisted, because they are re-run on load.

- [ ] **Step 1: Write the webview script**

Create `recipe-hub/src/webview/main.ts`:

```ts
import type { Facets, HubErrorKind, RecipeCard } from '../hub-client';
import { isDisplayableImageUrl } from '../hub-urls';
import type { FromWebview, ToWebview } from '../protocol';
import {
    activeFilterCount, addTerm, clearFilters, emptyFilters, MAX_TIME_PRESETS, parseFilters, resolveDefaultLocale, SearchFilters, SortOrder,
} from '../search-query';

interface SavedState {
    filters: SearchFilters;
    filtersOpen: boolean;
    /** The user picked a language, so facets no longer adjust the default. */
    localeTouched: boolean;
}

declare function acquireVsCodeApi(): {
    postMessage(message: FromWebview): void;
    getState(): unknown;
    setState(state: SavedState): void;
};

type InitMessage = Extract<ToWebview, { type: 'init' }>;
type ResultsMessage = Extract<ToWebview, { type: 'results' }>;
type ErrorMessage = Extract<ToWebview, { type: 'error' }>;

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;
const SEARCH_DEBOUNCE_MS = 300;
const FALLBACK_DIFFICULTIES = ['easy', 'medium', 'hard'];

function readSavedState(): SavedState | undefined {
    const raw = vscode.getState() as { filters?: unknown; filtersOpen?: unknown; localeTouched?: unknown } | undefined;
    const filters = parseFilters(raw?.filters);
    return filters ? { filters, filtersOpen: raw?.filtersOpen === true, localeTouched: raw?.localeTouched === true } : undefined;
}

const saved = readSavedState();
let filters: SearchFilters = saved?.filters ?? emptyFilters();
let filtersOpen = saved?.filtersOpen ?? false;
let localeTouched = saved?.localeTouched ?? false;
/** False until the first `init` when nothing was saved: the default language is not known before it. */
let initialized = saved !== undefined;
let defaultLocale = '';
let serverOrigin = '';
let facets: Facets | undefined;

let seq = 0;
let loading = false;
/** Page of the newest request (1 = new search, >1 = "Load more"). */
let requestedPage = 1;
let cards: RecipeCard[] = [];
let total = 0;
let page = 0;
let hasMore = false;
let searched = false;
let error: { kind: HubErrorKind; message: string } | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

// --- DOM helpers ---

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function button(className: string, text: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

function termInput(placeholder: string, onAdd: (term: string) => void): HTMLInputElement {
    const input = element('input', 'term-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && input.value.trim() !== '') {
            onAdd(input.value);
            input.value = '';
        }
    });
    return input;
}

function servingsInput(placeholder: string, onChange: (value: number | undefined) => void): HTMLInputElement {
    const input = element('input', 'servings-input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', `${placeholder} servings`);
    input.addEventListener('change', () => {
        const value = Number(input.value);
        onChange(input.value !== '' && Number.isInteger(value) && value > 0 ? value : undefined);
    });
    return input;
}

function filterRow(label: string, ...controls: HTMLElement[]): HTMLElement {
    const row = element('div', 'filter-row');
    row.append(element('div', 'filter-label', label), ...controls);
    return row;
}

function fillSelect(select: HTMLSelectElement, options: ReadonlyArray<readonly [string, string]>, value: string): void {
    select.replaceChildren(...options.map(([optionValue, label]) => {
        const option = element('option', undefined, label);
        option.value = optionValue;
        return option;
    }));
    select.value = value;
}

function renderChips(container: HTMLElement, values: readonly string[], onRemove: (value: string) => void, className = 'chip'): void {
    container.replaceChildren(...values.map(value => {
        const chip = element('span', className, value);
        const remove = button('chip-remove', '×', () => onRemove(value));
        remove.title = `Remove ${value}`;
        remove.setAttribute('aria-label', `Remove ${value}`);
        chip.append(remove);
        return chip;
    }));
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatMinutes(minutes: number): string {
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// --- Controls (built once; syncControls writes the filter state into them) ---

const searchBox = element('input', 'search-box');
searchBox.type = 'search';
searchBox.placeholder = 'Search recipes, e.g. pasta or tags:vegan';
searchBox.setAttribute('aria-label', 'Search recipes');
searchBox.addEventListener('input', () => setFilters({ ...filters, q: searchBox.value }));
searchBox.addEventListener('keydown', event => {
    if (event.key === 'Enter') { searchNow(); }
});

const queryError = element('div', 'query-error');
const filtersToggle = button('filters-toggle', 'Filters', () => {
    filtersOpen = !filtersOpen;
    saveState();
    syncControls();
});
const clearLink = button('link', 'Clear filters', () => clearAllFilters());

const tagSelect = element('select', 'tag-select');
tagSelect.setAttribute('aria-label', 'Add a tag');
tagSelect.addEventListener('change', () => {
    if (tagSelect.value !== '') {
        setFilters({ ...filters, tags: addTerm(filters.tags, tagSelect.value) });
    }
});
const tagInput = termInput('Type a tag', term => setFilters({ ...filters, tags: addTerm(filters.tags, term) }));
const tagChips = element('div', 'chips');

const includeInput = termInput('Add an ingredient to include', term =>
    setFilters({ ...filters, includeIngredients: addTerm(filters.includeIngredients, term) }));
const includeChips = element('div', 'chips');
const excludeInput = termInput('Add an ingredient to exclude', term =>
    setFilters({ ...filters, excludeIngredients: addTerm(filters.excludeIngredients, term) }));
const excludeChips = element('div', 'chips');

const timeButtons = element('div', 'segmented');
for (const minutes of [...MAX_TIME_PRESETS, undefined]) {
    const option = button('segment', minutes === undefined ? 'Any' : `≤ ${minutes} min`, () => setFilters({ ...filters, maxTime: minutes }));
    option.dataset.minutes = minutes === undefined ? '' : String(minutes);
    timeButtons.append(option);
}

const difficultySelect = element('select');
difficultySelect.setAttribute('aria-label', 'Difficulty');
difficultySelect.addEventListener('change', () =>
    setFilters({ ...filters, difficulty: difficultySelect.value === '' ? undefined : difficultySelect.value }));

const minServings = servingsInput('Min', value => setFilters({ ...filters, minServings: value }));
const maxServings = servingsInput('Max', value => setFilters({ ...filters, maxServings: value }));
const servingsRange = element('div', 'range');
servingsRange.append(minServings, element('span', 'range-separator', '–'), maxServings);

const localeSelect = element('select');
localeSelect.setAttribute('aria-label', 'Language');
localeSelect.addEventListener('change', () => {
    localeTouched = true;
    setFilters({ ...filters, locale: localeSelect.value });
});

const sortSelect = element('select');
sortSelect.setAttribute('aria-label', 'Sort');
fillSelect(sortSelect, [['relevance', 'Relevance'], ['newest', 'Newest']], 'relevance');
sortSelect.addEventListener('change', () => setFilters({ ...filters, sort: sortSelect.value as SortOrder }));

const feedChip = element('div', 'chips');
const feedRow = filterRow('Feed', feedChip);

const filtersPanel = element('div', 'filters');
filtersPanel.append(
    filterRow('Tags', tagSelect, tagInput, tagChips),
    filterRow('With ingredients', includeInput, includeChips),
    filterRow('Without ingredients', excludeInput, excludeChips),
    filterRow('Max time', timeButtons),
    filterRow('Difficulty', difficultySelect),
    filterRow('Servings', servingsRange),
    filterRow('Language', localeSelect),
    filterRow('Sort', sortSelect),
    feedRow,
);

const resultsHeader = element('div', 'results-header');
const resultsList = element('div', 'results');
const resultsFooter = element('div', 'results-footer');

// --- State → controls ---

function syncControls(): void {
    if (searchBox.value !== filters.q) {
        searchBox.value = filters.q;
    }
    const count = activeFilterCount(filters);
    filtersToggle.textContent = `${filtersOpen ? '▼' : '▶'} Filters${count > 0 ? ` (${count})` : ''}`;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersPanel.hidden = !filtersOpen;
    clearLink.hidden = count === 0;

    const tagOptions = (facets?.tags ?? [])
        .filter(tag => !filters.tags.includes(tag.name.toLowerCase()))
        .map(tag => [tag.name, `${tag.name} (${tag.count})`] as const);
    fillSelect(tagSelect, [['', tagOptions.length > 0 ? 'Add a tag…' : 'No tag list available'], ...tagOptions], '');
    tagSelect.disabled = tagOptions.length === 0;
    renderChips(tagChips, filters.tags, tag => setFilters({ ...filters, tags: filters.tags.filter(item => item !== tag) }));
    renderChips(includeChips, filters.includeIngredients, name =>
        setFilters({ ...filters, includeIngredients: filters.includeIngredients.filter(item => item !== name) }));
    renderChips(excludeChips, filters.excludeIngredients, name =>
        setFilters({ ...filters, excludeIngredients: filters.excludeIngredients.filter(item => item !== name) }), 'chip exclude');

    const activeMinutes = filters.maxTime === undefined ? '' : String(filters.maxTime);
    for (const option of Array.from(timeButtons.children) as HTMLElement[]) {
        option.classList.toggle('active', option.dataset.minutes === activeMinutes);
    }

    const difficulties = facets && facets.difficulties.length > 0
        ? facets.difficulties.map(item => item.name.toLowerCase())
        : FALLBACK_DIFFICULTIES;
    const difficultyValues = filters.difficulty !== undefined && !difficulties.includes(filters.difficulty)
        ? [...difficulties, filters.difficulty]
        : difficulties;
    fillSelect(difficultySelect, [['', 'Any'], ...difficultyValues.map(name => [name, capitalize(name)] as const)], filters.difficulty ?? '');

    minServings.value = filters.minServings === undefined ? '' : String(filters.minServings);
    maxServings.value = filters.maxServings === undefined ? '' : String(filters.maxServings);

    const locales = (facets?.locales ?? []).map(locale => [locale.code, locale.name] as const);
    const localeOptions = filters.locale !== '' && !locales.some(([code]) => code === filters.locale)
        ? [...locales, [filters.locale, filters.locale] as const]
        : locales;
    fillSelect(localeSelect, [['', 'Any language'], ...localeOptions], filters.locale);

    sortSelect.value = filters.sort;

    feedRow.hidden = filters.feed === undefined;
    renderChips(feedChip, filters.feed ? [filters.feed.title] : [], () => setFilters({ ...filters, feed: undefined }));
}

function saveState(): void {
    vscode.setState({ filters, filtersOpen, localeTouched });
}

function setFilters(next: SearchFilters): void {
    filters = next;
    saveState();
    syncControls();
    scheduleSearch();
}

function clearAllFilters(): void {
    localeTouched = false;
    filters = clearFilters(filters, defaultLocale);
    saveState();
    syncControls();
    searchNow();
}

// --- Searching ---

function scheduleSearch(): void {
    if (debounce !== undefined) {
        clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
        debounce = undefined;
        runSearch(1);
    }, SEARCH_DEBOUNCE_MS);
}

function searchNow(): void {
    if (debounce !== undefined) {
        clearTimeout(debounce);
        debounce = undefined;
    }
    runSearch(1);
}

function runSearch(pageToLoad: number): void {
    seq += 1;
    requestedPage = pageToLoad;
    loading = true;
    error = undefined;
    vscode.postMessage({ type: 'search', seq, page: pageToLoad, filters });
    renderResults();
}

function onResults(message: ResultsMessage): void {
    if (message.seq !== seq) {
        return;
    }
    loading = false;
    searched = true;
    cards = message.page > 1 ? [...cards, ...message.cards] : message.cards;
    total = message.total;
    page = message.page;
    hasMore = message.hasMore;
    renderResults();
}

function onError(message: ErrorMessage): void {
    if (message.seq !== seq) {
        return;
    }
    loading = false;
    error = { kind: message.kind, message: message.message };
    if (requestedPage === 1) {
        cards = [];
        total = 0;
        hasMore = false;
    }
    renderResults();
}

// --- Results rendering ---

function errorBlock(kind: HubErrorKind, message: string): HTMLElement {
    const block = element('div', 'error');
    const text = kind === 'network' ? 'Could not reach Recipe Hub.'
        : kind === 'rateLimited' ? 'Too many searches — try again shortly.'
            : message;
    block.append(element('div', undefined, text));
    if (kind === 'network') {
        block.append(element('div', 'error-detail', message));
    }
    block.append(button('retry', 'Retry', () => runSearch(requestedPage)));
    return block;
}

function headerContent(): HTMLElement[] {
    const firstPage = requestedPage === 1;
    if (loading && firstPage) {
        return [element('div', 'status', 'Searching…')];
    }
    if (error && firstPage) {
        // A bad query is explained under the search box.
        return error.kind === 'badQuery' ? [] : [errorBlock(error.kind, error.message)];
    }
    if (!searched) {
        return [];
    }
    if (total === 0) {
        const empty = element('div', 'empty', 'No recipes match your search.');
        if (activeFilterCount(filters) > 0) {
            empty.append(' ', button('link', 'Clear filters', () => clearAllFilters()));
        }
        return [empty];
    }
    return [element('div', 'count', `${total} ${total === 1 ? 'recipe' : 'recipes'}`)];
}

function footerContent(): HTMLElement[] {
    const firstPage = requestedPage === 1;
    if (loading && !firstPage) {
        return [element('div', 'status', 'Loading more…')];
    }
    if (error && !firstPage) {
        return [errorBlock(error.kind, error.message)];
    }
    if (!loading && hasMore) {
        return [button('load-more', 'Load more', () => runSearch(page + 1))];
    }
    return [];
}

function renderCard(card: RecipeCard): HTMLElement {
    const node = element('div', 'card');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.title = `Preview ${card.title}`;
    const open = (): void => vscode.postMessage({ type: 'open', id: card.id, title: card.title });
    node.addEventListener('click', open);
    node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });

    if (card.imageUrl !== undefined && isDisplayableImageUrl(card.imageUrl, serverOrigin)) {
        const image = element('img', 'thumb');
        image.src = card.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.replaceWith(element('div', 'thumb')));
        node.append(image);
    } else {
        node.append(element('div', 'thumb'));
    }

    const body = element('div', 'card-body');
    body.append(element('div', 'card-title', card.title));
    if (card.summary !== undefined) {
        body.append(element('div', 'card-summary', card.summary));
    }
    const meta = element('div', 'card-meta');
    if (card.totalTimeMinutes !== undefined) {
        meta.append(element('span', undefined, formatMinutes(card.totalTimeMinutes)));
    }
    if (card.servings !== undefined) {
        meta.append(element('span', undefined, `${card.servings} ${card.servings === 1 ? 'serving' : 'servings'}`));
    }
    const feed = card.feed;
    if (feed?.title !== undefined) {
        const feedTitle = feed.title;
        const feedLink = button('link', feedTitle, event => {
            event.stopPropagation();
            setFilters({ ...filters, feed: { id: feed.id, title: feedTitle } });
        });
        feedLink.title = `Only recipes from ${feedTitle}`;
        meta.append(feedLink);
    }
    if (meta.childElementCount > 0) {
        body.append(meta);
    }
    if (card.tags.length > 0) {
        const tags = element('div', 'card-tags');
        for (const tag of card.tags.slice(0, 3)) {
            const chip = button('tag', tag, event => {
                event.stopPropagation();
                setFilters({ ...filters, tags: addTerm(filters.tags, tag) });
            });
            chip.title = `Only recipes tagged ${tag}`;
            tags.append(chip);
        }
        body.append(tags);
    }
    node.append(body);
    return node;
}

function renderResults(): void {
    const badQuery = error?.kind === 'badQuery' ? error.message : undefined;
    queryError.textContent = badQuery ?? '';
    queryError.hidden = badQuery === undefined;
    resultsList.classList.toggle('stale', loading && requestedPage === 1);
    resultsHeader.replaceChildren(...headerContent());
    resultsList.replaceChildren(...cards.map(renderCard));
    resultsFooter.replaceChildren(...footerContent());
}

// --- Messages from the extension host ---

function onInit(message: InitMessage): void {
    defaultLocale = message.defaultLocale;
    serverOrigin = message.serverOrigin;
    if (!initialized) {
        initialized = true;
        filters = emptyFilters(defaultLocale);
        saveState();
    }
    syncControls();
    searchNow();
}

function onFacets(next: Facets): void {
    facets = next;
    // The display language is only a default: with no recipes in it, search every language.
    if (!localeTouched && filters.locale !== '' && filters.locale === defaultLocale) {
        const resolved = resolveDefaultLocale(defaultLocale, next.locales);
        if (resolved !== filters.locale) {
            filters = { ...filters, locale: resolved };
            saveState();
            syncControls();
            searchNow();
            return;
        }
    }
    syncControls();
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const message = event.data;
    if (!message) {
        return;
    }
    switch (message.type) {
        case 'init': onInit(message); break;
        case 'facets': onFacets(message.facets); break;
        case 'results': onResults(message); break;
        case 'error': onError(message); break;
        case 'focusSearch': searchBox.focus(); break;
    }
});

const searchRow = element('div', 'search-row');
searchRow.append(searchBox);
const filtersBar = element('div', 'filters-bar');
filtersBar.append(filtersToggle, clearLink);
root.append(searchRow, queryError, filtersBar, filtersPanel, resultsHeader, resultsList, resultsFooter);
syncControls();
renderResults();
vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 2: Write the stylesheet**

Create `recipe-hub/media/recipe-hub.css`:

```css
body {
    padding: 0;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.5;
}

#root { padding: 8px 12px 16px; }

[hidden] { display: none !important; }

button { font: inherit; }

input, select {
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 3px;
    padding: 3px 6px;
    box-sizing: border-box;
    min-width: 0;
}

select {
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border-color: var(--vscode-dropdown-border, var(--vscode-panel-border));
}

input:focus, select:focus, button:focus-visible, .card:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
}

.search-box { width: 100%; padding: 5px 8px; }
.query-error { margin-top: 4px; color: var(--vscode-errorForeground); font-size: 0.9em; }

.filters-bar { display: flex; align-items: center; justify-content: space-between; margin: 8px 0 4px; }

.filters-toggle {
    background: none;
    border: none;
    padding: 2px 0;
    cursor: pointer;
    color: var(--vscode-foreground);
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
}

.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }

.filters { padding: 4px 0 8px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
.filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 6px 0; }
.filter-label { flex-basis: 100%; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.tag-select, .term-input { flex: 1 1 120px; }

.chips { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; }
.chips:empty { display: none; }

.chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px 0 8px;
    border-radius: 10px;
    font-size: 0.85em;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
}

.chip.exclude::before { content: 'no '; opacity: 0.8; }

.chip-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    opacity: 0.8;
}

.chip-remove:hover { opacity: 1; }

.segmented { display: flex; flex-wrap: wrap; gap: 4px; }

.segment {
    background: none;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    padding: 1px 8px;
    font-size: 0.9em;
    cursor: pointer;
}

.segment.active {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border-color: var(--vscode-button-background);
}

.range { display: flex; align-items: center; gap: 4px; }
.servings-input { width: 64px; }
.range-separator { color: var(--vscode-descriptionForeground); }

.status, .count, .empty { padding: 4px 0; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
.empty { font-style: italic; }
.error { padding: 6px 0; color: var(--vscode-errorForeground); }
.error-detail { font-size: 0.85em; color: var(--vscode-descriptionForeground); }

.retry, .load-more {
    margin-top: 6px;
    padding: 3px 12px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
}

.retry:hover, .load-more:hover { background: var(--vscode-button-secondaryHoverBackground); }
.load-more { width: 100%; }

.results.stale { opacity: 0.5; }

.card {
    display: flex;
    gap: 8px;
    padding: 8px 4px;
    cursor: pointer;
    border-bottom: 1px solid var(--vscode-panel-border);
}

.card:hover { background: var(--vscode-list-hoverBackground); }

.thumb {
    flex: 0 0 56px;
    width: 56px;
    height: 56px;
    border-radius: 4px;
    object-fit: cover;
    background: var(--vscode-editorWidget-background);
}

.card-body { flex: 1; min-width: 0; }
.card-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.card-summary {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
}

.card-meta { display: flex; flex-wrap: wrap; gap: 0 10px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }

.tag {
    border: none;
    border-radius: 10px;
    padding: 0 8px;
    font-size: 0.8em;
    cursor: pointer;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
}
```

- [ ] **Step 3: Type-check, test and bundle**

Run: `npm test && npm run bundle:webview`
Expected:
- `60 passing`;
- esbuild prints `out/webview.js` with its size and no errors.

Then run `grep -c "require(" out/webview.js`. Expected: `0`, meaning the bundle is self-contained and pulls in no Node or `vscode` modules.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/webview/main.ts recipe-hub/media/recipe-hub.css
git commit -m "feat(recipe-hub): search panel webview"
```

---

### Task 12: `vscode` glue: file system, view provider, controller, activation

**Files:**
- Create: `recipe-hub/src/hub-file-system.ts`
- Create: `recipe-hub/src/search-view-provider.ts`
- Create: `recipe-hub/src/recipe-hub-controller.ts`
- Create: `recipe-hub/src/extension.ts`

- [ ] **Step 1: File system adapter**

Create `recipe-hub/src/hub-file-system.ts`:

```ts
import * as vscode from 'vscode';
import { HubFileSystemCore, HubFsEntryType, HubFsError } from './hub-file-system-core';

/**
 * Read-only `cooklang-hub:` file system. Theia bridges plugin file systems into
 * its FileService, so the standard recipe preview can load Recipe Hub recipes.
 */
export class HubFileSystemProvider implements vscode.FileSystemProvider {

    protected readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    /** Hub recipes do not change under an open preview; nothing fires. */
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.onDidChangeFileEmitter.event;

    constructor(protected readonly core: HubFileSystemCore) { }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return this.translate(uri, async () => {
            const stat = await this.core.stat(uri.path);
            return { type: fileType(stat.type), ctime: 0, mtime: 0, size: stat.size };
        });
    }

    readDirectory(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
        return this.translate(uri, async () =>
            this.core.readDirectory(uri.path).map(([name, type]): [string, vscode.FileType] => [name, fileType(type)]));
    }

    readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return this.translate(uri, () => this.core.readFile(uri.path));
    }

    createDirectory(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(uri.path));
    }

    writeFile(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(uri.path));
    }

    delete(uri: vscode.Uri): Promise<void> {
        return this.translate(uri, async () => this.core.denyWrite(uri.path));
    }

    rename(oldUri: vscode.Uri): Promise<void> {
        return this.translate(oldUri, async () => this.core.denyWrite(oldUri.path));
    }

    protected async translate<T>(uri: vscode.Uri, action: () => Promise<T>): Promise<T> {
        try {
            return await action();
        } catch (e) {
            if (e instanceof HubFsError) {
                switch (e.code) {
                    case 'FileNotFound': throw vscode.FileSystemError.FileNotFound(uri);
                    case 'NoPermissions': throw vscode.FileSystemError.NoPermissions(e.message);
                    case 'Unavailable': throw vscode.FileSystemError.Unavailable(e.message);
                }
            }
            throw e;
        }
    }
}

function fileType(type: HubFsEntryType): vscode.FileType {
    return type === 'file' ? vscode.FileType.File : vscode.FileType.Directory;
}
```

- [ ] **Step 2: Webview view provider**

Create `recipe-hub/src/search-view-provider.ts`:

```ts
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { HubClient, HubError } from './hub-client';
import { serverOrigin } from './hub-urls';
import { parseFromWebview, ToWebview } from './protocol';
import { PAGE_SIZE, primaryLanguage, SearchFilters } from './search-query';

export const VIEW_ID = 'recipeHub.view';

/** What the panel needs from the controller. */
export interface SearchViewHost {
    hub(): HubClient;
    serverUrl(): string;
    openRecipe(id: number, title: string): Promise<void>;
}

/**
 * The Recipe Hub panel. Searches run here in the extension host, never in the
 * webview. The webview only loads thumbnails (CSP `img-src https:` plus the
 * server origin).
 */
export class SearchViewProvider implements vscode.WebviewViewProvider {

    protected view: vscode.WebviewView | undefined;
    /** Sequence number of the newest search the webview asked for; responses to older ones are dropped. */
    protected latestSeq = 0;

    constructor(protected readonly extensionUri: vscode.Uri, protected readonly host: SearchViewHost) { }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media'), vscode.Uri.joinPath(this.extensionUri, 'out')],
        };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message));
        view.onDidDispose(() => { this.view = undefined; });
    }

    /** The server changed: reload the webview so its CSP, facets and results follow the new server. */
    reload(): void {
        if (this.view) {
            this.latestSeq = 0;
            this.view.webview.html = this.html(this.view.webview);
        }
    }

    focusSearch(): void {
        this.post({ type: 'focusSearch' });
    }

    protected html(webview: vscode.Webview): string {
        const nonce = randomBytes(16).toString('hex');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'recipe-hub.css'));
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
        const origin = serverOrigin(this.host.serverUrl());
        const imageSources = origin === undefined ? 'https:' : `https: ${origin}`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
    }

    protected async onMessage(raw: unknown): Promise<void> {
        const message = parseFromWebview(raw);
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'ready':
                this.latestSeq = 0;
                this.post({
                    type: 'init',
                    defaultLocale: primaryLanguage(vscode.env.language),
                    serverOrigin: serverOrigin(this.host.serverUrl()) ?? '',
                });
                await this.loadFacets();
                return;
            case 'search':
                await this.search(message.seq, message.filters, message.page);
                return;
            case 'open':
                try {
                    await this.host.openRecipe(message.id, message.title);
                } catch (e) {
                    vscode.window.showErrorMessage(`Recipe Hub: ${errorMessage(e)}`);
                }
                return;
        }
    }

    protected async search(seq: number, filters: SearchFilters, page: number): Promise<void> {
        this.latestSeq = seq;
        try {
            const result = await this.host.hub().search(filters, page, PAGE_SIZE);
            if (seq !== this.latestSeq) {
                return;
            }
            this.post({ type: 'results', seq, page: result.page, cards: result.cards, total: result.total, hasMore: result.hasMore });
        } catch (e) {
            if (seq !== this.latestSeq) {
                return;
            }
            const error = e instanceof HubError ? e : new HubError('network', errorMessage(e));
            this.post({ type: 'error', seq, kind: error.kind, message: error.message });
        }
    }

    /** Facets only enrich the filters (tag list, languages); without them the panel still searches. */
    protected async loadFacets(): Promise<void> {
        try {
            this.post({ type: 'facets', facets: await this.host.hub().facets() });
        } catch (e) {
            console.warn('[recipe-hub] facets unavailable:', errorMessage(e));
        }
    }

    protected post(message: ToWebview): void {
        this.view?.webview.postMessage(message);
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
```

- [ ] **Step 3: Controller**

Create `recipe-hub/src/recipe-hub-controller.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { DEFAULT_SERVER_URL, HubClient } from './hub-client';
import { HubFileSystemProvider } from './hub-file-system';
import { HubFileSystemCore, loadRecipeContent } from './hub-file-system-core';
import { HUB_SCHEME, outletContextUri, parseRecipePath, recipePath, titleFromFileName } from './hub-uri';
import { originalRecipeUrl, trimServerUrl } from './hub-urls';
import { buildSaveDraftArgs } from './recipe-draft';
import { SearchViewHost, SearchViewProvider, VIEW_ID } from './search-view-provider';

/** A hub recipe a preview-toolbar command was invoked on. */
interface HubTarget {
    id: number;
    fileName: string;
    path: string;
}

/** Owns the settings, the `cooklang-hub:` file system and the commands; the panel is `SearchViewProvider`. */
export class RecipeHubController implements SearchViewHost {

    readonly files = new HubFileSystemCore(id => loadRecipeContent(this.hub(), id));
    protected readonly view: SearchViewProvider;

    constructor(protected readonly context: vscode.ExtensionContext, protected readonly api: CooklangApi) {
        this.view = new SearchViewProvider(context.extensionUri, this);
    }

    start(): void {
        this.context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(HUB_SCHEME, new HubFileSystemProvider(this.files), { isCaseSensitive: true, isReadonly: true }),
            vscode.window.registerWebviewViewProvider(VIEW_ID, this.view, { webviewOptions: { retainContextWhenHidden: true } }),
            vscode.commands.registerCommand('recipeHub.search', () => this.run(() => this.search())),
            vscode.commands.registerCommand('recipeHub.saveToDrafts', (arg: unknown) => this.run(() => this.saveToDrafts(arg))),
            vscode.commands.registerCommand('recipeHub.openSource', (arg: unknown) => this.run(() => this.openSource(arg))),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('recipeHub.serverUrl')) {
                    // Recipe ids belong to one server: drop cached recipes and restart the panel.
                    this.files.clear();
                    this.view.reload();
                }
            }),
        );
    }

    serverUrl(): string {
        const configured = vscode.workspace.getConfiguration('recipeHub').get<string>('serverUrl', DEFAULT_SERVER_URL);
        return trimServerUrl(configured) || DEFAULT_SERVER_URL;
    }

    hub(): HubClient {
        return new HubClient({ baseUrl: this.serverUrl() });
    }

    /** Card click: open the standard recipe preview on the hub URI. */
    async openRecipe(id: number, title: string): Promise<void> {
        await this.ensure(this.api.canOpenPreviews(), 'Update Cook Editor to preview Recipe Hub recipes.');
        const uri = vscode.Uri.from({ scheme: HUB_SCHEME, path: recipePath(id, title) });
        await this.api.openPreview(uri.toString());
    }

    protected async search(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.recipeHub');
        }
        this.view.focusSearch();
    }

    protected async saveToDrafts(arg: unknown): Promise<void> {
        await this.ensure(this.api.canSaveDrafts(), 'Update Cook Editor to save drafts.');
        const target = this.target(arg);
        const content = new TextDecoder().decode(await this.files.readFile(target.path));
        const detail = await this.hub().recipe(target.id).catch((e: unknown) => {
            console.warn(`[recipe-hub] no details for recipe ${target.id}; saving without them:`, e);
            return undefined;
        });
        await this.api.saveDraft(buildSaveDraftArgs({
            id: target.id,
            fileTitle: titleFromFileName(target.fileName),
            content,
            detail,
            serverUrl: this.serverUrl(),
        }));
    }

    protected async openSource(arg: unknown): Promise<void> {
        const target = this.target(arg);
        const detail = await this.hub().recipe(target.id).catch(() => undefined);
        await vscode.env.openExternal(vscode.Uri.parse(originalRecipeUrl(detail?.sourceUrl, this.serverUrl(), target.id)));
    }

    protected target(arg: unknown): HubTarget {
        const value = outletContextUri(arg);
        const uri = value === undefined ? undefined : vscode.Uri.parse(value);
        const ref = uri?.scheme === HUB_SCHEME ? parseRecipePath(uri.path) : undefined;
        if (!uri || !ref) {
            throw new Error('Open a Recipe Hub recipe in the preview first.');
        }
        return { ...ref, path: uri.path };
    }

    /** Rejects with `message` when the editor lacks the command behind `available`. */
    protected async ensure(available: Promise<boolean>, message: string): Promise<void> {
        if (!await available) {
            throw new Error(message);
        }
    }

    /** Runs a user action, surfacing failures as an error notification. */
    protected async run(action: () => Promise<void>): Promise<void> {
        try {
            await action();
        } catch (e) {
            vscode.window.showErrorMessage(`Recipe Hub: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
```

- [ ] **Step 4: Activation**

Create `recipe-hub/src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { RecipeHubController } from './recipe-hub-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    // Register first: a restored hub preview may be waiting for the cooklang-hub file system.
    new RecipeHubController(context, api).start();
    // Searching works on any editor; previewing and saving need cooklang.api.openPreview / saveDraft.
    // The editor's API version stays 1, so detect the commands themselves.
    const [canOpen, canSave] = await Promise.all([api.canOpenPreviews(), api.canSaveDrafts()]);
    if (!canOpen || !canSave) {
        vscode.window.showWarningMessage('Recipe Hub can search, but this Cook Editor cannot preview or save its recipes. Update Cook Editor to use them.');
    }
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 5: Compile and test**

Run: `npm run compile && npm test`
Expected:
- `tsc` prints no errors;
- esbuild writes `out/webview.js`;
- mocha reports `60 passing`.

- [ ] **Step 6: Manual smoke check**

Deploy into an editor that contains PR 2 (see Task 13, Steps 1–3, for the launch commands). Open the Recipe Hub activity-bar view. The panel shows "Searching…" and then either a result count or an error block. There must be no CSP violations in the webview devtools console (Help → Toggle Developer Tools, webview frame).

- [ ] **Step 7: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add recipe-hub/src/hub-file-system.ts recipe-hub/src/search-view-provider.ts recipe-hub/src/recipe-hub-controller.ts recipe-hub/src/extension.ts
git commit -m "feat(recipe-hub): file system, panel, commands and activation"
```

---

### Task 13: Deploy and verify end to end (manual, Electron via CDP)

**Files:** No new files. Fixes go into the files of the task that owns them.

- [ ] **Step 1: Deploy both plugins**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
export COOK_EDITOR_DIR=/Users/alexeydubovskoy/Cooklang/editor   # or the worktree holding PR 2
cd /Users/alexeydubovskoy/Cooklang/plugins/recipe-hub && npm run deploy
cd ../shopping-list && COOK_EDITOR_DIR=$COOK_EDITOR_DIR npm run deploy
```

Expected:
- `Deployed to …/plugins/cooklang.recipe-hub`;
- `Deployed to …/plugins/cooklang.shopping-list`.

- [ ] **Step 2: Prepare a workspace and a stub server**

```bash
mkdir -p ~/tmp/hub-e2e/.theia
cat > ~/tmp/hub-e2e/Local.cook <<'EOF'
---
servings: 2
---
Boil @pasta{200%g} with @salt.
EOF
cat > ~/tmp/hub-e2e-stub.js <<'EOF'
// Minimal Recipe Hub stand-in for the plugin's error states. Not committed.
const http = require('http');
const titleFor = id => (id % 10 === 1 ? 'Stub Pasta ' : 'Bare Card ') + Math.floor(id / 10);
const yamlRecipe = '---\nservings: 2\n---\nBoil @pasta{200%g} with @salt.\n';
const legacyRecipe = '>> servings: 2\n>> source: https://example.com/legacy\n\nBoil @pasta{200%g}.\n';
http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('q') ?? '';
    const send = (status, body, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    console.log(req.method, req.url);
    if (url.pathname === '/api/facets') {
        return send(200, { tags: [{ name: 'dinner', count: 2 }], locales: [{ code: 'en', name: 'English', count: 2 }], difficulties: [{ name: 'easy', count: 1 }] });
    }
    if (url.pathname === '/api/search') {
        if (q === 'bad') { return send(400, { error: 'Invalid query: unexpected end of input' }); }
        if (q === 'busy') { return send(429, 'Too Many Requests! Wait for 2s', 'text/plain'); }
        if (q === 'boom') { return send(500, { error: 'Search error' }); }
        if (q === 'slow') { return; } // never answers: the client gives up after 15 s
        const page = Number(url.searchParams.get('page') ?? '1');
        return send(200, {
            results: [
                { id: page * 10 + 1, title: titleFor(page * 10 + 1), summary: 'A stub recipe', tags: ['dinner', 'quick', 'vegan', 'extra'], locale: 'en', total_time_minutes: 20, servings: 2, feed: { id: 1, title: 'Stub Feed' } },
                { id: page * 10 + 2, title: titleFor(page * 10 + 2) },
            ],
            pagination: { page, limit: 20, total: 4, total_pages: 2 },
        });
    }
    const match = /^\/api\/recipes\/(\d+)(\/download)?$/.exec(url.pathname);
    if (match) {
        const id = Number(match[1]);
        if (match[2]) { return send(200, id % 10 === 2 ? legacyRecipe : yamlRecipe, 'text/plain'); }
        return send(200, id % 10 === 1
            ? { id, title: titleFor(id), source_url: 'https://example.com/stub-pasta', enclosure_url: 'https://example.com/stub-pasta.cook', feed: { id: 1, title: 'Stub Feed' } }
            : { id, title: titleFor(id), enclosure_url: 'https://example.com/bare.cook', feed: { id: 1, title: 'Stub Feed' } });
    }
    send(404, { error: 'Not found' });
}).listen(8765, () => console.log('stub on http://127.0.0.1:8765'));
EOF
node ~/tmp/hub-e2e-stub.js &
```

Expected: `stub on http://127.0.0.1:8765`.

- [ ] **Step 3: Launch the editor**

Quit Cook Editor.app first, because of the single-instance lock. Then:

```bash
cd $COOK_EDITOR_DIR/app
npm run bundle && npm run start -- --log-level=debug --remote-debugging-port=9222 ~/tmp/hub-e2e
```

Dismiss the workspace-trust dialog ("Yes, I trust the authors") before clicking anything else. To drive the checks unattended, run a script with `NODE_PATH=$COOK_EDITOR_DIR/node_modules node script.js` that calls `puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })`. The panel webview lives in an iframe; reach it via `page.frames()`.

- [ ] **Step 4: Production checks (needs PR 1 deployed; default `recipeHub.serverUrl`)**

1. The activity bar shows the globe. Clicking it opens "Recipe Hub", which shows "Searching…" and then "N recipes". The Language filter defaults to the editor's display language (English → `en`). With a display language that has no recipes, it switches to "Any language" once facets arrive.
2. Type `pasta`. Results update about 300 ms after you stop typing. The federation access log, or DevTools → Network on the extension host, shows only one request for the final text.
3. Filters: open "Filters". After each step below, confirm the badge count, and that the results obey the filter (spot-check cards):
   - Tags: pick a tag from the list (it shows counts), and type a second tag + Enter; both appear as chips;
   - With ingredients `garlic`;
   - Without ingredients `peanut`, shown as a "no peanut" chip;
   - Max time `≤ 30 min`;
   - Difficulty `Easy`;
   - Servings `2`–`4`;
   - Language `Any language`, then another language;
   - Sort `Newest`;
   - click a card's feed name, which adds a Feed chip;
   - click a card's tag chip, which adds that tag.
4. Each chip's × removes it. "Clear filters" resets every filter, puts the language back to the display language, and keeps the query text and sort.
5. "Load more" appends the next 20. It disappears on the last page.
6. Close the view and reopen it, then restart the editor: the filters and the query are restored.
7. Click a card. The standard recipe preview opens on `cooklang-hub:/recipes/<id>/<Title>.cook` with the title, ingredients and steps. If the recipe's frontmatter `image:` is an https URL, the image shows (PR 2). The preview header shows **Save to Drafts** and **Open Original Recipe**, and **not** the shopping-list cart.
8. Open `Local.cook` in the preview: the cart is shown, and the two Recipe Hub buttons are not.
9. On the hub preview, click Open Original Recipe. The system browser opens the recipe's `source_url`, or its recipes.cooklang.org page when it has none.
10. Click Save to Drafts. `Drafts/<Title>.cook` is created and opens. Check it:

    ```bash
    head -8 ~/tmp/hub-e2e/Drafts/*.cook
    grep -L '^title:' ~/tmp/hub-e2e/Drafts/*.cook      # expected: no output
    grep -L '^source:' ~/tmp/hub-e2e/Drafts/*.cook     # expected: no output
    grep -l '^>>' ~/tmp/hub-e2e/Drafts/*.cook          # expected: no output
    ```

    The file starts with `---`, contains `title:` and `source:` lines, and never uses `>>`.
11. Click Save to Drafts again. The editor creates a second, uniquely named draft; the first is not overwritten.
12. In the hub preview, use Toggle Preview / Show Source. A read-only editor opens, and typing or saving is refused with the "read-only" message.
13. Restart the editor with the hub preview tab still open. It comes back with its content, which confirms that `onFileSystem:cooklang-hub` activation works.
14. Command palette: "Recipe Hub: Search Recipes" focuses the panel's search box. "Save to Drafts" and "Open Original Recipe" are not listed, and no `cooklang.api.*` entries appear.

- [ ] **Step 5: Error-state checks**

Set the server in `~/tmp/hub-e2e/.theia/settings.json` for each check. Each change reloads the panel.

1. `{ "recipeHub.serverUrl": "http://127.0.0.1:9" }` shows "Could not reach Recipe Hub." with detail `(connect ECONNREFUSED 127.0.0.1:9)` and a Retry button. Retry repeats the request.
2. `{ "recipeHub.serverUrl": "recipes.cooklang.org" }` shows "Could not reach Recipe Hub." with a detail naming the `recipeHub.serverUrl` setting.
3. `{ "recipeHub.serverUrl": "http://127.0.0.1:8765" }`, the stub:
   - With an empty query, the list shows "4 recipes" and two cards. "Bare Card 1" renders with only its title, which confirms the tolerant parsing. "Load more" appends page 2, then disappears.
   - `bad`: the server message "Invalid query: unexpected end of input" shows under the search box, with no card list and no Retry.
   - `busy`: "Too many searches — try again shortly." with Retry.
   - `boom`: "Recipe Hub error: Search error" with Retry.
   - `slow`: after about 15 s, "Could not reach Recipe Hub." with detail "Recipe Hub did not respond in time."
   - Type `slo` and then quickly `boom`: only the `boom` state appears, because the stale response is dropped.
   - Open "Bare Card 1" and click Save to Drafts. The draft starts with YAML frontmatter holding `servings: 2` and `source: "https://example.com/legacy"`, has no `>>` lines, and has a `title:` line.
4. Remove the setting and confirm the panel is back on recipes.cooklang.org. Stop the stub with `kill %1`.

- [ ] **Step 6: Troubleshooting (only if a check fails)**

- **The hub buttons never appear, or the cart shows on a hub preview.** The outlet toolbar is not evaluating `when` against the preview element. Check that PR 2 set `cooklangPreviewScheme` on the preview and that `CooklangOutletService.getItems` scopes by it. That is an editor fix, not a plugin one.
- **Clicking a card shows "Update Cook Editor to preview Recipe Hub recipes."** The running editor lacks `cooklang.api.openPreview`: the bundle was built without PR 2. Rebuild with `npm run bundle`, or point `COOK_EDITOR_DIR` at the PR 2 worktree. If the command exists but the preview is empty, the preview is not reading through `FileService`, which is also PR 2.
- **`recipeHub.view.focus` is missing.** The `search` command already falls back to `workbench.view.extension.recipeHub`; check which one exists in the log.

- [ ] **Step 7: Commit any fixes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add -A recipe-hub shopping-list
git commit -m "fix(recipe-hub): issues found in the end-to-end run"
```

Skip this commit if nothing changed.

---

### Task 14: Document, package and publish

**Files:**
- Create: `recipe-hub/README.md`
- Modify: `README.md` (repo root)

- [ ] **Step 1: Plugin README**

Create `recipe-hub/README.md`:

```markdown
# Recipe Hub

Search the public Cooklang recipe index at
[recipes.cooklang.org](https://recipes.cooklang.org) without leaving Cook
Editor. Ships with Cook Editor.

- Search by text (the full query syntax works, e.g. `tags:vegan pasta`) and
  filter by tags, ingredients to include or exclude, total time, difficulty,
  servings, language and feed. Sort by relevance or newest.
- Click a result to open it in the normal recipe preview.
- **Save to Drafts** (preview toolbar) copies the recipe into your folder's
  `Drafts/` with `title:` and `source:` in its YAML frontmatter.
- **Open Original Recipe** opens the recipe's source page in your browser.

Setting: `recipeHub.serverUrl` (default `https://recipes.cooklang.org`) points
the panel at another Recipe Hub server.

## For plugin authors

This plugin shows:

- a read-only `FileSystemProvider` (`cooklang-hub:` scheme) that lets the
  standard recipe preview show remote recipes — `src/hub-file-system.ts`,
  logic in `src/hub-file-system-core.ts`;
- `cooklang.api.openPreview` and `cooklang.api.saveDraft`, detected with
  `vscode.commands.getCommands(true)` rather than a version number, and the
  `cooklangPreviewScheme` context key for `cooklang/recipePreview/toolbar`
  outlet entries — `src/cooklang-api.ts`, `package.json` → `contributes.menus`;
- a webview view that keeps all network access in the extension host
  (`src/search-view-provider.ts`, `src/webview/main.ts`).

Reference: https://cook.md/help/plugins/api and https://cook.md/help/plugins/outlets
```

- [ ] **Step 2: List the plugin**

In the root `README.md` table, add this row after the `shopping-list` row:

```markdown
| [`recipe-hub`](./recipe-hub) | Search recipes.cooklang.org, preview results and save them to Drafts. Ships with Cook Editor. Shows a read-only file system provider and `cooklang.api.saveDraft`. |
```

- [ ] **Step 3: Package both plugins**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/recipe-hub && npm run package
unzip -l recipe-hub-0.1.0.vsix | grep -E "out/(extension|webview).js|media/|README|LICENSE"
unzip -l recipe-hub-0.1.0.vsix | grep -cE "src/|\.spec\.js|\.map"
cd ../shopping-list && npm run package
```

Expected:
- `recipe-hub-0.1.0.vsix` is built with no vsce errors;
- the first `unzip` lists `out/extension.js`, `out/webview.js`, the six media files, `README.md` and `LICENSE`;
- the count of `src/`, spec or map entries is `0`;
- `shopping-list-0.1.2.vsix` is built.

- [ ] **Step 4: Commit, push and open the PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add README.md recipe-hub/README.md
git commit -m "docs: list the recipe-hub plugin"
git push -u origin feat/recipe-hub
gh pr create --title "feat: recipe-hub plugin; shopping-list 0.1.2" --body "Recipe Hub plugin: search recipes.cooklang.org with structured filters, preview through a read-only cooklang-hub: file system, Save to Drafts via cooklang.api.saveDraft. shopping-list 0.1.2 hides the cart on non-file previews (when: cooklangPreviewScheme == file). Spec: cook-md/editor docs/superpowers/specs/2026-09-25-recipe-hub-plugin-design.md"
```

- [ ] **Step 5: Publish (needs the user)**

After the PR is merged, ask the user to run the following with their plugins.cook.md PAT. The namespace `cooklang` already exists.

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/recipe-hub
OVSX_PAT=<PAT> npm run publish:marketplace
cd ../shopping-list
OVSX_PAT=<PAT> npm run publish:marketplace
```

Verify:

```bash
curl -sI https://plugins.cook.md/api/cooklang/recipe-hub/0.1.0/file/cooklang.recipe-hub-0.1.0.vsix | head -1
curl -sI https://plugins.cook.md/api/cooklang/shopping-list/0.1.2/file/cooklang.shopping-list-0.1.2.vsix | head -1
```

Expected: `HTTP/2 200` (or a 302 to storage) for both.

---

### Task 15: Ship Recipe Hub by default in the editor

**Files:**
- Modify: `editor/package.json` (`theiaPlugins`)

- [ ] **Step 1: Branch**

This task needs PR 2 merged to `main`, because the editor must provide `cooklang.api.saveDraft` and `cooklang.api.openPreview`.

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git fetch origin
git switch -c feat/recipe-hub-default-plugin origin/main
git grep -n "'cooklang.api.openPreview'\|'cooklang.api.saveDraft'" -- packages
```

Expected: one match for each id, in `cooklang-plugin-api-contribution.ts` and in the `cooklang-import` package. If either is missing, stop: PR 2 has not landed.

- [ ] **Step 2: Pin the plugins**

In the root `package.json` → `theiaPlugins`, replace the `cooklang.shopping-list` line with these two lines:

```json
    "cooklang.shopping-list": "https://plugins.cook.md/api/cooklang/shopping-list/0.1.2/file/cooklang.shopping-list-0.1.2.vsix",
    "cooklang.recipe-hub": "https://plugins.cook.md/api/cooklang/recipe-hub/0.1.0/file/cooklang.recipe-hub-0.1.0.vsix"
```

- [ ] **Step 3: Download and verify**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
rm -rf plugins/cooklang.recipe-hub plugins/cooklang.shopping-list
npm run download:plugins
node -e "for (const p of ['recipe-hub','shopping-list']) console.log(p, require('./plugins/cooklang.' + p + '/extension/package.json').version)" 2>/dev/null \
  || node -e "for (const p of ['recipe-hub','shopping-list']) console.log(p, require('./plugins/cooklang.' + p + '/package.json').version)"
```

Expected: `recipe-hub 0.1.0` and `shopping-list 0.1.2`. The unpacked layout has `extension/` or not depending on the downloader; one of the two commands prints the versions.

- [ ] **Step 4: Smoke test the packaged plugins**

```bash
cd app && npm run bundle && npm run start -- ~/tmp/hub-e2e
```

Check:
- the Recipe Hub globe is in the activity bar and a search returns results;
- a card opens the preview, and Save to Drafts writes `Drafts/<Title>.cook`;
- the shopping-list cart still works on `Local.cook`.

- [ ] **Step 5: Commit and open the PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add package.json
git commit -m "feat: ship the recipe-hub plugin by default; shopping-list 0.1.2"
git push -u origin feat/recipe-hub-default-plugin
gh pr create --title "feat: ship the recipe-hub plugin by default" --body "Adds cooklang.recipe-hub 0.1.0 to the default plugins and bumps cooklang.shopping-list to 0.1.2 (hides the cart on non-file previews). Spec: docs/superpowers/specs/2026-09-25-recipe-hub-plugin-design.md §3."
```

`release-please.yml` already runs `npm run download:plugins`, so release builds pick both plugins up with no workflow change.

---

## Self-review against the spec

| Spec item | Where | Notes |
|---|---|---|
| §3 Same layout/tooling as shopping-list (tsc + esbuild, mocha, deploy.js, vsce/ovsx) | Task 2 | Scripts, tsconfig and `.vscodeignore` are identical apart from names. `deploy.js` defaults to `../../editor` and honours `COOK_EDITOR_DIR`. |
| §3.1 `hub-client.ts`: search/facets/recipe/download, timeout, `HubError` kinds | Task 5 | Also has `fetchText`, used for the `enclosure_url` fallback. |
| §3.1 `search-query.ts` | Task 3 | Also holds the default-locale logic and filter validation for untrusted state. |
| §3.1 `recipe-draft.ts` (`source:` from `source_url`) | Task 8 | Falls back to the hub page when `source_url` is missing or not http(s). Converts `>>` metadata to YAML. |
| §3.1 `hub-file-system.ts`: URI shape, download with `enclosure_url` fallback, LRU 50, writes throw `NoPermissions` | Tasks 6, 7, 12 | Logic is factored into `hub-file-system-core.ts` so the spec's "FS provider cache and read-only errors" tests run without `vscode`. |
| §3.1 `search-view-provider.ts`: protocol, searches, request sequence | Tasks 10, 12 | `latestSeq` drops stale responses in the host, and the webview checks `seq` too. |
| §3.1 `webview/main.ts` | Task 11 | |
| §3.1 `extension.ts`: register provider, FS, commands; check `cooklang.api.version` | Tasks 9, 12 | Registration lives in `RecipeHubController.start()`, mirroring `ShoppingListController`. **Changed:** the plugin detects `cooklang.api.saveDraft` and `cooklang.api.openPreview` through `getCommands(true)` instead of checking a version, because `VERSION` stays `1` (editor plan decision 1). It warns once on activation, and each action re-checks. |
| §3.2 `viewsContainers.activitybar` `recipeHub` / webview `recipeHub.view` | Task 2 | |
| §3.2 `recipeHub.serverUrl` default | Task 2 | Changing it clears the cache and reloads the panel (Task 12). |
| §3.2 `recipeHub.search`, `recipeHub.saveToDrafts`, `recipeHub.openSource` with `when: cooklangPreviewScheme == cooklang-hub` | Tasks 2, 12 | The two toolbar commands are hidden from the palette. |
| §3.3 search box with full `q` syntax | Task 11 | |
| §3.3 filters: tags from facets with counts, include/exclude chips, time presets 15/30/60/any, difficulty, servings range, language (display language default + Any), sort, Clear filters | Tasks 3, 11 | The feed filter (spec §1.1 `feed_id`) is reachable by clicking a card's feed name. |
| §3.3 cards: thumbnail, title, summary, time, servings, feed, ≤3 tags | Task 11 | Missing fields are simply not rendered. |
| §3.3 Load more (20/page) | Tasks 3, 11 | `PAGE_SIZE = 20`. |
| §3.3 states: loading, empty, network + Retry, bad query inline, rate limited | Task 11 | Server errors also get Retry. |
| §3.3 300 ms debounce, stale-sequence drop, `setState` persistence, CSP `img-src https:` | Tasks 11, 12 | The CSP also allows the configured server origin, for http dev servers. No `connect-src`: all fetches run in the extension host. |
| §3.4 card → preview | Tasks 9, 12 | Uses `cooklang.api.openPreview({ uri })` from PR 2, because `cooklang.openPreview` does not exist. |
| §3.4 Save to Drafts via FS content → `saveDraft({ version: 1, content, title, frontmatter: { source } })` | Tasks 8, 12 | Reads through `HubFileSystemCore`, the same cache the FS provider uses. |
| §3.4 API too old → "Update Cook Editor to save drafts" | Tasks 9, 12 | Triggered by `cooklang.api.saveDraft` missing from the command list. Shown as "Recipe Hub: Update Cook Editor to save drafts." (a plain string, as in shopping-list). Opening a preview without `cooklang.api.openPreview` gives "…to preview Recipe Hub recipes." |
| §3.5 shopping-list on hub previews | Task 1 | Decision: hide, with `when: cooklangPreviewScheme == file` and version 0.1.2. The shopping list resolves workspace-relative paths through the native crate, not `workspace.fs`, and the outlet `path` is `''` outside the workspace. |
| §4 Plugin mocha tests | Tasks 3–10 | hub-client (stubbed fetch: success, every error kind, missing fields), search-query, recipe-draft frontmatter, FS cache and read-only errors. 60 tests in total. |
| §4 E2E: search → filter → preview → Save to Drafts → `title:` and `source:` | Task 13 | Also covers every filter, Load more, and every error state (bad host, stub server). |
| Ship by default | Task 15 | `theiaPlugins` in the editor's root `package.json`, as for shopping-list. |

Gaps found while writing the plan, and fixed inline:
- The spec's "minor bump" of `CooklangPluginApi.VERSION` would disable shopping-list, whose check is `!== 1`. Per the editor plan, `VERSION` stays `1` and the plugin uses feature detection (Task 9).
- `cooklang.openPreview` does not exist; the plugin calls PR 2's `cooklang.api.openPreview({ uri })`, with the id kept in `CooklangApiCommands`.
- Remote images need no rewriting: the preview renders `image: https://…` frontmatter natively (PR 2), so neither `recipe-draft.ts` nor the FS provider touches images.
- A hub preview restored at startup needs the file system before `onStartupFinished`; the `onFileSystem:cooklang-hub` activation event is added in Task 2.
- Changing the server needs a cache flush, because ids are per server; handled in Task 12.
- Drafts must not carry `>>` metadata from old feeds; conversion added in Task 8.
