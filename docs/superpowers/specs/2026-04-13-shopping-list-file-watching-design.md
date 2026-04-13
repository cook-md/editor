# Shopping List File Watching — Design

## Problem

`ShoppingListService` reads `.shopping-list` and `.shopping-checked` from the workspace root once during `init()` and never reloads them. External changes — cloud sync, another window, `git pull`, manual edits, `rm` — are invisible until the app restarts.

## Goal

Treat the two on-disk files as the source of truth. When either file changes on disk, the service's in-memory state catches up and the UI re-renders via the existing `onDidChange` event.

## Non-goals

- No conflict resolution between local edits and external changes. Last write wins; disk overwrites memory.
- No cross-workspace watching. Only files in the current workspace root.
- No watching of `config/aisle.conf` or `config/pantry.conf`. Those only matter during `regenerate()` and aren't the focus here.

## Design

### Behavior

On any ADDED / UPDATED / DELETED event for `<root>/.shopping-list` or `<root>/.shopping-checked`:

1. Schedule a reload after a ~100ms debounce. Subsequent events within the window reset the timer.
2. When the timer fires, call the existing `loadFromDisk()`. It already:
   - Treats a missing `.shopping-list` as `{ items: [] }` (matches deletion semantics).
   - Treats a missing `.shopping-checked` as empty log + empty set.
   - Calls `regenerate()` when items exist, or fires `onDidChange` directly when empty.
   - Uses `regenerationSeq` to cancel stale in-flight regenerations.

Our own writes (`saveList()`, `appendCheckEntry()`, `compactCheckedLog()`, `clearAll()`) will trigger the watcher too. The debounced reload re-parses the same content, fires `onDidChange` again, and the UI re-renders idempotently. No suppression flag, no content hash — simple over clever.

### Implementation

**File:** `packages/cooklang/src/browser/shopping-list-service.ts`

1. Add fields:
   - `protected reloadTimer: ReturnType<typeof setTimeout> | undefined;`
   - Constant `RELOAD_DEBOUNCE_MS = 100`.

2. After the initial `loadFromDisk()` completes in `init()`, call a new `protected setupWatcher(): void`.

3. `setupWatcher()`:
   - Get the workspace root URI (return early if none).
   - Register `this.fileService.watch(root)` and push the returned `Disposable` into `this.toDispose`.
   - Subscribe to `this.fileService.onDidFilesChange(event => this.onFilesChanged(event))` and push the subscription into `this.toDispose`.

4. `protected onFilesChanged(event: FileChangesEvent): void`:
   - Resolve `listUri = root.resolve('.shopping-list')` and `checkedUri = root.resolve('.shopping-checked')`.
   - Use `event.contains(uri)` (or equivalent — check the actual `FileChangesEvent` API at implementation time) to test for any change type on either URI.
   - If matched, call `scheduleReload()`.

5. `protected scheduleReload(): void`:
   - `clearTimeout(this.reloadTimer)` if set.
   - `this.reloadTimer = setTimeout(() => { this.reloadTimer = undefined; this.loadFromDisk().catch(err => console.error(...)); }, RELOAD_DEBOUNCE_MS);`

6. Update `dispose()` (or push into `toDispose` via a wrapper `Disposable`) to `clearTimeout(this.reloadTimer)`.

**Workspace root changes:** Out of scope. A workspace switch tears down frontend widgets anyway; if this turns out to matter we can add `workspaceService.onWorkspaceChanged` later.

### Race & ordering

- `loadFromDisk()` itself is a sequence of awaits. Two overlapping reloads could interleave — but only the most recent `regenerate()` wins (via `regenerationSeq`), and the writes into `this.list` / `this.checkedLog` are simple assignments. Last one wins, which is what we want when disk is truth.
- User actions (`addRecipe`, `removeRecipe`, etc.) call `saveList()` then `regenerate()`. A watcher-triggered reload arriving mid-action would re-read the file we just wrote — correct content, redundant regen. Acceptable.

### Disposal

All new resources (watcher, event subscription, timeout-clearing wrapper) flow through `this.toDispose`. Existing `dispose()` unchanged except for clearing the debounce timer.

## Testing

Extend `packages/cooklang/src/browser/shopping-list-service.spec.ts`:

1. **External update of `.shopping-list`**: write a new list file out-of-band, fire the file-change event, advance fake timers past the debounce → `getItems()` reflects the new content and `onDidChange` fires.
2. **External delete of `.shopping-list`**: fire DELETED event → `getItems()` is empty and `getResult()` is `undefined`.
3. **External update of `.shopping-checked`**: fire event for the checked log → `isChecked(name)` reflects the new state.
4. **Debounce coalesces**: fire N events within 100ms → exactly one `loadFromDisk` execution (assert via a spy or a counter).
5. **Dispose stops reloads**: dispose the service, then fire an event → no further `onDidChange`.
6. **Self-write echo is harmless**: call `addRecipe()` (which writes + fires change events), then fire the synthetic watcher event → state is unchanged (idempotent), `onDidChange` fires once more.

Use the existing test harness patterns (fake `FileService`, `DisposableCollection`, sinon fake timers if not already in use).

## Files touched

- `packages/cooklang/src/browser/shopping-list-service.ts` — watcher, debounce, disposal.
- `packages/cooklang/src/browser/shopping-list-service.spec.ts` — new test cases.

No new files, no public API changes, no changes to widget or contribution code — the widget already subscribes to `onDidChange`.
