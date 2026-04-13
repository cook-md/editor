# Shopping List File Watching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ShoppingListService` reload from disk whenever `.shopping-list` or `.shopping-checked` changes externally, so the UI stays in sync with cloud sync / multi-window / manual edits.

**Architecture:** Subscribe to `FileService.onDidFilesChange`, filter to the two shopping files in the workspace root, debounce rapid events (~100ms), then call the existing `loadFromDisk()` — which already handles missing files as empty state and uses `regenerationSeq` to cancel stale regenerations.

**Tech Stack:** Theia `FileService` (watch + onDidFilesChange), InversifyJS, TypeScript, mocha + chai (unit tests).

**Spec:** [`docs/superpowers/specs/2026-04-13-shopping-list-file-watching-design.md`](../specs/2026-04-13-shopping-list-file-watching-design.md)

---

## File Structure

- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`
  - Add watcher registration, debounce state, reload handler, dispose cleanup.
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`
  - Extend `FakeFileService` with `watch()` + `onDidFilesChange` emitter.
  - Add new test cases (one per behavior).

No new files. No public API changes. No changes to the widget or contribution — they already subscribe to `onDidChange`.

---

## Task 1: Extend test fakes with file-watching support

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

The current `FakeFileService` only implements `read` / `write` / `delete`. The watcher code we'll add in Task 2 calls `fileService.watch(uri)` and `fileService.onDidFilesChange(listener)`. Tests need to be able to fire synthetic change events.

We also need a helper that fully initializes the service (runs `@postConstruct`) so the watcher is registered before the test fires events.

- [ ] **Step 1: Add imports and fake change-event infrastructure to the spec file**

At the top of `packages/cooklang/src/browser/shopping-list-service.spec.ts`, add the `Emitter` import next to the existing imports:

```typescript
import { Emitter } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
```

(Keep the existing `DisposableCollection` import — just add `Disposable` and the `Emitter` import.)

- [ ] **Step 2: Extend `FakeFileService` with `watch()` and a file-change emitter**

Replace the existing `FakeFileService` class (currently at lines ~22–36) with:

```typescript
/** Minimal in-memory FileService stub — only the methods the service calls. */
class FakeFileService {
    files = new Map<string, string>();
    readonly onDidFilesChangeEmitter = new Emitter<FakeFileChangesEvent>();
    readonly onDidFilesChange = this.onDidFilesChangeEmitter.event;

    async read(uri: { toString(): string }): Promise<{ value: string }> {
        const key = uri.toString();
        if (!this.files.has(key)) { throw new Error('ENOENT'); }
        return { value: this.files.get(key)! };
    }
    async write(uri: { toString(): string }, content: string): Promise<void> {
        this.files.set(uri.toString(), content);
    }
    async delete(uri: { toString(): string }): Promise<void> {
        this.files.delete(uri.toString());
    }
    watch(_uri: { toString(): string }): Disposable {
        return Disposable.create(() => { /* no-op */ });
    }

    /** Test helper: fire a synthetic change event for a URI string. */
    fireChange(uriString: string): void {
        this.onDidFilesChangeEmitter.fire({
            contains: (resource: { toString(): string }) => resource.toString() === uriString,
        });
    }
}

/** Minimal shape the service uses from `FileChangesEvent`. */
interface FakeFileChangesEvent {
    contains(resource: { toString(): string }): boolean;
}
```

> Why `contains(resource)` only? The service's `onFilesChanged` (Task 2) only calls `event.contains(uri)`. That's the entire surface the production code uses.

- [ ] **Step 3: Add a `makeServiceReady()` helper that fully initializes the service**

After the existing `makeService()` function, add a second helper that awaits the full `init()` cycle so the watcher is registered and initial load has completed:

```typescript
/**
 * Like `makeService()` but also invokes the `@postConstruct` initializer and
 * waits for initial `loadFromDisk()` + watcher registration to complete.
 */
async function makeServiceReady(): Promise<{ svc: ShoppingListService; fs: FakeFileService; ls: FakeLanguageService }> {
    const { svc, fs, ls } = makeService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Shrink the debounce so tests don't wait 100ms per reload.
    (svc as any).reloadDebounceMs = 5;
    // Invoke the @postConstruct init manually. It's a protected method, so we
    // go through `as any`. `init()` fires-and-forgets an async loadFromDisk,
    // so await its returned promise chain before handing back the service.
    await (svc as any).init();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { svc, fs, ls };
}

/** Sleep helper — used to let the debounce timer elapse in tests. */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

> `init()` as written returns `void` because the inner promise chain is `.then(...).catch(...)`. We'll change it in Task 2 to return a `Promise<void>` so tests can await it. If you prefer to keep `init()` void, the alternative is `await new Promise(r => setTimeout(r, 0))` here to let the microtask queue drain, but returning a promise is cleaner. Task 2's implementation step assumes `init()` returns `Promise<void>`.

- [ ] **Step 4: Run the existing test suite to confirm the refactor didn't break anything**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang
```

Expected: all existing `ShoppingListService` tests still pass. (We haven't added a new test yet, just extended the fakes.)

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): extend shopping list fakes with watcher support"
```

---

## Task 2: Reload on external update of `.shopping-list`

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts`
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

TDD: test first, then implement the watcher + debounce + reload plumbing.

- [ ] **Step 1: Write the failing test**

Add at the bottom of the `describe('ShoppingListService', ...)` block in the spec file (before the closing `});`):

```typescript
it('reloads when .shopping-list is updated externally', async () => {
    const { svc, fs } = await makeServiceReady();
    expect(svc.getItems().length).to.equal(0);

    let changeFires = 0;
    svc.onDidChange(() => { changeFires += 1; });

    // External write (simulates cloud sync / another process).
    fs.files.set('file:///ws/.shopping-list', 'pasta.cook\nsoup.cook\n');
    fs.fireChange('file:///ws/.shopping-list');

    // Wait past the debounce window.
    await sleep(30);

    expect(svc.getItems().length).to.equal(2);
    expect(svc.getItems()[0].path).to.equal('pasta.cook');
    expect(changeFires).to.be.greaterThan(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'reloads when .shopping-list is updated externally'
```

Expected: FAIL. `svc.getItems().length` is still 0 because the service never reloaded.

- [ ] **Step 3: Add imports to the service for the watcher types**

In `packages/cooklang/src/browser/shopping-list-service.ts`, update the existing `FileService` import line to also bring in `FileChangesEvent`:

```typescript
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent } from '@theia/filesystem/lib/common/files';
```

- [ ] **Step 4: Add debounce fields and change `init()` to return a promise**

Near the top of the `ShoppingListService` class (next to the existing `protected regenerationSeq = 0;` line), add:

```typescript
    /** Debounce window for reloading after an external file change. Overridable in tests. */
    protected reloadDebounceMs = 100;

    /** Active debounce timer, if any. */
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;
```

Change the existing `init()` signature and body from:

```typescript
    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.workspaceService.roots
            .then(() => this.loadFromDisk())
            .catch(err => console.error('ShoppingListService: initial load failed', err));
    }
```

to:

```typescript
    @postConstruct()
    protected async init(): Promise<void> {
        this.toDispose.push(this.onDidChangeEmitter);
        try {
            await this.workspaceService.roots;
            await this.loadFromDisk();
        } catch (err) {
            console.error('ShoppingListService: initial load failed', err);
        }
        this.setupWatcher();
    }
```

> Why `Promise<void>`? Tests need to await initialization. InversifyJS's `@postConstruct` tolerates async methods — their returned promise is awaited internally.

- [ ] **Step 5: Add `setupWatcher()`, `onFilesChanged()`, and `scheduleReload()` methods**

Add these three methods at the end of the class body (just before the closing `}` of the class):

```typescript
    protected setupWatcher(): void {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        try {
            this.toDispose.push(this.fileService.watch(root));
        } catch (e) {
            console.error('[shopping-list] Failed to register watcher:', e);
        }
        this.toDispose.push(this.fileService.onDidFilesChange(event => this.onFilesChanged(event)));
        this.toDispose.push(Disposable.create(() => {
            if (this.reloadTimer !== undefined) {
                clearTimeout(this.reloadTimer);
                this.reloadTimer = undefined;
            }
        }));
    }

    protected onFilesChanged(event: FileChangesEvent): void {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            return;
        }
        const listUri = root.resolve(LIST_FILE);
        const checkedUri = root.resolve(CHECKED_FILE);
        if (event.contains(listUri) || event.contains(checkedUri)) {
            this.scheduleReload();
        }
    }

    protected scheduleReload(): void {
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.loadFromDisk().catch(err =>
                console.error('[shopping-list] Reload after file change failed:', err),
            );
        }, this.reloadDebounceMs);
    }
```

> `Disposable` is already imported at the top of the file. `LIST_FILE` and `CHECKED_FILE` are the existing module constants. `FileChangesEvent.contains(uri)` already handles all change types (ADDED/UPDATED/DELETED), so no type filtering needed.

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'reloads when .shopping-list is updated externally'
```

Expected: PASS.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.ts packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "feat(cooklang): watch .shopping-list for external changes"
```

---

## Task 3: External delete of `.shopping-list` resets state

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

The implementation from Task 2 already handles this via `loadFromDisk()`'s try/catch that treats a missing file as `{ items: [] }`. This task locks in the behavior with a test.

- [ ] **Step 1: Write the test**

Add at the bottom of the `describe('ShoppingListService', ...)` block:

```typescript
it('resets to empty when .shopping-list is deleted externally', async () => {
    const { svc, fs } = await makeServiceReady();
    // Seed an existing list, reload so in-memory state catches up.
    fs.files.set('file:///ws/.shopping-list', 'pasta.cook\n');
    fs.fireChange('file:///ws/.shopping-list');
    await sleep(30);
    expect(svc.getItems().length).to.equal(1);

    // External delete.
    fs.files.delete('file:///ws/.shopping-list');
    fs.fireChange('file:///ws/.shopping-list');
    await sleep(30);

    expect(svc.getItems().length).to.equal(0);
    expect(svc.getResult()).to.equal(undefined);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'resets to empty when .shopping-list is deleted externally'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): verify external delete of .shopping-list resets state"
```

---

## Task 4: External update of `.shopping-checked` updates `isChecked()`

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

The existing `FakeLanguageService.parseChecked` reads lines starting with `+ ` as checked and `- ` as unchecked, and `checkedSet` deduces the final set. The watcher path from Task 2 handles this file the same way as `.shopping-list`.

- [ ] **Step 1: Write the test**

Add at the bottom of the `describe('ShoppingListService', ...)` block:

```typescript
it('reloads when .shopping-checked is updated externally', async () => {
    const { svc, fs } = await makeServiceReady();
    expect(svc.isChecked('flour')).to.equal(false);

    fs.files.set('file:///ws/.shopping-checked', '+ flour\n');
    fs.fireChange('file:///ws/.shopping-checked');
    await sleep(30);
    expect(svc.isChecked('flour')).to.equal(true);

    // An external unchecked entry wins.
    fs.files.set('file:///ws/.shopping-checked', '+ flour\n- flour\n');
    fs.fireChange('file:///ws/.shopping-checked');
    await sleep(30);
    expect(svc.isChecked('flour')).to.equal(false);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'reloads when .shopping-checked is updated externally'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): verify external update of .shopping-checked reloads"
```

---

## Task 5: Debounce coalesces rapid events

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

Verify that N events arriving within the debounce window cause exactly one reload. We measure reload count via a spy on `loadFromDisk`.

- [ ] **Step 1: Write the test**

Add at the bottom of the `describe('ShoppingListService', ...)` block:

```typescript
it('coalesces rapid file change events into one reload', async () => {
    const { svc, fs } = await makeServiceReady();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const original = (svc as any).loadFromDisk.bind(svc);
    let reloadCount = 0;
    (svc as any).loadFromDisk = async () => {
        reloadCount += 1;
        return original();
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    fs.files.set('file:///ws/.shopping-list', 'a.cook\n');
    // Fire 5 events back-to-back within the 5ms debounce window.
    for (let i = 0; i < 5; i += 1) {
        fs.fireChange('file:///ws/.shopping-list');
    }
    await sleep(30);

    expect(reloadCount).to.equal(1);
    expect(svc.getItems().length).to.equal(1);
});
```

> The 5 events are synchronous (no awaits between them), so they all arrive before the first `setTimeout(..., 5)` fires. The debounce must coalesce them into one reload.

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'coalesces rapid file change events'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): verify file-change debounce coalesces events"
```

---

## Task 6: Dispose stops further reloads

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

Verify the watcher subscription and the pending debounce timer are both torn down when the service is disposed.

- [ ] **Step 1: Write the test**

Add at the bottom of the `describe('ShoppingListService', ...)` block:

```typescript
it('stops reloading after dispose()', async () => {
    const { svc, fs } = await makeServiceReady();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const original = (svc as any).loadFromDisk.bind(svc);
    let reloadCount = 0;
    (svc as any).loadFromDisk = async () => {
        reloadCount += 1;
        return original();
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    fs.files.set('file:///ws/.shopping-list', 'a.cook\n');
    fs.fireChange('file:///ws/.shopping-list');

    // Dispose before the debounce window elapses — the queued reload must be cancelled.
    svc.dispose();

    await sleep(30);
    expect(reloadCount).to.equal(0);

    // A fresh event after dispose must also not reload.
    fs.fireChange('file:///ws/.shopping-list');
    await sleep(30);
    expect(reloadCount).to.equal(0);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'stops reloading after dispose'
```

Expected: PASS. The `Disposable.create(() => clearTimeout(...))` registered in `setupWatcher()` cancels the pending timer; disposing the `onDidFilesChange` subscription stops new events from scheduling reloads.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): verify dispose cancels pending reloads"
```

---

## Task 7: Self-write echo is idempotent

**Files:**
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts`

When the service writes `.shopping-list` itself (e.g., via `addRecipe()`), the watcher will see its own write. The reload re-reads the same content. Verify state stays correct (no duplicated items, no lost checks).

- [ ] **Step 1: Write the test**

Add at the bottom of the `describe('ShoppingListService', ...)` block:

```typescript
it('handles self-write echo idempotently', async () => {
    const { svc, fs } = await makeServiceReady();
    await svc.addRecipe('pasta.cook', 1);
    expect(svc.getItems().length).to.equal(1);

    // Simulate the watcher firing for our own write.
    fs.fireChange('file:///ws/.shopping-list');
    await sleep(30);

    // State is unchanged — still exactly one item with the same path.
    expect(svc.getItems().length).to.equal(1);
    expect(svc.getItems()[0].path).to.equal('pasta.cook');

    // Checks survive a spurious .shopping-checked echo too.
    await svc.checkItem('flour');
    fs.fireChange('file:///ws/.shopping-checked');
    await sleep(30);
    expect(svc.isChecked('flour')).to.equal(true);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang -- --grep 'handles self-write echo idempotently'
```

Expected: PASS.

- [ ] **Step 3: Run the full suite one more time**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-service.spec.ts
git commit -m "test(cooklang): verify self-write echo does not corrupt state"
```

---

## Task 8: Lint and verify the whole package compiles

**Files:** none changed — this is a verification task.

- [ ] **Step 1: Run the compile step for the package**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run lint**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run lint --scope @theia/cooklang
```

Expected: no lint errors. If lint complains about unused imports or `any` casts, fix inline.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang
```

Expected: all ShoppingListService tests (original + 6 new) pass.

- [ ] **Step 4: If any fixes were needed, commit them**

```bash
git add -u
git commit -m "chore(cooklang): lint/compile fixes for shopping-list watcher"
```

(Skip if nothing changed.)
