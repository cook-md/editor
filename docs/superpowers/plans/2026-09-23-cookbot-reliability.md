# CookBot Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CookBot pick up COOK.md live, report when a file search was cut at 200, always end a turn with a reply, and keep the user's question across the folder-open reload.

**Architecture:** Four independent, editor-only changes in `packages/cooklang-ai` (plus a two-line hook in `packages/cooklang-branding`). No proto or cookbot-server change. Spec: `../growth/docs/2026-09-23-cookbot-reliability-design.md` (in the `cook-md/growth` repo).

**Tech Stack:** TypeScript, Theia (inversify DI), mocha + chai on compiled `lib/**/*.spec.js`.

---

## Working environment (read first)

- Worktree: `/Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability`, branch `fix/cookbot-reliability` (from `origin/main` 48601a5ee). Dependencies are installed (`npm ci --ignore-scripts`).
- **Node 22 is required.** Prefix every command with `export PATH=$HOME/.local/bin:$PATH &&` (Node 20 on the default PATH fails the suites).
- Tests run on compiled JS. The cycle for `cooklang-ai` is:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml lib/node/cookbot-session-initializer.spec.js
```

  Swap the spec path per task. A TypeScript error shows up in `tsc -b`, not mocha: a "failing test" step may fail at compile time, and that counts as failing.
- Baseline (verified 2026-09-23): the three specs touched here pass 56/56; `cooklang-branding` 15/15.
- Commit after every task with `git commit` from the worktree root. Do **not** push or open a PR — Alex decides that after review.

## File map

| File | Change |
|---|---|
| `packages/cooklang-ai/src/node/cookbot-session-initializer.ts` | Re-init when COOK.md content changes; case-insensitive lookup |
| `packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts` | Tests for the above |
| `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts` | `findFilesByPattern` fills to 201 so `truncated` can fire |
| `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts` | Truncation tests |
| `packages/cooklang-ai/src/node/cookbot-language-model.ts` | Per-tool timeout, round cap, closing line, top-level-only `emptyResponse` |
| `packages/cooklang-ai/src/node/cookbot-language-model.spec.ts` | Tool-loop tests |
| `packages/cooklang-ai/src/browser/pending-prompt.ts` (new) | Save/take the user's prompt across a reload |
| `packages/cooklang-ai/src/browser/pending-prompt.spec.ts` (new) | Tests |
| `packages/cooklang-ai/src/browser/file-tools/open-recipe-folder.ts` | Save the prompt before reload; new result text |
| `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts` | Prefill the input with a saved prompt |

---

### Task 1: COOK.md picked up live

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-session-initializer.ts`
- Test: `packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts`

- [ ] **Step 1: Make the fake gRPC client record what it was initialised with**

In `cookbot-session-initializer.spec.ts`, replace the `initialize` method of `FakeGrpcClient` (and add the `calls` field) so tests can see the instructions sent:

```ts
class FakeGrpcClient {
    initializeCalls = 0;
    /** The (recipesDir, customInstructions) of every initialize call, in order. */
    calls: Array<{ recipesDir: string; instructions: string }> = [];
    failNext = false;
    /** When set, `initialize` awaits this before resolving/rejecting, letting a test control when a call settles. */
    nextInitializeBlocksOn: Promise<void> | undefined;

    async initialize(recipesDir = '', customInstructions = ''): Promise<unknown> {
        this.initializeCalls++;
        this.calls.push({ recipesDir, instructions: customInstructions });
        if (this.nextInitializeBlocksOn) {
            const blocker = this.nextInitializeBlocksOn;
            this.nextInitializeBlocksOn = undefined;
            await blocker;
        }
        if (this.failNext) {
            this.failNext = false;
            throw new Error('init failed');
        }
        return { success: true, sessionId: `session-${this.initializeCalls}`, serverVersion: 'test' };
    }
}
```

- [ ] **Step 2: Write the failing tests**

Change the import line at the top of the spec to:

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { CookbotSessionInitializer, pickCookMdName } from './cookbot-session-initializer';
```

Append at the end of the file:

```ts
describe('CookbotSessionInitializer COOK.md', () => {

    let dir: string;
    let workspaceServer: FakeWorkspaceServer;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookbot-init-'));
        workspaceServer = new FakeWorkspaceServer();
        workspaceServer.current = FileUri.create(dir).toString();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('picks up a COOK.md created after the session started', async () => {
        // uid 2647, 2026-09-18: added COOK.md mid-session, then got asked
        // "how many people?" because the prompt still said there was none.
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        expect(grpcClient.calls[0].instructions).to.equal('');

        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('We are 2 people.');
    });

    it('does not re-initialize while COOK.md is unchanged', async () => {
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        await initializer.ensureInitialized();
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(1);
    });

    it('re-initializes with the new content when COOK.md is edited', async () => {
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 2 people.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();
        fs.writeFileSync(path.join(dir, 'COOK.md'), 'We are 4 people.');
        await initializer.ensureInitialized();

        expect(grpcClient.initializeCalls).to.equal(2);
        expect(grpcClient.calls[1].instructions).to.equal('We are 4 people.');
    });

    it('reads a lowercase cook.md', async () => {
        fs.writeFileSync(path.join(dir, 'cook.md'), 'No dairy.');
        const grpcClient = new FakeGrpcClient();
        const initializer = createInitializer(grpcClient, workspaceServer);

        await initializer.ensureInitialized();

        expect(grpcClient.calls[0].instructions).to.equal('No dairy.');
    });
});

describe('pickCookMdName', () => {

    it('prefers an exact COOK.md over other casings', () => {
        expect(pickCookMdName(['cook.md', 'COOK.md', 'Pasta.cook'])).to.equal('COOK.md');
    });

    it('accepts any casing when there is no exact COOK.md', () => {
        expect(pickCookMdName(['Pasta.cook', 'Cook.md'])).to.equal('Cook.md');
    });

    it('returns undefined when there is none', () => {
        expect(pickCookMdName(['Pasta.cook', 'cook.md.bak'])).to.be.undefined;
    });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml lib/node/cookbot-session-initializer.spec.js
```

Expected: `tsc` fails with `Module './cookbot-session-initializer' has no exported member 'pickCookMdName'`.

- [ ] **Step 4: Implement**

In `cookbot-session-initializer.ts`, add this exported function just above the `@injectable()` line:

```ts
/**
 * Which directory entry is the user's COOK.md. An exact `COOK.md` wins; any
 * other casing (`cook.md`, `Cook.md`) is accepted, so the file is found on
 * case-sensitive filesystems too.
 */
export function pickCookMdName(names: string[]): string | undefined {
    if (names.includes('COOK.md')) {
        return 'COOK.md';
    }
    return names.find(name => name.toLowerCase() === 'cook.md');
}
```

Add a field below `private initializedDir: string | undefined;`:

```ts
    /**
     * The COOK.md text the current session was created with. `undefined`
     * while the first initialization is still reading it, so a concurrent
     * caller does not mistake "not read yet" for "changed".
     */
    private initializedInstructions: string | undefined;
```

Replace the staleness block at the top of `ensureInitialized` (the `if (this.initPromise) { ... }` block) with:

```ts
        if (this.initPromise) {
            const currentDir = await this.resolveRecipesDir();
            if (currentDir !== this.initializedDir) {
                console.info(
                    `[Cookbot] Recipe folder changed (${this.initializedDir || 'none'} -> ${currentDir || 'none'}), re-initializing the session`
                );
                this.initPromise = undefined;
            } else if (this.initializedInstructions !== undefined
                && await this.readCookMd(currentDir) !== this.initializedInstructions) {
                // COOK.md is only sent at Initialize, so a file added or edited
                // mid-session (including one the onboarding skill just staged)
                // was ignored until the editor restarted.
                console.info('[Cookbot] COOK.md changed, re-initializing the session');
                this.initPromise = undefined;
            }
        }
```

Replace `doInitialize` with:

```ts
    private async doInitialize(): Promise<void> {
        const recipesDir = await this.resolveRecipesDir();
        const customInstructions = await this.readCookMd(recipesDir);
        // Recorded before the call so a failed init still re-checks the folder
        // rather than comparing against a stale value.
        this.initializedDir = recipesDir;
        this.initializedInstructions = customInstructions;
        await this.grpcClient.initialize(recipesDir, customInstructions);
    }

    /** The COOK.md at the folder root, in any casing, or `''` when there is none. */
    private async readCookMd(recipesDir: string): Promise<string> {
        if (!recipesDir) {
            return '';
        }
        try {
            const name = pickCookMdName(await fs.promises.readdir(recipesDir));
            return name ? await fs.promises.readFile(path.join(recipesDir, name), 'utf-8') : '';
        } catch {
            // Folder unreadable or COOK.md vanished between listing and reading.
            return '';
        }
    }
```

- [ ] **Step 5: Run to verify they pass**

Same command as Step 3. Expected: all `CookbotSessionInitializer*` and `pickCookMdName` tests pass (15 total), including the pre-existing "initializes only once across concurrent and repeated callers".

- [ ] **Step 6: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability
git add packages/cooklang-ai/src/node/cookbot-session-initializer.ts packages/cooklang-ai/src/node/cookbot-session-initializer.spec.ts
git commit -m "fix(cookbot): re-initialize the session when COOK.md changes, in any casing"
```

---

### Task 2: `findFilesByPattern` reports truncation

**Files:**
- Modify: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts` (constant at 41, description ~562-600, call sites 648 and 693, `summarise` 707-714)
- Test: `packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add inside `describe('FindFilesByPattern', ...)` (before its closing `});`):

```ts
    /** A flat library of `count` recipes, plus one menu. */
    function library(count: number): TreeSpec {
        const tree: TreeSpec = { Plans: { 'Week.menu': 'Day 1' } };
        for (let i = 0; i < count; i++) {
            tree[`Recipe ${i}.cook`] = 'Add @salt';
        }
        return tree;
    }

    it('says so when more than 200 files match', async () => {
        // The walk used to stop at exactly 200, so `truncated` could never be
        // set and the model took 200 for the whole library.
        const { tool } = wire(new FindFilesByPattern(), library(250));
        const result = await callJson<{ files: string[]; truncated?: boolean; note?: string }>(tool, { pattern: '**/*.cook' });
        expect(result.files).to.have.length(200);
        expect(result.truncated).to.equal(true);
        expect(result.note).to.match(/More than 200/);
    });

    it('does not flag exactly 200 matches', async () => {
        const { tool } = wire(new FindFilesByPattern(), library(200));
        const result = await callJson<{ files: string[]; truncated?: boolean }>(tool, { pattern: '**/*.cook' });
        expect(result.files).to.have.length(200);
        expect(result.truncated).to.be.undefined;
    });

    it('flags each pattern of a batch on its own', async () => {
        const { tool } = wire(new FindFilesByPattern(), library(250));
        const result = await callJson<{ patterns: Array<{ files: string[]; truncated?: boolean }> }>(
            tool, { patterns: ['**/*.cook', '**/*.menu'] });
        expect(result.patterns[0].truncated).to.equal(true);
        expect(result.patterns[1].truncated).to.be.undefined;
        expect(result.patterns[1].files).to.deep.equal(['Plans/Week.menu']);
    });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml lib/browser/file-tools/workspace-functions.spec.js
```

Expected: "says so when more than 200 files match" and "flags each pattern of a batch on its own" FAIL (`expected undefined to equal true`); "does not flag exactly 200 matches" passes.

- [ ] **Step 3: Implement**

Below `const MAX_FIND_RESULTS = 200;` add:

```ts
/** Told to the model when a glob matched more than MAX_FIND_RESULTS files. */
const TRUNCATION_NOTE =
    `More than ${MAX_FIND_RESULTS} files match; only the first ${MAX_FIND_RESULTS} are listed. ` +
    'Narrow the pattern (e.g. a sub-folder) or use searchRecipes with fields/where for library-wide questions.';
```

In both `traverseDirectory(...)` calls (single-pattern path ~648 and `findFilesBatch` ~693), change the `MAX_FIND_RESULTS` argument to `MAX_FIND_RESULTS + 1` — the walk fills one past the cap, which is how `summarise` learns there were more:

```ts
            await this.traverseDirectory(workspaceRoot, workspaceRoot, buckets, excludeMatchers, MAX_FIND_RESULTS + 1, cancellationToken);
```

Replace `summarise`:

```ts
    protected summarise(bucket: PatternBucket): Record<string, unknown> {
        const result: Record<string, unknown> = { files: bucket.results.slice(0, MAX_FIND_RESULTS) };
        // The walk fills each bucket to MAX_FIND_RESULTS + 1, so a result past
        // the cap means "more than", not an exact count (that needs a full walk).
        if (bucket.results.length > MAX_FIND_RESULTS) {
            result.truncated = true;
            result.note = TRUNCATION_NOTE;
        }
        return result;
    }
```

In the tool `description`, replace `'returns relative paths from the workspace root, and limits results to 200 files maximum. ' +` with:

```ts
                'returns relative paths from the workspace root, and lists at most 200 files per pattern — when more match, ' +
                'the result carries truncated: true and a note, so never treat a 200-file list as the whole library. ' +
```

In the `patterns` parameter description, replace `'{ patterns: [{ pattern, files, totalFound?, truncated? }] } in the order given. ' +` with:

```ts
                            '{ patterns: [{ pattern, files, truncated?, note? }] } in the order given. ' +
```

- [ ] **Step 4: Run to verify they pass**

Same command as Step 2. Expected: all `workspace-functions.spec.js` tests pass, including the existing "walks the workspace once for many globs".

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability
git add packages/cooklang-ai/src/browser/file-tools/workspace-functions.ts packages/cooklang-ai/src/browser/file-tools/workspace-functions.spec.ts
git commit -m "fix(cookbot): findFilesByPattern reports when it cut the list at 200"
```

---

### Task 3: Every turn ends with an answer

**Files:**
- Modify: `packages/cooklang-ai/src/node/cookbot-language-model.ts` (`handleStreamingRequest` 82-244)
- Test: `packages/cooklang-ai/src/node/cookbot-language-model.spec.ts`

- [ ] **Step 1: Extend the spec's fakes**

In `cookbot-language-model.spec.ts`, replace `FakeGrpcClient.sendMessage` so it records the history of each request:

```ts
    /** The message history sent with each request, in order. */
    sentMessages: CookbotMessageParam[][] = [];

    sendMessage(messages: CookbotMessageParam[] = []): { stream: AsyncIterable<CookbotChatChunk> } {
        this.sentMessages.push(messages);
        const factory = this.streams[this.sendMessageCalls++];
        if (!factory) {
            throw new Error('Unexpected sendMessage call');
        }
        return { stream: factory() };
    }
```

Below `emptyStream()`, add:

```ts
/** One model round that asks for a single tool call and stops for its result. */
async function* toolUseStream(id: string, name: string, args = '{}'): AsyncIterable<CookbotChatChunk> {
    yield { type: 'content_block_start', index: 0, blockType: 'tool_use', id, name };
    yield { type: 'content_block_delta', index: 0, deltaType: 'input_json_delta', partialJson: args };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_delta', stopReason: 'tool_use', outputTokens: 5 };
    yield { type: 'message_stop' };
}

type FakeHandler = (args: string) => Promise<unknown>;

function requestWithTools(handlers: Record<string, FakeHandler>): UserRequest {
    return {
        messages: [{ actor: 'user', type: 'text', text: 'hi' }],
        tools: Object.entries(handlers).map(([name, handler]) => ({
            id: name,
            name,
            description: name,
            parameters: { type: 'object', properties: {} },
            handler,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

async function collectRequest(model: CookbotLanguageModel, request: UserRequest): Promise<LanguageModelStreamResponsePart[]> {
    const response = await model.request(request) as LanguageModelStreamResponse;
    const parts: LanguageModelStreamResponsePart[] = [];
    for await (const part of response.stream) {
        parts.push(part);
    }
    return parts;
}

function textsOf(parts: LanguageModelStreamResponsePart[]): string[] {
    return parts.filter(p => 'content' in p).map(p => (p as { content: string }).content);
}

/** The tool_result text sent back to the model in request `n` (0-based). */
function toolResultSentIn(grpcClient: FakeGrpcClient, n: number): string {
    const history = grpcClient.sentMessages[n];
    const last = history[history.length - 1];
    return last.content.find(part => part.type === 'tool_result')?.toolResultContent ?? '';
}
```

- [ ] **Step 2: Write the failing tests**

Append at the end of the spec:

```ts
describe('CookbotLanguageModel tool loop guarantees', () => {

    /* eslint-disable @typescript-eslint/no-explicit-any */
    function tuned(model: CookbotLanguageModel, settings: { toolTimeoutMs?: number; maxToolRounds?: number }): CookbotLanguageModel {
        Object.assign(model as any, settings);
        return model;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    it('reports a tool that never answers as timed out and carries on', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => toolUseStream('t1', 'slowTool'), () => textStream('Sorry, that timed out.')];
        const model = tuned(createModel(grpcClient), { toolTimeoutMs: 20 });

        const parts = await collectRequest(model, requestWithTools({ slowTool: () => new Promise(() => { /* never */ }) }));

        expect(toolResultSentIn(grpcClient, 1)).to.contain('did not finish within');
        expect(textsOf(parts)).to.deep.equal(['Sorry, that timed out.']);
    });

    it('never times out openRecipeFolder, which waits on the user', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => toolUseStream('t1', 'openRecipeFolder'), () => textStream('Opened.')];
        const model = tuned(createModel(grpcClient), { toolTimeoutMs: 20 });

        await collectRequest(model, requestWithTools({
            openRecipeFolder: () => new Promise(resolve => setTimeout(() => resolve('folder opened'), 60)),
        }));

        expect(toolResultSentIn(grpcClient, 1)).to.equal('folder opened');
    });

    it('tells the model to wrap up on the last round and does not run tools past the cap', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [
            () => toolUseStream('t1', 'step'),
            () => toolUseStream('t2', 'step'),
            () => toolUseStream('t3', 'step'),
            () => toolUseStream('t4', 'step'),
        ];
        const model = tuned(createModel(grpcClient), { maxToolRounds: 3 });
        let runs = 0;

        const parts = await collectRequest(model, requestWithTools({ step: async () => { runs++; return 'ok'; } }));

        expect(runs).to.equal(3);
        expect(grpcClient.sendMessageCalls).to.equal(4);
        const lastHistory = grpcClient.sentMessages[3];
        const note = lastHistory[lastHistory.length - 1].content.find(part => part.type === 'text');
        expect(note?.text).to.contain('Tool-round limit reached');
        expect(textsOf(parts).join('')).to.contain('step limit');
    });

    it('adds a closing line instead of failing when tools ran but no reply followed', async () => {
        // The nested round used to throw emptyResponse ("start a new chat")
        // even though the tools had already staged changes.
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => toolUseStream('t1', 'stage'), () => emptyStream()];
        const model = createModel(grpcClient);

        const parts = await collectRequest(model, requestWithTools({ stage: async () => 'Proposed writing to file a.cook.' }));

        expect(textsOf(parts).join('')).to.contain('stopped without a reply');
    });

    it('adds nothing when the model replied after its tools', async () => {
        const grpcClient = new FakeGrpcClient();
        grpcClient.streams = [() => toolUseStream('t1', 'stage'), () => textStream('Staged a.cook.')];
        const model = createModel(grpcClient);

        const parts = await collectRequest(model, requestWithTools({ stage: async () => 'ok' }));

        expect(textsOf(parts)).to.deep.equal(['Staged a.cook.']);
    });
});
```

The existing test "reports an error when the stream produces no content" stays as-is and must keep passing: a turn with no tools and no text still throws `emptyResponse`.

- [ ] **Step 3: Run to verify they fail**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml lib/node/cookbot-language-model.spec.js
```

Expected: the timeout test fails with mocha's 2000 ms timeout (the handler never resolves); the round-cap test fails (`expected 4 to equal 3` or "Unexpected sendMessage call"); the closing-line test fails with `Cookbot returned an empty response`; "adds nothing when the model replied" and "never times out openRecipeFolder" pass.

- [ ] **Step 4: Implement**

In `cookbot-language-model.ts`, add `ToolRequest` to the `@theia/ai-core/lib/common` import list.

Above the class declaration, add:

```ts
/** Sent with the last tool round a single user message may use. */
const ROUND_LIMIT_NOTE =
    'Tool-round limit reached for this request. Do not call more tools. Reply to the user now: '
    + 'what is done, what is staged for review, and what is left for them to ask next.';

/** Shown when the model still asks for tools after the round limit. */
const STEP_LIMIT_TEXT =
    'CookBot hit its step limit for one message. Anything it proposed is in the Changes panel — ask it to continue.';

/** Shown when tools ran but the model ended the turn without a reply. */
const NO_REPLY_TEXT =
    '_CookBot stopped without a reply. Anything it proposed is in the Changes panel._';

/** Tools that wait on the user (a native dialog) and must never be timed out. */
const UNTIMED_TOOLS = new Set(['openRecipeFolder']);
```

Inside the class, next to the other fields, add:

```ts
    /** A tool that has not answered by then is reported to the model as timed out. */
    protected toolTimeoutMs = 120_000;

    /**
     * Tool rounds one user message may use. The worst prompt in the 09-18
     * export used 16, before the bulk metadata tools existed.
     */
    protected maxToolRounds = 30;
```

Add a method to the class (e.g. just above `isVisibleContent`):

```ts
    /**
     * Runs one tool handler, giving up after `toolTimeoutMs` so a handler that
     * never resolves cannot stall the turn forever. The handler keeps running;
     * its late result is ignored.
     */
    protected async runTool(tool: ToolRequest, args: string, toolUseId: string): Promise<ToolCallResult> {
        const call = tool.handler(args, ToolInvocationContext.create(toolUseId));
        if (UNTIMED_TOOLS.has(tool.name)) {
            return call;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<ToolCallResult>(resolve => {
            timer = setTimeout(() => resolve(createToolCallError(
                `${tool.name} did not finish within ${Math.max(1, Math.round(this.toolTimeoutMs / 1000))} s. `
                + 'Tell the user it timed out; do not retry it automatically.'
            )), this.toolTimeoutMs);
        });
        try {
            return await Promise.race([call, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
```

In `handleStreamingRequest`, right after `const token = cancellationToken ?? request.cancellationToken;`, add:

```ts
        // Each tool round appends one assistant message and one tool-result
        // message, so the history tail length counts the rounds already run.
        const round = (toolMessages?.length ?? 0) / 2;
        const isTopLevel = toolMessages === undefined;
```

Inside the generator, below `let currentOutputTokens = 0;` (the declarations before `attempt:`), add:

```ts
                // Whether the turn ran tools and whether any text followed the
                // last of them — nested rounds are re-yielded through here.
                let toolsRan = false;
                let textAfterTools = false;
                const track = (part: LanguageModelStreamResponsePart): void => {
                    if (isToolCallResponsePart(part) && part.tool_calls.some(tc => tc.finished)) {
                        toolsRan = true;
                        textAfterTools = false;
                    } else if (isTextResponsePart(part) && part.content.length > 0) {
                        textAfterTools = true;
                    }
                };
```

In the streaming `for await` loop, add `track(part);` right before `yield part;`.

Replace the whole `if (toolCalls.length > 0) { ... }` block and the final empty-response check with:

```ts
                // Tool loop: execute tools and recurse
                if (toolCalls.length > 0) {
                    if (round >= that.maxToolRounds) {
                        // Close the tool calls the UI already shows as pending,
                        // then stop: the model was told to wrap up and did not.
                        const notRun = {
                            tool_calls: toolCalls.map(tc => ({
                                finished: true as const,
                                id: tc.id,
                                result: 'Not run: step limit reached.',
                                function: { name: tc.name, arguments: tc.args || '{}' },
                            })),
                        };
                        yield notRun;
                        yield { content: STEP_LIMIT_TEXT };
                        return;
                    }

                    const toolResults = await Promise.all(toolCalls.map(async tc => {
                        const tool = request.tools?.find(t => t.name === tc.name);
                        const argsObject = tc.args.length === 0 ? '{}' : tc.args;
                        const handlerResult: ToolCallResult = tool
                            ? await that.runTool(tool, argsObject, tc.id)
                            : createToolCallError(`Tool '${tc.name}' not found in the available tools for this request.`, 'tool-not-available');
                        return { name: tc.name, result: handlerResult, id: tc.id, arguments: argsObject };
                    }));

                    // Yield finished tool calls with results
                    const calls = toolResults.map(tr => ({
                        finished: true as const,
                        id: tr.id,
                        result: tr.result,
                        function: { name: tr.name, arguments: tr.arguments },
                    }));
                    const finishedCalls = { tool_calls: calls };
                    track(finishedCalls);
                    yield finishedCalls;

                    // Build tool result message for next turn
                    const toolResponseMessage: CookbotMessageParam = {
                        role: 'user',
                        content: toolResults.map(call => ({
                            type: 'tool_result',
                            toolUseId: call.id,
                            toolResultContent: that.formatToolCallResult(call.result),
                            isError: that.hasError(call.result),
                        })),
                    };
                    if (round + 1 === that.maxToolRounds) {
                        toolResponseMessage.content.push({ type: 'text', text: ROUND_LIMIT_NOTE });
                    }

                    // Build assistant message from accumulated content blocks
                    const assistantContent: CookbotContentPart[] = [];
                    for (const msg of currentMessages) {
                        assistantContent.push(...msg.content);
                    }
                    // Also add tool_use content parts for each tool call
                    for (const tc of toolCalls) {
                        assistantContent.push({
                            type: 'tool_use',
                            toolUseId: tc.id,
                            name: tc.name,
                            input: tc.args || '{}',
                        });
                    }
                    const assistantMessage: CookbotMessageParam = {
                        role: 'assistant',
                        content: assistantContent,
                    };

                    // Recurse with accumulated messages
                    const result = await that.handleStreamingRequest(
                        request,
                        cancellationToken,
                        [
                            ...(toolMessages ?? []),
                            assistantMessage,
                            toolResponseMessage,
                        ]
                    );

                    for await (const nestedEvent of result.stream) {
                        contentProduced = contentProduced || CookbotLanguageModel.isVisibleContent(nestedEvent);
                        track(nestedEvent);
                        yield nestedEvent;
                    }
                }

                // Only the outermost call judges the turn as a whole; a nested
                // round that adds nothing after its tools is not a failure.
                if (!isTopLevel || token?.isCancellationRequested) {
                    return;
                }
                if (toolsRan && !textAfterTools) {
                    yield { content: NO_REPLY_TEXT };
                    return;
                }
                // A stream that completes without a single content block is a
                // failure the user cannot see otherwise - it renders as a blank
                // assistant turn. Report it instead of yielding nothing.
                if (!contentProduced) {
                    console.error('[CookbotLM] Stream completed without producing any content');
                    throw CookbotError.emptyResponse();
                }
```

Check the file's imports: `CookbotContentPart` and `CookbotMessageParam` are already imported from `../common/cookbot-protocol` (used in the original block); if `tsc` reports either missing, add it to that import.

- [ ] **Step 5: Run to verify they pass**

Same command as Step 3. Expected: every test in `cookbot-language-model.spec.js` passes, including the pre-existing empty-response, retry and quota tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability
git add packages/cooklang-ai/src/node/cookbot-language-model.ts packages/cooklang-ai/src/node/cookbot-language-model.spec.ts
git commit -m "fix(cookbot): time out stuck tools, cap tool rounds, close turns that end without a reply"
```

---

### Task 4: Opening a folder keeps the question

**Files:**
- Create: `packages/cooklang-ai/src/browser/pending-prompt.ts`
- Create: `packages/cooklang-ai/src/browser/pending-prompt.spec.ts`
- Modify: `packages/cooklang-ai/src/browser/file-tools/open-recipe-folder.ts`
- Modify: `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts` (`init`, ~line 62)

- [ ] **Step 1: Write the failing tests**

Create `packages/cooklang-ai/src/browser/pending-prompt.spec.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
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

import { expect } from 'chai';
import { PENDING_PROMPT_KEY, PENDING_PROMPT_MAX_AGE_MS, PromptStore, savePendingPrompt, takePendingPrompt } from './pending-prompt';

class MapStore implements PromptStore {
    readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}

describe('pending prompt', () => {

    it('hands back a fresh prompt once, then forgets it', () => {
        const store = new MapStore();
        savePendingPrompt(store, 'Is my week balanced?', 1_000);

        expect(takePendingPrompt(store, 2_000)).to.equal('Is my week balanced?');
        expect(takePendingPrompt(store, 2_000)).to.be.undefined;
    });

    it('drops a prompt older than the limit without returning it', () => {
        const store = new MapStore();
        savePendingPrompt(store, 'old question', 0);

        expect(takePendingPrompt(store, PENDING_PROMPT_MAX_AGE_MS + 1)).to.be.undefined;
        expect(store.items.has(PENDING_PROMPT_KEY)).to.equal(false);
    });

    it('returns undefined when nothing was saved', () => {
        expect(takePendingPrompt(new MapStore(), 0)).to.be.undefined;
    });

    it('does not save a blank prompt', () => {
        const store = new MapStore();
        savePendingPrompt(store, '   ', 0);
        expect(store.items.size).to.equal(0);
    });

    it('ignores a corrupt entry', () => {
        const store = new MapStore();
        store.setItem(PENDING_PROMPT_KEY, '{not json');
        expect(takePendingPrompt(store, 0)).to.be.undefined;
        expect(store.items.size).to.equal(0);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml lib/browser/pending-prompt.spec.js
```

Expected: `tsc` fails with `Cannot find module './pending-prompt'`.

- [ ] **Step 3: Implement the helper**

Create `packages/cooklang-ai/src/browser/pending-prompt.ts`:

```ts
// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
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

/**
 * Carries the user's question across the window reload that opening a recipe
 * folder causes. Without it the chat ended and the user had to retype the
 * question (uid 2647, 2026-09-21). The prompt is only put back in the input
 * box, never re-sent: sending it again would spend credits unasked.
 */

export const PENDING_PROMPT_KEY = 'cookbot.pendingPrompt';

/** A reload takes seconds; anything older is from an abandoned attempt. */
export const PENDING_PROMPT_MAX_AGE_MS = 10 * 60 * 1000;

/** The slice of `window.localStorage` this needs, so tests can use a Map. */
export interface PromptStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export function savePendingPrompt(store: PromptStore, text: string, now: number = Date.now()): void {
    if (!text.trim()) {
        return;
    }
    try {
        store.setItem(PENDING_PROMPT_KEY, JSON.stringify({ text, savedAt: now }));
    } catch {
        // Storage full or unavailable: the prompt is lost, as it was before.
    }
}

/** Returns the saved prompt if it is fresh, and always clears it. */
export function takePendingPrompt(store: PromptStore, now: number = Date.now()): string | undefined {
    let raw: string | null;
    try {
        raw = store.getItem(PENDING_PROMPT_KEY);
        if (raw !== null) {
            store.removeItem(PENDING_PROMPT_KEY);
        }
    } catch {
        return undefined;
    }
    if (raw === null) {
        return undefined;
    }
    try {
        const { text, savedAt } = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
        if (typeof text === 'string' && typeof savedAt === 'number' && savedAt <= now && now - savedAt <= PENDING_PROMPT_MAX_AGE_MS) {
            return text;
        }
    } catch {
        // Corrupt entry: already removed above.
    }
    return undefined;
}
```

- [ ] **Step 4: Run to verify they pass**

Same command as Step 2. Expected: 5 passing.

- [ ] **Step 5: Save the prompt in `openRecipeFolder`**

In `open-recipe-folder.ts`, add imports next to the existing ones:

```ts
import { ToolInvocationContext } from '@theia/ai-core/lib/common';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { savePendingPrompt } from '../pending-prompt';
```

(If `ToolInvocationContext` is already imported from `@theia/ai-core/lib/common`, extend that import instead.)

Change the handler line to pass the context through:

```ts
            handler: async (_args: string, ctx?: ToolInvocationContext) => this.execute(ctx),
```

Change `execute`'s signature and the block from `this.workspaceService.open(...)` to the end:

```ts
    private async execute(ctx?: ToolInvocationContext): Promise<string> {
```

```ts
        // The reload below ends this chat; keep the question so the new
        // window can put it back in the input box.
        if (ChatToolContext.is(ctx) && typeof window !== 'undefined') {
            savePendingPrompt(window.localStorage, ctx.request.request.text);
        }

        // preserveWindow reloads this window onto the chosen folder. Without it
        // Theia opens a second window and leaves the user staring at the empty
        // one they just tried to fix.
        this.workspaceService.open(selected, { preserveWindow: true });

        return `Opening ${selected.path.fsPath()} as the recipe folder. The editor is reloading, `
            + 'and the user\'s question will be waiting in the chat box. '
            + 'Do not reply further and do not call any more tools.';
    }
```

Also update the tool `description`'s last sentence from `'the current chat, so call it instead of starting work rather than in the middle of it.'` to:

```ts
                + 'the current chat (the user\'s question is kept in the chat box), so call it instead of starting work rather than in the middle of it.',
```

- [ ] **Step 6: Prefill the input after the reload**

In `packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts`, add the import:

```ts
import { takePendingPrompt } from '@theia/cooklang-ai/lib/browser/pending-prompt';
```

In `init()`, directly after `super.init();`, add:

```ts
        // A question asked before a recipe folder was open survives the
        // reload that opening one causes. Prefill only; never auto-send.
        const pendingPrompt = typeof window !== 'undefined' ? takePendingPrompt(window.localStorage) : undefined;
        if (pendingPrompt) {
            this.inputWidget.initialValue = pendingPrompt;
        }
```

(`initialValue` is read when the input's Monaco editor is first created — `chat-input-widget.tsx:1491` — which happens after `init()`.)

- [ ] **Step 7: Compile both packages and run their suites**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx tsc -b && npx mocha --config ../../configs/mocharc.yml "lib/**/*.spec.js" 2>&1 | tail -5
cd ../cooklang-branding && npx tsc -b && npx mocha --config ../../configs/mocharc.yml "lib/**/*.spec.js" 2>&1 | tail -3
```

Expected: both compile; both suites report 0 failing.

- [ ] **Step 8: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability
git add packages/cooklang-ai/src/browser/pending-prompt.ts packages/cooklang-ai/src/browser/pending-prompt.spec.ts packages/cooklang-ai/src/browser/file-tools/open-recipe-folder.ts packages/cooklang-branding/src/browser/cooklang-chat-view-widget.ts
git commit -m "fix(cookbot): keep the user's question in the chat box across the folder-open reload"
```

---

### Task 5: Full verification

- [ ] **Step 1: Lint the two packages**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/.worktrees/cookbot-reliability/packages/cooklang-ai
export PATH=$HOME/.local/bin:$PATH && npx eslint "src/**/*.{ts,tsx}"
cd ../cooklang-branding && npx eslint "src/**/*.{ts,tsx}"
```

Expected: no errors. Fix any reported issue in the files this plan touched and amend with a `style:` commit.

- [ ] **Step 2: Full suites of both packages**

Same as Task 4 Step 7. Expected: 0 failing. Record the pass counts for the PR description.

- [ ] **Step 3: Manual check in a dev build**

Build the Electron app from the worktree (`npm run build` at the root needs the native build — if it is too slow, run this check after merge on the main checkout). Then:
1. Open a recipe folder with no COOK.md, start a chat, ask anything. Create `cook.md` (lowercase) at the root containing "We are 2 people. No dairy." Ask "Plan three dinners." → CookBot does not ask how many people.
2. Close the folder (File → Close Folder). Ask "What's in my pantry?" → the folder picker opens → pick a folder → after the reload, the question is in the chat input, **not sent**.
3. Open a folder with >200 `.cook` files and ask "List every recipe file I have." → the reply says the list is partial or narrows by folder.

- [ ] **Step 4: Stop and report**

Do not push. Report to Alex: commits on `fix/cookbot-reliability`, suite counts, manual-check results, and anything that deviated from this plan.
