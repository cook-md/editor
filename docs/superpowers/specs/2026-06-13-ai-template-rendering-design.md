# AI-Authored Template Rendering — Design

**Date:** 2026-06-13
**Status:** Approved (design)
**Related:** [2026-06-10-cooklang-report-design.md](./2026-06-10-cooklang-report-design.md), cookbot skill decomposition (`cook.md/cookbot` `docs/superpowers/specs/2026-06-04-cookbot-skill-decomposition-design.md`)

## Goal

Let the Cookbot AI assistant **author Jinja2 report templates and render them during its agentic loop** to achieve user goals. Three use cases, all in scope:

1. **Compute an answer** — render a template to calculate something (total cost, nutrition, ingredient counts), read the output, answer the user in chat. Output is intermediate.
2. **Produce a saved report** — author a reusable `.jinja` template and/or a rendered report the user keeps. Output is a deliverable artifact.
3. **Iterative authoring** — render to validate, see errors/output, fix, repeat — using render as a feedback loop while building a report.

**Render scope:** a single `.cook` recipe **or** a single `.menu` file — matching the existing "Render Report" command exactly. Multi-recipe aggregation is handled via `.menu` files, already supported by the renderer.

## Background — what already exists

- **Render pipeline:** `CooklangLanguageService.renderReport(recipeContent, templateContent, configJson)` (RPC) → Rust native `render_report(recipe, template, config_json)` (minijinja). Returns JSON `{ "output": "…" }` or `{ "error": "…" }`. The template is passed as a **string**, so rendering an arbitrary AI-authored template is already possible with no native change.
- **`ReportContribution`** (`packages/cooklang/src/browser/report-contribution.ts`) owns, inline: active-recipe URI resolution (`getActiveCooklangUri`), config assembly (`buildConfigJson` — scale + workspace `config/aisle.conf`, `config/pantry.conf`, `db`/`config/db` as URI strings), and widget reuse (`getOrCreateReport`).
- **`ReportWidget`** (`packages/cooklang/src/browser/report-widget.tsx`) renders against a recipe URI + a template that is either a workspace file (`templateUri`) or a built-in (`ReportTemplates.byId`). It reads recipe/template from the open Monaco model (unsaved edits) with a `FileService` fallback, and picks markdown/HTML/text display by template filename.
- **Cookbot agentic loop:** runs **client-side** in `cookbot-language-model.ts`. The Rust server (`cook.md/cookbot`) is a thin Claude proxy plus a server-side **skill** system (`loadSkill`). Skills are markdown in `crates/server/prompts/skills/`, `include_str!`'d in `src/skills/mod.rs`, listed in `SKILL_NAMES` + `load_skill()` + the `loadSkill` enum. A `reports` skill already exists (analytics *interpretation*).
- **Tool registration:** the cookbot chat agent includes **all** registered `ToolProvider`s via `ToolInvocationRegistry.getAllFunctions()`. A new tool needs only `bindToolProvider(...)`. Existing tools: server tools (`searchWeb`, `fetchUrl`, `convert*`) and local file tools (read files, `suggestFileContent` user-reviewed changeset).

## Architecture

One new client tool + one extracted shared service + a small widget extension + one server skill. **No proto changes, no Rust-native changes.**

### Decision: tool placement — `@theia/cooklang`

The render tool drives `CooklangLanguageService.renderReport`, the config-assembly logic, `ReportWidget`, and `ReportTemplates` — all in `@theia/cooklang`. So the tool lives in `@theia/cooklang`, adding only `@theia/ai-core` (interface-only) as a dependency. The alternative — placing it in `cooklang-ai` — would pull the entire `@theia/cooklang` language package (grammar, LSP client, widgets) into the AI package. The tool implements ai-core's `ToolProvider` and is registered via cooklang's existing frontend module; the cookbot agent picks it up automatically.

### Components

1. **`ReportConfigService`** — `packages/cooklang/src/browser/report-config-service.ts` (new, `@injectable()`).
   Extract from `ReportContribution`:
   - `buildConfigJson(scale?: number): Promise<string>` — workspace config assembly (currently hard-codes `scale: 1`; parameterize).
   - `getActiveCooklangUri(): URI | undefined` and the `getCooklangResourceUri`/`getActiveCooklangEditorUri` helpers.
   `ReportContribution` is refactored to depend on this service instead of holding the logic inline. Targeted refactor only — no behavior change for the command.

2. **`RenderTemplateTool`** — `packages/cooklang/src/browser/render-template-tool.ts` (new, `@injectable()`, implements `ToolProvider`). Tool id/name `renderTemplate`. Injects `ReportConfigService`, `CooklangLanguageService`, `MonacoWorkspace`, `FileService`, `WidgetManager`, `ApplicationShell`.

3. **`ReportWidget` extension** — add to `ReportWidgetOptions`:
   - `inlineTemplateContent?: string` — when set, `readTemplateContent()` returns it directly (ephemeral AI template, no file).
   - `outputFormat?: ReportOutputFormat` — when set, `getOutputFormat()` uses it (inline templates have no filename to infer from).
   The inline template id convention is `inline:<short-label>`; `getOrCreateReport` keys on it so repeated AI renders of "the report" reuse one tab.

4. **Server skill** `report-authoring` — new markdown in `cook.md/cookbot`.

### Tool contract — `renderTemplate`

Parameters:
- `templateContent` (string, **required**) — the Jinja2 template to render.
- `recipeUri` (string, optional) — `.cook`/`.menu` to render against. Defaults to the active recipe via `ReportConfigService.getActiveCooklangUri()`. If absent and none active → `{ error }` with a clear message.
- `show` (boolean, default `false`) — `true` opens/refreshes a `ReportWidget` tab showing the output; `false` is headless (output only to the model). This is the "AI decides per render" control.
- `outputFormat` (`'markdown' | 'html' | 'text'`, optional, default `'markdown'`) — display format when `show` is true.
- `scale` (number, optional, default `1`) — recipe scale.

Returns (JSON string to the model):

```json
{ "output": "…rendered text…" }
```
or
```json
{ "error": "…minijinja error including line context…" }
```

Behavior:
- Rendering is **read-only** → the tool **auto-executes** with no changeset/approval (like `searchWeb`).
- The tool **never throws** into the loop: missing/invalid `recipeUri`, no active recipe, RPC/native failure all map to `{ error: "…" }` so the model can recover (fix template, ask the user which recipe, etc.).
- **Saving is separate:** the model writes `.jinja` templates and report files via the existing user-reviewed `suggestFileContent` (convention: templates into `config/reports/`). Render + save compose; no new save tool.

### Data flow

```
model → renderTemplate({ templateContent, recipeUri?, show?, outputFormat?, scale? })
  → RenderTemplateTool.handler(argString)
      → parse args
      → ReportConfigService: resolve recipeUri (or active recipe); buildConfigJson(scale)
      → read recipe content: open Monaco model (unsaved edits) → else FileService.read
      → CooklangLanguageService.renderReport(recipe, templateContent, configJson)   [existing RPC → native addon]
      → if show: getOrCreateReport({ uri, templateId: 'inline:<label>', templateLabel,
                                     inlineTemplateContent: templateContent, outputFormat, configJson })
                 + addWidget(main) if detached + activateWidget
      → return { output } | { error }   (JSON string) to the model
  → model: answer in chat | iterate on { error } | suggestFileContent to save the template/report
```

### Server skill: `report-authoring`

New `cook.md/cookbot/crates/server/prompts/skills/report-authoring.md`. Wiring in `src/skills/mod.rs`:
- `const SKILL_REPORT_AUTHORING: &str = include_str!("../../prompts/skills/report-authoring.md");`
- add `"report-authoring"` to `SKILL_NAMES`
- add the match arm in `load_skill()` with `attach_syntax_reference: false` (template-focused; the report variable/filter reference is embedded inline in the skill body)

Skill content teaches:
- The minijinja dialect and available render context: `ingredients[].name` / `.quantity`, `metadata` (incl. `metadata.title`), `scale`; filters `aisled(ingredients)`, `db()`, `excluding_pantry()`, plus standard `sort(attribute=…)`, `titleize`, `default(…)`, `items`.
- The **render → inspect → fix** loop: render headlessly (`show:false`) to validate syntax and compute values; use `show:true` to present a finished report to the user.
- When to render ephemerally vs. save a reusable template via `suggestFileContent` into `config/reports/`.
- Output-format declaration via inner extension for saved templates (`report.html.jinja` → HTML, etc.) and the `outputFormat` param for inline renders.

Relationship to the existing `reports` skill: `reports` covers analytics *interpretation*; `report-authoring` covers *authoring + executing* templates. They are kept separate and cross-linked, since their jobs are distinct.

## Error handling

- `renderReport` already returns `{output}|{error}` JSON; the tool passes `error` through verbatim (minijinja errors carry source/line context).
- Recipe resolution failures and read failures are caught and returned as `{ error }`.
- `show:true` tab failures are non-fatal: the render result is still returned to the model even if the widget fails to open (logged, not thrown).

## Testing

- `packages/cooklang/src/browser/report-config-service.spec.ts` — config assembly (presence/absence of aisle/pantry/datastore), scale parameterization, active-URI resolution order.
- `packages/cooklang/src/browser/render-template-tool.spec.ts` — arg parsing, default-recipe resolution, recipe content read (model vs FileService), `{output}`/`{error}` passthrough, missing-recipe error, `show` path with mocked `WidgetManager`/`ApplicationShell`.
- `ReportContribution` existing behavior preserved after extraction (no regression in the command path).
- Server: cookbot `cargo build` (verifies `include_str!` + match arms) and a manual `loadSkill("report-authoring")` round-trip.

## Out of scope (YAGNI)

- Multi-recipe/folder aggregation beyond `.menu` files.
- A dedicated "save template" tool (handled by existing `suggestFileContent`).
- Server-side rendering / new proto RPCs.
- Changes to the Rust native `render_report` signature or the `cooklang-reports` crate.
- New template-discovery or template-management UI.
