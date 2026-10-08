# Favourites plugin — design

**Date:** 2026-10-08
**Status:** Approved (brainstorming)
**Repos touched:** `editor` (one context key, one `theiaPlugins` entry), `plugins` (new `favourites` package)
**Design reference:** Cooklang iOS Figma, "Favourites" page (node 5183-28212): outline heart → filled orange heart, "Added to Favourites" toast with Undo, a Favourites tab listing recipes.

## Goal

Mark recipes as favourites from the recipe preview (a heart button), from the
Explorer, or from the command palette. Favourites are stored in a plain-text
`.bookmarks` file at the workspace root so other Cooklang clients (iOS app,
CLI, sync) can share them. A "Favourites" view in the Explorer sidebar lists
them and opens the preview on click.

Shipped as a built-in plugin: source in `../plugins/favourites`, published to
plugins.cook.md, listed in the editor's `theiaPlugins` like `shopping-list`.

## Non-goals

- Menus (`.menu`). Recipes (`.cook`) only. Adding menus later is additive
  (another `when` clause and outlet).
- The iOS bounce animation. A plugin cannot animate a toolbar button; the
  action bar's hover style is what there is.
- Hiding `.bookmarks` from the Explorer. It is the user's file and they may
  edit it by hand.
- Multi-root workspaces. Only the first workspace folder is used, which is how
  the preview already computes `PreviewOutletContext.path`.
- A heart over the hero image (iOS placement). The heart is the first button
  of the preview's header action bar.

## Work order

1. Editor: `cooklangPreviewPath` context key on the recipe preview element.
2. Plugin `cooklang.favourites` in `../plugins/favourites`: file format, store,
   commands, toolbar hearts, Explorer context menu, Favourites view, toasts,
   rename/delete tracking, tests, README, CI matrix row.
3. Publish 0.1.0 to plugins.cook.md (user runs `publish:marketplace` with the
   PAT) and add the `theiaPlugins` entry in the editor's root `package.json`.

1 and 2 can be developed together with `npm run deploy` from the plugin
folder; 3 needs the published vsix URL.

---

## 1. Editor

### 1.1 `cooklangPreviewPath` context key

`CooklangOutlets.PREVIEW_PATH_CONTEXT_KEY = 'cooklangPreviewPath'`, documented
next to `PREVIEW_SCHEME_CONTEXT_KEY` in `cooklang-outlets.ts`.

`RecipePreviewWidget.setUri` sets it on the scoped context key store together
with the scheme key, to `this.outlets.describe(uri).path`: the
workspace-relative path with `/` separators, or `''` for a recipe outside the
workspace or with a non-`file` scheme. It is the same string the outlet
context's `path` field carries, so a plugin can publish a list of such paths
and use `cooklangPreviewPath in <key>` / `not in <key>` in a toolbar `when`
clause. Monaco's context key parser (used by Theia's `ContextKeyService`)
supports both operators.

Spec: `recipe-preview-widget.spec.ts` gets a sibling of the existing
`cooklangPreviewScheme` tests: set for a workspace file, `''` for a hub URI,
updated on re-bind.

No other editor change: `cooklang.api.refreshBadges` already fires
`CooklangOutletService.refresh()`, and the recipe preview re-renders its
toolbar on `outlets.onDidChange`, so a plugin that updates a context key and
then calls `refreshBadges` gets the toolbar re-evaluated.

### 1.2 `theiaPlugins`

After step 3: `"cooklang.favourites": "https://plugins.cook.md/api/cooklang/favourites/0.1.0/file/cooklang.favourites-0.1.0.vsix"`.

---

## 2. Plugin `cooklang.favourites`

Folder `../plugins/favourites`, same layout and tooling as `corevitals`
(`package.json`, `tsconfig.json`, `src/`, `media/`, `scripts/deploy.js`,
`LICENSE`, `README.md`; mocha specs next to the modules; `vscode:prepublish`,
`package`, `publish:marketplace` scripts). Publisher `cooklang`, name
`favourites`, display name "Favourites", `engines.vscode ^1.100.0`,
`activationEvents: ["onStartupFinished"]`.

### 2.1 `.bookmarks` file format

- Location: `<first workspace folder>/.bookmarks`.
- UTF-8, LF line endings, trailing newline.
- One favourite per line: the recipe path relative to the workspace root,
  with `/` separators and the `.cook` extension, e.g. `Breakfast/Pancakes.cook`.
- Blank lines are ignored. Lines whose first non-blank character is `#` are
  comments.
- When reading, each line is trimmed, `\` is normalised to `/`, a leading `./`
  is dropped, and duplicates are collapsed keeping the first occurrence.
  Matching is exact and case-sensitive after normalisation.
- When writing, the plugin edits the existing text: a new favourite is
  appended as the last line; a removed favourite deletes its line(s); a rename
  rewrites the matching line in place. Comments, blank lines and the order of
  untouched lines are preserved. A file that does not exist is treated as
  empty and is created on the first add; it is never created just by opening
  a workspace. Removing the last favourite leaves an empty (or comment-only)
  file; the file is not deleted.

`src/bookmarks.ts` is pure (no `vscode` import): `parse(text): string[]`,
`add(text, path): string`, `remove(text, path): string`,
`rename(text, from, to): string`, `renamePrefix(text, fromDir, toDir): string`
(folder moves), `removePrefix(text, dir): string` (folder deletes), plus
`normalizePath(raw): string`. Unit-tested.

### 2.2 Store — `src/favourites-store.ts`

Owns the in-memory set and the file. API: `paths(): readonly string[]` (file
order, normalised), `has(path)`, `add(path)`, `remove(path)`, `toggle(path)`,
`applyRenames(renames: {from, to}[])`, `applyDeletes(paths: string[])`
(both take workspace-relative paths and cover files and folders alike, see
2.7), `onDidChange: Event<void>`,
`reload()`.

- Reads with `workspace.fs.readFile`; `FileNotFound` → empty.
- Every mutation is read-modify-write: read the current file text, apply the
  pure edit, write with `workspace.fs.writeFile`, then update the set and
  fire `onDidChange`. External edits between two operations are therefore
  kept.
- Watches `.bookmarks` with `workspace.createFileSystemWatcher(new
  RelativePattern(root, '.bookmarks'))`; on create/change/delete it reloads
  and fires `onDidChange` only when the parsed list differs. Writes the store
  itself just made also trigger the watcher; the diff check makes that a
  no-op.
- No workspace folder: `paths()` is empty, mutations throw
  `NoWorkspaceError`, which commands turn into an information message
  ("Open a recipe folder to use favourites.").
- `workspace.onDidChangeWorkspaceFolders` → re-root and reload.

### 2.3 Context keys — `src/context-sync.ts`

On activation and on every `onDidChange`:

- `setContext('cooklang.favourites.paths', store.paths())` — for the preview
  toolbar `when` clauses (`cooklangPreviewPath in cooklang.favourites.paths`).
- `setContext('cooklang.favourites.uris', paths.map(p =>
  Uri.joinPath(root, ...p.split('/')).toString()))` — for the Explorer context
  menu, which can only see the built-in resource keys; `resource` holds the
  selected file's URI string, and both sides build it with the same
  `vscode-uri` encoding, so string equality holds on every OS (`resourcePath`
  would not: Theia and `vscode-uri` disagree on the Windows drive-letter case).
- then `cooklang.api.refreshBadges` (ignored when the editor predates it, as
  in `corevitals`), so open previews re-render their toolbar.
- The store fires no change event when the loaded list equals the initial
  empty list, so `activate` also syncs once explicitly after binding the
  workspace.

### 2.4 Resolving the target recipe — `src/recipe-target.ts`

Pure. `recipeTarget(argument, root: Uri | undefined, activeEditorUri: Uri |
undefined): { uri: string; path: string } | undefined`, where `uri` is the
URI string (plain JSON, like the tree items) and `path` is the normalised
workspace-relative path. Paths are compared after lower-casing a leading
Windows drive letter, because `vscode-uri` yields `/C:/…` from `Uri.file()`
but `/c:/…` from `Uri.parse()`:

- `PreviewOutletContext` (toolbar, has `version`/`uri`/`path`): uses `path`
  when non-empty and the URI scheme is `file`.
- A `Uri` (Explorer `explorer/context`): must be `file`,
  inside `root`, extension `.cook` (case-insensitive).
- A tree item (`FavouriteItem`, has `favouritePath`): uses it.
- Otherwise the active editor's document URI, same checks.
- Returns `undefined` when none applies; the command then shows "Open a recipe
  (.cook) to add it to Favourites." and does nothing.

### 2.5 Commands and menus (`package.json`)

Commands (category "Favourites"):

| id | title | icon |
|---|---|---|
| `cooklang.favourites.add` | Add to Favourites | `media/heart-light.svg` / `media/heart-dark.svg` (outline) |
| `cooklang.favourites.remove` | Remove from Favourites | `media/heart-filled.svg` (filled, `#e15a29`, the editor's brand orange) |
| `cooklang.favourites.toggle` | Toggle Favourite | — |
| `cooklang.favourites.openRecipe` | Open Recipe | — (tree item click; hidden from the palette) |

Menus:

- `cooklang/recipePreview/toolbar`, both at `navigation@1`:
  `add` when `cooklangPreviewScheme == file && cooklangPreviewPath =~
  /\.cook$/i && cooklangPreviewPath not in cooklang.favourites.paths`;
  `remove` when `cooklangPreviewScheme == file && cooklangPreviewPath =~
  /\.cook$/i && cooklangPreviewPath in cooklang.favourites.paths`. The
  `.cook` match also excludes the Markdown recipes (`.md` with
  `recipe: true`) the recipe preview can show, and an empty path (outside
  the workspace).
- `explorer/context`, group `navigation@80`:
  `add` when `resourceExtname =~ /^\.cook$/i && resource not in
  cooklang.favourites.uris`; `remove` when `resourceExtname =~ /^\.cook$/i
  && resource in cooklang.favourites.uris`.
- `view/item/context` on `cooklang.favourites.view` items with
  `viewItem == favourite`: `remove`, group `inline`.
- `commandPalette`: `toggle` always; `add` and `remove` when
  `editorLangId == cooklang` (they then act on the active editor);
  `openRecipe` `when: false`.

Behaviour:

- `add`/`remove`/`toggle` first check the store has a workspace (else
  "Open a recipe folder to use favourites."), resolve the target (2.4), call
  the store, then show a toast: "Added to Favourites" or "Removed from
  Favourites" with an **Undo** action that applies the inverse operation.
  `add` on a recipe that is already a favourite shows "Already in Favourites"
  (no Undo); `remove` on one that is not shows "Not in Favourites". Toasts use
  `window.showInformationMessage`, which the editor renders as a notification.
- Store failures (write errors) surface as
  `window.showErrorMessage("Could not update .bookmarks: <reason>")` and are
  logged to an output channel "Favourites".

### 2.6 Favourites view — `src/favourites-tree.ts`

`contributes.views.explorer`: `{ "id": "cooklang.favourites.view", "name":
"Favourites", "visibility": "collapsed" }` (`visibility` is a VS Code hint;
Theia ignores it and restores whatever state the container had). A `TreeDataProvider<FavouriteItem>`
registered with `window.createTreeView`, `showCollapseAll: false`.

- One flat level. Items sorted by recipe name (file name without `.cook`),
  case-insensitive, then by path.
- `label`: recipe name; `description`: the containing folder (`''` at the
  root); `tooltip`: the relative path; `resourceUri`: the file URI (so the
  file icon theme applies); `contextValue: 'favourite'`;
  `command: cooklang.favourites.openRecipe` with the item as argument, which
  runs `cooklang.api.openPreview({ uri })`.
- A favourite whose file does not exist (checked with `workspace.fs.stat`
  when building the items) gets `iconPath = ThemeIcon('warning')` and the
  tooltip "File not found: <path>". It stays in the list so the user can
  remove it.
- `contributes.viewsWelcome` for the empty view: "No favourites yet. Open a
  recipe and press the heart in its preview."
- Refreshes on `store.onDidChange`.

### 2.7 Renames and deletes

Neither handler needs to know whether a path was a file or a folder: an
operation on `p` applies to the favourite equal to `p` and to every favourite
under `p/`.

- `workspace.onDidRenameFiles`: `store.applyRenames` with the old and new
  workspace-relative paths. The exact match is renamed with `rename`; entries
  under the old path are rewritten with `renamePrefix`. A file renamed to a
  non-`.cook` name is removed instead. A rename out of the workspace is a
  removal.
- `workspace.onDidDeleteFiles`: `store.applyDeletes` removes the exact match
  (`remove`) and everything under it (`removePrefix`).
- Both events cover renames/deletes made through the editor only; external
  moves leave stale entries, shown with the warning icon (2.6).

### 2.8 Tests

Mocha, like the other plugins (`npm test` = `tsc && mocha out/**/*.spec.js`):

- `bookmarks.spec.ts`: parse (comments, blanks, `\`, `./`, duplicates),
  add/remove/rename/renamePrefix/removePrefix preserving comments and order,
  trailing newline, empty text.
- `recipe-target.spec.ts`: each argument shape, rejections (hub scheme,
  outside root, `.menu`, missing).
- `favourites-store.spec.ts`: with a fake `fs` (readFile/writeFile/stat) —
  missing file, read-modify-write keeps external edits, change events only on
  real changes, no workspace.
- `favourites-tree.spec.ts`: sorting, description, missing-file marker.

Manual check in the editor: heart toggles and re-renders in an open preview,
Explorer menu entries switch, view lists and opens, Undo works, hand-editing
`.bookmarks` updates the heart and the view.

### 2.9 Docs and CI

- `favourites/README.md`: what it does, the `.bookmarks` format (2.1), the
  commands, that it ships with Cook Editor.
- Plugins repo `README.md` table: a `favourites` row ("Heart on recipe
  previews and a Favourites view, stored in a plain-text `.bookmarks` file.
  Ships with Cook Editor. Shows context keys driving toolbar `when` clauses
  and a tree view.").
- `.github/workflows/ci.yml` matrix: add `favourites`.
