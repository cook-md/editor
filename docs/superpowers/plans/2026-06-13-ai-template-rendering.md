# AI-Authored Template Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Cookbot AI a `renderTemplate` tool that renders an AI-authored Jinja2 report template against a `.cook`/`.menu` file during the agentic loop, returning the output (to compute answers, validate templates, or present finished reports), plus a server-side `report-authoring` skill that teaches the model how to use it.

**Architecture:** A new client-side `ToolProvider` (`renderTemplate`) in `@theia/cooklang` wraps the existing `CooklangLanguageService.renderReport` RPC (already accepts a template string → no native/proto change). Config assembly and active-recipe resolution are extracted from `ReportContribution` into an injectable `ReportConfigService`; the "open a Report tab" path is extracted into a `ReportPresenter`. Both extractions keep the tool's file monaco-free so it is unit-testable under this repo's test harness. The only server change is one new skill markdown wired into the skill registry.

**Tech Stack:** TypeScript, Theia (InversifyJS DI, `@theia/ai-core` `ToolProvider`), Mocha + Chai, Rust (cookbot server, `include_str!` skill embedding).

**Design spec:** `docs/superpowers/specs/2026-06-13-ai-template-rendering-design.md`

---

## File Structure

**Editor (`/Users/alexeydubovskoy/Cooklang/editor`, package `packages/cooklang`):**
- Create `src/browser/report-widget-types.ts` — monaco-free `REPORT_WIDGET_ID`, `ReportWidgetOptions`, `createReportWidgetId` (extracted from `report-widget.tsx`).
- Create `src/browser/report-config-service.ts` — `ReportConfigService`: `buildConfigJson(scale)` + active-recipe URI resolution.
- Create `src/browser/report-config-service.spec.ts` — unit tests (monaco-free).
- Create `src/browser/report-presenter.ts` — `ReportPresenter` symbol + interface (monaco-free).
- Create `src/browser/report-widget-presenter.ts` — `ReportWidgetPresenter` impl (imports the widget).
- Create `src/browser/render-template-tool.ts` — `RenderTemplateTool` `ToolProvider` (monaco-free).
- Create `src/browser/render-template-tool.spec.ts` — unit tests (monaco-free).
- Modify `src/browser/report-widget.tsx` — import types from `report-widget-types`; handle `inlineTemplateContent` + `outputFormat`.
- Modify `src/browser/report-contribution.ts` — delegate to `ReportConfigService` + `ReportPresenter`.
- Modify `src/browser/cooklang-frontend-module.ts` — bind the new service, presenter, and tool.
- Modify `package.json` — add `@theia/ai-core` dependency.

**Server (`/Users/alexeydubovskoy/Cooklang/cook.md/cookbot`):**
- Create `crates/server/prompts/skills/report-authoring.md`.
- Modify `crates/server/src/skills/mod.rs` — embed + register the skill.

---

## Task 1: Add `@theia/ai-core` dependency to `@theia/cooklang`

**Files:**
- Modify: `packages/cooklang/package.json`

- [ ] **Step 1: Add the dependency**

In `packages/cooklang/package.json`, in the `"dependencies"` object, add the `@theia/ai-core` entry (keep alphabetical grouping with the other `@theia/*` entries):

```json
    "@theia/ai-core": "1.70.0",
```

The dependencies block should then include (excerpt):

```json
    "@theia/ai-core": "1.70.0",
    "@theia/core": "1.70.0",
    "@theia/editor": "1.70.0",
```

- [ ] **Step 2: Install to create the workspace symlink**

Run (from repo root): `npm install`
Expected: completes without errors; `packages/cooklang/node_modules/@theia/ai-core` resolves (workspace symlink).

- [ ] **Step 3: Verify the import resolves**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && node -e "require.resolve('@theia/ai-core/lib/common', { paths: ['packages/cooklang'] }); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/package.json package-lock.json
git commit -m "build(cooklang): add @theia/ai-core dependency"
```

---

## Task 2: Extract monaco-free report widget types and add inline-template support

**Why:** `RenderTemplateTool` and `ReportPresenter` must reference `ReportWidgetOptions`, `REPORT_WIDGET_ID`, and `createReportWidgetId` without importing `report-widget.tsx` (which pulls `@theia/monaco` and breaks the spec harness). Moving these into a monaco-free file fixes that and is where the two new option fields land.

**Files:**
- Create: `packages/cooklang/src/browser/report-widget-types.ts`
- Modify: `packages/cooklang/src/browser/report-widget.tsx`
- Modify: `packages/cooklang/src/browser/report-contribution.ts:27` (import line)

- [ ] **Step 1: Create the monaco-free types file**

Create `packages/cooklang/src/browser/report-widget-types.ts`:

```typescript
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

import URI from '@theia/core/lib/common/uri';
import { ReportOutputFormat } from '../common';

export const REPORT_WIDGET_ID = 'cooklang-report-widget';

export interface ReportWidgetOptions {
    /** URI string of the source `.cook` or `.menu` file. */
    uri: string;
    /** Template id: `builtin:*`, `workspace:<template uri>`, or `inline:*`. */
    templateId: string;
    /** Human-readable template name for the tab title. */
    templateLabel: string;
    /** URI string of a workspace template file; unset for built-ins/inline. */
    templateUri?: string;
    /**
     * Inline template content. When set, the widget renders this string
     * directly instead of reading a file or built-in (used by AI-authored
     * ephemeral templates).
     */
    inlineTemplateContent?: string;
    /**
     * Explicit output format. When set, overrides filename-based detection
     * (inline templates have no filename to infer from).
     */
    outputFormat?: ReportOutputFormat;
    /** Render config (scale + URI-string paths), passed through to the RPC. */
    configJson: string;
}

/**
 * Constructs a unique widget ID for a report tab tied to a recipe + template.
 */
export function createReportWidgetId(uri: URI, templateId: string): string {
    return `${REPORT_WIDGET_ID}:${templateId}:${uri.toString()}`;
}
```

- [ ] **Step 2: Re-point `report-widget.tsx` to the new types**

In `packages/cooklang/src/browser/report-widget.tsx`, delete the local definitions of `REPORT_WIDGET_ID`, `ReportWidgetOptions`, and `createReportWidgetId` (the block at lines 34-54, between the "Public constants and helpers" banner and the "ReportWidget" banner) and replace that block with a re-export so existing importers keep working:

```typescript
// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export { REPORT_WIDGET_ID, createReportWidgetId } from './report-widget-types';
export type { ReportWidgetOptions } from './report-widget-types';
```

Then add an import of the value/type near the other imports (after the `CooklangLanguageService` import on line 26):

```typescript
import { ReportWidgetOptions, REPORT_WIDGET_ID, createReportWidgetId } from './report-widget-types';
```

(`REPORT_WIDGET_ID` and `createReportWidgetId` are used by `setOptions`/`createReportWidgetId`; keep the re-export so `report-contribution.ts` and `cooklang-frontend-module.ts` continue to import from `./report-widget`.)

- [ ] **Step 3: Handle inline content and explicit format in the widget**

In `packages/cooklang/src/browser/report-widget.tsx`, replace `readTemplateContent()` (lines 179-193) so inline content wins:

```typescript
    protected async readTemplateContent(): Promise<string> {
        if (this.options.inlineTemplateContent !== undefined) {
            return this.options.inlineTemplateContent;
        }
        if (this.options.templateUri) {
            const model = this.monacoWorkspace.getTextDocument(this.options.templateUri);
            if (model) {
                return model.getText();
            }
            const content = await this.fileService.read(new URI(this.options.templateUri));
            return content.value;
        }
        const builtIn = ReportTemplates.byId(this.options.templateId);
        if (!builtIn) {
            throw new Error(`Unknown built-in report template: ${this.options.templateId}`);
        }
        return builtIn.content;
    }
```

And replace `getOutputFormat()` (lines 235-240) so an explicit format wins:

```typescript
    protected getOutputFormat(): ReportOutputFormat {
        if (this.options.outputFormat) {
            return this.options.outputFormat;
        }
        if (this.options.templateUri) {
            return ReportTemplates.outputFormat(new URI(this.options.templateUri).path.base);
        }
        return 'markdown';
    }
```

- [ ] **Step 4: Update the `report-contribution.ts` import line**

In `packages/cooklang/src/browser/report-contribution.ts`, line 27 currently imports from `./report-widget`. Leave it as-is for now (the re-export keeps it valid); it is rewritten in Task 4.

- [ ] **Step 5: Compile the package**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: compiles with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/report-widget-types.ts packages/cooklang/src/browser/report-widget.tsx
git commit -m "refactor(cooklang): extract report widget types, add inline template support"
```

---

## Task 3: Create `ReportConfigService` (TDD)

**Why:** Both `ReportContribution` and `RenderTemplateTool` need active-recipe resolution and config assembly. Extract into one monaco-free, unit-testable service.

**Files:**
- Create: `packages/cooklang/src/browser/report-config-service.ts`
- Test: `packages/cooklang/src/browser/report-config-service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/report-config-service.spec.ts`:

```typescript
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
import URI from '@theia/core/lib/common/uri';
import { ReportConfigService } from './report-config-service';

/** In-memory FileService stub — only `exists` is used by buildConfigJson. */
class FakeFileService {
    existing = new Set<string>();
    async exists(uri: { toString(): string }): Promise<boolean> {
        return this.existing.has(uri.toString());
    }
}

/** WorkspaceService stub returning a single root (or none). */
class FakeWorkspaceService {
    constructor(protected readonly root?: URI) { }
    tryGetRoots(): Array<{ resource: URI }> {
        return this.root ? [{ resource: this.root }] : [];
    }
}

function createService(root: URI | undefined, existing: string[] = []): {
    service: ReportConfigService;
    fileService: FakeFileService;
} {
    const fileService = new FakeFileService();
    existing.forEach(p => fileService.existing.add(p));
    const service = new ReportConfigService();
    // Property injection — assign the fakes the service actually uses.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (service as any).fileService = fileService;
    (service as any).workspaceService = new FakeWorkspaceService(root);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { service, fileService };
}

describe('ReportConfigService#buildConfigJson', () => {

    it('returns only the scale when there is no workspace root', async () => {
        const { service } = createService(undefined);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config).to.deep.equal({ scale: 1 });
    });

    it('respects the scale argument', async () => {
        const { service } = createService(undefined);
        const config = JSON.parse(await service.buildConfigJson(2.5));
        expect(config.scale).to.equal(2.5);
    });

    it('includes basePath but omits optional paths when files are absent', async () => {
        const root = new URI('file:///ws');
        const { service } = createService(root, []);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.basePath).to.equal(root.toString());
        expect(config.aislePath).to.equal(undefined);
        expect(config.pantryPath).to.equal(undefined);
        expect(config.datastorePath).to.equal(undefined);
    });

    it('includes aisle, pantry, and datastore paths when present', async () => {
        const root = new URI('file:///ws');
        const aisle = root.resolve('config/aisle.conf').toString();
        const pantry = root.resolve('config/pantry.conf').toString();
        const datastore = root.resolve('db').toString();
        const { service } = createService(root, [aisle, pantry, datastore]);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.aislePath).to.equal(aisle);
        expect(config.pantryPath).to.equal(pantry);
        expect(config.datastorePath).to.equal(datastore);
    });

    it('prefers db over config/db for the datastore', async () => {
        const root = new URI('file:///ws');
        const db = root.resolve('db').toString();
        const configDb = root.resolve('config/db').toString();
        const { service } = createService(root, [db, configDb]);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.datastorePath).to.equal(db);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: FAIL — TypeScript error, `Cannot find module './report-config-service'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/browser/report-config-service.ts`:

```typescript
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID } from '../common';

/**
 * Resolves the active recipe/menu URI and assembles the render config from
 * workspace conventions. Shared by the "Render Report" command and the
 * `renderTemplate` AI tool. Deliberately free of `@theia/monaco` imports so it
 * can be unit-tested under the repo's mocha harness.
 */
@injectable()
export class ReportConfigService {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    /**
     * Resolves the recipe URI from the focused widget, the current main-area
     * tab, or the active Cooklang text editor — in that order.
     */
    getActiveCooklangUri(): URI | undefined {
        return this.getCooklangResourceUri(this.shell.currentWidget)
            ?? this.getCooklangResourceUri(this.shell.getCurrentWidget('main'))
            ?? this.getActiveCooklangEditorUri();
    }

    /**
     * Returns the widget's resource URI when it is a navigatable showing a
     * `.cook` or `.menu` resource (text editor, recipe preview, report tab).
     */
    protected getCooklangResourceUri(widget: Widget | undefined): URI | undefined {
        if (NavigatableWidget.is(widget)) {
            const uri = widget.getResourceUri();
            if (uri && (uri.path.ext === '.cook' || uri.path.ext === '.menu')) {
                return uri;
            }
        }
        return undefined;
    }

    /**
     * Returns the URI of the active editor when its language is Cooklang,
     * or `undefined` otherwise.
     */
    protected getActiveCooklangEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const { languageId, uri } = editorWidget.editor.document;
        if (languageId !== COOKLANG_LANGUAGE_ID) {
            return undefined;
        }
        return new URI(uri);
    }

    /**
     * Builds the render config from workspace conventions. Paths are sent as
     * URI strings; the backend converts them to filesystem paths.
     */
    async buildConfigJson(scale: number = 1): Promise<string> {
        const config: {
            scale: number;
            basePath?: string;
            aislePath?: string;
            pantryPath?: string;
            datastorePath?: string;
        } = { scale };
        const root = this.workspaceService.tryGetRoots()[0];
        if (root) {
            config.basePath = root.resource.toString();
            const aisle = root.resource.resolve('config/aisle.conf');
            const pantry = root.resource.resolve('config/pantry.conf');
            const datastores = [root.resource.resolve('db'), root.resource.resolve('config/db')];
            const [hasAisle, hasPantry, ...hasDatastores] = await Promise.all([
                this.fileService.exists(aisle),
                this.fileService.exists(pantry),
                ...datastores.map(candidate => this.fileService.exists(candidate)),
            ]);
            if (hasAisle) {
                config.aislePath = aisle.toString();
            }
            if (hasPantry) {
                config.pantryPath = pantry.toString();
            }
            const datastore = datastores.find((candidate, index) => hasDatastores[index]);
            if (datastore) {
                config.datastorePath = datastore.toString();
            }
        }
        return JSON.stringify(config);
    }
}
```

- [ ] **Step 4: Compile and run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: PASS — the `ReportConfigService#buildConfigJson` suite (5 tests) passes; existing suites still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/report-config-service.ts packages/cooklang/src/browser/report-config-service.spec.ts
git commit -m "feat(cooklang): add ReportConfigService for shared config assembly"
```

---

## Task 4: Add `ReportPresenter` and refactor `ReportContribution`

**Why:** The "open/refresh a Report tab" path must be reusable by `RenderTemplateTool` without importing the monaco-backed widget into the tool. Extract it behind a symbol+interface (the documented exception to "classes over interfaces" — it lets the tool depend on the abstraction, not the monaco impl). Then refactor `ReportContribution` to use both `ReportConfigService` and `ReportPresenter`.

**Files:**
- Create: `packages/cooklang/src/browser/report-presenter.ts`
- Create: `packages/cooklang/src/browser/report-widget-presenter.ts`
- Modify: `packages/cooklang/src/browser/report-contribution.ts` (full rewrite below)
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Create the presenter abstraction (monaco-free)**

Create `packages/cooklang/src/browser/report-presenter.ts`:

```typescript
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

import { ReportWidgetOptions } from './report-widget-types';

export const ReportPresenter = Symbol('ReportPresenter');

/**
 * Opens or refreshes a report tab for the given options and activates it.
 * Abstracted behind a symbol so consumers (e.g. the `renderTemplate` tool) can
 * depend on it without importing the monaco-backed report widget.
 */
export interface ReportPresenter {
    show(options: ReportWidgetOptions): Promise<void>;
}
```

- [ ] **Step 2: Create the presenter implementation**

Create `packages/cooklang/src/browser/report-widget-presenter.ts`:

```typescript
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { ReportPresenter } from './report-presenter';
import { ReportWidgetOptions, REPORT_WIDGET_ID, createReportWidgetId } from './report-widget-types';
import { ReportWidget } from './report-widget';

@injectable()
export class ReportWidgetPresenter implements ReportPresenter {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    async show(options: ReportWidgetOptions): Promise<void> {
        const widget = await this.getOrCreateReport(options);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    /**
     * Returns an existing report widget for (uri, template) — looked up by its
     * widget id — otherwise creates one via the widget factory. A fresh
     * `setOptions` re-render is triggered on reuse so the report reflects the
     * latest config/template.
     */
    protected async getOrCreateReport(options: ReportWidgetOptions): Promise<ReportWidget> {
        const widgetId = createReportWidgetId(new URI(options.uri), options.templateId);
        const existing = this.widgetManager.getWidgets(REPORT_WIDGET_ID)
            .find((widget): widget is ReportWidget => widget.id === widgetId);
        if (existing) {
            existing.setOptions(options);
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<ReportWidget>(REPORT_WIDGET_ID, options);
    }
}
```

- [ ] **Step 3: Rewrite `report-contribution.ts` to use the service + presenter**

Replace the entire contents of `packages/cooklang/src/browser/report-contribution.ts` with:

```typescript
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common/menu';
import { QuickPickService, QuickPickItem, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { nls } from '@theia/core/lib/common/nls';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser';
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { ReportTemplates, BuiltInReportTemplate } from '../common';
import { ReportWidgetOptions } from './report-widget-types';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export namespace CooklangReportCommands {
    export const RENDER_REPORT: Command = Command.toLocalizedCommand({
        id: 'cooklang.renderReport',
        label: 'Cooklang: Render Report...',
        iconClass: 'codicon codicon-output'
    }, 'theia/cooklang/renderReport');
}

/** A template choice offered in the QuickPick. */
interface ReportTemplatePick {
    id: string;
    label: string;
    uri?: string;
    /** Workspace-relative directory the template came from, shown in the QuickPick. */
    description?: string;
}

// ---------------------------------------------------------------------------
// ReportContribution
// ---------------------------------------------------------------------------

@injectable()
export class ReportContribution implements CommandContribution, MenuContribution {

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(FileSearchService)
    protected readonly fileSearchService: FileSearchService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(ReportPresenter)
    protected readonly reportPresenter: ReportPresenter;

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportCommands.RENDER_REPORT, {
            execute: () => this.renderReport(),
            isEnabled: () => this.reportConfigService.getActiveCooklangUri() !== undefined,
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...EDITOR_CONTEXT_MENU, 'navigation'], {
            commandId: CooklangReportCommands.RENDER_REPORT.id,
            when: 'resourceExtname == .cook || resourceExtname == .menu',
        });
    }

    // --- Command execution ---

    protected async renderReport(): Promise<void> {
        const uri = this.reportConfigService.getActiveCooklangUri();
        if (!uri) {
            return;
        }
        const template = await this.pickTemplate();
        if (!template) {
            return;
        }
        const options: ReportWidgetOptions = {
            uri: uri.toString(),
            templateId: template.id,
            templateLabel: template.label,
            templateUri: template.uri,
            configJson: await this.reportConfigService.buildConfigJson(),
        };
        await this.reportPresenter.show(options);
    }

    /**
     * Shows a QuickPick of workspace templates (*.jinja|j2|jinja2 in template
     * directories) followed by the built-in templates.
     */
    protected async pickTemplate(): Promise<ReportTemplatePick | undefined> {
        const workspaceTemplates = await this.findWorkspaceTemplates();
        const items: Array<(QuickPickItem & { template: ReportTemplatePick }) | QuickPickSeparator> = [];
        if (workspaceTemplates.length > 0) {
            items.push({
                type: 'separator',
                label: nls.localize('theia/cooklang/workspaceTemplates', 'Workspace Templates'),
            });
            for (const template of workspaceTemplates) {
                items.push({ label: template.label, description: template.description, template });
            }
        }
        items.push({
            type: 'separator',
            label: nls.localize('theia/cooklang/builtInTemplates', 'Built-in Templates'),
        });
        for (const builtIn of ReportTemplates.BUILT_IN) {
            const label = this.localizeBuiltInLabel(builtIn);
            items.push({ label, template: { id: builtIn.id, label } });
        }
        const picked = await this.quickPickService.show(items, {
            placeholder: nls.localize('theia/cooklang/pickReportTemplate', 'Select a report template'),
        });
        return picked && 'template' in picked ? picked.template : undefined;
    }

    /**
     * Built-in template labels are user-facing; localize them at the display
     * point (the stored labels double as stable fallbacks).
     */
    protected localizeBuiltInLabel(template: BuiltInReportTemplate): string {
        return template.localizationKey
            ? nls.localize(template.localizationKey, template.label)
            : template.label;
    }

    /**
     * Finds template files (*.jinja|j2|jinja2) anywhere in the workspace via
     * the ripgrep-backed file search (respects .gitignore).
     */
    protected async findWorkspaceTemplates(): Promise<ReportTemplatePick[]> {
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return [];
        }
        let matches: string[];
        try {
            matches = await this.fileSearchService.find('', {
                rootUris: roots.map(root => root.resource.toString()),
                includePatterns: ReportTemplates.FILE_EXTENSIONS.map(ext => `**/*${ext}`),
                useGitIgnore: true,
                fuzzyMatch: false,
                limit: 200,
            });
        } catch (error) {
            console.warn('[cooklang] Report template search failed:', error);
            return [];
        }
        return matches
            .filter(match => ReportTemplates.isTemplateFile(match))
            .map(match => {
                const uri = new URI(match);
                const root = roots.find(candidate => candidate.resource.isEqualOrParent(uri));
                const parentDir = root ? root.resource.relative(uri.parent)?.toString() : undefined;
                return {
                    id: `workspace:${uri.toString()}`,
                    label: uri.path.base,
                    uri: uri.toString(),
                    description: parentDir || undefined,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    }
}
```

- [ ] **Step 4: Wire the bindings in the frontend module**

In `packages/cooklang/src/browser/cooklang-frontend-module.ts`, add imports near the other report imports (after line 39, `import { ReportContribution } from './report-contribution';`):

```typescript
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';
import { ReportWidgetPresenter } from './report-widget-presenter';
```

Then, in the report section (right before `// Report command and context menu`, i.e. before line 93), add:

```typescript
    // Report config + presenter (shared by the command and the AI render tool)
    bind(ReportConfigService).toSelf().inSingletonScope();
    bind(ReportWidgetPresenter).toSelf().inSingletonScope();
    bind(ReportPresenter).toService(ReportWidgetPresenter);
```

- [ ] **Step 5: Compile and test**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: compiles; all tests pass (no regression).

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/report-presenter.ts packages/cooklang/src/browser/report-widget-presenter.ts packages/cooklang/src/browser/report-contribution.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "refactor(cooklang): extract ReportPresenter, use shared service in ReportContribution"
```

---

## Task 5: Create `RenderTemplateTool` (TDD)

**Files:**
- Create: `packages/cooklang/src/browser/render-template-tool.ts`
- Test: `packages/cooklang/src/browser/render-template-tool.spec.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/render-template-tool.spec.ts`:

```typescript
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
import URI from '@theia/core/lib/common/uri';
import { RenderTemplateTool } from './render-template-tool';
import { ReportWidgetOptions } from './report-widget-types';

class FakeConfigService {
    activeUri: URI | undefined;
    lastScale: number | undefined;
    getActiveCooklangUri(): URI | undefined { return this.activeUri; }
    async buildConfigJson(scale: number = 1): Promise<string> {
        this.lastScale = scale;
        return JSON.stringify({ scale });
    }
}

class FakeLanguageService {
    calls: Array<{ recipe: string; template: string; config: string }> = [];
    response = JSON.stringify({ output: 'RENDERED' });
    throwError: Error | undefined;
    async renderReport(recipe: string, template: string, config: string): Promise<string> {
        if (this.throwError) { throw this.throwError; }
        this.calls.push({ recipe, template, config });
        return this.response;
    }
}

class FakeFileService {
    files = new Map<string, string>();
    async read(uri: { toString(): string }): Promise<{ value: string }> {
        const key = uri.toString();
        if (!this.files.has(key)) { throw new Error('ENOENT'); }
        return { value: this.files.get(key)! };
    }
}

class FakePresenter {
    shown: ReportWidgetOptions[] = [];
    async show(options: ReportWidgetOptions): Promise<void> { this.shown.push(options); }
}

function createTool(): {
    tool: RenderTemplateTool;
    config: FakeConfigService;
    language: FakeLanguageService;
    files: FakeFileService;
    presenter: FakePresenter;
} {
    const tool = new RenderTemplateTool();
    const config = new FakeConfigService();
    const language = new FakeLanguageService();
    const files = new FakeFileService();
    const presenter = new FakePresenter();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (tool as any).reportConfigService = config;
    (tool as any).languageService = language;
    (tool as any).fileService = files;
    (tool as any).reportPresenter = presenter;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { tool, config, language, files, presenter };
}

/** Invokes the registered tool handler with a JSON argument string. */
async function invoke(tool: RenderTemplateTool, args: object): Promise<{ output?: string; error?: string }> {
    const result = await tool.getTool().handler(JSON.stringify(args));
    return JSON.parse(result as string);
}

describe('RenderTemplateTool', () => {

    it('exposes the tool under the id renderTemplate with templateContent required', () => {
        const { tool } = createTool();
        const def = tool.getTool();
        expect(def.id).to.equal('renderTemplate');
        expect(def.name).to.equal('renderTemplate');
        expect(def.parameters.required).to.deep.equal(['templateContent']);
    });

    it('errors when templateContent is missing', async () => {
        const { tool, config } = createTool();
        config.activeUri = new URI('file:///ws/recipe.cook');
        const result = await invoke(tool, {});
        expect(result.error).to.match(/templateContent is required/);
    });

    it('errors when no recipeUri is given and no recipe is active', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: '{{ scale }}' });
        expect(result.error).to.match(/No recipe/);
    });

    it('errors when recipeUri is not a .cook or .menu file', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: 'x', recipeUri: 'file:///ws/notes.txt' });
        expect(result.error).to.match(/\.cook or \.menu/);
    });

    it('errors when the recipe file cannot be read', async () => {
        const { tool } = createTool();
        const result = await invoke(tool, { templateContent: 'x', recipeUri: 'file:///ws/missing.cook' });
        expect(result.error).to.match(/Could not read recipe/);
    });

    it('renders against the explicit recipeUri and returns the output verbatim', async () => {
        const { tool, language, files } = createTool();
        files.files.set('file:///ws/cake.cook', 'Add @flour{200%g}');
        const result = await invoke(tool, { templateContent: '{{ scale }}', recipeUri: 'file:///ws/cake.cook' });
        expect(result.output).to.equal('RENDERED');
        expect(language.calls).to.have.length(1);
        expect(language.calls[0].recipe).to.equal('Add @flour{200%g}');
        expect(language.calls[0].template).to.equal('{{ scale }}');
    });

    it('falls back to the active recipe when recipeUri is omitted', async () => {
        const { tool, config, files } = createTool();
        config.activeUri = new URI('file:///ws/active.cook');
        files.files.set('file:///ws/active.cook', 'recipe');
        const result = await invoke(tool, { templateContent: 't' });
        expect(result.output).to.equal('RENDERED');
    });

    it('passes the scale argument through to buildConfigJson', async () => {
        const { tool, config, files } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook', scale: 3 });
        expect(config.lastScale).to.equal(3);
    });

    it('does not open a report tab when show is falsy', async () => {
        const { tool, files, presenter } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook' });
        expect(presenter.shown).to.have.length(0);
    });

    it('opens a report tab with inline content + outputFormat when show is true', async () => {
        const { tool, files, presenter } = createTool();
        files.files.set('file:///ws/cake.cook', 'r');
        await invoke(tool, { templateContent: 'TPL', recipeUri: 'file:///ws/cake.cook', show: true, outputFormat: 'html' });
        expect(presenter.shown).to.have.length(1);
        expect(presenter.shown[0].inlineTemplateContent).to.equal('TPL');
        expect(presenter.shown[0].outputFormat).to.equal('html');
        expect(presenter.shown[0].uri).to.equal('file:///ws/cake.cook');
    });

    it('passes render errors through and does not open a tab', async () => {
        const { tool, language, files, presenter } = createTool();
        language.response = JSON.stringify({ error: 'template syntax error at line 2' });
        files.files.set('file:///ws/cake.cook', 'r');
        const result = await invoke(tool, { templateContent: 'bad', recipeUri: 'file:///ws/cake.cook', show: true });
        expect(result.error).to.match(/template syntax error/);
        expect(presenter.shown).to.have.length(0);
    });

    it('maps a thrown renderReport into an error result', async () => {
        const { tool, language, files } = createTool();
        language.throwError = new Error('addon crashed');
        files.files.set('file:///ws/cake.cook', 'r');
        const result = await invoke(tool, { templateContent: 't', recipeUri: 'file:///ws/cake.cook' });
        expect(result.error).to.match(/Render failed: addon crashed/);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: FAIL — `Cannot find module './render-template-tool'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/browser/render-template-tool.ts`:

```typescript
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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService, ReportOutputFormat } from '../common';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';

interface RenderTemplateArgs {
    templateContent?: string;
    recipeUri?: string;
    show?: boolean;
    outputFormat?: ReportOutputFormat;
    scale?: number;
}

/**
 * AI tool that renders a Jinja2 report template against a `.cook`/`.menu` file
 * and returns `{ output }` or `{ error }`. Rendering is read-only, so the tool
 * auto-executes (no changeset/approval). Saving templates is handled separately
 * by the user-reviewed `suggestFileContent` tool.
 *
 * Kept free of `@theia/monaco` imports (recipe reads go through `FileService`;
 * the report tab goes through `ReportPresenter`) so it is unit-testable.
 */
@injectable()
export class RenderTemplateTool implements ToolProvider {

    static ID = 'renderTemplate';

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ReportPresenter)
    protected readonly reportPresenter: ReportPresenter;

    getTool(): ToolRequest {
        return {
            id: RenderTemplateTool.ID,
            name: RenderTemplateTool.ID,
            displayName: 'Render Template',
            description: 'Render a Cooklang Jinja2 report template against a recipe (.cook) or menu (.menu) file and '
                + 'return the rendered output. Use it to compute values (cost, nutrition, ingredient counts), to validate '
                + 'a template you are authoring (inspect the error and fix it), or to present a finished report to the '
                + 'user (set show=true). Available template context: `ingredients` (each with `.name`, `.quantity`), '
                + '`metadata` (incl. `metadata.title`), and `scale`; filters include `aisled()`, `db()`, '
                + '`excluding_pantry()`, `sort`, `titleize`, `default`. To save a template for reuse, write it as a '
                + '`.jinja` file with the suggestFileContent tool (convention: config/reports/).',
            parameters: {
                type: 'object',
                properties: {
                    templateContent: {
                        type: 'string',
                        description: 'The Jinja2 template source to render.',
                    },
                    recipeUri: {
                        type: 'string',
                        description: 'URI of the .cook or .menu file to render against. Defaults to the active recipe in the editor.',
                    },
                    show: {
                        type: 'boolean',
                        description: 'When true, open or refresh a Report tab showing the output. Default false (headless; output only returned to you).',
                    },
                    outputFormat: {
                        type: 'string',
                        description: "Display format when show is true: 'markdown', 'html', or 'text'. Default 'markdown'.",
                    },
                    scale: {
                        type: 'number',
                        description: 'Recipe scale factor. Default 1.',
                    },
                },
                required: ['templateContent'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: RenderTemplateArgs;
        try {
            args = JSON.parse(argString);
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        if (!args.templateContent) {
            return this.fail('templateContent is required.');
        }
        const recipeUri = args.recipeUri
            ? new URI(args.recipeUri)
            : this.reportConfigService.getActiveCooklangUri();
        if (!recipeUri) {
            return this.fail('No recipe specified and no active .cook or .menu file. Pass recipeUri.');
        }
        if (recipeUri.path.ext !== '.cook' && recipeUri.path.ext !== '.menu') {
            return this.fail(`recipeUri must be a .cook or .menu file, got: ${recipeUri.path.base}`);
        }
        let recipeContent: string;
        try {
            recipeContent = (await this.fileService.read(recipeUri)).value;
        } catch (e) {
            return this.fail(`Could not read recipe ${recipeUri.toString()}: ${this.message(e)}`);
        }
        const configJson = await this.reportConfigService.buildConfigJson(args.scale ?? 1);
        let resultJson: string;
        try {
            resultJson = await this.languageService.renderReport(recipeContent, args.templateContent, configJson);
        } catch (e) {
            return this.fail(`Render failed: ${this.message(e)}`);
        }
        if (args.show) {
            const result = this.tryParse(resultJson);
            if (result && result.output !== undefined) {
                try {
                    await this.reportPresenter.show({
                        uri: recipeUri.toString(),
                        templateId: 'inline:renderTemplate',
                        templateLabel: 'AI Template',
                        inlineTemplateContent: args.templateContent,
                        outputFormat: args.outputFormat ?? 'markdown',
                        configJson,
                    });
                } catch (e) {
                    console.warn('[cooklang] renderTemplate: failed to show report tab:', e);
                }
            }
        }
        // renderReport already returns `{ output }` | `{ error }`; pass through.
        return resultJson;
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }

    protected message(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    protected tryParse(json: string): { output?: string; error?: string } | undefined {
        try {
            return JSON.parse(json);
        } catch {
            return undefined;
        }
    }
}
```

- [ ] **Step 4: Bind the tool in the frontend module**

In `packages/cooklang/src/browser/cooklang-frontend-module.ts`, add the import (after the presenter imports added in Task 4):

```typescript
import { bindToolProvider } from '@theia/ai-core/lib/common';
import { RenderTemplateTool } from './render-template-tool';
```

Then, right after the `bind(ReportPresenter).toService(ReportWidgetPresenter);` line added in Task 4, add:

```typescript
    // AI render tool (picked up by the cookbot agent via ToolInvocationRegistry)
    bindToolProvider(RenderTemplateTool, bind);
```

- [ ] **Step 5: Compile and run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: PASS — the `RenderTemplateTool` suite (12 tests) and `ReportConfigService` suite pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/render-template-tool.ts packages/cooklang/src/browser/render-template-tool.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): add renderTemplate AI tool"
```

---

## Task 6: Add the `report-authoring` server skill (cookbot)

**Repo:** `/Users/alexeydubovskoy/Cooklang/cook.md/cookbot`

**Files:**
- Create: `crates/server/prompts/skills/report-authoring.md`
- Modify: `crates/server/src/skills/mod.rs`

- [ ] **Step 1: Create the skill markdown**

Create `crates/server/prompts/skills/report-authoring.md`:

```markdown
# Skill: Report Authoring

Author and run **Jinja2 report templates** for the user's recipes using the
`renderTemplate` tool, then either answer from the output or save a reusable
template. Use this skill when the user wants a computed value (total cost,
nutrition, ingredient counts), a custom report/summary, or a new report
template — anything that requires rendering recipe data through a template.

This skill is about *authoring and executing* templates. For interpreting
existing analytics/report output, see the `reports` skill.

## The render tool

`renderTemplate` renders a template string against ONE `.cook` recipe or ONE
`.menu` file and returns `{ "output": "..." }` or `{ "error": "..." }`.

Arguments:
- `templateContent` (required) — the Jinja2 source.
- `recipeUri` (optional) — the `.cook`/`.menu` to render against; defaults to
  the recipe the user currently has open.
- `show` (optional, default false) — when true, also opens a Report tab so the
  user sees the rendered output. Render headlessly while iterating; set
  `show: true` only when presenting a finished result.
- `outputFormat` (optional) — `markdown` | `html` | `text`, for `show`.
- `scale` (optional, default 1) — recipe scale factor.

Rendering is read-only and never edits files.

## Template context and filters

Within a template you have:
- `ingredients` — list; each item has `.name` and `.quantity`.
- `metadata` — recipe metadata, including `metadata.title` and any custom keys.
- `scale` — the numeric scale factor.

Filters/functions available:
- `aisled(ingredients)` — groups ingredients by aisle (uses `config/aisle.conf`).
- `db()` — looks up values from the workspace datastore (`db/` or `config/db/`).
- `excluding_pantry()` — drops ingredients already in `config/pantry.conf`.
- Standard Jinja: `sort(attribute='name')`, `titleize`, `default(...)`, `items`.

Example — an ingredients list:

\`\`\`jinja
# {{ metadata.title | default("Ingredients") }}

{% for ingredient in ingredients | sort(attribute='name') -%}
- {{ ingredient.name }}{% if ingredient.quantity %}: {{ ingredient.quantity }}{% endif %}
{% endfor %}
\`\`\`

## Workflow: render → inspect → fix

1. Draft the template.
2. Call `renderTemplate` **headlessly** (`show:false`) to run it.
3. If you get `{ "error": ... }`, read the message (minijinja reports the line),
   fix the template, and render again. Repeat until it renders cleanly.
4. To answer a question (e.g. "what's the total cost?"), read the `output` and
   reply in chat — you do not need to save anything.
5. To present a finished report to the user, render once more with `show:true`
   and the appropriate `outputFormat`.

## Saving a reusable template

When the user wants to keep a report, save the template as a `.jinja` file with
the `suggestFileContent` tool (the user reviews and applies the change):
- Put templates in `config/reports/` by convention.
- Declare the output format via the inner extension:
  `weekly-cost.md.jinja` → markdown, `menu.html.jinja` → HTML,
  `shopping.txt.jinja` → plain text.
- After saving, the user can re-run it any time from the editor's
  "Render Report" command.

Render ephemerally for one-off questions; save a template only when reuse is
wanted.
```

Note: in the file above, the three ``` fences inside the skill are real fenced code blocks (remove the leading backslashes shown here for escaping — write them as plain ``` fences).

- [ ] **Step 2: Embed and register the skill in `mod.rs`**

In `crates/server/src/skills/mod.rs`:

(a) After the `SKILL_REPORTS` const (the line `const SKILL_REPORTS: &str = include_str!("../../prompts/skills/reports.md");`), add:

```rust
const SKILL_REPORT_AUTHORING: &str = include_str!("../../prompts/skills/report-authoring.md");
```

(b) In `SKILL_NAMES`, add `"report-authoring"` after `"reports"`:

```rust
pub const SKILL_NAMES: &[&str] = &[
    "cooklang-editing",
    "recipe-import",
    "meal-planning",
    "shopping-list",
    "pantry",
    "reports",
    "report-authoring",
];
```

(c) In `load_skill()`, add a match arm after the `"reports"` arm:

```rust
        "report-authoring" => (SKILL_REPORT_AUTHORING, false),
```

- [ ] **Step 3: Build the server to verify embedding + wiring**

Run: `cd /Users/alexeydubovskoy/Cooklang/cook.md/cookbot && cargo build -p server`
Expected: builds successfully (a missing/misnamed skill file would be an `include_str!` build error; a missing match arm would be a non-exhaustive-match error if the enum were exhaustive — here `_ => None` covers it, so the key verification is that `SKILL_NAMES` and the arm are present and it compiles).

If the crate name differs, run `cargo build` from `crates/server` instead:
`cd /Users/alexeydubovskoy/Cooklang/cook.md/cookbot/crates/server && cargo build`

- [ ] **Step 4: Commit (in the cookbot repo)**

```bash
cd /Users/alexeydubovskoy/Cooklang/cook.md/cookbot
git add crates/server/prompts/skills/report-authoring.md crates/server/src/skills/mod.rs
git commit -m "feat(skills): add report-authoring skill for renderTemplate tool"
```

(Push/PR for the cookbot repo is handled separately by the user; this plan's PR step covers the editor repo.)

---

## Task 7: Full verification and bundle (editor repo)

**Files:** none (verification only)

- [ ] **Step 1: Compile all packages**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npm run compile`
Expected: all packages compile with no errors.

- [ ] **Step 2: Lint the cooklang package**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run lint --scope @theia/cooklang`
Expected: no lint errors.

- [ ] **Step 3: Run the cooklang tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run test --scope @theia/cooklang`
Expected: all suites pass (report-config-service, render-template-tool, report-templates, shopping-list-service, plus node specs).

- [ ] **Step 4: Bundle the Electron app (regenerates `src-gen/`)**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor/app && npm run bundle`
Expected: bundle completes; `RenderTemplateTool` is reachable through the cooklang frontend module (no DI binding errors at build time).

- [ ] **Step 5: Commit any regenerated artifacts (if changed)**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add -A
git commit -m "chore: rebuild app bundle for renderTemplate tool" || echo "nothing to commit"
```

---

## Task 8: Open the pull request (editor repo)

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git push -u origin feature/ai-template-rendering
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --base main --head feature/ai-template-rendering \
  --title "feat: AI-authored template rendering (renderTemplate tool)" \
  --body "$(cat <<'EOF'
## Summary
Adds a `renderTemplate` AI tool so Cookbot can author Jinja2 report templates and render them during its agentic loop — to compute answers, validate templates while authoring, or present finished reports.

- New client tool `renderTemplate` in `@theia/cooklang` wrapping the existing `CooklangLanguageService.renderReport` RPC (no proto/native changes).
- Extracted `ReportConfigService` (config assembly + active-recipe resolution) and `ReportPresenter` (Report tab show path) from `ReportContribution`; both keep the tool monaco-free and unit-testable.
- `ReportWidget` now supports inline (AI-authored) templates and an explicit output format.
- Companion server skill `report-authoring` added in cook.md/cookbot (separate commit/PR).

## Design / Plan
- Spec: `docs/superpowers/specs/2026-06-13-ai-template-rendering-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-ai-template-rendering.md`

## Testing
- `npx lerna run test --scope @theia/cooklang` (ReportConfigService + RenderTemplateTool unit suites)
- `npm run compile`, `npx lerna run lint --scope @theia/cooklang`
- `cd app && npm run bundle`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR created; print the PR URL.

---

## Self-Review

**Spec coverage:**
- "Compute an answer" → `renderTemplate` returns `{output}` headlessly (Task 5). ✓
- "Produce a saved report" → save via existing `suggestFileContent`; skill instructs convention `config/reports/` (Tasks 5 description, 6). ✓
- "Iterative authoring" → render→inspect→fix loop documented in skill; tool returns `{error}` verbatim (Tasks 5, 6). ✓
- "Single .cook or .menu" scope → `recipeUri` validation rejects other extensions; active-recipe resolution matches the command (Tasks 3, 5). ✓
- "AI decides per render (show flag)" → `show` param opens/refreshes a tab via `ReportPresenter` (Tasks 4, 5). ✓
- Tool in `@theia/cooklang`, only ai-core added → Task 1, placement throughout. ✓
- Shared `ReportConfigService`, `ReportWidget` inline extension → Tasks 2, 3. ✓
- Server skill `report-authoring` separate from `reports`, wired into `SKILL_NAMES`/`load_skill` with `attach_syntax_reference:false` → Task 6. ✓
- Error handling: tool never throws, missing recipe/bad uri/read/render failures → `{error}` (Task 5 tests). ✓
- Testing: `report-config-service.spec.ts`, `render-template-tool.spec.ts`, cookbot build (Tasks 3, 5, 6). ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. The skill markdown's nested code-fence escaping is called out explicitly in Task 6 Step 1.

**Type consistency:** `ReportWidgetOptions` (with `inlineTemplateContent`/`outputFormat`) is defined once in `report-widget-types.ts` (Task 2) and consumed identically by `ReportWidget`, `ReportPresenter`, `ReportWidgetPresenter`, and `RenderTemplateTool`. `ReportConfigService.buildConfigJson(scale)` signature matches its callers (`ReportContribution`, tool). `ReportPresenter.show(options)` matches the impl and tool/contribution call sites. Tool id string `renderTemplate` is consistent across impl and tests.
