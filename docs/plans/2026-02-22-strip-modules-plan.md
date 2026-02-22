# Strip Unnecessary Modules - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove ~49 unnecessary packages from the Theia monorepo to create a focused Cooklang editor foundation.

**Architecture:** Two-phase approach. Phase 1 removes packages that are only referenced as dependencies of the example apps (no code changes to retained packages). Phase 2 decouples plugin-ext from removed subsystems by removing Main/Ext implementations and proxy identifiers.

**Tech Stack:** Lerna monorepo, npm workspaces, TypeScript composite projects, InversifyJS DI

---

## Phase 1: Safe Removals (dependency-only changes)

### Task 1: Remove AI provider dependencies from Electron example

**Files:**
- Modify: `examples/electron/package.json` (lines 29-51 contain AI deps)

**Step 1: Remove these dependencies from `examples/electron/package.json`**

Remove these 19 entries from the `dependencies` object:
```
"@theia/ai-anthropic"
"@theia/ai-claude-code"
"@theia/ai-code-completion"
"@theia/ai-codex"
"@theia/ai-copilot"
"@theia/ai-editor"
"@theia/ai-google"
"@theia/ai-history"
"@theia/ai-huggingface"
"@theia/ai-ide"
"@theia/ai-llamafile"
"@theia/ai-mcp"
"@theia/ai-mcp-server"
"@theia/ai-mcp-ui"
"@theia/ai-ollama"
"@theia/ai-openai"
"@theia/ai-scanoss"
"@theia/ai-terminal"
"@theia/ai-vercel-ai"
```

Keep: `@theia/ai-chat`, `@theia/ai-chat-ui`, `@theia/ai-core`, `@theia/ai-core-ui`

**Step 2: Commit**

```bash
git add examples/electron/package.json
git commit -m "chore: remove AI provider dependencies from electron app"
```

---

### Task 2: Remove Git, SCM extras, and dev/meta dependencies from Electron example

**Files:**
- Modify: `examples/electron/package.json`

**Step 1: Remove these dependencies from `examples/electron/package.json`**

```
"@theia/collaboration"
"@theia/dev-container"
"@theia/git"
"@theia/memory-inspector"
"@theia/metrics"
"@theia/remote"
"@theia/scanoss"
"@theia/scm-extra"
"@theia/timeline"
```

**Step 2: Commit**

```bash
git add examples/electron/package.json
git commit -m "chore: remove git, SCM extras, and dev/meta deps from electron app"
```

---

### Task 3: Remove debug, terminal, task, test, and other Phase-2 targets from Electron example

These packages are Phase 2 targets (they need decoupling from plugin-ext), but we can
already remove them from the Electron app's direct dependencies. plugin-ext will still
pull them in transitively until Phase 2, but this makes the Electron app's dependency
intent clear.

**Files:**
- Modify: `examples/electron/package.json`

**Step 1: Remove these dependencies from `examples/electron/package.json`**

```
"@theia/bulk-edit"
"@theia/callhierarchy"
"@theia/console"
"@theia/debug"
"@theia/external-terminal"
"@theia/mini-browser"
"@theia/notebook"
"@theia/plugin-dev"
"@theia/plugin-metrics"
"@theia/preview"
"@theia/scm"
"@theia/task"
"@theia/terminal"
"@theia/terminal-manager"
"@theia/test"
"@theia/typehierarchy"
```

**Step 2: Commit**

```bash
git add examples/electron/package.json
git commit -m "chore: remove debug, terminal, task, test, and other unneeded deps from electron app"
```

---

### Task 4: Remove sample/example dependencies from Electron example

**Files:**
- Modify: `examples/electron/package.json`

**Step 1: Remove these dependencies**

```
"@theia/api-provider-sample"
"@theia/api-samples"
```

**Step 2: Commit**

```bash
git add examples/electron/package.json
git commit -m "chore: remove sample dependencies from electron app"
```

---

### Task 5: Clean up Browser example the same way

Apply the same removals to the browser example so it stays buildable for testing.

**Files:**
- Modify: `examples/browser/package.json`

**Step 1: Remove the same set of dependencies removed in Tasks 1-4**

Remove from `examples/browser/package.json`:
```
"@theia/ai-anthropic"
"@theia/ai-claude-code"
"@theia/ai-code-completion"
"@theia/ai-codex"
"@theia/ai-copilot"
"@theia/ai-editor"
"@theia/ai-google"
"@theia/ai-history"
"@theia/ai-huggingface"
"@theia/ai-ide"
"@theia/ai-llamafile"
"@theia/ai-mcp"
"@theia/ai-mcp-server"
"@theia/ai-mcp-ui"
"@theia/ai-ollama"
"@theia/ai-openai"
"@theia/ai-scanoss"
"@theia/ai-terminal"
"@theia/ai-vercel-ai"
"@theia/api-provider-sample"
"@theia/api-samples"
"@theia/bulk-edit"
"@theia/callhierarchy"
"@theia/collaboration"
"@theia/console"
"@theia/debug"
"@theia/dev-container"
"@theia/git"
"@theia/memory-inspector"
"@theia/metrics"
"@theia/mini-browser"
"@theia/notebook"
"@theia/plugin-dev"
"@theia/plugin-metrics"
"@theia/preview"
"@theia/remote"
"@theia/scanoss"
"@theia/scm"
"@theia/scm-extra"
"@theia/task"
"@theia/terminal"
"@theia/terminal-manager"
"@theia/test"
"@theia/timeline"
"@theia/typehierarchy"
```

Keep: same keep list as electron (core, editor, filesystem, workspace, monaco, navigator, etc.)

**Step 2: Commit**

```bash
git add examples/browser/package.json
git commit -m "chore: strip browser example dependencies to match electron"
```

---

### Task 6: Delete removed package directories

**Step 1: Delete AI provider package directories**

```bash
rm -rf packages/ai-anthropic packages/ai-claude-code packages/ai-code-completion \
  packages/ai-codex packages/ai-copilot packages/ai-editor packages/ai-google \
  packages/ai-history packages/ai-hugging-face packages/ai-ide packages/ai-llamafile \
  packages/ai-mcp packages/ai-mcp-server packages/ai-mcp-ui packages/ai-ollama \
  packages/ai-openai packages/ai-scanoss packages/ai-terminal packages/ai-vercel-ai
```

**Step 2: Delete Git/SCM extras and dev/meta package directories**

```bash
rm -rf packages/collaboration packages/dev-container packages/git \
  packages/memory-inspector packages/metrics packages/remote packages/remote-wsl \
  packages/scanoss packages/scm-extra packages/timeline
```

**Step 3: Delete Phase 2 target package directories (now unreferenced by apps)**

```bash
rm -rf packages/bulk-edit packages/callhierarchy packages/console \
  packages/debug packages/external-terminal packages/mini-browser \
  packages/notebook packages/plugin-dev packages/plugin-metrics \
  packages/preview packages/scm packages/task packages/terminal \
  packages/terminal-manager packages/test packages/typehierarchy
```

**Step 4: Delete unused example directories**

```bash
rm -rf examples/api-provider-sample examples/api-samples \
  examples/browser-only examples/playwright
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete removed package and example directories"
```

---

### Task 7: Remove plugin-ext dependencies on deleted packages

Now that the package directories are deleted, plugin-ext's package.json still
references them. Remove those references so npm install works.

**Files:**
- Modify: `packages/plugin-ext/package.json`

**Step 1: Remove these from plugin-ext's dependencies**

```
"@theia/ai-mcp"
"@theia/bulk-edit"
"@theia/callhierarchy"
"@theia/console"
"@theia/debug"
"@theia/notebook"
"@theia/scm"
"@theia/task"
"@theia/terminal"
"@theia/test"
"@theia/timeline"
"@theia/typehierarchy"
```

**Step 2: Remove these from plugin-ext-vscode's dependencies**

Check `packages/plugin-ext-vscode/package.json` and remove:
```
"@theia/callhierarchy"
"@theia/scm"
"@theia/terminal"
"@theia/typehierarchy"
```

**Step 3: Check other kept packages for references to deleted packages**

Run: `grep -r '"@theia/debug"\|"@theia/terminal"\|"@theia/task"\|"@theia/scm"\|"@theia/test"\|"@theia/notebook"\|"@theia/console"\|"@theia/timeline"\|"@theia/callhierarchy"\|"@theia/typehierarchy"\|"@theia/bulk-edit"\|"@theia/git"\|"@theia/collaboration"\|"@theia/scanoss"\|"@theia/metrics"' packages/*/package.json`

Remove any found references from kept packages' package.json files.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove references to deleted packages from remaining package.json files"
```

---

### Task 8: Fix plugin-ext TypeScript compilation

After removing dependencies, plugin-ext will have broken imports. Fix them by
commenting out or removing the import statements and usages for the deleted packages.

**Files:**
- Modify: Multiple files in `packages/plugin-ext/src/`

**Step 1: Attempt to compile and identify errors**

Run: `npx lerna run compile --scope @theia/plugin-ext 2>&1 | head -100`

**Step 2: For each broken import, remove or stub the functionality**

This will involve:
- Removing imports from deleted packages in `plugin-ext-frontend-module.ts`, `plugin-ext-backend-module.ts`
- Removing Main implementations that import from deleted packages
- Stubbing Ext implementations that are part of the API surface
- Removing proxy identifiers for removed subsystems from `plugin-api-rpc.ts`
- Removing API namespaces from the return object in `plugin-context.ts`

The specific changes depend on compilation errors. Work through them iteratively:
1. Compile
2. Fix first batch of errors
3. Compile again
4. Repeat until clean

**Step 3: Compile to verify**

Run: `npx lerna run compile --scope @theia/plugin-ext`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: remove deleted package references from plugin-ext source"
```

---

### Task 9: Fix plugin-ext-vscode TypeScript compilation

**Files:**
- Modify: Files in `packages/plugin-ext-vscode/src/`

**Step 1: Compile and fix errors**

Run: `npx lerna run compile --scope @theia/plugin-ext-vscode 2>&1 | head -100`

**Step 2: Fix broken imports iteratively (same approach as Task 8)**

**Step 3: Compile to verify**

Run: `npx lerna run compile --scope @theia/plugin-ext-vscode`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: remove deleted package references from plugin-ext-vscode source"
```

---

### Task 10: Fix any remaining compilation errors across the monorepo

**Step 1: Full monorepo compile**

Run: `npm run compile 2>&1 | tail -50`

**Step 2: Fix any remaining broken references in kept packages**

Work through errors iteratively.

**Step 3: Verify clean compile**

Run: `npm run compile`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve remaining compilation errors after module removal"
```

---

### Task 11: Verify Electron app builds

**Step 1: Clean install**

Run: `rm -rf node_modules && npm install`

**Step 2: Build the Electron app**

Run: `npm run build:electron`
Expected: Successful build

**Step 3: Commit any fixes needed**

```bash
git add -A
git commit -m "fix: ensure electron app builds after module removal"
```

---

## Phase 2: Deep plugin-ext Decoupling (future plan)

Phase 2 involves removing the API surface for deleted subsystems from plugin-ext
so that terminal, debug, SCM, task, test, and notebook APIs are no longer even
stubbed. This is a separate effort to be planned after Phase 1 is verified working.

High-level tasks:
1. Remove `debug` namespace + DebugMain/DebugExt from plugin-ext
2. Remove `tasks` namespace + TasksMain/TasksExt
3. Remove `terminal` API surface (TerminalMain/TerminalExt)
4. Remove `scm` namespace + ScmMain/ScmExt
5. Remove `tests` namespace + TestingMain/TestingExt
6. Remove `notebooks` namespace + all Notebook Main/Ext
7. Remove `comments` namespace + CommentsMain/CommentsExt
8. Remove timeline, callhierarchy, typehierarchy integrations
9. Clean up type exports in plugin-context.ts return object
10. Create dedicated Cooklang Electron app (examples/cooklang-editor)
