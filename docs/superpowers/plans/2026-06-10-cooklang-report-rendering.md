# Cooklang Report Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Cooklang: Render Report…" command that applies a Jinja2 report template (cookcli-compatible, via the `cooklang-reports` crate) to the open `.cook` recipe and shows the rendered markdown in a new main-area tab.

**Architecture:** Rendering happens in Rust (`cooklang-reports` 0.5.0, minijinja) exposed through a new `renderReport` NAPI function in `packages/cooklang-native`, surfaced over the existing `CooklangLanguageService` RPC. The frontend adds a command contribution (QuickPick of workspace + built-in templates) and a per-(recipe, template) `ReportWidget` that renders output with Theia's `MarkdownRenderer` and live-refreshes on document change.

**Tech Stack:** Rust + NAPI-RS, Theia RPC (`ServiceConnectionProvider`), React `ReactWidget`, `@theia/core` `Markdown` component, mocha/chai specs, cargo tests.

**Spec:** `docs/superpowers/specs/2026-06-10-cooklang-report-design.md`

**Reference repos (read-only):**
- `/Users/alexeydubovskoy/Cooklang/cooklang-reports` — local checkout of the crate (v0.5.0, same as crates.io)
- `/Users/alexeydubovskoy/Cooklang/CookCLI/src/report.rs` — cookcli's report command

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/cooklang-native/Cargo.toml` | Modify | add `cooklang-reports = "0.5"` |
| `packages/cooklang-native/src/lib.rs` | Modify | new `render_report` NAPI fn + cargo tests |
| `packages/cooklang/src/common/cooklang-language-service.ts` | Modify | RPC interface: `renderReport` |
| `packages/cooklang/src/common/report-templates.ts` | Create | built-in templates + filename helpers (monaco-free) |
| `packages/cooklang/src/common/report-templates.spec.ts` | Create | unit tests for helpers |
| `packages/cooklang/src/common/index.ts` | Modify | re-export report-templates |
| `packages/cooklang/src/node/cooklang-language-service-impl.ts` | Modify | backend impl: URI→fsPath conversion + native call |
| `packages/cooklang/src/node/cooklang-language-service-impl.spec.ts` | Create | tests for URI→fsPath config conversion |
| `packages/cooklang/src/browser/report-widget.tsx` | Create | per-(recipe, template) rendered-markdown tab |
| `packages/cooklang/src/browser/report-contribution.ts` | Create | command, QuickPick, menus |
| `packages/cooklang/src/browser/style/report.css` | Create | widget styling |
| `packages/cooklang/src/browser/cooklang-frontend-module.ts` | Modify | DI bindings |

Every new TS file starts with the same 12-line license header used by every existing file in `packages/cooklang/src/` (copy it verbatim from `packages/cooklang/src/common/cooklang-language-service.ts:1-12`).

---

### Task 1: Rust — `render_report` in cooklang-native

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Modify: `packages/cooklang-native/src/lib.rs` (append at end of file)

- [ ] **Step 1: Add the dependency**

In `packages/cooklang-native/Cargo.toml`, after the `cooklang-find = "0.5.8"` line, add:

```toml
cooklang-reports = "0.5"
```

(crates.io has 0.5.0; it depends on `cooklang 0.18` which unifies with our `0.18.5`.)

- [ ] **Step 2: Write the failing cargo tests**

Append at the very end of `packages/cooklang-native/src/lib.rs`:

```rust
#[cfg(test)]
mod render_report_tests {
    #[test]
    fn renders_ingredients_template() {
        let recipe = "Mix @eggs{3} with @flour{125%g}.";
        let template = "{% for i in ingredients %}{{ i.name }};{% endfor %}";
        let result = super::render_report(recipe.into(), template.into(), "{}".into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        let output = v["output"].as_str().expect("expected output, not error");
        assert!(output.contains("eggs;"), "output was: {output}");
        assert!(output.contains("flour;"), "output was: {output}");
    }

    #[test]
    fn applies_scale_from_config() {
        let recipe = "Mix @eggs{2}.";
        let template = "{{ scale }}";
        let result = super::render_report(recipe.into(), template.into(), r#"{"scale": 2}"#.into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["output"].as_str().unwrap(), "2.0");
    }

    #[test]
    fn returns_error_for_bad_template() {
        let result = super::render_report("Mix @eggs{1}.".into(), "{% for %}".into(), "{}".into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(!v["error"].as_str().unwrap().is_empty());
    }
}
```

Note for the `applies_scale_from_config` assertion: minijinja renders the f64 `2.0` as `2.0`. If the test fails with output `2`, relax the assertion to `assert!(["2", "2.0"].contains(&v["output"].as_str().unwrap()))` — the point is that the config was parsed, not the float formatting.

- [ ] **Step 3: Run tests to verify they fail to compile**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor/packages/cooklang-native && cargo test render_report`
Expected: compile error — `render_report` not found.

- [ ] **Step 4: Implement `render_report`**

In `packages/cooklang-native/src/lib.rs`, immediately above the test module you just added, append:

```rust
/// Configuration accepted by `render_report`, mirroring cooklang_reports::Config.
/// All path fields are OS filesystem paths (the Theia backend converts URIs
/// before calling into the addon).
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ReportConfig {
    scale: Option<f64>,
    base_path: Option<String>,
    aisle_path: Option<String>,
    pantry_path: Option<String>,
    datastore_path: Option<String>,
}

/// Render a Jinja2 report template against a recipe via cooklang-reports
/// (the same engine cookcli's `cook report` uses).
///
/// Returns JSON: `{"output": "..."}` on success or `{"error": "..."}` on failure.
#[napi]
pub fn render_report(recipe: String, template: String, config_json: String) -> String {
    let cfg: ReportConfig = serde_json::from_str(&config_json).unwrap_or_default();
    let mut builder = cooklang_reports::config::Config::builder();
    builder.scale(cfg.scale.unwrap_or(1.0));
    if let Some(p) = cfg.base_path {
        builder.base_path(p);
    }
    if let Some(p) = cfg.aisle_path {
        builder.aisle_path(p);
    }
    if let Some(p) = cfg.pantry_path {
        builder.pantry_path(p);
    }
    if let Some(p) = cfg.datastore_path {
        builder.datastore_path(p);
    }
    let config = builder.build();
    match cooklang_reports::render_template_with_config(&recipe, &template, &config) {
        Ok(output) => serde_json::json!({ "output": output }).to_string(),
        Err(err) => serde_json::json!({ "error": err.to_string() }).to_string(),
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor/packages/cooklang-native && cargo test render_report`
Expected: `test result: ok. 3 passed`

- [ ] **Step 6: Rebuild the Node addon (regenerates index.d.ts / index.js)**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor/packages/cooklang-native && npm run build`
Expected: success; `grep renderReport index.d.ts` shows
`export declare function renderReport(recipe: string, template: string, configJson: string): string`

- [ ] **Step 7: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/lib.rs packages/cooklang-native/index.d.ts packages/cooklang-native/index.js
git commit -m "feat(cooklang-native): add renderReport via cooklang-reports crate"
```

---

### Task 2: Backend RPC — `renderReport` on CooklangLanguageService

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts:67` (after `findRecipe`)
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts` (after `findRecipe`, line ~275)
- Create: `packages/cooklang/src/node/cooklang-language-service-impl.spec.ts`

- [ ] **Step 1: Extend the common interface**

In `packages/cooklang/src/common/cooklang-language-service.ts`, inside `interface CooklangLanguageService`, after the `findRecipe` method, add:

```ts
    /**
     * Render a Jinja2 report template against a recipe (cookcli-compatible,
     * via the cooklang-reports crate).
     *
     * `configJson` is a JSON object with optional `scale` (number) and
     * optional `basePath`, `aislePath`, `pantryPath`, `datastorePath` given
     * as **URI strings** — the backend converts them to filesystem paths.
     *
     * Returns JSON: `{"output": "..."}` on success or `{"error": "..."}`.
     */
    renderReport(recipeContent: string, templateContent: string, configJson: string): Promise<string>;
```

- [ ] **Step 2: Write the failing backend spec**

Create `packages/cooklang/src/node/cooklang-language-service-impl.spec.ts` (license header first, then):

```ts
import { expect } from 'chai';
import { CooklangLanguageServiceImpl } from './cooklang-language-service-impl';

describe('CooklangLanguageServiceImpl report config conversion', () => {

    it('converts URI entries to filesystem paths', () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = impl['convertReportConfigPaths'](JSON.stringify({
            scale: 1,
            basePath: 'file:///tmp/workspace',
            aislePath: 'file:///tmp/workspace/config/aisle.conf'
        }));
        const config = JSON.parse(result);
        expect(config.scale).to.equal(1);
        expect(config.basePath).to.equal('/tmp/workspace');
        expect(config.aislePath).to.equal('/tmp/workspace/config/aisle.conf');
    });

    it('leaves absent path entries absent', () => {
        const impl = new CooklangLanguageServiceImpl();
        const config = JSON.parse(impl['convertReportConfigPaths']('{"scale":2}'));
        expect(config).to.deep.equal({ scale: 2 });
    });
});
```

(`impl['convertReportConfigPaths']` is the standard bracket-access trick for testing a protected method; the constructor is safe to call directly — DI `@postConstruct` does not run outside a container.)

- [ ] **Step 3: Compile and run the spec to verify it fails**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: TS error — `convertReportConfigPaths` / `renderReport` missing on the impl (interface not satisfied).

- [ ] **Step 4: Implement in the backend service**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`:

Add the import at the top, next to the other `@theia/core` imports:

```ts
import { FileUri } from '@theia/core/lib/common/file-uri';
```

After the `findRecipe` method, add:

```ts
    async renderReport(recipeContent: string, templateContent: string, configJson: string): Promise<string> {
        try {
            const native = require('@theia/cooklang-native');
            return native.renderReport(recipeContent, templateContent, this.convertReportConfigPaths(configJson));
        } catch (error) {
            console.error('[cooklang] Failed to render report:', error);
            return JSON.stringify({ error: String(error) });
        }
    }

    /**
     * The frontend sends path-like config entries as URI strings (URIs cross
     * the wire, never raw paths); the native addon needs OS filesystem paths.
     */
    protected convertReportConfigPaths(configJson: string): string {
        const config = JSON.parse(configJson) as Record<string, unknown>;
        for (const key of ['basePath', 'aislePath', 'pantryPath', 'datastorePath']) {
            const value = config[key];
            if (typeof value === 'string') {
                config[key] = FileUri.fsPath(value);
            }
        }
        return JSON.stringify(config);
    }
```

- [ ] **Step 5: Compile and run tests to verify they pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: compile OK; the two new specs pass (existing `shopping-list-service.spec.ts` still passes).

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts packages/cooklang/src/node/cooklang-language-service-impl.spec.ts
git commit -m "feat(cooklang): add renderReport RPC to CooklangLanguageService"
```

---

### Task 3: Built-in templates + filename helpers (common, monaco-free)

**Files:**
- Create: `packages/cooklang/src/common/report-templates.ts`
- Create: `packages/cooklang/src/common/report-templates.spec.ts`
- Modify: `packages/cooklang/src/common/index.ts`

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang/src/common/report-templates.spec.ts` (license header, then):

```ts
import { expect } from 'chai';
import { ReportTemplates } from './report-templates';

describe('ReportTemplates', () => {

    it('recognizes template files by extension, case-insensitively', () => {
        expect(ReportTemplates.isTemplateFile('cost.jinja')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.md.jinja')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.J2')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.jinja2')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.txt')).to.equal(false);
        expect(ReportTemplates.isTemplateFile('recipe.cook')).to.equal(false);
    });

    it('resolves built-in templates by id', () => {
        for (const template of ReportTemplates.BUILT_IN) {
            expect(ReportTemplates.byId(template.id)).to.equal(template);
            expect(template.content.length).to.be.greaterThan(0);
        }
        expect(ReportTemplates.byId('nope')).to.equal(undefined);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: TS error — module `./report-templates` not found.

- [ ] **Step 3: Implement**

Create `packages/cooklang/src/common/report-templates.ts` (license header, then):

```ts
/**
 * A report template bundled with the editor, available even when the
 * workspace has no `config/reports/` directory.
 */
export interface BuiltInReportTemplate {
    id: string;
    label: string;
    content: string;
}

export namespace ReportTemplates {

    /** File extensions recognized as Jinja2 report templates. */
    export const FILE_EXTENSIONS: ReadonlyArray<string> = ['.jinja', '.j2', '.jinja2'];

    /** Workspace directory scanned for report templates. */
    export const WORKSPACE_TEMPLATE_DIR = 'config/reports';

    export function isTemplateFile(fileName: string): boolean {
        const lower = fileName.toLowerCase();
        return FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    export const BUILT_IN: ReadonlyArray<BuiltInReportTemplate> = [
        {
            id: 'builtin:ingredients',
            label: 'Ingredients List (built-in)',
            content: `# {{ metadata.title | default("Ingredients") }}

{% for ingredient in ingredients | sort(attribute='name') -%}
- {{ ingredient.name }}{% if ingredient.quantity %}: {{ ingredient.quantity }}{% endif %}
{% endfor %}`
        },
        {
            id: 'builtin:shopping-list',
            label: 'Shopping List (built-in)',
            content: `# Shopping List

{% for (aisle, items) in aisled(ingredients) | items -%}
## {{ aisle | titleize }}

{% for ingredient in items -%}
- [ ] {{ ingredient.name }}{% if ingredient.quantity %}: {{ ingredient.quantity }}{% endif %}
{% endfor %}
{% endfor %}`
        }
    ];

    export function byId(id: string): BuiltInReportTemplate | undefined {
        return BUILT_IN.find(template => template.id === id);
    }
}
```

In `packages/cooklang/src/common/index.ts`, add alongside the existing exports:

```ts
export * from './report-templates';
```

- [ ] **Step 4: Compile and run tests to verify they pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang && npx lerna run test --scope @theia/cooklang`
Expected: PASS (all specs).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/common/report-templates.ts packages/cooklang/src/common/report-templates.spec.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): add built-in report templates and template-file helpers"
```

---

### Task 4: ReportWidget — rendered-markdown tab

**Files:**
- Create: `packages/cooklang/src/browser/report-widget.tsx`
- Create: `packages/cooklang/src/browser/style/report.css`

No unit spec for this file: it imports `MonacoWorkspace`, which kills the browser spec harness (known monaco-css pitfall). Behavior is covered by the manual verification in Task 6; the testable logic (template constants/helpers, config conversion) already lives in monaco-free files.

- [ ] **Step 1: Create the CSS**

Create `packages/cooklang/src/browser/style/report.css`:

```css
.cooklang-report {
    padding: 0 20px 20px 20px;
    color: var(--theia-editor-foreground);
    background: var(--theia-editor-background);
}

.cooklang-report-error pre {
    color: var(--theia-errorForeground);
    white-space: pre-wrap;
    font-family: var(--theia-code-font-family);
}

.cooklang-report-loading {
    padding: 20px;
    color: var(--theia-descriptionForeground);
}
```

- [ ] **Step 2: Create the widget**

Create `packages/cooklang/src/browser/report-widget.tsx` (license header, then):

```tsx
import { injectable, inject, postConstruct, interfaces } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { Markdown } from '@theia/core/lib/browser/markdown-rendering/markdown';
import { nls } from '@theia/core/lib/common/nls';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID, ReportTemplates } from '../common';

import '../../src/browser/style/report.css';

// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export const REPORT_WIDGET_ID = 'cooklang-report-widget';

export interface ReportWidgetOptions {
    /** URI string of the source `.cook` file. */
    uri: string;
    /** Template id: `builtin:*` or `workspace:<template uri>`. */
    templateId: string;
    /** Human-readable template name for the tab title. */
    templateLabel: string;
    /** URI string of a workspace template file; unset for built-ins. */
    templateUri?: string;
    /** Render config (scale + URI-string paths), passed through to the RPC. */
    configJson: string;
}

/**
 * Constructs a unique widget ID for a report tab tied to a recipe + template.
 */
export function createReportWidgetId(uri: URI, templateId: string): string {
    return `${REPORT_WIDGET_ID}:${templateId}:${uri.toString()}`;
}

// ---------------------------------------------------------------------------
// ReportWidget
// ---------------------------------------------------------------------------

@injectable()
export class ReportWidget extends ReactWidget implements Navigatable {

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MarkdownRenderer)
    protected readonly markdownRenderer: MarkdownRenderer;

    protected uri: URI;
    protected options: ReportWidgetOptions;
    protected output: string | undefined;
    protected errorMessage: string | undefined;
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;

    @postConstruct()
    protected init(): void {
        this.addClass('cooklang-report');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.toDispose.push(
            this.monacoWorkspace.onDidChangeTextDocument(event => {
                if (
                    event.model.languageId !== COOKLANG_LANGUAGE_ID ||
                    event.model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.debouncedRender();
            })
        );
    }

    /**
     * Bind this widget to a recipe + template and trigger the first render.
     */
    setOptions(options: ReportWidgetOptions): void {
        this.options = options;
        this.uri = new URI(options.uri);
        this.id = createReportWidgetId(this.uri, options.templateId);
        this.title.label = nls.localize('theia/cooklang/reportTabTitle', 'Report: {0} ({1})', this.uri.path.base, options.templateLabel);
        this.title.caption = this.title.label;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-output';
        this.renderReport();
    }

    // --- Navigatable ---

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    // --- Report rendering ---

    protected debouncedRender(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.renderReport();
        }, 300);
    }

    protected async renderReport(): Promise<void> {
        try {
            const recipe = await this.readRecipeContent();
            const template = await this.readTemplateContent();
            const resultJson = await this.service.renderReport(recipe, template, this.options.configJson);
            const result = JSON.parse(resultJson) as { output?: string; error?: string };
            this.output = result.output;
            this.errorMessage = result.error;
        } catch (error) {
            this.output = undefined;
            this.errorMessage = String(error);
        }
        this.update();
    }

    protected async readRecipeContent(): Promise<string> {
        const model = this.monacoWorkspace.getTextDocument(this.uri.toString());
        if (model) {
            return model.getText();
        }
        const content = await this.fileService.read(this.uri);
        return content.value;
    }

    protected async readTemplateContent(): Promise<string> {
        if (this.options.templateUri) {
            const content = await this.fileService.read(new URI(this.options.templateUri));
            return content.value;
        }
        const builtIn = ReportTemplates.byId(this.options.templateId);
        if (!builtIn) {
            throw new Error(`Unknown built-in report template: ${this.options.templateId}`);
        }
        return builtIn.content;
    }

    // --- Rendering ---

    protected render(): React.ReactNode {
        if (this.errorMessage) {
            return (
                <div className='cooklang-report-error'>
                    <strong>{nls.localize('theia/cooklang/reportError', 'Report rendering failed:')}</strong>
                    <pre>{this.errorMessage}</pre>
                </div>
            );
        }
        if (this.output === undefined) {
            return <div className='cooklang-report-loading'>{nls.localizeByDefault('Loading...')}</div>;
        }
        return (
            <Markdown
                markdown={this.output}
                markdownRenderer={this.markdownRenderer}
                className='cooklang-report-content'
            />
        );
    }

    // --- Disposal ---

    override dispose(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        super.dispose();
    }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a fully initialised {@link ReportWidget} bound to `options`.
 *
 * Uses a child container so each report tab gets its own widget instance
 * while inheriting all parent bindings.
 */
export function createReportWidget(
    container: interfaces.Container,
    options: ReportWidgetOptions
): ReportWidget {
    const child = container.createChild();
    child.bind(ReportWidget).toSelf().inTransientScope();
    const widget = child.get(ReportWidget);
    widget.setOptions(options);
    return widget;
}
```

Note: `Markdown` is exported from `@theia/core/lib/browser/markdown-rendering/markdown` (`export const Markdown = React.memo(MarkdownComponent)` at `packages/core/src/browser/markdown-rendering/markdown.tsx:124`); `MarkdownRenderer` is a DI symbol bound in `frontend-application-module.ts:321`.

- [ ] **Step 3: Compile**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: success. (The widget isn't bound yet — that's Task 6.)

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/browser/report-widget.tsx packages/cooklang/src/browser/style/report.css
git commit -m "feat(cooklang): add ReportWidget rendering report output as markdown"
```

---

### Task 5: ReportContribution — command, QuickPick, menus

**Files:**
- Create: `packages/cooklang/src/browser/report-contribution.ts`

- [ ] **Step 1: Create the contribution**

Create `packages/cooklang/src/browser/report-contribution.ts` (license header, then):

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common/menu';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { QuickPickService, QuickPickItem, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { EditorManager, EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID, ReportTemplates } from '../common';
import { ReportWidget, ReportWidgetOptions, REPORT_WIDGET_ID, createReportWidgetId } from './report-widget';

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
}

// ---------------------------------------------------------------------------
// ReportContribution
// ---------------------------------------------------------------------------

@injectable()
export class ReportContribution implements CommandContribution, MenuContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportCommands.RENDER_REPORT, {
            execute: () => this.renderReport(),
            isEnabled: () => this.getActiveCooklangEditorUri() !== undefined,
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...EDITOR_CONTEXT_MENU, 'navigation'], {
            commandId: CooklangReportCommands.RENDER_REPORT.id,
            when: 'resourceExtname == .cook',
        });
    }

    // --- Command execution ---

    protected async renderReport(): Promise<void> {
        const uri = this.getActiveCooklangEditorUri();
        if (!uri) {
            return;
        }
        if (uri.path.ext === '.menu') {
            this.messageService.info(
                nls.localize('theia/cooklang/reportMenuUnsupported', 'Reports are not supported for menu files yet.')
            );
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
            configJson: await this.buildConfigJson(),
        };
        const widget = await this.getOrCreateReport(options);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
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
     * Shows a QuickPick of workspace templates (config/reports/*.jinja|j2|jinja2)
     * followed by the built-in templates.
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
                items.push({ label: template.label, description: ReportTemplates.WORKSPACE_TEMPLATE_DIR, template });
            }
        }
        items.push({
            type: 'separator',
            label: nls.localize('theia/cooklang/builtInTemplates', 'Built-in Templates'),
        });
        for (const builtIn of ReportTemplates.BUILT_IN) {
            items.push({ label: builtIn.label, template: { id: builtIn.id, label: builtIn.label } });
        }
        const picked = await this.quickPickService.show(items, {
            placeholder: nls.localize('theia/cooklang/pickReportTemplate', 'Select a report template'),
        });
        return picked && 'template' in picked ? picked.template : undefined;
    }

    /**
     * Lists template files in `config/reports/` of the first workspace root.
     */
    protected async findWorkspaceTemplates(): Promise<ReportTemplatePick[]> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return [];
        }
        const dir = root.resource.resolve(ReportTemplates.WORKSPACE_TEMPLATE_DIR);
        try {
            const stat = await this.fileService.resolve(dir);
            if (!stat.isDirectory || !stat.children) {
                return [];
            }
            return stat.children
                .filter(child => !child.isDirectory && ReportTemplates.isTemplateFile(child.name))
                .map(child => ({
                    id: `workspace:${child.resource.toString()}`,
                    label: child.name,
                    uri: child.resource.toString(),
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
            // Directory does not exist — no workspace templates.
            return [];
        }
    }

    /**
     * Builds the render config from workspace conventions. Paths are sent as
     * URI strings; the backend converts them to filesystem paths.
     */
    protected async buildConfigJson(): Promise<string> {
        const config: {
            scale: number;
            basePath?: string;
            aislePath?: string;
            pantryPath?: string;
            datastorePath?: string;
        } = { scale: 1 };
        const root = this.workspaceService.tryGetRoots()[0];
        if (root) {
            config.basePath = root.resource.toString();
            const aisle = root.resource.resolve('config/aisle.conf');
            if (await this.fileService.exists(aisle)) {
                config.aislePath = aisle.toString();
            }
            const pantry = root.resource.resolve('config/pantry.conf');
            if (await this.fileService.exists(pantry)) {
                config.pantryPath = pantry.toString();
            }
            const datastore = root.resource.resolve('db');
            if (await this.fileService.exists(datastore)) {
                config.datastorePath = datastore.toString();
            }
        }
        return JSON.stringify(config);
    }

    /**
     * Returns an existing report widget for (uri, template) if open, otherwise
     * creates one via the widget factory. A fresh `setOptions` re-render is
     * triggered on reuse so the report reflects the latest config.
     */
    protected async getOrCreateReport(options: ReportWidgetOptions): Promise<ReportWidget> {
        const widgetId = createReportWidgetId(new URI(options.uri), options.templateId);
        const existing = this.widgetManager.tryGetWidget<ReportWidget>(widgetId);
        if (existing) {
            existing.setOptions(options);
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<ReportWidget>(REPORT_WIDGET_ID, options);
    }
}
```

- [ ] **Step 2: Compile**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang`
Expected: success. If `EDITOR_CONTEXT_MENU` is not exported from `@theia/editor/lib/browser`, import it from `@theia/editor/lib/browser/editor-menu` instead.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang/src/browser/report-contribution.ts
git commit -m "feat(cooklang): add Render Report command with template QuickPick"
```

---

### Task 6: Wire up DI, lint, bundle, verify

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Add bindings**

In `packages/cooklang/src/browser/cooklang-frontend-module.ts`, add imports:

```ts
import { REPORT_WIDGET_ID, ReportWidgetOptions, createReportWidget } from './report-widget';
import { ReportContribution } from './report-contribution';
```

Inside the `ContainerModule`, after the menu-preview bindings (line ~82), add:

```ts
    // Report widget factory
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: REPORT_WIDGET_ID,
        createWidget: (options: ReportWidgetOptions) =>
            createReportWidget(ctx.container, options),
    })).inSingletonScope();

    // Report command and context menu
    bind(ReportContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ReportContribution);
    bind(MenuContribution).toService(ReportContribution);
```

- [ ] **Step 2: Compile, lint, test**

Run:
```bash
cd /Users/alexeydubovskoy/Cooklang/editor
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
npx lerna run test --scope @theia/cooklang
```
Expected: all pass. Fix any lint complaints (4-space indent, single quotes, explicit return types).

- [ ] **Step 3: Bundle and launch the app**

Run:
```bash
cd /Users/alexeydubovskoy/Cooklang/editor/app && npm run bundle
npm run start:electron
```

- [ ] **Step 4: Manual verification**

1. Open a `.cook` file from the workspace (e.g. one under `app/`).
2. Run "Cooklang: Render Report..." from the command palette → QuickPick shows the two built-in templates (plus any `config/reports/*.jinja` files if present).
3. Pick "Ingredients List (built-in)" → a new tab "Report: <file> (Ingredients List (built-in))" opens with a rendered markdown heading + ingredient bullets.
4. Edit the recipe (add `@butter{10%g}` to a step) → the report tab updates within ~a second without re-running the command.
5. Create `config/reports/bad.jinja` containing `{% for %}` in the workspace, re-run the command, pick it → the tab shows the minijinja error in the preformatted error block (no popup, no crash).
6. Open a `.menu` file, run the command → info toast "Reports are not supported for menu files yet."
7. Right-click inside a `.cook` editor → "Cooklang: Render Report..." appears in the context menu.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): wire up report widget factory and contribution"
```
