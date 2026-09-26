# Pantry Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cooklang.pantry` plugin that shows `config/pantry.conf` in the right sidebar and lets users search, filter, add, edit and remove items, shipped by default with Cook Editor.

**Architecture:** A VS Code-API plugin that mirrors `../plugins/shopping-list`. A webview view is rendered with plain DOM. A store owns file I/O on `config/pantry.conf` and serialises edits through a promise queue. All TOML work goes through the editor's `cooklang.api.parsePantry` / `cooklang.api.editPantry` commands. Pure view logic (status, filters, expiry, quantity formatting) lives in `view-model.ts` and is unit-tested.

**Tech Stack:** TypeScript 5.4, VS Code API ^1.100 (Theia plugin host), esbuild (webview bundle), mocha + node `assert`.

**Spec:** `docs/superpowers/specs/2026-09-26-pantry-plugin-design.md` (§2) in the editor repo.

**Depends on:** the editor plan `2026-09-26-pantry-plugin-editor.md`. Its commands must exist before the manual E2E in Task 8. Tasks 1–7 can run in parallel with it.

**Repo:** `/Users/alexeydubovskoy/Cooklang/plugins` (GitHub `cook-md/plugins`). Create the branch first:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins && git checkout main && git pull && git checkout -b feature/pantry
```

**Node:** use Node 22 for every npm command:

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
```

---

## File structure (all under `plugins/pantry/`)

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `.vscodeignore`, `LICENSE`, `README.md` | Package manifest and metadata (copied from shopping-list, adapted). |
| `scripts/deploy.js` | Copy the built plugin into `editor/plugins/cooklang.pantry`. |
| `media/pantry.svg`, `media/pantry.css` | Sidebar icon; webview styles (only `--vscode-*` colours). |
| `src/cooklang-api.ts` (+ `.spec.ts`) | Typed wrapper over `cooklang.api.*`; detects whether the pantry commands exist. No `vscode` import. |
| `src/view-model.ts` (+ `.spec.ts`) | Pure functions: dates, status, filters, search, quantity display/storage, edit diffs. |
| `src/pantry-store.ts` (+ `.spec.ts`) | Load/create/edit `config/pantry.conf` via an injected `PantryFiles`; edit queue; change events. |
| `src/protocol.ts` (+ `.spec.ts`) | Webview ↔ extension message types and `isValidMessage`. |
| `src/pantry-controller.ts` | `WebviewViewProvider`, commands, watcher, modal delete confirmation. |
| `src/extension.ts` | Activation: API version + capability check, start the controller. |
| `src/webview/main.ts` | Plain-DOM UI. |

---

### Task 1: Scaffold the package

**Files:**
- Create: `pantry/package.json`, `pantry/tsconfig.json`, `pantry/.vscodeignore`, `pantry/LICENSE`, `pantry/scripts/deploy.js`, `pantry/media/pantry.svg`

- [ ] **Step 1: Create `pantry/package.json`**

```json
{
  "name": "pantry",
  "displayName": "Pantry",
  "description": "See and edit what's in your pantry (config/pantry.conf): stock levels, low and out-of-stock items, expiry dates. Ships with Cook Editor.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cook-md/plugins.git",
    "directory": "pantry"
  },
  "keywords": [
    "cooklang",
    "pantry",
    "inventory",
    "groceries",
    "recipes"
  ],
  "engines": {
    "vscode": "^1.100.0"
  },
  "categories": [
    "Other"
  ],
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "viewsContainers": {
      "right": [
        {
          "id": "pantry",
          "title": "Pantry",
          "icon": "media/pantry.svg"
        }
      ]
    },
    "views": {
      "pantry": [
        {
          "type": "webview",
          "id": "pantry.view",
          "name": "Pantry"
        }
      ]
    },
    "commands": [
      {
        "command": "pantry.show",
        "title": "Show Pantry",
        "category": "Pantry"
      },
      {
        "command": "pantry.addItem",
        "title": "Add Pantry Item",
        "category": "Pantry",
        "icon": "$(add)"
      },
      {
        "command": "pantry.openFile",
        "title": "Open pantry.conf",
        "category": "Pantry",
        "icon": "$(go-to-file)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "pantry.addItem",
          "when": "view == pantry.view",
          "group": "navigation@1"
        },
        {
          "command": "pantry.openFile",
          "when": "view == pantry.view",
          "group": "navigation@2"
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
    "publish:marketplace": "ovsx publish --packagePath pantry-$npm_package_version.vsix -r https://plugins.cook.md"
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

- [ ] **Step 2: Copy the shared files**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
mkdir -p pantry/src/webview pantry/scripts pantry/media
cp shopping-list/tsconfig.json shopping-list/.vscodeignore shopping-list/LICENSE pantry/
```

- [ ] **Step 3: Create `pantry/scripts/deploy.js`**

```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.pantry');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'media', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 4: Create `pantry/media/pantry.svg`** (a jar, in the same stroke style as `cart.svg`)

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8"/><path d="M9 2v3"/><path d="M15 2v3"/><path d="M7 5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M5 11h14"/><path d="M5 16h14"/></svg>
```

- [ ] **Step 5: Install dependencies and commit**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd pantry && npm install && cd ..
git add pantry/package.json pantry/package-lock.json pantry/tsconfig.json pantry/.vscodeignore pantry/LICENSE pantry/scripts pantry/media/pantry.svg
git commit -m "feat(pantry): scaffold the pantry plugin"
```

---

### Task 2: `cooklang-api.ts`

**Files:**
- Create: `pantry/src/cooklang-api.ts`
- Test: `pantry/src/cooklang-api.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry/src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';

function recorder(result: unknown, commands: string[] = []): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('calls each cooklang.api command with one JSON argument', async () => {
        const { api, calls } = recorder(undefined);
        await api.version();
        await api.parsePantry('text');
        await api.editPantry('text', { op: 'remove', section: 'fridge', name: 'milk' });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.version', args: [] },
            { command: 'cooklang.api.parsePantry', args: [{ text: 'text' }] },
            { command: 'cooklang.api.editPantry', args: [{ text: 'text', edit: { op: 'remove', section: 'fridge', name: 'milk' } }] },
        ]);
    });

    it('reports pantry support only when both pantry commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.parsePantry', 'cooklang.api.editPantry', 'x']).api.supportsPantry(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.parsePantry']).api.supportsPantry(), false);
        assert.strictEqual(await recorder(undefined, []).api.supportsPantry(), false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pantry && npm test`
Expected: FAIL, `tsc` error `Cannot find module './cooklang-api'`.

- [ ] **Step 3: Implement**

`pantry/src/cooklang-api.ts`:

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/pantry-types.ts`.
// Kept free of the `vscode` import so it can be unit-tested; extension.ts
// passes `vscode.commands.executeCommand` and `vscode.commands.getCommands`.

export const SUPPORTED_API_VERSION = 1;

/** Pantry commands were added to API version 1 later; detect them by name. */
export const PANTRY_COMMANDS = ['cooklang.api.parsePantry', 'cooklang.api.editPantry'] as const;

export interface PantryItem {
    name: string;
    /** As written in pantry.conf, e.g. `500%g`. */
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
    isLow: boolean;
    /** Quantity parses to zero. No quantity means in stock. */
    isOutOfStock: boolean;
    /** `expire` as `YYYY-MM-DD`, when parseable. */
    expireDate?: string;
    /** `bought` as `YYYY-MM-DD`, when parseable. */
    boughtDate?: string;
}

export interface PantrySection {
    name: string;
    items: PantryItem[];
}

export interface PantryContents {
    sections: PantrySection[];
}

/** On update: omitted = unchanged, empty string = remove the attribute. */
export interface PantryAttributes {
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
}

export type PantryEdit =
    | ({ op: 'add'; section: string; name: string } & PantryAttributes)
    | { op: 'update'; section: string; name: string; fields: PantryAttributes }
    | { op: 'remove'; section: string; name: string };

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    async supportsPantry(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return PANTRY_COMMANDS.every(command => commands.has(command));
    }

    parsePantry(text: string): Promise<PantryContents> {
        return this.call('cooklang.api.parsePantry', { text });
    }

    /** Returns the new file text; rejects with the editor's message on a bad edit. */
    editPantry(text: string, edit: PantryEdit): Promise<string> {
        return this.call('cooklang.api.editPantry', { text, edit });
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pantry && npm test`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add pantry/src/cooklang-api.ts pantry/src/cooklang-api.spec.ts
git commit -m "feat(pantry): typed Cooklang API wrapper"
```

---

### Task 3: `view-model.ts`

**Files:**
- Create: `pantry/src/view-model.ts`
- Test: `pantry/src/view-model.spec.ts`

- [ ] **Step 1: Write the failing tests**

`pantry/src/view-model.spec.ts`:

```ts
import * as assert from 'assert';
import type { PantryItem, PantrySection } from './cooklang-api';
import {
    addAttributes, changedFields, daysUntil, displayQuantity, expiryLabel, initialDraft, itemStatus,
    matchesFilter, sectionChoices, storedQuantity, todayIso, visibleSections,
} from './view-model';

const TODAY = '2026-09-26';

function item(overrides: Partial<PantryItem> & { name: string }): PantryItem {
    return { isLow: false, isOutOfStock: false, ...overrides };
}

describe('view-model', () => {
    it('formats today as a local YYYY-MM-DD date', () => {
        assert.strictEqual(todayIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    });

    it('counts whole days between ISO dates, negative in the past', () => {
        assert.strictEqual(daysUntil('2026-09-26', TODAY), 0);
        assert.strictEqual(daysUntil('2026-10-03', TODAY), 7);
        assert.strictEqual(daysUntil('2026-09-24', TODAY), -2);
        assert.strictEqual(daysUntil('2027-03-29', '2027-03-27'), 2, 'DST change does not shift the count');
    });

    it('ranks status worst-first: expired, out, low, expiring, ok', () => {
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-09-25', isOutOfStock: true }), TODAY), 'expired');
        assert.strictEqual(itemStatus(item({ name: 'a', isOutOfStock: true, isLow: true }), TODAY), 'out');
        assert.strictEqual(itemStatus(item({ name: 'a', isLow: true, expireDate: '2026-09-27' }), TODAY), 'low');
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-10-03' }), TODAY), 'expiring');
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-10-04' }), TODAY), 'ok');
        assert.strictEqual(itemStatus(item({ name: 'a', expire: 'soon' }), TODAY), 'ok', 'unparseable expiry is ignored');
    });

    it('filters by low, out of stock and expiring (which includes expired)', () => {
        const low = item({ name: 'low', isLow: true });
        const out = item({ name: 'out', isOutOfStock: true });
        const expired = item({ name: 'expired', expireDate: '2026-09-01' });
        const fine = item({ name: 'fine' });
        const all = [low, out, expired, fine];
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'all', TODAY)), all);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'low', TODAY)), [low]);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'out', TODAY)), [out]);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'expiring', TODAY)), [expired]);
    });

    it('searches case-insensitively and hides empty sections only while narrowing', () => {
        const sections: PantrySection[] = [
            { name: 'fridge', items: [item({ name: 'Milk' }), item({ name: 'eggs' })] },
            { name: 'freezer', items: [item({ name: 'peas' })] },
            { name: 'empty', items: [] },
        ];
        assert.deepStrictEqual(visibleSections(sections, '', 'all', TODAY).map(s => [s.name, s.items.length, s.total]),
            [['fridge', 2, 2], ['freezer', 1, 1], ['empty', 0, 0]]);
        assert.deepStrictEqual(visibleSections(sections, ' MIL ', 'all', TODAY).map(s => [s.name, s.items.map(i => i.name), s.total]),
            [['fridge', ['Milk'], 2]]);
        assert.deepStrictEqual(visibleSections(sections, '', 'low', TODAY), []);
    });

    it('shows quantities with a space and stores them with %', () => {
        assert.strictEqual(displayQuantity('500%g'), '500 g');
        assert.strictEqual(displayQuantity('6'), '6');
        assert.strictEqual(storedQuantity(' 500 g '), '500%g');
        assert.strictEqual(storedQuantity('1.5 kg'), '1.5%kg');
        assert.strictEqual(storedQuantity('1/2 cup'), '1/2%cup');
        assert.strictEqual(storedQuantity('500%g'), '500%g');
        assert.strictEqual(storedQuantity('6'), '6');
        assert.strictEqual(storedQuantity('a pinch'), 'a pinch');
        assert.strictEqual(storedQuantity(''), '');
    });

    it('labels expiry relative to today', () => {
        assert.strictEqual(expiryLabel(0), 'today');
        assert.strictEqual(expiryLabel(1), 'in 1 day');
        assert.strictEqual(expiryLabel(3), 'in 3 days');
        assert.strictEqual(expiryLabel(-1), 'expired 1 day ago');
        assert.strictEqual(expiryLabel(-4), 'expired 4 days ago');
    });

    it('offers existing sections, or defaults when there are none', () => {
        assert.deepStrictEqual(sectionChoices([{ name: 'cellar', items: [] }]), ['cellar']);
        assert.deepStrictEqual(sectionChoices([]), ['fridge', 'pantry', 'freezer']);
    });

    it('prefills the edit draft from display quantities and normalised dates', () => {
        assert.deepStrictEqual(initialDraft(item({ name: 'milk', quantity: '1%L', low: '200%ml', expire: '01.10.2026', expireDate: '2026-10-01', bought: 'last week' })),
            { quantity: '1 L', low: '200 ml', bought: 'last week', expire: '2026-10-01' });
    });

    it('sends only changed fields, with an empty string for a cleared one', () => {
        const milk = item({ name: 'milk', quantity: '1%L', expire: '01.10.2026', expireDate: '2026-10-01' });
        assert.deepStrictEqual(changedFields(milk, { quantity: '1 L', low: '', bought: '', expire: '2026-10-01' }), {});
        assert.deepStrictEqual(changedFields(milk, { quantity: '2 L', low: '500 ml', bought: '', expire: '' }),
            { quantity: '2%L', low: '500%ml', expire: '' });
    });

    it('builds add attributes from non-empty fields only', () => {
        assert.deepStrictEqual(addAttributes({ quantity: '500 g', low: '', bought: '', expire: '2026-10-01' }),
            { quantity: '500%g', expire: '2026-10-01' });
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pantry && npm test`
Expected: FAIL, `Cannot find module './view-model'`.

- [ ] **Step 3: Implement**

`pantry/src/view-model.ts`:

```ts
// Pure view logic for the pantry webview; no DOM, no vscode.
import type { PantryAttributes, PantryItem, PantrySection } from './cooklang-api';

export type PantryFilter = 'all' | 'low' | 'out' | 'expiring';
export type ItemStatus = 'expired' | 'out' | 'low' | 'expiring' | 'ok';

/** Items expiring within this many days count as "expiring". */
export const EXPIRING_DAYS = 7;
export const DEFAULT_SECTIONS = ['fridge', 'pantry', 'freezer'];

/** The four editable attributes as the form shows them. */
export interface EditDraft {
    quantity: string;
    low: string;
    bought: string;
    expire: string;
}

export interface SectionView {
    name: string;
    /** Items in the section before search/filter. */
    total: number;
    items: PantryItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date as `YYYY-MM-DD`. */
export function todayIso(now: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `today` to `isoDate` (both `YYYY-MM-DD`); negative in the past. */
export function daysUntil(isoDate: string, today: string): number {
    const utc = (iso: string): number => {
        const [year, month, day] = iso.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    return Math.round((utc(isoDate) - utc(today)) / DAY_MS);
}

export function itemStatus(item: PantryItem, today: string): ItemStatus {
    const days = item.expireDate ? daysUntil(item.expireDate, today) : undefined;
    if (days !== undefined && days < 0) {
        return 'expired';
    }
    if (item.isOutOfStock) {
        return 'out';
    }
    if (item.isLow) {
        return 'low';
    }
    if (days !== undefined && days <= EXPIRING_DAYS) {
        return 'expiring';
    }
    return 'ok';
}

export function matchesFilter(item: PantryItem, filter: PantryFilter, today: string): boolean {
    switch (filter) {
        case 'all': return true;
        case 'low': return item.isLow;
        case 'out': return item.isOutOfStock;
        case 'expiring': return item.expireDate !== undefined && daysUntil(item.expireDate, today) <= EXPIRING_DAYS;
    }
}

/** Sections with their matching items; empty sections are hidden while a search or filter is active. */
export function visibleSections(sections: readonly PantrySection[], search: string, filter: PantryFilter, today: string): SectionView[] {
    const needle = search.trim().toLowerCase();
    const narrowing = needle !== '' || filter !== 'all';
    return sections
        .map(section => ({
            name: section.name,
            total: section.items.length,
            items: section.items.filter(item => item.name.toLowerCase().includes(needle) && matchesFilter(item, filter, today)),
        }))
        .filter(section => !narrowing || section.items.length > 0);
}

/** `500%g` → `500 g`. */
export function displayQuantity(quantity: string): string {
    return quantity.replace('%', ' ');
}

/** `500 g` → `500%g`; values already using `%`, bare numbers and free text are kept. */
export function storedQuantity(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('%')) {
        return trimmed;
    }
    const match = /^([\d.,/]+)\s+(\S.*)$/.exec(trimmed);
    return match ? `${match[1]}%${match[2]}` : trimmed;
}

export function expiryLabel(days: number): string {
    const unit = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
    if (days === 0) {
        return 'today';
    }
    return days > 0 ? `in ${unit(days)}` : `expired ${unit(-days)} ago`;
}

export function sectionChoices(sections: readonly PantrySection[]): string[] {
    return sections.length > 0 ? sections.map(section => section.name) : [...DEFAULT_SECTIONS];
}

export function initialDraft(item: PantryItem): EditDraft {
    return {
        quantity: item.quantity ? displayQuantity(item.quantity) : '',
        low: item.low ? displayQuantity(item.low) : '',
        bought: item.boughtDate ?? item.bought ?? '',
        expire: item.expireDate ?? item.expire ?? '',
    };
}

/** Fields that differ from the item; a field emptied by the user is sent as `''` (clears it). */
export function changedFields(item: PantryItem, draft: EditDraft): PantryAttributes {
    const initial = initialDraft(item);
    const fields: PantryAttributes = {};
    if (draft.quantity.trim() !== initial.quantity) {
        fields.quantity = storedQuantity(draft.quantity);
    }
    if (draft.low.trim() !== initial.low) {
        fields.low = storedQuantity(draft.low);
    }
    if (draft.bought.trim() !== initial.bought) {
        fields.bought = draft.bought.trim();
    }
    if (draft.expire.trim() !== initial.expire) {
        fields.expire = draft.expire.trim();
    }
    return fields;
}

/** Attributes for a new item: only non-empty fields. */
export function addAttributes(draft: EditDraft): PantryAttributes {
    const attributes: PantryAttributes = {};
    const quantity = storedQuantity(draft.quantity);
    const low = storedQuantity(draft.low);
    if (quantity) { attributes.quantity = quantity; }
    if (low) { attributes.low = low; }
    if (draft.bought.trim()) { attributes.bought = draft.bought.trim(); }
    if (draft.expire.trim()) { attributes.expire = draft.expire.trim(); }
    return attributes;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pantry && npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add pantry/src/view-model.ts pantry/src/view-model.spec.ts
git commit -m "feat(pantry): view model (status, filters, quantities, edit diffs)"
```

---

### Task 4: `pantry-store.ts`

**Files:**
- Create: `pantry/src/pantry-store.ts`
- Test: `pantry/src/pantry-store.spec.ts`

- [ ] **Step 1: Write the failing tests**

`pantry/src/pantry-store.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, PantryContents, PantryEdit } from './cooklang-api';
import { PantryFiles, PantryStore, STARTER_PANTRY } from './pantry-store';

class FakeFiles implements PantryFiles {
    text: string | undefined;
    writes: string[] = [];
    failRead = false;
    async read(): Promise<string | undefined> {
        if (this.failRead) { throw new Error('EACCES'); }
        return this.text;
    }
    async write(text: string): Promise<void> {
        this.text = text;
        this.writes.push(text);
    }
}

/** Lines are `section/name`; `GARBAGE` fails to parse; edits append/remove lines. */
class FakeApi extends CooklangApi {
    edits: PantryEdit[] = [];
    constructor() { super(async () => undefined, async () => []); }
    override async parsePantry(text: string): Promise<PantryContents> {
        if (text.includes('GARBAGE')) { throw new Error('parsePantry: bad TOML'); }
        const sections = new Map<string, string[]>();
        for (const line of text.split('\n').filter(l => l.includes('/'))) {
            const [section, name] = line.split('/');
            sections.set(section, [...(sections.get(section) ?? []), name]);
        }
        return {
            sections: [...sections].map(([name, items]) => ({ name, items: items.map(item => ({ name: item, isLow: false, isOutOfStock: false })) })),
        };
    }
    override async editPantry(text: string, edit: PantryEdit): Promise<string> {
        this.edits.push(edit);
        const line = `${edit.section}/${edit.name}`;
        if (edit.op === 'add') { return `${text}${line}\n`; }
        if (!text.split('\n').includes(line)) { throw new Error(`editPantry: item '${edit.name}' not found in section '${edit.section}'`); }
        return edit.op === 'remove' ? text.split('\n').filter(l => l !== line).join('\n') : text;
    }
}

function makeStore(): { store: PantryStore; files: FakeFiles; api: FakeApi } {
    const files = new FakeFiles();
    const api = new FakeApi();
    const store = new PantryStore(files, api);
    store.reloadDebounceMs = 5;
    return { store, files, api };
}

describe('PantryStore', () => {
    it('reports a missing file, a parse error and a loaded pantry', async () => {
        const { store, files } = makeStore();
        assert.deepStrictEqual(store.getState(), { kind: 'loading' });
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'noFile' });
        files.text = 'GARBAGE';
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'parseError', message: 'parsePantry: bad TOML' });
        files.text = 'fridge/milk\n';
        await store.load();
        assert.deepStrictEqual(store.getState(), {
            kind: 'loaded', sections: [{ name: 'fridge', items: [{ name: 'milk', isLow: false, isOutOfStock: false }] }],
        });
    });

    it('reports an unreadable file as a parse error', async () => {
        const { store, files } = makeStore();
        files.failRead = true;
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'parseError', message: 'Could not read config/pantry.conf: EACCES' });
    });

    it('creates the starter file only when there is none', async () => {
        const { store, files } = makeStore();
        await store.create();
        assert.deepStrictEqual(files.writes, [STARTER_PANTRY]);
        assert.deepStrictEqual(store.getState(), { kind: 'loaded', sections: [] });
        await store.create();
        assert.strictEqual(files.writes.length, 1);
    });

    it('applies edits to the current file text, in order, and reloads', async () => {
        const { store, files, api } = makeStore();
        files.text = '';
        await Promise.all([
            store.edit({ op: 'add', section: 'fridge', name: 'milk' }),
            store.edit({ op: 'add', section: 'fridge', name: 'eggs' }),
        ]);
        assert.strictEqual(files.text, 'fridge/milk\nfridge/eggs\n');
        assert.deepStrictEqual(api.edits.map(e => e.name), ['milk', 'eggs']);
        const state = store.getState();
        assert.ok(state.kind === 'loaded' && state.sections[0].items.length === 2);
    });

    it('keeps a failed edit as an error, reloads, and clears it on success or dismiss', async () => {
        const { store, files } = makeStore();
        files.text = 'fridge/milk\n';
        await store.edit({ op: 'remove', section: 'fridge', name: 'eggs' });
        assert.strictEqual(store.getEditError(), "editPantry: item 'eggs' not found in section 'fridge'");
        assert.strictEqual(files.writes.length, 0);
        assert.strictEqual(store.getState().kind, 'loaded');
        store.dismissEditError();
        assert.strictEqual(store.getEditError(), undefined);
        await store.edit({ op: 'remove', section: 'fridge', name: 'eggs' });
        await store.edit({ op: 'remove', section: 'fridge', name: 'milk' });
        assert.strictEqual(store.getEditError(), undefined);
    });

    it('refuses to edit when there is no pantry file', async () => {
        const { store } = makeStore();
        await store.edit({ op: 'add', section: 'fridge', name: 'milk' });
        assert.strictEqual(store.getEditError(), 'There is no config/pantry.conf to edit.');
    });

    it('notifies listeners and debounces scheduled reloads', async () => {
        const { store, files } = makeStore();
        let changes = 0;
        store.onDidChange(() => changes++);
        files.text = 'fridge/milk\n';
        store.scheduleReload();
        store.scheduleReload();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(changes, 1);
        store.dispose();
        store.scheduleReload();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(changes, 1);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pantry && npm test`
Expected: FAIL, `Cannot find module './pantry-store'`.

- [ ] **Step 3: Implement**

`pantry/src/pantry-store.ts`:

```ts
import { CooklangApi, PantryEdit, PantrySection } from './cooklang-api';

export const PANTRY_FILE = 'config/pantry.conf';

/** Written by "Create pantry". Comment-only: the parser drops empty sections anyway. */
export const STARTER_PANTRY = `# Pantry for Cook Editor and CookCLI.
# Each [section] lists items as  name = "quantity"  or
#   name = { quantity = "500%g", low = "100%g", bought = "2026-09-26", expire = "2026-10-03" }
`;

/** Access to `config/pantry.conf` in the workspace. `read` returns undefined when it does not exist. */
export interface PantryFiles {
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
}

export interface StoreDisposable {
    dispose(): void;
}

export type PantryState =
    | { kind: 'loading' }
    | { kind: 'noFile' }
    | { kind: 'parseError'; message: string }
    | { kind: 'loaded'; sections: PantrySection[] };

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * `config/pantry.conf` for one workspace folder. Every edit re-reads the file
 * and goes through `cooklang.api.editPantry`, so external changes are never
 * overwritten; loads and edits run one at a time.
 */
export class PantryStore {

    /** Debounce for `scheduleReload`. Overridable in tests. */
    reloadDebounceMs = 100;

    protected state: PantryState = { kind: 'loading' };
    protected editError: string | undefined;
    protected queue: Promise<void> = Promise.resolve();
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly files: PantryFiles, protected readonly api: CooklangApi) { }

    onDidChange(listener: () => void): StoreDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    getState(): PantryState {
        return this.state;
    }

    /** Message of the last failed edit, until dismissed or a later edit succeeds. */
    getEditError(): string | undefined {
        return this.editError;
    }

    load(): Promise<void> {
        return this.enqueue(() => this.doLoad());
    }

    /** Writes the starter file if there is no pantry yet. */
    create(): Promise<void> {
        return this.enqueue(async () => {
            if (await this.files.read() === undefined) {
                await this.files.write(STARTER_PANTRY);
            }
            await this.doLoad();
        });
    }

    /** Never rejects: a failure becomes `getEditError()`. */
    edit(edit: PantryEdit): Promise<void> {
        return this.enqueue(async () => {
            try {
                const text = await this.files.read();
                if (text === undefined) {
                    throw new Error(`There is no ${PANTRY_FILE} to edit.`);
                }
                await this.files.write(await this.api.editPantry(text, edit));
                this.editError = undefined;
            } catch (e) {
                this.editError = messageOf(e);
            }
            await this.doLoad();
        });
    }

    dismissEditError(): void {
        this.editError = undefined;
        this.emit();
    }

    scheduleReload(): void {
        if (this.disposed) {
            return;
        }
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.load().catch(err => console.error('[pantry] Reload failed:', err));
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

    protected async doLoad(): Promise<void> {
        let text: string | undefined;
        try {
            text = await this.files.read();
        } catch (e) {
            this.state = { kind: 'parseError', message: `Could not read ${PANTRY_FILE}: ${messageOf(e)}` };
            this.emit();
            return;
        }
        if (text === undefined) {
            this.state = { kind: 'noFile' };
        } else {
            try {
                this.state = { kind: 'loaded', sections: (await this.api.parsePantry(text)).sections };
            } catch (e) {
                this.state = { kind: 'parseError', message: messageOf(e) };
            }
        }
        this.emit();
    }

    protected enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work);
        // Keep the queue alive when a unit of work fails; the caller still sees the rejection.
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    protected emit(): void {
        if (this.disposed) {
            return;
        }
        this.listeners.forEach(listener => listener());
    }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pantry && npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add pantry/src/pantry-store.ts pantry/src/pantry-store.spec.ts
git commit -m "feat(pantry): store with queued, re-reading edits"
```

---

### Task 5: `protocol.ts`

**Files:**
- Create: `pantry/src/protocol.ts`
- Test: `pantry/src/protocol.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry/src/protocol.spec.ts`:

```ts
import * as assert from 'assert';
import { isValidMessage } from './protocol';

describe('isValidMessage', () => {
    it('accepts well-formed messages', () => {
        for (const message of [
            { type: 'ready' }, { type: 'create' }, { type: 'openFile' }, { type: 'dismissError' },
            { type: 'add', section: 'fridge', name: 'milk', attributes: { quantity: '1%L' } },
            { type: 'update', section: 'fridge', name: 'milk', fields: { expire: '' } },
            { type: 'remove', section: 'fridge', name: 'milk' },
        ]) {
            assert.strictEqual(isValidMessage(message), true, JSON.stringify(message));
        }
    });

    it('rejects anything else', () => {
        for (const message of [
            undefined, null, 'ready', { type: 'nope' },
            { type: 'remove', section: '', name: 'milk' },
            { type: 'remove', section: 'fridge' },
            { type: 'add', section: 'fridge', name: 'milk' },
            { type: 'add', section: 'fridge', name: 'milk', attributes: { quantity: 1 } },
            { type: 'update', section: 'fridge', name: 'milk', fields: [] },
        ]) {
            assert.strictEqual(isValidMessage(message), false, JSON.stringify(message));
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pantry && npm test`
Expected: FAIL, `Cannot find module './protocol'`.

- [ ] **Step 3: Implement**

`pantry/src/protocol.ts`:

```ts
import type { PantryAttributes, PantrySection } from './cooklang-api';

export type ViewStatus = 'unsupported' | 'noWorkspace' | 'loading' | 'noFile' | 'parseError' | 'loaded';

/** Everything the webview renders. */
export interface ViewState {
    status: ViewStatus;
    sections: PantrySection[];
    parseError?: string;
    editError?: string;
}

export type ToWebview =
    | { type: 'state'; state: ViewState }
    /** From the `pantry.addItem` command. */
    | { type: 'showAdd' };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'create' }
    | { type: 'openFile' }
    | { type: 'dismissError' }
    | { type: 'add'; section: string; name: string; attributes: PantryAttributes }
    | { type: 'update'; section: string; name: string; fields: PantryAttributes }
    | { type: 'remove'; section: string; name: string };

function isName(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== '';
}

function isAttributes(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every(v => typeof v === 'string');
}

/** The webview is untrusted input: check shapes before touching the store. */
export function isValidMessage(message: unknown): message is FromWebview {
    if (typeof message !== 'object' || message === null) {
        return false;
    }
    const m = message as Record<string, unknown>;
    switch (m.type) {
        case 'ready':
        case 'create':
        case 'openFile':
        case 'dismissError': return true;
        case 'add': return isName(m.section) && isName(m.name) && isAttributes(m.attributes);
        case 'update': return isName(m.section) && isName(m.name) && isAttributes(m.fields);
        case 'remove': return isName(m.section) && isName(m.name);
        default: return false;
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pantry && npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add pantry/src/protocol.ts pantry/src/protocol.spec.ts
git commit -m "feat(pantry): webview protocol and message validation"
```

---

### Task 6: Controller and activation

**Files:**
- Create: `pantry/src/pantry-controller.ts`
- Create: `pantry/src/extension.ts`

This task is glue on top of the VS Code API and has no unit tests; Task 8 covers it end to end.

- [ ] **Step 1: Create `pantry/src/pantry-controller.ts`**

```ts
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { PANTRY_FILE, PantryFiles, PantryStore } from './pantry-store';
import { FromWebview, isValidMessage, ToWebview, ViewState } from './protocol';

const VIEW_ID = 'pantry.view';

/** `config/pantry.conf` under one workspace folder, via `workspace.fs`. */
class WorkspacePantryFiles implements PantryFiles {
    constructor(protected readonly root: vscode.Uri) { }

    get uri(): vscode.Uri {
        return vscode.Uri.joinPath(this.root, PANTRY_FILE);
    }

    async read(): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri));
        } catch (e) {
            if (isNotFound(e)) { return undefined; }
            throw e;
        }
    }

    async write(text: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'config'));
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
    }
}

function isNotFound(e: unknown): boolean {
    const code = (e as { code?: string }).code;
    return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

/** Owns the store for the first workspace folder, the webview view and the commands. */
export class PantryController implements vscode.WebviewViewProvider {

    protected store: PantryStore | undefined;
    protected storeDisposables: vscode.Disposable[] = [];
    protected view: vscode.WebviewView | undefined;
    /** `pantry.addItem` ran before the webview was ready. */
    protected pendingShowAdd = false;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly api: CooklangApi,
        /** False when this Cook Editor has no pantry API commands. */
        protected readonly supported: boolean,
    ) { }

    start(): void {
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEW_ID, this),
            vscode.commands.registerCommand('pantry.show', () => this.reveal()),
            vscode.commands.registerCommand('pantry.addItem', () => this.showAdd()),
            vscode.commands.registerCommand('pantry.openFile', () => this.openFile()),
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
        const nonce = randomBytes(16).toString('hex');
        const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'pantry.css'));
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
        view.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message));
        view.onDidDispose(() => { this.view = undefined; });
    }

    protected folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    protected openStore(): void {
        this.closeStore();
        const folder = this.folder();
        if (!this.supported || !folder) {
            this.postState();
            return;
        }
        const store = new PantryStore(new WorkspacePantryFiles(folder.uri), this.api);
        this.store = store;
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, PANTRY_FILE));
        const reload = (): void => store.scheduleReload();
        this.storeDisposables = [
            watcher,
            watcher.onDidChange(reload),
            watcher.onDidCreate(reload),
            watcher.onDidDelete(reload),
            store.onDidChange(() => this.postState()),
        ];
        store.load().catch(err => console.error('[pantry] initial load failed:', err));
    }

    protected closeStore(): void {
        this.storeDisposables.forEach(disposable => disposable.dispose());
        this.storeDisposables = [];
        this.store?.dispose();
        this.store = undefined;
    }

    protected async onMessage(message: unknown): Promise<void> {
        if (!isValidMessage(message)) {
            return;
        }
        if (message.type === 'ready') {
            this.postState();
            if (this.pendingShowAdd) {
                this.pendingShowAdd = false;
                this.post({ type: 'showAdd' });
            }
            return;
        }
        if (message.type === 'openFile') {
            await this.openFile();
            return;
        }
        const store = this.store;
        if (!store) {
            return;
        }
        await this.handle(store, message);
    }

    protected async handle(store: PantryStore, message: Exclude<FromWebview, { type: 'ready' | 'openFile' }>): Promise<void> {
        switch (message.type) {
            case 'create': return store.create();
            case 'dismissError': return store.dismissEditError();
            case 'add': return store.edit({ op: 'add', section: message.section, name: message.name, ...message.attributes });
            case 'update': return store.edit({ op: 'update', section: message.section, name: message.name, fields: message.fields });
            case 'remove': {
                const choice = await vscode.window.showWarningMessage(
                    `Remove "${message.name}" from ${message.section}?`, { modal: true }, 'Remove');
                if (choice === 'Remove') {
                    await store.edit({ op: 'remove', section: message.section, name: message.name });
                }
                return;
            }
        }
    }

    protected postState(): void {
        const store = this.store;
        let state: ViewState;
        if (!this.supported) {
            state = { status: 'unsupported', sections: [] };
        } else if (!store) {
            state = { status: 'noWorkspace', sections: [] };
        } else {
            const current = store.getState();
            state = {
                status: current.kind,
                sections: current.kind === 'loaded' ? current.sections : [],
                parseError: current.kind === 'parseError' ? current.message : undefined,
                editError: store.getEditError(),
            };
        }
        this.post({ type: 'state', state });
    }

    protected post(message: ToWebview): void {
        this.view?.webview.postMessage(message);
    }

    protected async showAdd(): Promise<void> {
        if (this.view) {
            this.post({ type: 'showAdd' });
        } else {
            this.pendingShowAdd = true;
        }
        await this.reveal();
    }

    protected async openFile(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            vscode.window.showInformationMessage('Open a folder to use the pantry.');
            return;
        }
        const uri = vscode.Uri.joinPath(folder.uri, PANTRY_FILE);
        try {
            await vscode.window.showTextDocument(uri);
        } catch {
            vscode.window.showInformationMessage(`There is no ${PANTRY_FILE} yet. Use "Create pantry" in the Pantry view.`);
        }
    }

    protected async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.pantry');
        }
    }
}
```

- [ ] **Step 2: Create `pantry/src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { PantryController } from './pantry-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    let version: number | undefined;
    try {
        version = await api.version();
    } catch {
        version = undefined;
    }
    // Without the pantry API the view still opens and asks the user to update.
    const supported = version === SUPPORTED_API_VERSION && await api.supportsPantry();
    new PantryController(context, api, supported).start();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 3: Compile**

Run: `cd pantry && npx tsc -p .`
Expected: no errors. The webview doesn't exist yet, and `tsc` compiles `src/webview` too, so if Task 7 hasn't run there is simply nothing there to compile.

- [ ] **Step 4: Commit**

```bash
git add pantry/src/pantry-controller.ts pantry/src/extension.ts
git commit -m "feat(pantry): webview controller, commands and activation"
```

---

### Task 7: Webview UI and styles

**Files:**
- Create: `pantry/src/webview/main.ts`
- Create: `pantry/media/pantry.css`

The DOM code itself has no unit tests; its logic sits in `view-model.ts`, and Task 8 checks the UI by hand.

- [ ] **Step 1: Create `pantry/src/webview/main.ts`**

```ts
import type { PantryItem } from '../cooklang-api';
import type { FromWebview, ToWebview, ViewState } from '../protocol';
import {
    EditDraft, ItemStatus, PantryFilter, addAttributes, changedFields, daysUntil, displayQuantity, expiryLabel,
    initialDraft, itemStatus, sectionChoices, todayIso, visibleSections,
} from '../view-model';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const FILTERS: Array<[PantryFilter, string]> = [['all', 'All'], ['low', 'Low'], ['out', 'Out of stock'], ['expiring', 'Expiring']];
const STATUS_LABELS: Record<ItemStatus, string> = {
    expired: 'Expired', out: 'Out of stock', low: 'Low stock', expiring: 'Expiring soon', ok: 'In stock',
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let state: ViewState | undefined;
let search = '';
let filter: PantryFilter = 'all';
const collapsed = new Set<string>();
let editing: { section: string; name: string; draft: EditDraft } | undefined;
let adding: ({ section: string; name: string } & EditDraft) | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/** A labelled input; date fields fall back to text when the stored value is not ISO. */
function field(label: string, value: string, kind: 'text' | 'date', onInput: (value: string) => void, placeholder = ''): HTMLLabelElement {
    const wrapper = element('label', 'field');
    wrapper.append(element('span', 'field-label', label));
    const input = element('input');
    input.type = kind === 'date' && (value === '' || ISO_DATE.test(value)) ? 'date' : 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('input', () => onInput(input.value));
    wrapper.append(input);
    return wrapper;
}

/** Enter submits and Escape cancels, for every input inside `form`. */
function keys(form: HTMLElement, submit: () => void, cancel: () => void): void {
    form.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
}

// --- persistent parts (kept across renders so the search box keeps focus) ---

const banner = element('div');
const body = element('div');
const toolbar = element('div', 'toolbar');
const addContainer = element('div');
const list = element('div', 'sections');
const chips = new Map<PantryFilter, HTMLButtonElement>();

const searchInput = element('input', 'search');
searchInput.type = 'search';
searchInput.placeholder = 'Search pantry';
searchInput.addEventListener('input', () => { search = searchInput.value; renderList(); });
const chipRow = element('div', 'chips');
for (const [value, label] of FILTERS) {
    const chip = button('chip', label, () => { filter = value; updateChips(); renderList(); });
    chips.set(value, chip);
    chipRow.append(chip);
}
const toolbarRow = element('div', 'toolbar-row');
toolbarRow.append(searchInput, button('primary', 'Add', () => openAddForm()));
toolbar.append(toolbarRow, chipRow);
updateChips();
root.append(banner, body);

function updateChips(): void {
    chips.forEach((chip, value) => chip.classList.toggle('active', value === filter));
}

// --- rendering ---

function render(): void {
    renderBanner();
    if (!state) {
        body.replaceChildren();
        return;
    }
    switch (state.status) {
        case 'unsupported':
            body.replaceChildren(element('div', 'empty', 'This version of Cook Editor does not support the Pantry plugin. Please update Cook Editor.'));
            return;
        case 'noWorkspace':
            body.replaceChildren(element('div', 'empty', 'Open a folder to use the pantry.'));
            return;
        case 'loading':
            body.replaceChildren();
            return;
        case 'noFile': {
            const box = element('div', 'empty');
            box.append(element('p', undefined, 'No pantry yet. Your pantry lives in config/pantry.conf, shared with CookCLI and the shopping list.'));
            box.append(button('primary', 'Create pantry', () => vscode.postMessage({ type: 'create' })));
            body.replaceChildren(box);
            return;
        }
        case 'parseError': {
            const box = element('div', 'error');
            box.append(element('p', undefined, `config/pantry.conf could not be read: ${state.parseError ?? ''}`));
            box.append(button('secondary', 'Open file', () => vscode.postMessage({ type: 'openFile' })));
            body.replaceChildren(box);
            return;
        }
        case 'loaded':
            if (!body.contains(toolbar)) {
                body.replaceChildren(toolbar, addContainer, list);
            }
            renderAddForm();
            renderList();
            return;
    }
}

function renderBanner(): void {
    if (!state?.editError) {
        banner.replaceChildren();
        return;
    }
    const box = element('div', 'banner');
    box.append(element('span', undefined, state.editError));
    const close = button('icon', '×', () => vscode.postMessage({ type: 'dismissError' }));
    close.title = 'Dismiss';
    box.append(close);
    banner.replaceChildren(box);
}

function openAddForm(): void {
    if (state?.status !== 'loaded') {
        return;
    }
    adding = { section: sectionChoices(state.sections)[0], name: '', quantity: '', low: '', bought: '', expire: '' };
    renderAddForm();
    addContainer.querySelector<HTMLInputElement>('.name-field input')?.focus();
}

function renderAddForm(): void {
    if (!adding || state?.status !== 'loaded') {
        addContainer.replaceChildren();
        return;
    }
    const draft = adding;
    const form = element('div', 'form add-form');
    form.append(element('div', 'form-title', 'Add item'));

    const sectionField = field('Section', draft.section, 'text', value => { draft.section = value; });
    const options = element('datalist');
    options.id = 'pantry-sections';
    for (const name of sectionChoices(state.sections)) {
        const option = element('option');
        option.value = name;
        options.append(option);
    }
    sectionField.querySelector('input')!.setAttribute('list', options.id);
    const nameField = field('Name', draft.name, 'text', value => { draft.name = value; }, 'e.g. milk');
    nameField.classList.add('name-field');

    const grid = element('div', 'grid');
    grid.append(
        field('Quantity', draft.quantity, 'text', value => { draft.quantity = value; }, 'e.g. 500 g'),
        field('Low at', draft.low, 'text', value => { draft.low = value; }, 'e.g. 100 g'),
        field('Bought', draft.bought, 'date', value => { draft.bought = value; }),
        field('Expires', draft.expire, 'date', value => { draft.expire = value; }),
    );

    const submit = (): void => {
        const section = draft.section.trim();
        const name = draft.name.trim();
        if (!section || !name) {
            form.classList.add('invalid');
            return;
        }
        vscode.postMessage({ type: 'add', section, name, attributes: addAttributes(draft) });
        adding = undefined;
        renderAddForm();
    };
    const cancel = (): void => { adding = undefined; renderAddForm(); };
    const actions = element('div', 'actions');
    actions.append(button('primary', 'Add', submit), button('secondary', 'Cancel', cancel));
    form.append(sectionField, options, nameField, grid, actions);
    keys(form, submit, cancel);
    addContainer.replaceChildren(form);
}

function renderList(): void {
    if (state?.status !== 'loaded') {
        return;
    }
    if (state.sections.length === 0) {
        list.replaceChildren(element('div', 'empty', 'Your pantry is empty. Use Add to stock it.'));
        return;
    }
    const today = todayIso(new Date());
    const views = visibleSections(state.sections, search, filter, today);
    if (views.length === 0) {
        list.replaceChildren(element('div', 'empty', 'No items match.'));
        return;
    }
    const narrowing = search.trim() !== '' || filter !== 'all';
    list.replaceChildren(...views.map(view => {
        const section = element('div', 'section');
        const isCollapsed = collapsed.has(view.name) && !narrowing;
        const count = narrowing ? `${view.items.length}/${view.total}` : String(view.total);
        const header = button('section-header', `${isCollapsed ? '▶' : '▼'} ${view.name}`, () => {
            if (collapsed.has(view.name)) { collapsed.delete(view.name); } else { collapsed.add(view.name); }
            renderList();
        });
        header.append(element('span', 'count', count));
        section.append(header);
        if (!isCollapsed) {
            view.items.forEach(item => section.append(itemRow(view.name, item, today)));
        }
        return section;
    }));
}

function itemRow(section: string, item: PantryItem, today: string): HTMLElement {
    const status = itemStatus(item, today);
    const row = element('div', 'item');
    const head = button('item-head', '', () => {
        editing = isEditing(section, item) ? undefined : { section, name: item.name, draft: initialDraft(item) };
        renderList();
    });
    const dot = element('span', `dot ${status}`);
    dot.title = STATUS_LABELS[status];
    head.append(dot, element('span', 'item-name', item.name));
    if (item.quantity) {
        head.append(element('span', 'item-qty', displayQuantity(item.quantity)));
    }
    if (item.expireDate) {
        head.append(element('span', `badge ${status}`, expiryLabel(daysUntil(item.expireDate, today))));
    }
    row.append(head);
    if (editing && isEditing(section, item)) {
        row.append(editForm(section, item, editing.draft));
    }
    return row;
}

function isEditing(section: string, item: PantryItem): boolean {
    return editing?.section === section && editing.name === item.name;
}

function editForm(section: string, item: PantryItem, draft: EditDraft): HTMLElement {
    const form = element('div', 'form');
    const grid = element('div', 'grid');
    grid.append(
        field('Quantity', draft.quantity, 'text', value => { draft.quantity = value; }, 'e.g. 500 g'),
        field('Low at', draft.low, 'text', value => { draft.low = value; }, 'e.g. 100 g'),
        field('Bought', draft.bought, 'date', value => { draft.bought = value; }),
        field('Expires', draft.expire, 'date', value => { draft.expire = value; }),
    );
    const close = (): void => { editing = undefined; renderList(); };
    const save = (): void => {
        const fields = changedFields(item, draft);
        if (Object.keys(fields).length > 0) {
            vscode.postMessage({ type: 'update', section, name: item.name, fields });
        }
        close();
    };
    const actions = element('div', 'actions');
    actions.append(
        button('primary', 'Save', save),
        button('secondary', 'Cancel', close),
        button('danger', 'Delete', () => { vscode.postMessage({ type: 'remove', section, name: item.name }); close(); }),
    );
    form.append(grid, actions);
    keys(form, save, close);
    return form;
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const message = event.data;
    if (message?.type === 'state') {
        state = message.state;
        // Drop the edit form if its item is gone (removed here or edited outside).
        if (editing && !state.sections.some(s => s.name === editing!.section && s.items.some(i => i.name === editing!.name))) {
            editing = undefined;
        }
        render();
    } else if (message?.type === 'showAdd') {
        openAddForm();
    }
});
vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 2: Create `pantry/media/pantry.css`**

```css
body {
    padding: 0;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.5;
}

#root { padding: 10px 12px; }

button { font-family: inherit; font-size: inherit; cursor: pointer; }

input {
    box-sizing: border-box;
    width: 100%;
    padding: 3px 6px;
    font-family: inherit;
    font-size: inherit;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 2px;
}

input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.empty { padding: 16px 4px; color: var(--vscode-descriptionForeground); text-align: center; }
.empty p { margin: 0 0 10px 0; }
.error { padding: 8px 0; color: var(--vscode-errorForeground); }
.error p { margin: 0 0 8px 0; }

.banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 8px;
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
}

.banner span { flex: 1; }

.primary, .secondary, .danger {
    padding: 3px 10px;
    border: 1px solid transparent;
    border-radius: 2px;
}

.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.primary:hover { background: var(--vscode-button-hoverBackground); }
.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.danger { background: none; color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); margin-left: auto; }
.icon { background: none; border: none; color: inherit; padding: 0 2px; }

.toolbar { margin-bottom: 10px; }
.toolbar-row { display: flex; gap: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

.chip {
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid var(--vscode-panel-border);
    background: none;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
}

.chip.active {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-color: var(--vscode-badge-background);
}

.form {
    padding: 8px;
    margin: 4px 0 8px 0;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    background: var(--vscode-editorWidget-background);
}

.form.invalid .name-field input:placeholder-shown { border-color: var(--vscode-inputValidation-errorBorder); }
.form-title { font-weight: 600; margin-bottom: 6px; }
.field { display: block; margin-bottom: 6px; }
.field-label { display: block; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
.actions { display: flex; gap: 6px; margin-top: 4px; }

.section { margin-bottom: 8px; }

.section-header {
    display: flex;
    width: 100%;
    align-items: center;
    padding: 4px 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--vscode-panel-border);
    color: var(--vscode-foreground);
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: left;
}

.count { margin-left: auto; color: var(--vscode-descriptionForeground); font-weight: normal; }

.item-head {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 3px 2px;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    text-align: left;
}

.item-head:hover { background: var(--vscode-list-hoverBackground); }
.item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-qty { color: var(--vscode-descriptionForeground); font-size: 0.9em; white-space: nowrap; }

.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--vscode-testing-iconPassed); }
.dot.low, .dot.expiring { background: var(--vscode-editorWarning-foreground); }
.dot.out, .dot.expired { background: var(--vscode-errorForeground); }

.badge { font-size: 0.8em; padding: 0 6px; border-radius: 8px; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.badge.expiring, .badge.low { color: var(--vscode-editorWarning-foreground); }
.badge.expired, .badge.out { color: var(--vscode-errorForeground); }
```

- [ ] **Step 3: Compile and test**

Run: `cd pantry && npm run compile && npm test`
Expected: `out/webview.js` is produced and every spec passes.

- [ ] **Step 4: Commit**

```bash
git add pantry/src/webview/main.ts pantry/media/pantry.css
git commit -m "feat(pantry): webview UI"
```

---

### Task 8: README, deploy and manual E2E

**Files:**
- Create: `pantry/README.md`
- Modify: `README.md` (repo root plugin table)

- [ ] **Step 1: Write `pantry/README.md`**

```markdown
# Pantry

See and edit what's in your [Cooklang](https://cooklang.org) pantry from Cook
Editor's right sidebar. Ships with Cook Editor.

- Items are grouped by the sections of `config/pantry.conf`, the same file
  CookCLI and the shopping list use; pantry items are subtracted from
  shopping lists.
- Each item shows its stock status (in stock, low, out of stock, expiring,
  expired), quantity and expiry.
- Search, and filter by Low, Out of stock or Expiring (within 7 days).
- Add, edit and remove items. Edits keep your file's comments and
  formatting; emptying a field removes it.
- No pantry yet? "Create pantry" writes a starter `config/pantry.conf`.

Items written above the first `[section]` header can only have a quantity;
move them into a section to track expiry or a low-stock level.

User guide: https://cook.md/help/plugins/pantry

## For plugin authors

This plugin uses:

- the `cooklang.api.parsePantry` and `cooklang.api.editPantry` commands
  (see `src/cooklang-api.ts`), detected with `vscode.commands.getCommands`;
- a webview view in the right sidebar (`src/pantry-controller.ts`,
  `src/webview/main.ts`).

Reference: https://cook.md/help/plugins/api
```

- [ ] **Step 2: Add the plugin to the repo README table**

In `/Users/alexeydubovskoy/Cooklang/plugins/README.md`, add a row after the `shopping-list` row:

```markdown
| [`pantry`](./pantry) | See and edit `config/pantry.conf`: stock levels, low and out-of-stock items, expiry. Ships with Cook Editor. Shows editing a config file through the Cooklang API. |
```

- [ ] **Step 3: Deploy into a local editor that has the editor-plan changes**

The editor plan must be done first: the `feature/pantry-plugin` branch built, with `packages/cooklang-native` rebuilt.

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/plugins/pantry && npm run deploy
cd /Users/alexeydubovskoy/Cooklang/editor && npm run start:electron
```

- [ ] **Step 4: Manual E2E checklist.** Open a recipe folder and tick each item:

- [ ] The Pantry icon (a jar) appears in the right sidebar, next to the Shopping List.
- [ ] In a folder with no `config/pantry.conf`, "Create pantry" writes the starter file and the view shows "Your pantry is empty".
- [ ] Add `milk`, section `fridge`, quantity `1 L`, expires in 3 days. The file gains `[fridge]` with `milk = { quantity = "1%L", expire = "YYYY-MM-DD" }`, and the row shows an amber dot and "in 3 days".
- [ ] Add a comment line to `pantry.conf` by hand and save. The view reloads, and a later edit keeps the comment.
- [ ] Editing `milk` and emptying Expires removes `expire`, and the item collapses to `milk = "1%L"`.
- [ ] Setting quantity `0 L` shows a red dot, and the "Out of stock" filter shows only that item.
- [ ] Search "mil" narrows the list; section counts show `1/N`.
- [ ] Delete asks for confirmation in a modal; confirming removes the item, and removes the section if it's now empty.
- [ ] Adding `Milk` again in `fridge` shows the banner "item 'milk' already exists in section 'fridge'", and the banner dismisses.
- [ ] Writing invalid TOML by hand shows the parse error with an "Open file" button.
- [ ] The Shopping List's "In Pantry" section updates after a pantry edit.
- [ ] The Pantry view title bar actions (+ and open-file) work; `Pantry: Add Pantry Item` from the palette opens the add form.

Fix anything that fails and commit the fixes with a `fix(pantry): …` message.

- [ ] **Step 5: Commit and open the PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add pantry/README.md README.md
git commit -m "docs(pantry): README"
git push -u origin feature/pantry
gh pr create --title "feat: pantry plugin" --body "$(cat <<'EOF'
New `cooklang.pantry` plugin: see and edit `config/pantry.conf` in the right sidebar — stock status, search, low/out-of-stock/expiring filters, add/edit/remove with formatting preserved.

Needs Cook Editor with `cooklang.api.parsePantry` / `cooklang.api.editPantry` (editor PR "pantry editing API for plugins"); older editors show an "update Cook Editor" message.
EOF
)"
```

---

### Task 9: Publish and ship by default

Do this only after both PRs are merged, and ask the user before publishing. Publishing to plugins.cook.md is outward-facing.

- [ ] **Step 1: Package and publish**

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/plugins/pantry && npm run package && npm run publish:marketplace
```
Expected: `pantry-0.1.0.vsix` is created and the publish succeeds. The publish needs the plugins.cook.md token; see `plugins/docs/superpowers/specs/2026-06-10-marketplace-publishing-design.md` for how it's supplied.

- [ ] **Step 2: Bundle it in the editor**

In the editor repo, on a new branch from `main`, add this to `theiaPlugins` in the root `package.json`, after `cooklang.shopping-list`:

```json
    "cooklang.pantry": "https://plugins.cook.md/api/cooklang/pantry/0.1.0/file/cooklang.pantry-0.1.0.vsix"
```

Then:
```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npm run download:plugins && ls plugins/cooklang.pantry/package.json
git add package.json
git commit -m "feat: ship the pantry plugin by default"
```
Expected: the plugin folder is downloaded. Open a PR.

- [ ] **Step 3: Help page**

The user guide URLs (`cook.md/help/plugins/pantry`) point at the cook.md site, which is a separate repo. Tell the user that a help page is needed there. Do not create it from this plan.
