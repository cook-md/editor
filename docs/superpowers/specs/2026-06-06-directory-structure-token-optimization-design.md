# Directory Structure Tool — Token Optimization

**Date:** 2026-06-06
**Status:** Approved, pending implementation

## Problem

The `GetWorkspaceDirectoryStructure` AI tool (display name "Get Directory Structure")
returns a nested JSON object that the tool framework serializes verbatim. This is
wasteful in two ways:

1. **JSON structural overhead** — every directory becomes a quoted key with `{ ... }`
   braces, and every leaf directory becomes a redundant empty `{}`. For a deep tree
   this is a large fraction of the output tokens.
2. **Hidden directories are not excluded** — only `node_modules` and `lib` are filtered
   by default (via `userExcludes`). Hidden dirs like `.git` are fully traversed, so the
   `.git/objects/**` fan-out alone can dominate the entire output.

Result: a single call can emit thousands of low-value tokens (see the `.git` object-dir
dump that motivated this work).

## Goals

- Replace the JSON object output with a compact indented-tree string.
- Exclude hidden (dotfile) directories by default, with an opt-in parameter to include them.
- Keep the change scoped to this one tool.

## Non-Goals

- No changes to `GetWorkspaceFileList`, `FindFilesByPattern`, or the shared
  `WorkspaceFunctionScope.shouldExclude`.
- No depth limit, no file listing (tool remains directories-only), no pagination.

## Affected Code

- `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts`
  — class `GetWorkspaceDirectoryStructure` (`getTool`, `getDirectoryStructure`,
  `buildDirectoryStructure`).
- Corresponding `*.spec.ts` test file (located during planning).

The shared scope/exclusion logic in `workspace-function-scope.ts` is unchanged; the
dotfile filter is layered on locally so it cannot affect other tools.

## Design

### 1. Output format — indented tree string

The tool returns a plain `string` instead of a `Record<string, unknown>`.

- 2 spaces of indentation per depth level.
- Directory names suffixed with `/`.
- One entry per line.
- Children sorted alphabetically (case-sensitive `localeCompare`) for stable, diff-friendly output.
- Directories only (unchanged behavior — files are not listed).

Example:

```
packages/
  cooklang/
  cooklang-native/
src/
  components/
    widgets/
  utils/
test/
```

Edge cases:

- Empty workspace (no included subdirectories) → return the literal string `(empty)`.
- Errors (e.g. no workspace open, resolve failure) → return a short plain-text string,
  e.g. `Error: <message>`. This replaces the previous `{ error: ... }` object and is
  consistent with the new `string` return type.

### 2. `includeHidden` parameter

- New optional boolean parameter `includeHidden`, default `false`.
- Added to the tool's JSON schema `properties` (not in `required`).
- The handler parses it from the argument string; absent/invalid → `false`.

Behavior:

- `includeHidden: false` (default) — skip any child directory whose basename starts
  with `.` (e.g. `.git`, `.vscode`, `.github`). This is the primary token saver.
- `includeHidden: true` — include dotfile directories.

The existing `shouldExclude` filtering (`node_modules`, `lib`, gitignore, user excludes)
continues to apply in both modes. The dotfile check is an additional local filter applied
only within this tool.

### 3. Implementation shape

`buildDirectoryStructure` is rewritten to append indented lines directly during the
recursive traversal, threading `depth` and the `includeHidden` flag, rather than building
an intermediate nested object and rendering it afterward. This is simpler and avoids the
intermediate allocation.

Sketch:

```ts
protected async getDirectoryStructure(includeHidden: boolean, cancellationToken?): Promise<string> {
    // resolve workspace root; on failure return `Error: ${message}`
    const lines: string[] = [];
    await this.appendDirectoryLines(workspaceRoot, 0, includeHidden, lines, cancellationToken);
    return lines.length ? lines.join('\n') : '(empty)';
}

protected async appendDirectoryLines(uri, depth, includeHidden, lines, cancellationToken): Promise<void> {
    // resolve uri; for each child directory, sorted by name:
    //   - skip if !child.isDirectory
    //   - skip if !includeHidden && basename.startsWith('.')
    //   - skip if await shouldExclude(child)
    //   - push `${'  '.repeat(depth)}${basename}/`
    //   - recurse at depth + 1
}
```

Cancellation is honored at the same points as today (return early; surface
`Error: Operation cancelled by user` or stop appending).

### 4. Tool description / schema updates

- `description` updated to state the tool returns an indented directory tree (2-space
  indent, directories only) and to document the `includeHidden` parameter and its default.
- `parameters.properties.includeHidden` documented as "Include hidden (dotfile)
  directories such as .git and .vscode. Defaults to false."

## Testing

Unit tests (in the tool's `.spec.ts`) covering:

1. Indented-tree format: correct indentation per depth, trailing `/`, alphabetical order.
2. Dotfile directories excluded by default.
3. `includeHidden: true` reveals dotfile directories.
4. `node_modules` / `lib` still excluded regardless of `includeHidden`.
5. Empty workspace returns `(empty)`.
6. Files are not listed (directories only).
