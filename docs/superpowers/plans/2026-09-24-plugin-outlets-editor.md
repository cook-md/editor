# Plugin Outlets, Cooklang Plugin API and Shopping List Extraction — Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cook Editor a versioned Cooklang plugin API and five button/menu "outlets" in the Cooklang UI, then remove the built-in shopping list so the `cooklang.shopping-list` plugin can replace it.

**Architecture:** Outlets are plain Theia menu paths that plugins fill through `contributes.menus` (Theia already maps unknown menu ids to menu paths). A `CooklangOutletService` reads those menus and the preview/report widgets render them with a presentational `CooklangActionBar`. The plugin API is a set of label-less `cooklang.api.*` commands that wrap existing editor services (`ShoppingListGenerator`, `RecipeReferenceResolver`, the native language service).

**Tech Stack:** Theia 1.70 (InversifyJS DI, `MenuModelRegistry`, `CommandRegistry`, `ContextMenuRenderer`), React 18, TypeScript 5.4, mocha + chai with jsdom.

**Spec:** `docs/superpowers/specs/2026-09-24-shopping-list-plugin-design.md`

**Companion plans:** `2026-09-24-shopping-list-plugin.md` (plugin repo) runs between Task 9 and Task 10 of this plan. `2026-09-24-help-plugins-section.md` (cook.md) runs after the plugin is published.

---

## Working environment

- Work in the worktree `/Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets` on branch `feature/plugin-outlets`. Another session uses the main checkout `/Users/alexeydubovskoy/Cooklang/editor` — never switch branches there.
- The worktree has no `node_modules` yet. Before Task 1 run, from the worktree root:

```bash
export PATH="/Users/alexeydubovskoy/.local/node-v22.23.2-darwin-x64/bin:$PATH"
npm install
```

  Expected: finishes without errors (it builds the native addon; takes several minutes).
- **Every** shell that compiles or tests needs Node 22 on `PATH` (the default `node` is 20 and mocha dies with `ERR_UNKNOWN_FILE_EXTENSION ... .css`). Prefix commands with the `export PATH=...` line above. Do not install Node.
- Compile the Cooklang package: `npx tsc -b packages/cooklang` (from the worktree root).
- Run one spec: `cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/<name>.spec.js`
- Run all Cooklang specs: `npx lerna run test --scope @theia/cooklang`
- Lint: `npx lerna run lint --scope @theia/cooklang`
- New files start with the licence header used by every Cooklang file:

```ts
// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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
```

  (Code blocks below omit it; add it to every new `.ts`/`.tsx` file.)
- Browser specs start with the jsdom preamble (put it **before** any other import):

```ts
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}
```

  and end the imports with `after(() => disableJSDOM());` only if the sibling specs do so (they do in this package). Never call `disableJSDOM()` anywhere else.

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/cooklang/src/common/cooklang-outlet-context.ts` | create | JSON context types passed to outlet commands + `IngredientOutletInfo.fromIngredient` |
| `packages/cooklang/src/common/cooklang-outlet-context.spec.ts` | create | tests for the helper |
| `packages/cooklang/src/common/index.ts` | modify | export the new module |
| `packages/cooklang/src/browser/cooklang-outlets.ts` | create | `CooklangOutlets` menu paths (public API) |
| `packages/cooklang/src/browser/cooklang-outlet-service.ts` | create | read, filter, run and context-menu outlets |
| `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts` | create | tests |
| `packages/cooklang/src/browser/cooklang-action-bar.tsx` | create | presentational icon-button bar |
| `packages/cooklang/src/browser/cooklang-action-bar.spec.tsx` | create | tests |
| `packages/cooklang/src/browser/style/cooklang-action-bar.css` | create | button styling |
| `packages/cooklang/src/browser/cooklang-outlet-contribution.ts` | create | `cooklang.outlet.showSource` command + its outlet entries |
| `packages/cooklang/src/browser/recipe-preview-components.tsx` | modify | toolbar items + ingredient context menu instead of Show Source button |
| `packages/cooklang/src/browser/recipe-preview-widget.tsx` | modify | builds outlet contexts |
| `packages/cooklang/src/browser/menu-preview-components.tsx` | modify | toolbar items + recipe-reference context menu |
| `packages/cooklang/src/browser/menu-preview-widget.tsx` | modify | builds outlet contexts |
| `packages/cooklang/src/browser/report-widget.tsx` | modify | report toolbar outlet |
| `packages/cooklang/src/browser/style/report.css` | modify | toolbar row |
| `packages/cooklang/src/browser/shopping-list-generator.ts` | create | headless aggregation (moved out of `ShoppingListService`) |
| `packages/cooklang/src/browser/shopping-list-generator.spec.ts` | create | tests |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` | create | `cooklang.api.*` commands + `cooklang.apiVersion` context key |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | create | tests |
| `packages/cooklang/src/browser/generate-shopping-list-tool.ts` | modify | generator for headless, plugin command for `addToList` |
| `packages/cooklang/src/browser/generate-shopping-list-tool.spec.ts` | modify | new fakes |
| `packages/cooklang/src/browser/cooklang-frontend-module.ts` | modify | bindings |
| `packages/cooklang/src/browser/shopping-list-{service,service.spec,widget,components,contribution}.ts(x)`, `style/shopping-list.css` | delete (Task 10) | built-in shopping list |
| `package.json` (root) | modify (Task 11) | pin the plugin in `theiaPlugins` |

---

### Task 1: Outlet context types and menu paths

**Files:**
- Create: `packages/cooklang/src/common/cooklang-outlet-context.ts`
- Create: `packages/cooklang/src/common/cooklang-outlet-context.spec.ts`
- Create: `packages/cooklang/src/browser/cooklang-outlets.ts`
- Modify: `packages/cooklang/src/common/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/cooklang/src/common/cooklang-outlet-context.spec.ts`:

```ts
import { expect } from 'chai';
import { IngredientOutletInfo, PreviewOutletContext } from './cooklang-outlet-context';
import { Ingredient } from './recipe-types';

function ingredient(quantity: Ingredient['quantity']): Ingredient {
    return { name: 'flour', alias: null, quantity, note: null, reference: null } as unknown as Ingredient;
}

describe('IngredientOutletInfo.fromIngredient', () => {
    it('describes a regular number quantity with its unit', () => {
        const info = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'number', value: { type: 'regular', value: 2 } }, unit: 'cups', scalable: true,
        }));
        expect(info).to.deep.equal({ name: 'flour', quantity: '2 cups', amount: 2, unit: 'cups' });
    });

    it('turns a fraction into a decimal amount', () => {
        const info = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'number', value: { type: 'fraction', value: { whole: 1, num: 1, den: 2, err: 0 } } },
            unit: null, scalable: true,
        } as unknown as Ingredient['quantity']));
        expect(info.amount).to.equal(1.5);
        expect(info.unit).to.equal(undefined);
    });

    it('omits amount for text quantities and everything for a missing quantity', () => {
        const text = IngredientOutletInfo.fromIngredient(ingredient({
            value: { type: 'text', value: 'some' }, unit: null, scalable: false,
        } as unknown as Ingredient['quantity']));
        expect(text).to.deep.equal({ name: 'flour', quantity: 'some' });
        expect(IngredientOutletInfo.fromIngredient(ingredient(null))).to.deep.equal({ name: 'flour' });
    });
});

describe('PreviewOutletContext.is', () => {
    it('accepts a context object and rejects anything else', () => {
        expect(PreviewOutletContext.is({ version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 })).to.equal(true);
        expect(PreviewOutletContext.is(undefined)).to.equal(false);
        expect(PreviewOutletContext.is({ uri: 'file:///ws/a.cook' })).to.equal(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -b packages/cooklang`
Expected: FAIL — `Cannot find module './cooklang-outlet-context'`.

- [ ] **Step 3: Write the implementation**

Check the exact `Ingredient`, `Quantity` and fraction shapes first: `grep -n "export interface Ingredient\b" -A12 packages/cooklang/src/common/recipe-types.ts` and `grep -n "fraction" packages/cooklang/src/common/recipe-types.ts`. Adjust the test's fixture fields (not the helper's logic) if the names differ.

`packages/cooklang/src/common/cooklang-outlet-context.ts`:

```ts
import { formatQuantity, Ingredient } from './recipe-types';
import { ReportOutputFormat } from './report-templates';

/**
 * Contexts passed as the single argument to commands contributed to the
 * Cooklang outlets (see `CooklangOutlets`). Plain JSON so they cross the
 * plugin-host boundary unchanged. Version 1; later versions only add optional
 * fields. Paths are workspace-relative; URIs are `file://` strings.
 */
export interface PreviewOutletContext {
    version: 1;
    uri: string;
    path: string;
    scale: number;
}

export namespace PreviewOutletContext {
    export function is(arg: unknown): arg is PreviewOutletContext {
        return typeof arg === 'object' && arg !== undefined && arg !== null // eslint-disable-line no-null/no-null
            && typeof (arg as PreviewOutletContext).version === 'number'
            && typeof (arg as PreviewOutletContext).uri === 'string'
            && typeof (arg as PreviewOutletContext).path === 'string';
    }
}

/** An ingredient as shown in the recipe preview (already scaled). */
export interface IngredientOutletInfo {
    name: string;
    /** Formatted quantity as displayed, e.g. `"2 cups"`. */
    quantity?: string;
    /** Numeric amount when the quantity is a number or fraction. */
    amount?: number;
    unit?: string;
}

export namespace IngredientOutletInfo {
    export function fromIngredient(ingredient: Ingredient): IngredientOutletInfo {
        const info: IngredientOutletInfo = { name: ingredient.name };
        const quantity = ingredient.quantity;
        if (!quantity) {
            return info;
        }
        const text = formatQuantity(quantity);
        if (text) {
            info.quantity = text;
        }
        if (quantity.value.type === 'number') {
            const number = quantity.value.value;
            info.amount = number.type === 'regular'
                ? number.value
                : number.value.whole + number.value.num / number.value.den;
        }
        if (quantity.unit) {
            info.unit = quantity.unit;
        }
        return info;
    }
}

export interface IngredientOutletContext extends PreviewOutletContext {
    ingredient: IngredientOutletInfo;
}

/** A `@recipe` reference as written in a menu. */
export interface MenuRecipeOutletInfo {
    /** Reference without a leading `./`. */
    name: string;
    /** Scale shown in the menu, already multiplied by the menu scale. */
    scale?: number;
    /** When set, `scale` is a target in this unit (e.g. `servings`), not a multiplier. */
    unit?: string;
}

export interface MenuRecipeOutletContext {
    version: 1;
    menuUri: string;
    menuPath: string;
    menuScale: number;
    recipe: MenuRecipeOutletInfo;
}

export interface ReportOutletContext {
    version: 1;
    /** Recipe or menu the report was rendered for. */
    uri: string;
    path: string;
    templateId: string;
    templateLabel: string;
    templateUri?: string;
    outputFormat: ReportOutputFormat;
    /** Rendered output, once rendering succeeded. */
    output?: string;
}
```

Check where `ReportOutputFormat` is exported from: `grep -rn "export type ReportOutputFormat" packages/cooklang/src/common`. Import it from that module.

Add to `packages/cooklang/src/common/index.ts` (next to the other `export *` lines):

```ts
export * from './cooklang-outlet-context';
```

`packages/cooklang/src/browser/cooklang-outlets.ts`:

```ts
import { MenuPath } from '@theia/core/lib/common/menu';

/**
 * Public menu paths plugins contribute to with `contributes.menus`, e.g.
 * `"cooklang/recipePreview/toolbar": [{ "command": "x", "group": "navigation@10" }]`.
 * Theia maps any non-VS Code menu id to the menu path `[id]`, so plugins need
 * nothing beyond the id. Each outlet passes one JSON context argument — see
 * `cooklang-outlet-context.ts`. Renaming a path breaks plugins.
 */
export namespace CooklangOutlets {
    export const VERSION = 1;
    /** Icon buttons in the recipe preview header. Context: `PreviewOutletContext`. */
    export const RECIPE_PREVIEW_TOOLBAR: MenuPath = ['cooklang/recipePreview/toolbar'];
    /** Icon buttons in the menu preview header. Context: `PreviewOutletContext`. */
    export const MENU_PREVIEW_TOOLBAR: MenuPath = ['cooklang/menuPreview/toolbar'];
    /** Right-click on an ingredient in the recipe preview. Context: `IngredientOutletContext`. */
    export const RECIPE_INGREDIENT_CONTEXT: MenuPath = ['cooklang/recipePreview/ingredient/context'];
    /** Right-click on a recipe reference in the menu preview. Context: `MenuRecipeOutletContext`. */
    export const MENU_RECIPE_CONTEXT: MenuPath = ['cooklang/menuPreview/recipe/context'];
    /** Icon buttons above a rendered report. Context: `ReportOutletContext`. */
    export const REPORT_TOOLBAR: MenuPath = ['cooklang/report/toolbar'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/common/cooklang-outlet-context.spec.js`
Expected: PASS, 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/common/cooklang-outlet-context.ts packages/cooklang/src/common/cooklang-outlet-context.spec.ts packages/cooklang/src/common/index.ts packages/cooklang/src/browser/cooklang-outlets.ts
git commit -m "feat(cooklang): outlet menu paths and context types for plugins"
```

---

### Task 2: CooklangOutletService

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-outlet-service.ts`
- Create: `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the failing test**

`packages/cooklang/src/browser/cooklang-outlet-service.spec.ts` (jsdom preamble first, see Working environment):

```ts
import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { Emitter } from '@theia/core/lib/common/event';
import { MenuPath } from '@theia/core/lib/common/menu';
import { CooklangOutletService } from './cooklang-outlet-service';

after(() => disableJSDOM());

const PATH: MenuPath = ['cooklang/recipePreview/toolbar'];

interface Run { id: string; args: unknown[] }

class Fixture {
    runs: Run[] = [];
    rendered: unknown[] = [];
    errors: string[] = [];
    menuChanged = new Emitter<void>();
    commandsChanged = new Emitter<void>();
    root: { children: unknown[] } | undefined = { children: [] };

    command(id: string, sortString: string, options: { icon?: string; visible?: (ctx: unknown) => boolean; fail?: boolean } = {}): object {
        const runs = this.runs;
        return {
            id, label: `Label ${id}`, icon: options.icon, sortString,
            isVisible: (_path: MenuPath, _matcher: unknown, _ctx: unknown, ...args: unknown[]) => options.visible ? options.visible(args[0]) : true,
            isEnabled: () => true,
            isToggled: () => false,
            run: async (_path: MenuPath, ...args: unknown[]) => {
                runs.push({ id, args });
                if (options.fail) { throw new Error('boom'); }
            },
        };
    }

    group(id: string, sortString: string, children: object[]): object {
        return { id, sortString, children, isVisible: () => true, isEmpty: () => children.length === 0 };
    }

    create(): CooklangOutletService {
        const service = new CooklangOutletService();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (service as any).menus = { getMenu: (path: MenuPath) => path[0] === PATH[0] ? this.root : undefined, onDidChange: this.menuChanged.event };
        (service as any).commands = { onCommandsChanged: this.commandsChanged.event };
        (service as any).contextKeys = { match: () => true };
        (service as any).contextMenuRenderer = { render: (options: unknown) => { this.rendered.push(options); } };
        (service as any).messages = { error: (message: string) => { this.errors.push(message); } };
        (service as any).workspaceService = { tryGetRoots: () => [{ resource: new URI('file:///ws') }] };
        (service as any).init();
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return service;
    }
}

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };

describe('CooklangOutletService', () => {
    it('returns no items when nothing was contributed to the outlet', () => {
        const fixture = new Fixture();
        fixture.root = undefined;
        expect(fixture.create().getItems(PATH, CONTEXT)).to.deep.equal([]);
    });

    it('lists the navigation group first, then other groups, each sorted by order', () => {
        const fixture = new Fixture();
        fixture.root!.children = [
            fixture.group('z-extra', 'z-extra', [fixture.command('extra', '1')]),
            fixture.command('loose', '5'),
            fixture.group('navigation', 'navigation', [fixture.command('late', '90'), fixture.command('early', '10', { icon: 'codicon codicon-add' })]),
        ];
        const items = fixture.create().getItems(PATH, CONTEXT);
        expect(items.map(item => item.id)).to.deep.equal(['early', 'late', 'loose', 'extra']);
        expect(items[0]).to.deep.equal({ id: 'early', label: 'Label early', iconClass: 'codicon codicon-add' });
    });

    it('asks every node whether it is visible for the context', () => {
        const fixture = new Fixture();
        fixture.root!.children = [
            fixture.command('menus-only', '1', { visible: ctx => (ctx as { path: string }).path.endsWith('.menu') }),
            fixture.command('always', '2'),
        ];
        expect(fixture.create().getItems(PATH, CONTEXT).map(item => item.id)).to.deep.equal(['always']);
    });

    it('runs an item with the context as its only argument', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('cart', '1')];
        await fixture.create().run(PATH, 'cart', CONTEXT);
        expect(fixture.runs).to.deep.equal([{ id: 'cart', args: [CONTEXT] }]);
    });

    it('ignores an id that is not (or no longer) in the outlet', async () => {
        const fixture = new Fixture();
        await fixture.create().run(PATH, 'gone', CONTEXT);
        expect(fixture.runs).to.deep.equal([]);
    });

    it('reports a failing command instead of throwing', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('cart', '1', { fail: true })];
        await fixture.create().run(PATH, 'cart', CONTEXT);
        expect(fixture.errors).to.have.length(1);
        expect(fixture.errors[0]).to.contain('Label cart').and.to.contain('boom');
    });

    it('shows a context menu with the context and without the anchor argument', () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('lookup', '1')];
        let prevented = false;
        const event = { clientX: 10, clientY: 20, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined };
        fixture.create().showContextMenu(PATH, CONTEXT, event);
        expect(prevented).to.equal(true);
        expect(fixture.rendered).to.deep.equal([{ menuPath: PATH, anchor: { x: 10, y: 20 }, args: [CONTEXT], includeAnchorArg: false }]);
    });

    it('leaves the default context menu alone when the outlet is empty', () => {
        const fixture = new Fixture();
        let prevented = false;
        fixture.create().showContextMenu(PATH, CONTEXT, { clientX: 0, clientY: 0, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined });
        expect(prevented).to.equal(false);
        expect(fixture.rendered).to.deep.equal([]);
    });

    it('fires onDidChange when menus or commands change', () => {
        const fixture = new Fixture();
        const service = fixture.create();
        let fired = 0;
        service.onDidChange(() => { fired += 1; });
        fixture.menuChanged.fire();
        fixture.commandsChanged.fire();
        expect(fired).to.equal(2);
    });

    it('describes a resource with its URI and workspace-relative path', () => {
        const service = new Fixture().create();
        expect(service.describe(new URI('file:///ws/Dinner/Soup.cook'))).to.deep.equal({ uri: 'file:///ws/Dinner/Soup.cook', path: 'Dinner/Soup.cook' });
        expect(service.describe(new URI('file:///elsewhere/Cake.cook'))).to.deep.equal({ uri: 'file:///elsewhere/Cake.cook', path: 'Cake.cook' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -b packages/cooklang`
Expected: FAIL — `Cannot find module './cooklang-outlet-service'`.

- [ ] **Step 3: Write the implementation**

`packages/cooklang/src/browser/cooklang-outlet-service.ts`:

```ts
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { CommandMenu, CompoundMenuNode, MenuModelRegistry, MenuNode, MenuPath } from '@theia/core/lib/common/menu';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';

/** One visible entry of an outlet, ready to render as a button. */
export interface OutletItem {
    id: string;
    label: string;
    iconClass?: string;
}

/** The parts of a mouse event `showContextMenu` needs (DOM and React events both fit). */
export interface OutletMouseEvent {
    clientX: number;
    clientY: number;
    preventDefault(): void;
    stopPropagation(): void;
}

/**
 * Reads what plugins (and the editor itself) contributed to a Cooklang outlet
 * (`CooklangOutlets`) and runs it with the outlet's JSON context.
 */
@injectable()
export class CooklangOutletService {

    @inject(MenuModelRegistry)
    protected readonly menus: MenuModelRegistry;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(ContextKeyService)
    protected readonly contextKeys: ContextKeyService;

    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /**
     * Fires when outlet contents may have changed. Menu additions fire no
     * registry event, but plugin contributions register their commands in the
     * same pass and `onCommandsChanged` fires (debounced) right after.
     */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.menus.onDidChange(() => this.onDidChangeEmitter.fire());
        this.commands.onCommandsChanged(() => this.onDidChangeEmitter.fire());
    }

    getItems(menuPath: MenuPath, context: object): OutletItem[] {
        return this.visibleCommands(menuPath, context).map(node => {
            const item: OutletItem = { id: node.id, label: node.label };
            if (node.icon) {
                item.iconClass = node.icon;
            }
            return item;
        });
    }

    async run(menuPath: MenuPath, id: string, context: object): Promise<void> {
        const node = this.visibleCommands(menuPath, context).find(candidate => candidate.id === id);
        if (!node) {
            return;
        }
        try {
            await node.run(menuPath, context);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            console.error(`[cooklang] outlet command ${id} failed:`, e);
            this.messages.error(nls.localize('theia/cooklang/outletCommandFailed', '{0} failed: {1}', node.label, reason));
        }
    }

    /** Opens the outlet as a context menu; does nothing when it has no visible items. */
    showContextMenu(menuPath: MenuPath, context: object, event: OutletMouseEvent): void {
        if (this.visibleCommands(menuPath, context).length === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuRenderer.render({
            menuPath,
            anchor: { x: event.clientX, y: event.clientY },
            args: [context],
            // The anchor is a DOM object; plugin commands only get the JSON context.
            includeAnchorArg: false,
        });
    }

    /** `uri` and workspace-relative `path` for an outlet context. */
    describe(uri: URI): { uri: string; path: string } {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const relative = root && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        return { uri: uri.toString(), path: relative ?? uri.path.base };
    }

    protected visibleCommands(menuPath: MenuPath, context: object): CommandMenu[] {
        const root = this.menus.getMenu(menuPath);
        if (!root) {
            return [];
        }
        const out: CommandMenu[] = [];
        const visit = (node: MenuNode): void => {
            if (!node.isVisible(menuPath, this.contextKeys, undefined, context)) {
                return;
            }
            if (CommandMenu.is(node)) {
                out.push(node);
            } else if (CompoundMenuNode.is(node)) {
                [...node.children].sort(CompoundMenuNode.sortChildren).forEach(visit);
            }
        };
        [...root.children].sort(CompoundMenuNode.sortChildren).forEach(visit);
        return out;
    }
}
```

If `tsc` complains that `this.contextKeys` is not a `ContextExpressionMatcher<undefined>`, cast at the call: `this.contextKeys as ContextExpressionMatcher<HTMLElement>` and pass `undefined` — the same call shape `TabBarToolbar` uses (`grep -n "isVisible(" packages/core/src/browser/shell/tab-bar-toolbar/*.ts*`).

In `packages/cooklang/src/browser/cooklang-frontend-module.ts` add the import and binding (next to `bind(PreviewTabManager)...`):

```ts
import { CooklangOutletService } from './cooklang-outlet-service';
// ...
    bind(CooklangOutletService).toSelf().inSingletonScope();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-outlet-service.spec.js`
Expected: PASS, 10 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-outlet-service.ts packages/cooklang/src/browser/cooklang-outlet-service.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): outlet service that reads, runs and shows plugin menu items"
```

---

### Task 3: CooklangActionBar component

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-action-bar.tsx`
- Create: `packages/cooklang/src/browser/cooklang-action-bar.spec.tsx`
- Create: `packages/cooklang/src/browser/style/cooklang-action-bar.css`

- [ ] **Step 1: Write the failing test**

Confirm the spec glob picks up `.spec.tsx`: `grep -rn "spec.js" dev-packages/private-ext-scripts/package.json` shows `./lib/**/*.*spec.js`, which matches compiled `.tsx` specs. Confirm the React test helpers exist: `ls packages/core/shared/react-dom/client` and `node -e "require.resolve('react-dom/test-utils')"`.

`packages/cooklang/src/browser/cooklang-action-bar.spec.tsx` (jsdom preamble first):

```tsx
import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { act } from 'react-dom/test-utils';
import { CooklangActionBar } from './cooklang-action-bar';

after(() => disableJSDOM());

describe('CooklangActionBar', () => {
    let host: HTMLElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('renders nothing without items', () => {
        act(() => root.render(<CooklangActionBar items={[]} onRun={() => undefined} />));
        expect(host.innerHTML).to.equal('');
    });

    it('renders an icon button per item with the label as tooltip, and runs it on click', () => {
        const ran: string[] = [];
        act(() => root.render(<CooklangActionBar
            items={[{ id: 'cart', label: 'Add to Shopping List', iconClass: 'codicon codicon-add' }, { id: 'plain', label: 'Plain' }]}
            onRun={id => ran.push(id)} />));
        const buttons = host.querySelectorAll('button');
        expect(buttons).to.have.length(2);
        expect(buttons[0].title).to.equal('Add to Shopping List');
        expect(buttons[0].querySelector('span')!.className).to.equal('codicon codicon-add');
        expect(buttons[1].textContent).to.equal('Plain');
        act(() => buttons[0].click());
        expect(ran).to.deep.equal(['cart']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -b packages/cooklang`
Expected: FAIL — `Cannot find module './cooklang-action-bar'`.

- [ ] **Step 3: Write the implementation**

`packages/cooklang/src/browser/cooklang-action-bar.tsx`:

```tsx
import * as React from '@theia/core/shared/react';
import { OutletItem } from './cooklang-outlet-service';

import '../../src/browser/style/cooklang-action-bar.css';

export interface CooklangActionBarProps {
    items: readonly OutletItem[];
    onRun: (id: string) => void;
    className?: string;
}

/** Icon buttons for the items of a Cooklang outlet. Renders nothing when empty. */
export const CooklangActionBar = ({ items, onRun, className }: CooklangActionBarProps): React.ReactElement | null => {
    if (items.length === 0) {
        return null; // eslint-disable-line no-null/no-null
    }
    return (
        <div className={className ? `theia-cooklang-action-bar ${className}` : 'theia-cooklang-action-bar'}>
            {items.map(item => <ActionBarButton key={item.id} item={item} onRun={onRun} />)}
        </div>
    );
};

interface ActionBarButtonProps {
    item: OutletItem;
    onRun: (id: string) => void;
}

const ActionBarButton = ({ item, onRun }: ActionBarButtonProps): React.ReactElement => (
    <button className='theia-cooklang-action-bar-button' title={item.label} aria-label={item.label} onClick={() => onRun(item.id)}>
        {item.iconClass ? <span className={item.iconClass}></span> : item.label}
    </button>
);
```

`packages/cooklang/src/browser/style/cooklang-action-bar.css` (same look as the existing `.recipe-show-source` button):

```css
.theia-cooklang-action-bar {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.theia-cooklang-action-bar-button {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid var(--theia-panel-border);
    border-radius: 3px;
    background: transparent;
    color: var(--theia-descriptionForeground);
    cursor: pointer;
    white-space: nowrap;
    font-size: 14px;
    flex-shrink: 0;
}

.theia-cooklang-action-bar-button:hover {
    background: var(--theia-toolbar-hoverBackground, var(--theia-textCodeBlock-background));
    color: var(--theia-foreground);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-action-bar.spec.js`
Expected: PASS, 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-action-bar.tsx packages/cooklang/src/browser/cooklang-action-bar.spec.tsx packages/cooklang/src/browser/style/cooklang-action-bar.css
git commit -m "feat(cooklang): action bar component for outlet items"
```

---

### Task 4: Show Source on the toolbar outlets

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-outlet-contribution.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the implementation**

(No separate unit test: the command is a two-line delegation to `RecipeNavigator.openSource`; Task 5 and the E2E check cover it.)

`packages/cooklang/src/browser/cooklang-outlet-contribution.ts`:

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import URI from '@theia/core/lib/common/uri';
import { PreviewOutletContext } from '../common/cooklang-outlet-context';
import { CooklangOutlets } from './cooklang-outlets';
import { RecipeNavigator } from './recipe-navigator';

export namespace CooklangOutletCommands {
    export const SHOW_SOURCE: Command = Command.toLocalizedCommand({
        id: 'cooklang.outlet.showSource',
        label: 'Show Source',
        iconClass: 'codicon codicon-go-to-file',
    }, 'theia/cooklang/outletShowSource');
}

/**
 * The editor's own entries in the Cooklang outlets. Show Source lives here so
 * the outlet path is exercised by first-party code, not only by plugins.
 */
@injectable()
export class CooklangOutletContribution implements CommandContribution, MenuContribution {

    @inject(RecipeNavigator)
    protected readonly navigator: RecipeNavigator;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangOutletCommands.SHOW_SOURCE, {
            execute: (context: unknown) => PreviewOutletContext.is(context) ? this.navigator.openSource(new URI(context.uri)) : undefined,
            // Outlet-only: hidden from the command palette, which passes no context.
            isVisible: (context: unknown) => PreviewOutletContext.is(context),
            isEnabled: (context: unknown) => PreviewOutletContext.is(context),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        for (const outlet of [CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, CooklangOutlets.MENU_PREVIEW_TOOLBAR]) {
            menus.registerMenuAction([...outlet, 'navigation'], {
                commandId: CooklangOutletCommands.SHOW_SOURCE.id,
                order: '90',
            });
        }
    }
}
```

In `cooklang-frontend-module.ts`:

```ts
import { CooklangOutletContribution } from './cooklang-outlet-contribution';
// ...
    bind(CooklangOutletContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CooklangOutletContribution);
    bind(MenuContribution).toService(CooklangOutletContribution);
```

- [ ] **Step 2: Compile**

Run: `npx tsc -b packages/cooklang`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-outlet-contribution.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): contribute Show Source through the preview toolbar outlets"
```

---

### Task 5: Recipe preview renders its outlets

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx` (`IngredientRow` ~line 396, `IngredientsSidebar` ~line 431, `RecipeViewProps`/`RecipeView` ~line 555-660)
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx` (injections ~line 60, `init` ~line 100, handlers ~line 391, `render` ~line 442)

- [ ] **Step 1: Components**

In `recipe-preview-components.tsx`:

1. Add imports:

```tsx
import { CooklangActionBar } from './cooklang-action-bar';
import { OutletItem } from './cooklang-outlet-service';
```

2. `IngredientRow` gets an optional context-menu callback. Replace the `IngredientRowProps` interface and the opening `<li ...>` line:

```tsx
interface IngredientRowProps {
    ingredient: Ingredient;
    onNavigateToRecipe?: (referencePath: string) => void;
    onContextMenu?: (ingredient: Ingredient, event: React.MouseEvent) => void;
}

const IngredientRow = ({ ingredient, onNavigateToRecipe, onContextMenu }: IngredientRowProps): React.ReactElement => {
```

```tsx
        <li className={`ingredient-item${isRef ? ' ingredient-ref' : ''}`}
            onContextMenu={onContextMenu ? event => onContextMenu(ingredient, event) : undefined}>
```

3. `IngredientsSidebarProps` gains `onIngredientContextMenu?: (ingredient: Ingredient, event: React.MouseEvent) => void;`, the component destructures it, and `renderIngredientList` passes it: `<IngredientRow key={idx} ingredient={ingredients[idx]} onNavigateToRecipe={onNavigateToRecipe} onContextMenu={onIngredientContextMenu} />`.

4. In `RecipeViewProps` replace `onShowSource?: () => void;` with:

```tsx
    toolbarItems: readonly OutletItem[];
    onRunToolbarItem: (id: string) => void;
    onIngredientContextMenu?: (ingredient: Ingredient, event: React.MouseEvent) => void;
```

   (Keep `onAddToShoppingList` for now — it is removed in Task 10 once the plugin provides the button.) Update the `RecipeView` destructuring to match.

5. In the header replace the whole `{onShowSource && (...)}` block with:

```tsx
                    <CooklangActionBar items={toolbarItems} onRun={onRunToolbarItem} />
```

6. Pass the ingredient callback: `<IngredientsSidebar ... onIngredientContextMenu={onIngredientContextMenu} />`.

- [ ] **Step 2: Widget**

In `recipe-preview-widget.tsx`:

1. Imports:

```tsx
import { CooklangOutletService } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { IngredientOutletInfo, PreviewOutletContext } from '../common/cooklang-outlet-context';
import { Ingredient } from '../common/recipe-types';
```

   (`Ingredient` may already be importable from `'../common/recipe-types'` alongside `ParseResult, Recipe` — extend that import instead of adding a second one.)

2. Injection after `timerService`:

```tsx
    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;
```

3. At the end of `init()`:

```tsx
        this.toDispose.push(this.outlets.onDidChange(() => this.update()));
```

4. Replace `handleShowSource` with:

```tsx
    protected previewContext(): PreviewOutletContext | undefined {
        if (!this.uri) {
            return undefined;
        }
        return { version: CooklangOutlets.VERSION, ...this.outlets.describe(this.uri), scale: this.scale };
    }

    protected handleRunToolbarItem = (id: string): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.run(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, id, context);
        }
    };

    protected handleIngredientContextMenu = (ingredient: Ingredient, event: React.MouseEvent): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.showContextMenu(CooklangOutlets.RECIPE_INGREDIENT_CONTEXT,
                { ...context, ingredient: IngredientOutletInfo.fromIngredient(ingredient) }, event);
        }
    };
```

5. In `render()`, compute the items and pass the new props in place of `onShowSource`:

```tsx
            const context = this.previewContext();
            const toolbarItems = context ? this.outlets.getItems(CooklangOutlets.RECIPE_PREVIEW_TOOLBAR, context) : [];
```

```tsx
                            toolbarItems={toolbarItems}
                            onRunToolbarItem={this.handleRunToolbarItem}
                            onIngredientContextMenu={this.handleIngredientContextMenu}
```

   `this.navigator` stays injected (still used by `handleNavigateToRecipe`).

- [ ] **Step 3: Compile and run the package tests**

Run: `npx tsc -b packages/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: compiles; all specs pass (no existing spec renders `RecipeView` with `onShowSource`; if one does — `grep -rln "onShowSource" packages/cooklang/src` — update it to pass `toolbarItems={[]}` and `onRunToolbarItem={() => undefined}`).

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-components.tsx packages/cooklang/src/browser/recipe-preview-widget.tsx
git commit -m "feat(cooklang): recipe preview toolbar and ingredient outlets"
```

---

### Task 6: Menu preview renders its outlets

**Files:**
- Modify: `packages/cooklang/src/browser/menu-preview-components.tsx`
- Modify: `packages/cooklang/src/browser/menu-preview-widget.tsx`

- [ ] **Step 1: Components**

In `menu-preview-components.tsx`:

1. Imports: add `MenuRecipeReferenceItem` to the `'../common/menu-types'` import, plus

```tsx
import { CooklangActionBar } from './cooklang-action-bar';
import { OutletItem } from './cooklang-outlet-service';
```

2. Thread a callback `onRecipeContextMenu?: (item: MenuRecipeReferenceItem, event: React.MouseEvent) => void` through `MenuItemViewProps`, `MenuLineViewProps`, `MenuSectionViewProps` and `MenuViewProps` (each component destructures it and passes it to its child, exactly like `onNavigateToRecipe`).

3. In `MenuItemView`'s `recipeReference` case, put it on the wrapping span:

```tsx
                <span className='menu-recipe-ref'
                    onContextMenu={onRecipeContextMenu ? event => onRecipeContextMenu(item, event) : undefined}>
```

4. In `MenuViewProps` replace `onShowSource?: () => void;` with `toolbarItems: readonly OutletItem[];` and `onRunToolbarItem: (id: string) => void;`, update the destructuring, and replace the `{onShowSource && (...)}` button block with:

```tsx
                    <CooklangActionBar items={toolbarItems} onRun={onRunToolbarItem} />
```

   Keep `onAddToShoppingList` until Task 10.

- [ ] **Step 2: Widget**

In `menu-preview-widget.tsx` (mirrors Task 5):

```tsx
import { CooklangOutletService } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { MenuRecipeOutletInfo, PreviewOutletContext } from '../common/cooklang-outlet-context';
import { MenuRecipeReferenceItem } from '../common/menu-types';
```

```tsx
    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;
```

In `init()` (find it with `grep -n "@postConstruct" -A12 menu-preview-widget.tsx`) add `this.toDispose.push(this.outlets.onDidChange(() => this.update()));`.

Replace `handleShowSource` with:

```tsx
    protected previewContext(): PreviewOutletContext | undefined {
        if (!this.uri) {
            return undefined;
        }
        return { version: CooklangOutlets.VERSION, ...this.outlets.describe(this.uri), scale: this.scale };
    }

    protected handleRunToolbarItem = (id: string): void => {
        const context = this.previewContext();
        if (context) {
            this.outlets.run(CooklangOutlets.MENU_PREVIEW_TOOLBAR, id, context);
        }
    };

    protected handleRecipeContextMenu = (item: MenuRecipeReferenceItem, event: React.MouseEvent): void => {
        const context = this.previewContext();
        if (!context) {
            return;
        }
        const recipe: MenuRecipeOutletInfo = { name: item.name.replace(/^\.\//, '') };
        if (typeof item.scale === 'number') {
            recipe.scale = item.scale;
        }
        if (item.unit) {
            recipe.unit = item.unit;
        }
        this.outlets.showContextMenu(CooklangOutlets.MENU_RECIPE_CONTEXT, {
            version: CooklangOutlets.VERSION,
            menuUri: context.uri,
            menuPath: context.path,
            menuScale: context.scale,
            recipe,
        }, event);
    };
```

In `render()`:

```tsx
            const context = this.previewContext();
            const toolbarItems = context ? this.outlets.getItems(CooklangOutlets.MENU_PREVIEW_TOOLBAR, context) : [];
```

and pass `toolbarItems={toolbarItems}`, `onRunToolbarItem={this.handleRunToolbarItem}`, `onRecipeContextMenu={this.handleRecipeContextMenu}` instead of `onShowSource`.

- [ ] **Step 3: Compile and test**

Run: `npx tsc -b packages/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: compiles, all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/menu-preview-components.tsx packages/cooklang/src/browser/menu-preview-widget.tsx
git commit -m "feat(cooklang): menu preview toolbar and recipe-reference outlets"
```

---

### Task 7: Report toolbar outlet

**Files:**
- Modify: `packages/cooklang/src/browser/report-widget.tsx`
- Modify: `packages/cooklang/src/browser/style/report.css`

- [ ] **Step 1: Widget**

In `report-widget.tsx`:

```tsx
import { CooklangOutletService } from './cooklang-outlet-service';
import { CooklangOutlets } from './cooklang-outlets';
import { CooklangActionBar } from './cooklang-action-bar';
import { ReportOutletContext } from '../common/cooklang-outlet-context';
```

```tsx
    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;
```

At the end of `init()`: `this.toDispose.push(this.outlets.onDidChange(() => this.update()));`

Rename the existing `protected render(): React.ReactNode` to `protected renderBody(): React.ReactNode` (body unchanged) and add above it:

```tsx
    protected render(): React.ReactNode {
        const context = this.reportContext();
        const items = context ? this.outlets.getItems(CooklangOutlets.REPORT_TOOLBAR, context) : [];
        return (
            <>
                <CooklangActionBar className='theia-cooklang-report-toolbar' items={items} onRun={this.handleRunToolbarItem} />
                {this.renderBody()}
            </>
        );
    }

    protected reportContext(): ReportOutletContext | undefined {
        if (!this.uri || !this.options) {
            return undefined;
        }
        const context: ReportOutletContext = {
            version: CooklangOutlets.VERSION,
            ...this.outlets.describe(this.uri),
            templateId: this.options.templateId,
            templateLabel: this.options.templateLabel,
            outputFormat: this.getOutputFormat(),
        };
        if (this.options.templateUri) {
            context.templateUri = this.options.templateUri;
        }
        if (this.output !== undefined && this.errorMessage === undefined) {
            context.output = this.output;
        }
        return context;
    }

    protected handleRunToolbarItem = (id: string): void => {
        const context = this.reportContext();
        if (context) {
            this.outlets.run(CooklangOutlets.REPORT_TOOLBAR, id, context);
        }
    };
```

Check how `this.uri` is set (`grep -n "this.uri =" report-widget.tsx`); if it is set in `setOptions`, the guard above is enough.

- [ ] **Step 2: CSS**

Append to `packages/cooklang/src/browser/style/report.css`:

```css
.theia-cooklang-report .theia-cooklang-report-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 8px 16px 0;
}
```

- [ ] **Step 3: Compile and test**

Run: `npx tsc -b packages/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: compiles, all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/report-widget.tsx packages/cooklang/src/browser/style/report.css
git commit -m "feat(cooklang): report toolbar outlet"
```

---

### Task 8: Extract ShoppingListGenerator

**Files:**
- Create: `packages/cooklang/src/browser/shopping-list-generator.ts`
- Create: `packages/cooklang/src/browser/shopping-list-generator.spec.ts`
- Modify: `packages/cooklang/src/browser/shopping-list-service.ts` (`computeResult` ~line 222, `readConfigFile` ~line 313, `getWorkspaceRootUri` ~line 100)
- Modify: `packages/cooklang/src/browser/shopping-list-service.spec.ts` (`makeService`)
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`
- Modify: `packages/cooklang/src/browser/recipe-reference-resolver.ts` (doc comment on `flattenReferences`)

- [ ] **Step 1: Write the failing test**

`packages/cooklang/src/browser/shopping-list-generator.spec.ts` (jsdom preamble first):

```ts
import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { ShoppingListGenerator } from './shopping-list-generator';

after(() => disableJSDOM());

class Fakes {
    files = new Map<string, string>();
    recipes = new Map<string, string>();
    generateCalls: Array<{ recipes: unknown; aisle: string | null; pantry: string | null }> = []; // eslint-disable-line no-null/no-null
    roots: URI[] = [new URI('file:///ws')];

    create(): ShoppingListGenerator {
        const generator = new ShoppingListGenerator();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (generator as any).workspaceService = { tryGetRoots: () => this.roots.map(resource => ({ resource })) };
        (generator as any).fileService = {
            read: async (uri: URI) => {
                const value = this.files.get(uri.toString());
                if (value === undefined) { throw new Error('ENOENT'); }
                return { value };
            },
        };
        (generator as any).languageService = {
            findRecipe: async (_baseDir: string, name: string) => this.recipes.get(name),
            generateShoppingList: async (recipes: string, aisle: string | null, pantry: string | null) => { // eslint-disable-line no-null/no-null
                this.generateCalls.push({ recipes: JSON.parse(recipes), aisle, pantry });
                return JSON.stringify({ categories: [], other: { name: 'other', items: [] }, pantryItems: [] });
            },
        };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return generator;
    }
}

describe('ShoppingListGenerator', () => {
    it('reads each recipe through cooklang-find and passes the aisle and pantry config', async () => {
        const fakes = new Fakes();
        fakes.recipes.set('Soup.cook', 'soup');
        fakes.recipes.set('Bread', 'bread');
        fakes.files.set('file:///ws/config/aisle.conf', '[produce]');
        const result = await fakes.create().computeResult([{ path: 'Soup.cook', scale: 2 }, { path: 'Bread', scale: 1 }]);
        expect(result.other.name).to.equal('other');
        expect(fakes.generateCalls).to.deep.equal([{
            recipes: [{ content: 'soup', scale: 2 }, { content: 'bread', scale: 1 }],
            aisle: '[produce]',
            pantry: null, // eslint-disable-line no-null/no-null
        }]);
    });

    it('skips recipes it cannot find', async () => {
        const fakes = new Fakes();
        fakes.recipes.set('Soup.cook', 'soup');
        await fakes.create().computeResult([{ path: 'Missing.cook', scale: 1 }, { path: 'Soup.cook', scale: 1 }]);
        expect(fakes.generateCalls[0].recipes).to.deep.equal([{ content: 'soup', scale: 1 }]);
    });

    it('throws without a workspace', async () => {
        const fakes = new Fakes();
        fakes.roots = [];
        let error: unknown;
        try { await fakes.create().computeResult([]); } catch (e) { error = e; }
        expect((error as Error).message).to.match(/workspace/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -b packages/cooklang`
Expected: FAIL — `Cannot find module './shopping-list-generator'`.

- [ ] **Step 3: Write the implementation**

`packages/cooklang/src/browser/shopping-list-generator.ts` — the body of `computeResult` and `readConfigFile` is moved verbatim from `ShoppingListService`:

```ts
/* eslint-disable no-null/no-null */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { ShoppingListResult } from '../common/shopping-list-types';

/**
 * Headless shopping-list aggregation over the first workspace root: resolves
 * each `{ path, scale }` through cooklang-find, reads `config/aisle.conf` and
 * `config/pantry.conf`, and runs the native `generateShoppingList`. Used by the
 * `cooklang.api.generateShoppingList` command and the Cookbot tool.
 */
@injectable()
export class ShoppingListGenerator {

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    getWorkspaceRootUri(): URI | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.length > 0 ? new URI(roots[0].resource.toString()) : undefined;
    }

    /**
     * Missing recipes are skipped with a warning. Throws when no workspace is
     * open or the native call fails.
     */
    async computeResult(items: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        const root = this.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open.');
        }
        const baseDir = root.path.fsPath();
        const recipeInputs: Array<{ content: string; scale: number }> = [];
        for (const { path, scale } of items) {
            try {
                // cooklang-find auto-resolves `.cook`/`.menu` for extension-less menu references.
                const content = await this.languageService.findRecipe(baseDir, path);
                if (content === undefined) {
                    console.warn(`[shopping-list] Recipe not found: ${path}`);
                    continue;
                }
                recipeInputs.push({ content, scale });
            } catch (e) {
                console.warn(`[shopping-list] Failed to read recipe ${path}:`, e);
            }
        }

        const aisleConf = await this.readConfigFile(root, 'config/aisle.conf');
        const pantryConf = await this.readConfigFile(root, 'config/pantry.conf');

        const json = await this.languageService.generateShoppingList(
            JSON.stringify(recipeInputs),
            aisleConf,
            pantryConf,
        );
        return JSON.parse(json);
    }

    protected async readConfigFile(root: URI, relativePath: string): Promise<string | null> {
        try {
            const content = await this.fileService.read(root.resolve(relativePath));
            return content.value;
        } catch {
            return null;
        }
    }
}
```

In `shopping-list-service.ts`:
- add `import { ShoppingListGenerator } from './shopping-list-generator';` and an injected field

```ts
    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;
```

- replace the body of `computeResult` with `return this.generator.computeResult(items);` (keep the method — the Cookbot tool still calls it until Task 10),
- delete `readConfigFile` from the service.

In `shopping-list-service.spec.ts` `makeService()`, after the service's fakes are assigned, add a generator wired to the same fakes:

```ts
    const generator = new ShoppingListGenerator();
    (generator as any).fileService = fs;
    (generator as any).languageService = ls;
    (generator as any).workspaceService = ws;
    (svc as any).generator = generator;
```

(and `import { ShoppingListGenerator } from './shopping-list-generator';`).

In `cooklang-frontend-module.ts` bind it next to `RecipeReferenceResolver`:

```ts
import { ShoppingListGenerator } from './shopping-list-generator';
// ...
    bind(ShoppingListGenerator).toSelf().inSingletonScope();
```

In `recipe-reference-resolver.ts` change the `flattenReferences` doc comment's "the shape `ShoppingListService.computeResult` expects" to "the shape `ShoppingListGenerator.computeResult` expects".

- [ ] **Step 4: Run tests**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/shopping-list-generator.spec.js lib/browser/shopping-list-service.spec.js lib/browser/generate-shopping-list-tool.spec.js`
Expected: PASS (3 new + all existing service and tool tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/shopping-list-generator.ts packages/cooklang/src/browser/shopping-list-generator.spec.ts packages/cooklang/src/browser/shopping-list-service.ts packages/cooklang/src/browser/shopping-list-service.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts packages/cooklang/src/browser/recipe-reference-resolver.ts
git commit -m "refactor(cooklang): move headless shopping-list aggregation into ShoppingListGenerator"
```

---

### Task 9: Cooklang plugin API commands

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Create: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the failing test**

`packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` (jsdom preamble first):

```ts
import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { CooklangPluginApi, CooklangPluginApiContribution } from './cooklang-plugin-api-contribution';

after(() => disableJSDOM());

type Handler = { execute: (...args: unknown[]) => unknown };

class Fixture {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: unknown[] = [];
    recipes = new Map<string, string>();
    resolveCalls: Array<{ content: string; baseDir: string }> = [];
    handlers = new Map<string, Handler>();
    labels = new Map<string, string | undefined>();
    keys: Array<{ key: string; value: unknown }> = [];

    create(): CooklangPluginApiContribution {
        const contribution = new CooklangPluginApiContribution();
        const rootOf = (): URI | undefined => this.root;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (contribution as any).generator = {
            getWorkspaceRootUri: rootOf,
            computeResult: async (items: unknown) => {
                this.computeCalls.push(items);
                return { categories: [], other: { name: 'other', items: [] }, pantryItems: [] };
            },
        };
        (contribution as any).resolver = {
            resolve: async (content: string, baseDir: string) => {
                this.resolveCalls.push({ content, baseDir });
                return [{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }];
            },
        };
        (contribution as any).languageService = {
            findRecipe: async (_baseDir: string, name: string) => this.recipes.get(name),
            parseShoppingList: async () => JSON.stringify({ items: [{ Recipe: { path: 'a.cook', multiplier: 2, children: [] } }] }),
            writeShoppingList: async (json: string) => `wrote ${json}`,
            parseChecked: async () => JSON.stringify([{ Checked: 'flour' }, { Unchecked: 'milk' }]),
            writeCheckEntry: async (json: string) => `${json}\n`,
            compactChecked: async (_entries: string, names: string[]) => JSON.stringify(names.map(name => ({ Checked: name }))),
        };
        (contribution as any).reportConfigService = {
            resolveWorkspaceUri: (arg: string) => {
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(arg) || arg.startsWith('/')) { return new URI(arg).normalizePath(); }
                return this.root ? this.root.resolve(arg).normalizePath() : undefined;
            },
        };
        (contribution as any).contextKeys = { createKey: (key: string, value: unknown) => { this.keys.push({ key, value }); } };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        contribution.registerCommands({
            registerCommand: (command: { id: string; label?: string }, handler: Handler) => {
                this.handlers.set(command.id, handler);
                this.labels.set(command.id, command.label);
            },
        } as never);
        return contribution;
    }

    async run(id: string, args?: unknown): Promise<unknown> {
        return this.handlers.get(id)!.execute(args);
    }

    async error(id: string, args?: unknown): Promise<string> {
        try {
            await this.run(id, args);
        } catch (e) {
            return (e as Error).message;
        }
        throw new Error(`${id} did not reject`);
    }
}

describe('CooklangPluginApiContribution', () => {
    it('registers every API command without a label, so none shows in the palette', () => {
        const fixture = new Fixture();
        fixture.create();
        expect([...fixture.handlers.keys()]).to.have.members(Object.values(CooklangPluginApi.Commands));
        expect([...fixture.labels.values()].every(label => label === undefined)).to.equal(true);
    });

    it('reports the API version and sets the cooklang.apiVersion context key on start', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        contribution.onStart();
        expect(await fixture.run(CooklangPluginApi.Commands.VERSION)).to.equal(1);
        expect(fixture.keys).to.deep.equal([{ key: 'cooklang.apiVersion', value: 1 }]);
    });

    it('generates a shopping list with workspace-relative paths and default scale 1', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST, {
            recipes: [{ path: 'file:///ws/Dinner/Soup.cook', scale: 2 }, { path: 'Bread' }],
        });
        expect(fixture.computeCalls).to.deep.equal([[{ path: 'Dinner/Soup.cook', scale: 2 }, { path: 'Bread', scale: 1 }]]);
    });

    it('rejects bad generate arguments, paths outside the workspace and a missing workspace', async () => {
        const fixture = new Fixture();
        fixture.create();
        const id = CooklangPluginApi.Commands.GENERATE_SHOPPING_LIST;
        expect(await fixture.error(id, undefined)).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: 'Soup.cook' })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: [{ path: 'Soup.cook', scale: 0 }] })).to.match(/^Invalid arguments/);
        expect(await fixture.error(id, { recipes: [{ path: '../Out.cook' }] })).to.equal('Path is outside the workspace: ../Out.cook');
        fixture.root = undefined;
        expect(await fixture.error(id, { recipes: [{ path: 'Soup.cook' }] })).to.equal('No workspace is open.');
        expect(fixture.computeCalls).to.deep.equal([]);
    });

    it('resolves recipe references as a tree', async () => {
        const fixture = new Fixture();
        fixture.create();
        fixture.recipes.set('Dinner.cook', 'dinner');
        const refs = await fixture.run(CooklangPluginApi.Commands.RESOLVE_RECIPE_REFERENCES, { path: 'Dinner.cook' });
        expect(refs).to.deep.equal([{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }]);
        expect(fixture.resolveCalls).to.deep.equal([{ content: 'dinner', baseDir: '/ws' }]);
        expect(await fixture.error(CooklangPluginApi.Commands.RESOLVE_RECIPE_REFERENCES, { path: 'Nope.cook' }))
            .to.equal('Recipe not found: Nope.cook');
    });

    it('parses and writes the shopping list in the editor shape, not the wire shape', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_SHOPPING_LIST, { text: 'x' }))
            .to.deep.equal({ items: [{ type: 'recipe', path: 'a.cook', multiplier: 2, children: [] }] });
        expect(await fixture.run(CooklangPluginApi.Commands.WRITE_SHOPPING_LIST, {
            list: { items: [{ type: 'recipe', path: 'a.cook', children: [] }] },
        })).to.equal('wrote {"items":[{"Recipe":{"path":"a.cook","multiplier":null,"children":[]}}]}');
    });

    it('parses, writes and compacts the checked log', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(CooklangPluginApi.Commands.PARSE_SHOPPING_CHECKED, { text: 'x' }))
            .to.deep.equal([{ type: 'checked', name: 'flour' }, { type: 'unchecked', name: 'milk' }]);
        expect(await fixture.run(CooklangPluginApi.Commands.WRITE_SHOPPING_CHECKED, {
            entries: [{ type: 'checked', name: 'flour' }, { type: 'unchecked', name: 'milk' }],
        })).to.equal('{"Checked":"flour"}\n{"Unchecked":"milk"}\n');
        expect(await fixture.run(CooklangPluginApi.Commands.COMPACT_SHOPPING_CHECKED, {
            entries: [{ type: 'checked', name: 'flour' }], ingredients: ['flour'],
        })).to.deep.equal([{ type: 'checked', name: 'flour' }]);
        expect(await fixture.error(CooklangPluginApi.Commands.WRITE_SHOPPING_CHECKED, { entries: [{ type: 'maybe', name: 'x' }] }))
            .to.match(/^Invalid arguments/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -b packages/cooklang`
Expected: FAIL — `Cannot find module './cooklang-plugin-api-contribution'`.

- [ ] **Step 3: Write the implementation**

`packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`:

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import {
    CheckEntry,
    ShoppingListFile,
    ShoppingListResult,
    fromWireCheckedLog,
    fromWireShoppingList,
    toWireCheckEntryJson,
    toWireCheckedLog,
    toWireShoppingList,
} from '../common/shopping-list-types';
import { ShoppingListGenerator } from './shopping-list-generator';
import { RecipeReferenceResolver, ResolvedRecipeReference } from './recipe-reference-resolver';
import { ReportConfigService } from './report-config-service';

/**
 * The public Cooklang API for plugins: label-less commands (hidden from the
 * palette) that plugins call with `vscode.commands.executeCommand(id, args)`.
 * Arguments and results are plain JSON; paths are workspace-relative (absolute
 * paths and `file://` URIs inside the workspace are accepted). Version 1 —
 * changes are additive; bump `VERSION` for anything breaking.
 */
export namespace CooklangPluginApi {
    export const VERSION = 1;
    export const CONTEXT_KEY = 'cooklang.apiVersion';
    export const Commands = {
        VERSION: 'cooklang.api.version',
        GENERATE_SHOPPING_LIST: 'cooklang.api.generateShoppingList',
        RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
        PARSE_SHOPPING_LIST: 'cooklang.api.parseShoppingList',
        WRITE_SHOPPING_LIST: 'cooklang.api.writeShoppingList',
        PARSE_SHOPPING_CHECKED: 'cooklang.api.parseShoppingChecked',
        WRITE_SHOPPING_CHECKED: 'cooklang.api.writeShoppingChecked',
        COMPACT_SHOPPING_CHECKED: 'cooklang.api.compactShoppingChecked',
    } as const;
}

@injectable()
export class CooklangPluginApiContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;

    @inject(RecipeReferenceResolver)
    protected readonly resolver: RecipeReferenceResolver;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(ContextKeyService)
    protected readonly contextKeys: ContextKeyService;

    onStart(): void {
        this.contextKeys.createKey<number>(CooklangPluginApi.CONTEXT_KEY, CooklangPluginApi.VERSION);
    }

    registerCommands(registry: CommandRegistry): void {
        const { Commands } = CooklangPluginApi;
        registry.registerCommand({ id: Commands.VERSION }, { execute: () => CooklangPluginApi.VERSION });
        registry.registerCommand({ id: Commands.GENERATE_SHOPPING_LIST }, { execute: (args: unknown) => this.generateShoppingList(args) });
        registry.registerCommand({ id: Commands.RESOLVE_RECIPE_REFERENCES }, { execute: (args: unknown) => this.resolveRecipeReferences(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_LIST }, { execute: (args: unknown) => this.parseShoppingList(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_LIST }, { execute: (args: unknown) => this.writeShoppingList(args) });
        registry.registerCommand({ id: Commands.PARSE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.parseShoppingChecked(args) });
        registry.registerCommand({ id: Commands.WRITE_SHOPPING_CHECKED }, { execute: (args: unknown) => this.writeShoppingChecked(args) });
        registry.registerCommand({ id: Commands.COMPACT_SHOPPING_CHECKED }, { execute: (args: unknown) => this.compactShoppingChecked(args) });
    }

    protected async generateShoppingList(args: unknown): Promise<ShoppingListResult> {
        const recipes = this.object(args).recipes;
        if (!Array.isArray(recipes)) {
            throw this.invalid('`recipes` must be an array of { path, scale? }.');
        }
        const items = recipes.map(entry => {
            const recipe = this.object(entry);
            const path = this.string(recipe.path, '`path`');
            const scale = recipe.scale === undefined ? 1 : recipe.scale;
            if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
                throw this.invalid(`Recipe scale must be a positive number: ${path}`);
            }
            return { path, scale };
        });
        const normalised = items.map(item => ({ path: this.workspacePath(item.path), scale: item.scale }));
        return this.generator.computeResult(normalised);
    }

    protected async resolveRecipeReferences(args: unknown): Promise<ResolvedRecipeReference[]> {
        const requested = this.string(this.object(args).path, '`path`');
        const path = this.workspacePath(requested);
        const baseDir = this.root().path.fsPath();
        const content = await this.languageService.findRecipe(baseDir, path);
        if (content === undefined) {
            throw new Error(`Recipe not found: ${requested}`);
        }
        return this.resolver.resolve(content, baseDir);
    }

    protected async parseShoppingList(args: unknown): Promise<ShoppingListFile> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireShoppingList(await this.languageService.parseShoppingList(text));
    }

    protected async writeShoppingList(args: unknown): Promise<string> {
        const list = this.object(this.object(args).list);
        if (!Array.isArray(list.items)) {
            throw this.invalid('`list.items` must be an array.');
        }
        return this.languageService.writeShoppingList(toWireShoppingList(list as unknown as ShoppingListFile));
    }

    protected async parseShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const text = this.text(this.object(args).text, '`text`');
        return fromWireCheckedLog(await this.languageService.parseChecked(text));
    }

    protected async writeShoppingChecked(args: unknown): Promise<string> {
        const entries = this.entries(this.object(args).entries);
        const lines: string[] = [];
        for (const entry of entries) {
            // Every line ends with '\n' (the Rust writer uses writeln!).
            lines.push(await this.languageService.writeCheckEntry(toWireCheckEntryJson(entry)));
        }
        return lines.join('');
    }

    protected async compactShoppingChecked(args: unknown): Promise<CheckEntry[]> {
        const request = this.object(args);
        const entries = this.entries(request.entries);
        const ingredients = request.ingredients;
        if (!Array.isArray(ingredients) || !ingredients.every(name => typeof name === 'string')) {
            throw this.invalid('`ingredients` must be an array of strings.');
        }
        return fromWireCheckedLog(await this.languageService.compactChecked(toWireCheckedLog(entries), ingredients));
    }

    // --- argument helpers ---

    protected root(): URI {
        const root = this.generator.getWorkspaceRootUri();
        if (!root) {
            throw new Error('No workspace is open.');
        }
        return root;
    }

    /** Workspace-relative form of a path or URI inside the workspace. */
    protected workspacePath(path: string): string {
        const root = this.root();
        const uri = this.reportConfigService.resolveWorkspaceUri(path);
        const relative = uri && root.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        if (!relative) {
            throw new Error(`Path is outside the workspace: ${path}`);
        }
        return relative;
    }

    protected object(value: unknown): Record<string, unknown> {
        if (typeof value !== 'object' || value === undefined || value === null || Array.isArray(value)) { // eslint-disable-line no-null/no-null
            throw this.invalid('expected a JSON object.');
        }
        return value as Record<string, unknown>;
    }

    protected string(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw this.invalid(`${name} must be a non-empty string.`);
        }
        return value.trim();
    }

    protected text(value: unknown, name: string): string {
        if (typeof value !== 'string') {
            throw this.invalid(`${name} must be a string.`);
        }
        return value;
    }

    protected entries(value: unknown): CheckEntry[] {
        if (!Array.isArray(value)) {
            throw this.invalid('`entries` must be an array.');
        }
        return value.map(entry => {
            const candidate = this.object(entry);
            if ((candidate.type !== 'checked' && candidate.type !== 'unchecked') || typeof candidate.name !== 'string') {
                throw this.invalid('each entry must be { type: "checked" | "unchecked", name }.');
            }
            return { type: candidate.type, name: candidate.name };
        });
    }

    protected invalid(detail: string): Error {
        return new Error(`Invalid arguments: ${detail}`);
    }
}
```

In `cooklang-frontend-module.ts`:

```ts
import { CooklangPluginApiContribution } from './cooklang-plugin-api-contribution';
// ...
    bind(CooklangPluginApiContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CooklangPluginApiContribution);
    bind(FrontendApplicationContribution).toService(CooklangPluginApiContribution);
```

- [ ] **Step 4: Run tests**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js`
Expected: PASS, 7 passing. Then `npx lerna run test --scope @theia/cooklang` — all pass.

- [ ] **Step 5: Lint, build the app, smoke-check**

Run: `npx lerna run lint --scope @theia/cooklang` — expected: no errors.
Run: `cd app && npm run bundle` — expected: webpack completes.
Quit any running Cook Editor.app, then: `cd app && npm run start -- --remote-debugging-port=9222 "<a recipes folder>"`. Open a recipe preview: the Show Source button still appears (now via the outlet) and opens the source; the old cart button still works. Open the command palette and type `cooklang.api` — nothing is listed.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): public cooklang.api.* commands for plugins"
```

**Checkpoint:** stop here and execute the plugin plan (`2026-09-24-shopping-list-plugin.md`) against this build. Continue with Task 10 only after `cooklang.shopping-list@0.1.0` is published to plugins.cook.md.

---

### Task 10: Remove the built-in shopping list; Cookbot adds through the plugin

**Files:**
- Modify: `packages/cooklang/src/browser/generate-shopping-list-tool.ts`
- Modify: `packages/cooklang/src/browser/generate-shopping-list-tool.spec.ts`
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx`, `recipe-preview-widget.tsx`, `menu-preview-components.tsx`, `menu-preview-widget.tsx`
- Modify: `packages/cooklang/src/browser/style/recipe-preview.css`, `style/menu-preview.css`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`
- Delete: `shopping-list-service.ts`, `shopping-list-service.spec.ts`, `shopping-list-widget.tsx`, `shopping-list-components.tsx`, `shopping-list-contribution.ts`, `style/shopping-list.css` (all in `packages/cooklang/src/browser/`)

- [ ] **Step 1: Rewrite the tool spec's fakes and `addToList` tests (failing)**

In `generate-shopping-list-tool.spec.ts`:

1. Update the header comment: the tool no longer imports `ShoppingListContribution`; keep the jsdom preamble (it still imports `ReportConfigService`).

2. Replace `class FakeShoppingListService` and `class FakeContribution` with:

```ts
class FakeGenerator {
    root: URI | undefined = new URI('file:///ws');
    computeCalls: PathScale[][] = [];
    /** When set, `computeResult` throws this. */
    computeError: Error | undefined;
    getWorkspaceRootUri(): URI | undefined { return this.root; }
    async computeResult(items: PathScale[]): Promise<ShoppingListResult> {
        if (this.computeError) { throw this.computeError; }
        this.computeCalls.push(items);
        return RESULT;
    }
}

/** Stands in for the Shopping List plugin's `shoppingList.addRecipes` command. */
class FakeCommands {
    installed = true;
    calls: unknown[] = [];
    live: ShoppingListResult | undefined = LIVE_RESULT;
    getCommand(id: string): { id: string } | undefined {
        return this.installed && id === 'shoppingList.addRecipes' ? { id } : undefined;
    }
    async executeCommand(id: string, args: unknown): Promise<unknown> {
        this.calls.push({ id, args });
        return this.live;
    }
}
```

   Delete `class EventLog` (no longer needed).

3. Replace `createTool` with:

```ts
function createTool(): { tool: GenerateShoppingListTool; gen: FakeGenerator; fs: FakeFileService; resolver: FakeResolver; commands: FakeCommands } {
    const tool = new GenerateShoppingListTool();
    const gen = new FakeGenerator();
    const fs = new FakeFileService();
    const resolver = new FakeResolver();
    const commands = new FakeCommands();
    const config = new FakeConfigService(() => gen.root);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).generator = gen;
    (tool as any).fileService = fs;
    (tool as any).referenceResolver = resolver;
    (tool as any).commandRegistry = commands;
    (tool as any).reportConfigService = config;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, gen, fs, resolver, commands };
}
```

4. In every remaining test: destructure `gen` instead of `svc` and use `gen.computeCalls`, `gen.computeError`, `gen.root`; replace every `svc.addRecipeCalls`/`svc.addMenuCalls`/`view.opened` assertion with `expect(commands.calls).to.deep.equal([]);` (destructure `commands`). Affected tests: "computes a headless list…", "expands a menu…", "rejects a non-boolean addToList", "rejects recipe and menu paths outside the workspace…", "errors before adding anything when a recipe is missing", "errors when the menu is missing…".

5. Replace the four `addToList` tests ("addToList adds each recipe…", "addToList adds several recipes…", "addToList with a menu…", "addToList returns an empty list shape…") with:

```ts
    it('addToList hands the recipes to the Shopping List plugin and returns its live list', async () => {
        const { tool, gen, fs, commands } = createTool();
        fs.files.set('file:///ws/Pie.cook', 'pie');
        fs.files.set('file:///ws/Dinner/Carbonara.cook', 'carbonara');
        const result = await invoke(tool, { recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'file:///ws/Dinner/Carbonara.cook' }], addToList: true });
        expect(commands.calls).to.deep.equal([{
            id: 'shoppingList.addRecipes',
            args: { recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'Dinner/Carbonara.cook', scale: 1 }] },
        }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pie.cook', scale: 2 }, { path: 'Dinner/Carbonara.cook', scale: 1 }] });
        expect(gen.computeCalls).to.deep.equal([]);
    });

    it('addToList with a menu hands the menu path to the plugin', async () => {
        const { tool, fs, resolver, commands } = createTool();
        fs.files.set('file:///ws/Plans/Week.menu', 'menu');
        resolver.refs.set('menu', [{ path: 'Pancakes', scale: 2 }]);
        const result = await invoke(tool, { menu: 'Plans/Week.menu', addToList: true });
        expect(commands.calls).to.deep.equal([{ id: 'shoppingList.addRecipes', args: { menu: 'Plans/Week.menu' } }]);
        expect(result).to.deep.equal({ ...LIVE_RESULT, added: true, recipes: [{ path: 'Pancakes', scale: 2 }] });
    });

    it('addToList returns an empty list shape when the plugin has not computed a list yet', async () => {
        const { tool, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        commands.live = undefined;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({
            categories: [], other: { name: 'other', items: [] }, pantryItems: [],
            added: true, recipes: [{ path: 'Soup.cook', scale: 1 }],
        });
    });

    it('addToList explains that the Shopping List plugin is missing', async () => {
        const { tool, fs, commands } = createTool();
        fs.files.set('file:///ws/Soup.cook', 'y');
        commands.installed = false;
        const result = await invoke(tool, { recipes: [{ path: 'Soup.cook' }], addToList: true });
        expect(result).to.deep.equal({ error: 'The Shopping List plugin is not installed or is disabled.' });
        expect(commands.calls).to.deep.equal([]);
    });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx tsc -b packages/cooklang && cd packages/cooklang && npx mocha --config ../../configs/mocharc.yml lib/browser/generate-shopping-list-tool.spec.js`
Expected: FAIL — the tool still reads `shoppingListService` (TypeError on `undefined`).

- [ ] **Step 3: Update the tool**

In `generate-shopping-list-tool.ts`:

1. Imports: remove `ShoppingListService` and `ShoppingListContribution`; add

```ts
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ShoppingListGenerator } from './shopping-list-generator';
```

2. Constants below `EMPTY_RESULT`:

```ts
/** Contributed by the `cooklang.shopping-list` plugin. */
const ADD_RECIPES_COMMAND = 'shoppingList.addRecipes';
const PLUGIN_MISSING = 'The Shopping List plugin is not installed or is disabled.';
```

3. Replace the `shoppingListService` and `shoppingListContribution` injections with:

```ts
    @inject(ShoppingListGenerator)
    protected readonly generator: ShoppingListGenerator;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;
```

4. In `execute`, `this.shoppingListService.getWorkspaceRootUri()` → `this.generator.getWorkspaceRootUri()`.

5. In `fromRecipes`, resolve references only for the headless path, and replace the `addToList` branch:

```ts
            const refs = addToList ? [] : await this.referenceResolver.resolve(file.content, baseDir);
            inputs.push({ path: file.path, scale, refs });
```

```ts
        const summary = inputs.map(({ path, scale }) => ({ path, scale }));
        if (addToList) {
            return this.addToLiveList({ recipes: summary }, summary);
        }
```

   and `this.shoppingListService.computeResult(flat)` → `this.generator.computeResult(flat)`.

6. In `fromMenu` replace the `addToList` branch and the compute call:

```ts
        if (addToList) {
            return this.addToLiveList({ menu: file.path }, recipes);
        }

        const flat = [{ path: file.path, scale: 1 }, ...flattenReferences(recipes)];
        const result = await this.generator.computeResult(flat);
```

   (Keep whatever `flat` expression the file has today; only the receiver changes.)

7. Replace `currentResult()` with:

```ts
    /** Adds through the Shopping List plugin and returns its live list. */
    protected async addToLiveList(request: object, recipes: unknown): Promise<string> {
        if (!this.commandRegistry.getCommand(ADD_RECIPES_COMMAND)) {
            return this.fail(PLUGIN_MISSING);
        }
        const live = await this.commandRegistry.executeCommand<ShoppingListResult>(ADD_RECIPES_COMMAND, request);
        return JSON.stringify({ ...(live ?? EMPTY_RESULT), added: true, recipes });
    }
```

8. Update the class doc comment: "Headless by default; `addToList: true` hands the recipes to the Shopping List plugin (`shoppingList.addRecipes`), which adds them to the live list and reveals its view."

- [ ] **Step 4: Remove the built-in shopping list**

```bash
cd packages/cooklang/src/browser
git rm shopping-list-service.ts shopping-list-service.spec.ts shopping-list-widget.tsx shopping-list-components.tsx shopping-list-contribution.ts style/shopping-list.css
```

In `cooklang-frontend-module.ts`: remove the imports of `ShoppingListWidget`, `SHOPPING_LIST_WIDGET_ID`, `ShoppingListService`, `ShoppingListContribution`, and in the `// Shopping list` block delete the `ShoppingListService` binding, the `ShoppingListWidget` binding and its `WidgetFactory`, and the three `ShoppingListContribution` lines. Keep `RecipeReferenceResolver`, `RecipeNavigator` and `ShoppingListGenerator`; rename the comment to `// Shopping-list aggregation (plugin API + Cookbot)`. Remove now-unused imports (`bindViewContribution`, `TabBarToolbarContribution`, `WidgetFactory`) only if nothing else in the file uses them.

In `recipe-preview-components.tsx` remove `onAddToShoppingList` from `RecipeViewProps`, from the `RecipeView` destructuring, and delete the `{onAddToShoppingList && (...)}` cart button. In `recipe-preview-widget.tsx` delete `handleAddToShoppingList` and the `onAddToShoppingList={...}` prop. Do the same in `menu-preview-components.tsx` / `menu-preview-widget.tsx`.

Delete the `.recipe-add-shopping-list` rules from `style/recipe-preview.css` (keep the `.recipe-show-source` rules only if something still uses that class — `grep -rn "recipe-show-source" packages/cooklang/src`; delete them too if unused) and the `.menu-add-shopping-list` rules from `style/menu-preview.css` (same check).

- [ ] **Step 5: Verify nothing references the removed code**

Run: `grep -rn "ShoppingListService\|ShoppingListContribution\|ShoppingListWidget\|shopping-list-widget\|theia-shopping-cart-icon\|addToShoppingList\|addMenuToShoppingList\|toggleShoppingList" packages app --include=*.ts --include=*.tsx --include=*.css --include=*.json | grep -v node_modules | grep -v "/lib/"`
Expected: no output.

- [ ] **Step 6: Compile, test, lint**

Run: `npx tsc -b packages/cooklang && npx lerna run test --scope @theia/cooklang && npx lerna run lint --scope @theia/cooklang`
Expected: all green; `generate-shopping-list-tool.spec` includes the four new `addToList` tests.

- [ ] **Step 7: Commit**

```bash
git add -A packages/cooklang
git commit -m "feat(cooklang)!: shopping list moves to the cooklang.shopping-list plugin

The built-in service, view and commands are removed. The Cookbot
generateShoppingList tool keeps its headless mode and adds to the live
list through the plugin's shoppingList.addRecipes command."
```

---

### Task 11: Ship the plugin by default

**Files:**
- Modify: `package.json` (root, `theiaPlugins`)

- [ ] **Step 1: Find the published .vsix URL**

Run: `curl -sI https://plugins.cook.md/api/cooklang/shopping-list/0.1.0/file/cooklang.shopping-list-0.1.0.vsix | head -1`
Expected: `HTTP/2 200` (or a 302 to storage). If it is 404, get the real download URL from `curl -s https://plugins.cook.md/api/cooklang/shopping-list/0.1.0 | python3 -m json.tool | grep -i download` and use that.

- [ ] **Step 2: Pin it**

In the root `package.json`, add to `theiaPlugins` (after `samuelcolvin.jinjahtml`):

```json
    "cooklang.shopping-list": "https://plugins.cook.md/api/cooklang/shopping-list/0.1.0/file/cooklang.shopping-list-0.1.0.vsix"
```

- [ ] **Step 3: Download and verify**

Run: `npm run download:plugins && ls plugins | grep shopping`
Expected: `cooklang.shopping-list` is listed.

- [ ] **Step 4: End-to-end check in the app**

Quit Cook Editor.app. Make sure no dev copy is left: `ls plugins/cooklang.shopping-list/package.json` should show the downloaded version (`grep '"version"' plugins/cooklang.shopping-list/package.json` → `0.1.0`). Then `cd app && npm run bundle && npm run start -- --remote-debugging-port=9222 "<a recipes folder with config/aisle.conf>"` and check, by hand or with the CDP script from the plugin plan's Task 8:

1. The activity bar shows the Shopping List cart; the view lists any existing `.shopping-list` entries unchanged.
2. Recipe preview header: cart button (plugin) then Show Source. Clicking the cart adds the recipe with its scale and reveals the view.
3. Menu preview header: cart adds the whole menu.
4. Explorer right-click on a `.cook` / `.menu`: "Add to Shopping List" / "Add Menu to Shopping List".
5. Checking an item strikes it through and appends to `.shopping-checked`.
6. Cookbot: "add Carbonara to my shopping list" → the tool reports `added: true`; the item appears in the view.
7. Disable the plugin in the Extensions view: the cart buttons disappear from both previews; Cookbot's `addToList` returns the "not installed or is disabled" error.

- [ ] **Step 5: Commit and open the PR**

```bash
git add package.json
git commit -m "feat(app): ship cooklang.shopping-list as a default plugin"
git push -u origin feature/plugin-outlets
gh pr create --title "Plugin outlets, Cooklang plugin API, shopping list as a default plugin" --body "$(cat <<'EOF'
## Summary
- Five outlets plugins can contribute to with `contributes.menus`: recipe/menu preview toolbars, ingredient and menu-recipe context menus, report toolbar. Show Source now goes through the preview toolbar outlet.
- `cooklang.api.*` commands (version, generate shopping list, resolve references, read/write `.shopping-list` and `.shopping-checked`) and the `cooklang.apiVersion` context key.
- The built-in shopping list is removed; `cooklang.shopping-list@0.1.0` from plugins.cook.md ships by default. Existing `.shopping-list` files keep working. Cookbot's `addToList` goes through the plugin.

Spec: docs/superpowers/specs/2026-09-24-shopping-list-plugin-design.md
Docs: https://cook.md/help/plugins

## Test plan
- [ ] `npx lerna run test --scope @theia/cooklang`
- [ ] E2E checklist in plan Task 11 Step 4
EOF
)"
```

---

## Self-review notes

- Spec Part 1 → Tasks 8–9; Part 2 → Tasks 1–7; Part 4 → Tasks 10–11; Part 3 → plugin plan; Part 5 → cook.md plan.
- Outlet ids, command ids (`cooklang.api.*`, `shoppingList.addRecipes`) and context field names match the spec tables and the plugin plan.
- Known limitation (documented in the spec): outlet `when` clauses are evaluated when the widget re-renders; context-key changes alone do not re-render previews.
