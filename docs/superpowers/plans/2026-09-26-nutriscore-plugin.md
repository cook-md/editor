# Nutri-Score Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an official-style Nutri-Score strip (A–E) in the recipe preview header, computed from the cook.md nutrition API by an optional plugin, with a hover card explaining how trustworthy the score is, for users whose plan has the `nutrition` feature — built on general editor pieces so later plugins (calories, cost, allergens…) need no editor changes.

**Architecture:** The editor gains three generic pieces: `cooklang.api.hasFeature`, `cooklang.api.renderReport` (renders a plugin-supplied Jinja template against a recipe or menu with the Reports engine and configuration, so plugins get `aggregate_nutrition` & co. while the login token never leaves the editor; plus the `tojson` filter, enabled upstream in cooklang-reports 0.5.2), and a data-driven badge outlet `cooklang/recipePreview/badge` (plugins return a `PreviewBadge` — the `nutriscore` strip or a generic `pill` — and the editor draws it and shows its markdown in Theia's `HoverService`). The new `cooklang.nutriscore` plugin in `~/Cooklang/plugins/nutriscore` ships its nutrition template and owns the 2023 Nutri-Score algorithm and the trust summary.

**Tech Stack:** Rust (NAPI-RS, minijinja 2), TypeScript 5.4, InversifyJS, React 18, Theia `HoverService`, VS Code extension API, mocha/chai.

**Spec:** `docs/superpowers/specs/2026-09-26-nutriscore-plugin-design.md`

---

## Conventions for every task

- Editor repo: `/Users/alexeydubovskoy/Cooklang/editor`, branch `feature/nutriscore-plugin`. Plugins repo: `/Users/alexeydubovskoy/Cooklang/plugins`, create branch `feature/nutriscore` there in Task 9.
- Mocha needs Node 22: prefix test commands with `PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH` (default `node` is 20 and breaks browser specs).
- Editor specs run from compiled output: `npx lerna run compile --scope @theia/cooklang`, then `cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test` (the package's `test` script; runs all its specs).
- Browser specs that (transitively) import `@theia/monaco` or `@theia/filesystem` start with the JSDOM preamble from `cooklang-plugin-api-contribution.spec.ts` lines 14–23 (`enableJSDOM()` then guarded `FrontendApplicationConfigProvider.set({})`) before other imports. Never call `disableJSDOM()` in `after()`.
- New editor `.ts` files start with the AGPL header copied from `packages/cooklang/src/browser/cooklang-outlets.ts` lines 1–12 (year `2026`).
- Editor code style: 4 spaces, single quotes, `undefined` not `null`, explicit return types, property injection, `nls.localize` for user-facing strings.
- Never use the deprecated `>>` metadata syntax in any `.cook` test fixture; use YAML frontmatter.

## File map

**Editor (`packages/`)**

| File | Change |
|---|---|
| `cooklang-native/Cargo.toml`, `Cargo.lock` | `cooklang-reports` 0.5.2 (built-in `tojson` filter) |
| `cooklang-native/src/lib.rs` | regression test for `tojson` |
| `cooklang/src/common/plugin-report-types.ts` | create: `PluginReportResult` |
| `cooklang/src/common/cooklang-outlet-context.ts` | add `PreviewBadge` JSON type (`nutriscore` \| `pill`) + namespace |
| `cooklang/src/common/cooklang-outlet-context.spec.ts` | tests for `PreviewBadge.parse/equals` |
| `cooklang/src/browser/plugin-report-service.ts` | create: render plugin templates with the report config, error mapping, cache |
| `cooklang/src/browser/plugin-report-service.spec.ts` | create |
| `cooklang/src/browser/cooklang-plugin-api-contribution.ts` | `HAS_FEATURE`, `RENDER_REPORT` commands |
| `cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | tests |
| `cooklang/src/browser/cooklang-outlets.ts` | `RECIPE_PREVIEW_BADGE` |
| `cooklang/src/browser/cooklang-outlet-service.ts` | `collectBadges` |
| `cooklang/src/browser/cooklang-outlet-service.spec.ts` | tests |
| `cooklang/src/browser/nutriscore-colors.ts` | create: `ColorContribution` |
| `cooklang/src/browser/preview-badge.tsx` | create: `PreviewBadgeView` (strip + pill) |
| `cooklang/src/browser/preview-badge.spec.tsx` | create |
| `cooklang/src/browser/style/preview-badge.css` | create |
| `cooklang/src/browser/recipe-preview-components.tsx` | `RecipeView` renders badges |
| `cooklang/src/browser/recipe-preview-widget.tsx` | badge refresh + hover |
| `cooklang/src/browser/cooklang-frontend-module.ts` | bind service + colors |

**Plugins (`~/Cooklang/plugins/nutriscore/`)**

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `LICENSE`, `README.md`, `scripts/deploy.js` | scaffold |
| `src/cooklang-api.ts` (+ spec) | typed wrapper over `cooklang.api.*`, mirrored types |
| `src/nutrition-template.ts` (+ spec) | the Jinja template sent to `renderReport`; output parsing |
| `src/nutriscore.ts` (+ spec) | pure 2023 algorithm |
| `src/nutrition-input.ts` (+ spec) | aggregate → per-100 g input |
| `src/trust.ts` (+ spec) | confidence rollup, markdown |
| `src/provider.ts` (+ spec) | `provideBadge` flow |
| `src/extension.ts` | wiring |

---

## Task 1: Probe the live nutrition service (no code) — DONE 2026-09-26

Results: category slugs are plural (`fruits`, `vegetables`, `legumes`); totals carry `micros.sodium_mg` and `micros.energy_kj`. Service data quality issue found: some "raw" matches pick dried/powdered records (banana 346 kcal/100 g, milk 496 kcal/100 g) and apple reports 0 g sugar — reported to the user; out of scope here.


Resolves the two facts the spec could not verify without a token: category slug names and the sodium micro key.

- [ ] **Step 1: Get a token.** Ask the user to run `! export NUTRITION_TOKEN=<token>` with a valid cook.md token for an account that has nutrition access. Never write the token to a file or commit it. Without a token, skip to Step 3 and keep the defaults.

- [ ] **Step 2: Probe slugs and micros**

```bash
for s in fruit fruits vegetable vegetables legume legumes; do
  printf '%s ' "$s"; curl -s -H "Authorization: Bearer $NUTRITION_TOKEN" \
    "https://nutrition.cook.md/categories/$s/check?ingredient=apple" ; echo
done
curl -s -H "Authorization: Bearer $NUTRITION_TOKEN" -H 'content-type: application/json' \
  -X POST https://nutrition.cook.md/aggregate \
  -d '{"items":[{"ingredient":"salt","amount":5,"unit":"g","prep":"","region":""}],"exclusions":[]}' \
  | python3 -m json.tool | grep -i -n "sodium\|salt" | head
```

Expected: HTTP 200 JSON `{"in_category": …}` for existing slugs, `category not found` error for others; the aggregate output shows the sodium key (expected `sodium_mg`). If the `/aggregate` body shape is rejected, copy the request shape from `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cookmd-nutrition-client-0.1.0/src/lib.rs` `pub fn aggregate`.

- [ ] **Step 3: Record results.** Write the working slugs into the constant `FVL_CATEGORIES` used in Task 13 (default `['fruit', 'vegetable', 'legume']`) and the sodium key into `SODIUM_KEYS` in Task 11 (default `['sodium_mg']`). If none of the slugs exist, keep the default: the editor retries without categories and the hover says the fruit/veg share is unknown.

---

## Task 2: Use the `tojson` filter from cooklang-reports 0.5.2

`JsonExtension` (a custom `to_json` function, commit af97a4442) is replaced by minijinja's built-in `tojson` filter, now enabled upstream in `cooklang-reports` (branch `feat/tojson-filter`, commit 64e1406 in `~/Cooklang/cooklang-reports`). The built-in escapes `<`, `>`, `&`, `'` as `\uXXXX`, so it is also safe in HTML reports.

**Files:** `packages/cooklang-native/Cargo.toml`, `Cargo.lock`, `src/lib.rs`

- [ ] **Step 1: Revert the custom function.** `git revert --no-edit af97a4442`

- [ ] **Step 2: Depend on the new crate.**
  - Released: set `cooklang-reports = "0.5.2"` in `packages/cooklang-native/Cargo.toml`, run `cargo update -p cooklang-reports`.
  - Not yet released (local development only, **never commit**): append to `packages/cooklang-native/Cargo.toml`:

    ```toml
    [patch.crates-io]
    cooklang-reports = { path = "../../../cooklang-reports" }
    ```

    and remove it again before committing Step 5.

- [ ] **Step 3: Regression test** — append to `packages/cooklang-native/src/lib.rs`:

```rust
#[cfg(test)]
mod tojson_tests {
    use super::*;

    #[test]
    fn report_templates_can_return_json() {
        let out = render_report(
            "Mix @flour{200%g}.".to_string(),
            r#"{{ {"a": [1, 2], "s": "x<y"} | tojson }}"#.to_string(),
            "{}".to_string(),
        );
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let json: serde_json::Value = serde_json::from_str(v["output"].as_str().unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({ "a": [1, 2], "s": "x<y" }));
    }
}
```

Run: `cd packages/cooklang-native && cargo test --features nutrition tojson_tests && cargo test`
Expected: PASS (fails with `unknown filter` against 0.5.1 — confirms the dependency is picked up).

- [ ] **Step 4: Rebuild and smoke-check**

```bash
cd packages/cooklang-native && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npm run build && \
PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH node -e "const n=require('./index.js');console.log(n.renderReport('Mix @flour{200%g}.','{{ [1] | tojson }}','{}'))"
```

Expected: `{"output":"[1]"}`

- [ ] **Step 5: Commit** (only once `0.5.2` is on crates.io and no `[patch]` section remains)

```bash
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/lib.rs
git commit -m "chore(native): cooklang-reports 0.5.2 — report templates get the tojson filter"
```

---

## Task 3: Shared types — plugin report result and preview badge

**Files:**
- Create: `packages/cooklang/src/common/plugin-report-types.ts`
- Modify: `packages/cooklang/src/common/cooklang-outlet-context.ts`
- Test: `packages/cooklang/src/common/cooklang-outlet-context.spec.ts`

- [ ] **Step 1: Create `plugin-report-types.ts`** (header + body):

```ts
/**
 * Result of `cooklang.api.renderReport`: a plugin-supplied template rendered
 * by the Reports engine. Plain JSON: it crosses the plugin host.
 * `template` covers syntax errors, unknown functions and errors raised by
 * template functions that are not auth, plan, network or server problems.
 */
export type PluginReportFailureReason = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: PluginReportFailureReason; message: string };
```

- [ ] **Step 2: Write failing tests** — append to `cooklang-outlet-context.spec.ts` (add `PreviewBadge` to its import from `./cooklang-outlet-context`):

```ts
describe('PreviewBadge', () => {
    it('accepts a Nutri-Score badge', () => {
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' }))
            .to.deep.equal({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' });
    });

    it('accepts a pill badge and trims its text', () => {
        expect(PreviewBadge.parse({ kind: 'pill', text: ' 540 kcal ', tone: 'neutral', tooltipMarkdown: 'per serving' }))
            .to.deep.equal({ kind: 'pill', text: '540 kcal', tone: 'neutral', tooltipMarkdown: 'per serving' });
    });

    it('rejects unknown kinds, grades, tones and bad text', () => {
        expect(PreviewBadge.parse({ kind: 'other', grade: 'B', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'F', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'A', tooltipMarkdown: 3 })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'x', tone: 'loud', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: '   ', tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'x'.repeat(PreviewBadge.MAX_TEXT_LENGTH + 1), tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'pill', text: 'a\nb', tone: 'good', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse(undefined)).to.equal(undefined);
    });

    it('drops extra keys and truncates very long tooltips', () => {
        const parsed = PreviewBadge.parse({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(10000), extra: 1 });
        expect(parsed).to.deep.equal({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(PreviewBadge.MAX_TOOLTIP_LENGTH) });
    });

    it('compares badge lists by value', () => {
        const a: PreviewBadge = { kind: 'nutriscore', grade: 'A', tooltipMarkdown: 't' };
        const pill: PreviewBadge = { kind: 'pill', text: 'x', tone: 'bad', tooltipMarkdown: '' };
        expect(PreviewBadge.equals([a, pill], [{ ...a }, { ...pill }])).to.equal(true);
        expect(PreviewBadge.equals([a], [{ ...a, grade: 'B' }])).to.equal(false);
        expect(PreviewBadge.equals([a], [])).to.equal(false);
    });
});
```

- [ ] **Step 3: Run, expect compile failure** (`PreviewBadge` not exported)

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: FAIL `Module has no exported member 'PreviewBadge'`.

- [ ] **Step 4: Implement** — append to `cooklang-outlet-context.ts`:

```ts
export type PreviewBadgeGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown';
export type PreviewBadgeTone = 'neutral' | 'good' | 'warning' | 'bad';

/**
 * What a command contributed to the `cooklang/recipePreview/badge` outlet
 * returns. The editor owns the visuals: `kind` picks a built-in rendering
 * (`nutriscore`: the official-style A–E strip; `pill`: short text tinted by
 * `tone`), and `tooltipMarkdown` is shown untrusted (no HTML, no `command:`
 * links) on hover. Return `undefined` for no badge. New kinds are additive.
 */
export type PreviewBadge =
    | { kind: 'nutriscore'; grade: PreviewBadgeGrade; tooltipMarkdown: string }
    | { kind: 'pill'; text: string; tone: PreviewBadgeTone; tooltipMarkdown: string };

export namespace PreviewBadge {
    export const GRADES: readonly PreviewBadgeGrade[] = ['A', 'B', 'C', 'D', 'E', 'unknown'];
    export const TONES: readonly PreviewBadgeTone[] = ['neutral', 'good', 'warning', 'bad'];
    export const MAX_TOOLTIP_LENGTH = 4000;
    export const MAX_TEXT_LENGTH = 24;

    /** A validated copy of a plugin's return value, or `undefined` when it is not a badge. */
    export function parse(value: unknown): PreviewBadge | undefined {
        if (typeof value !== 'object' || value === undefined || value === null) { // eslint-disable-line no-null/no-null
            return undefined;
        }
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.tooltipMarkdown !== 'string') {
            return undefined;
        }
        const tooltipMarkdown = candidate.tooltipMarkdown.slice(0, MAX_TOOLTIP_LENGTH);
        if (candidate.kind === 'nutriscore' && GRADES.includes(candidate.grade as PreviewBadgeGrade)) {
            return { kind: 'nutriscore', grade: candidate.grade as PreviewBadgeGrade, tooltipMarkdown };
        }
        if (candidate.kind === 'pill' && TONES.includes(candidate.tone as PreviewBadgeTone) && typeof candidate.text === 'string') {
            const text = candidate.text.trim();
            // eslint-disable-next-line no-control-regex
            if (text === '' || text.length > MAX_TEXT_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
                return undefined;
            }
            return { kind: 'pill', text, tone: candidate.tone as PreviewBadgeTone, tooltipMarkdown };
        }
        return undefined;
    }

    /** Parsed badges have a fixed key order, so their JSON compares by value. */
    export function equals(a: readonly PreviewBadge[], b: readonly PreviewBadge[]): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }
}
```

- [ ] **Step 5: Compile and run tests**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: PASS, including the five new `PreviewBadge` tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/common/plugin-report-types.ts packages/cooklang/src/common/cooklang-outlet-context.ts packages/cooklang/src/common/cooklang-outlet-context.spec.ts
git commit -m "feat(cooklang): PreviewBadge and plugin report result types"
```

---

## Task 4: `PluginReportService`

Renders a plugin-supplied template against a recipe or menu with the Reports configuration, maps errors, caches.

**Files:**
- Create: `packages/cooklang/src/browser/plugin-report-service.ts`
- Test: `packages/cooklang/src/browser/plugin-report-service.spec.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts` (bind)

- [ ] **Step 1: Write the failing test** `plugin-report-service.spec.ts` (header, then the JSDOM preamble from Conventions, then):

```ts
import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { PluginReportService } from './plugin-report-service';

class Fixture {
    renders: Array<{ content: string; template: string; config: string }> = [];
    configs: Array<{ scale: number; uri: string }> = [];
    responses: string[] = [];
    text = 'Mix @apple{2} and @flour{200%g}.';
    model = true;

    create(): PluginReportService {
        const service = new PluginReportService();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (service as any).languageService = {
            renderReport: async (content: string, template: string, config: string) => {
                this.renders.push({ content, template, config });
                return this.responses.shift() ?? JSON.stringify({ error: 'no response queued' });
            },
        };
        (service as any).reportConfigService = {
            buildConfigJson: async (scale: number, uri: URI) => {
                this.configs.push({ scale, uri: uri.toString() });
                return JSON.stringify({ scale });
            },
        };
        (service as any).monacoWorkspace = { getTextDocument: () => this.model ? { getText: () => this.text } : undefined };
        (service as any).fileService = { read: async () => ({ value: `disk: ${this.text}` }) };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return service;
    }
}

const URI_A = new URI('file:///ws/a.cook');
const TEMPLATE = '{{ ingredients | length | tojson }}';

describe('PluginReportService', () => {
    it('renders the template against the open editor text with the report config', async () => {
        const fixture = new Fixture();
        fixture.responses.push(JSON.stringify({ output: '2' }));
        expect(await fixture.create().render(URI_A, TEMPLATE, 2)).to.deep.equal({ ok: true, output: '2' });
        expect(fixture.renders).to.deep.equal([{ content: fixture.text, template: TEMPLATE, config: JSON.stringify({ scale: 2 }) }]);
        expect(fixture.configs).to.deep.equal([{ scale: 2, uri: 'file:///ws/a.cook' }]);
    });

    it('reads the file when no editor has it open', async () => {
        const fixture = new Fixture();
        fixture.model = false;
        fixture.responses.push(JSON.stringify({ output: '' }));
        await fixture.create().render(URI_A, TEMPLATE, 1);
        expect(fixture.renders[0].content).to.equal(`disk: ${fixture.text}`);
    });

    for (const [message, reason] of [
        ['Error: authentication required: missing or invalid API key', 'unauthenticated'],
        ['Error: subscription required for nutrition', 'forbidden'],
        ['Error: transport error: dns failure', 'network'],
        ['Error: nutrition service unavailable: 503', 'network'],
        ['Error: server error: status 500', 'server'],
        ['Error: category not found: legume\n\n--- base ---', 'template'],
        ['Error: unknown function', 'template'],
    ] as const) {
        it(`maps "${message.split('\n')[0]}" to ${reason}`, async () => {
            const fixture = new Fixture();
            fixture.responses.push(JSON.stringify({ error: message }));
            expect(await fixture.create().render(URI_A, TEMPLATE, 1))
                .to.deep.equal({ ok: false, reason, message: message.replace(/^Error: /, '').split('\n')[0] });
        });
    }

    it('reports an unreadable engine response as a template failure', async () => {
        const fixture = new Fixture();
        fixture.responses.push('not json');
        expect(await fixture.create().render(URI_A, TEMPLATE, 1))
            .to.deep.equal({ ok: false, reason: 'template', message: 'Unexpected response from the report engine.' });
    });

    it('caches successes by uri, text, template and scale, but not failures', async () => {
        const fixture = new Fixture();
        const service = fixture.create();
        fixture.responses.push(JSON.stringify({ error: 'Error: server error: status 500' }));
        fixture.responses.push(JSON.stringify({ output: 'a' }));
        await service.render(URI_A, TEMPLATE, 1);
        await service.render(URI_A, TEMPLATE, 1);
        expect(await service.render(URI_A, TEMPLATE, 1)).to.deep.equal({ ok: true, output: 'a' });
        expect(fixture.renders).to.have.length(2);
        for (const change of [
            (): Promise<unknown> => service.render(URI_A, TEMPLATE, 2),
            (): Promise<unknown> => service.render(URI_A, '{{ 1 }}', 1),
            (): Promise<unknown> => service.render(new URI('file:///ws/b.cook'), TEMPLATE, 1),
        ]) {
            fixture.responses.push(JSON.stringify({ output: 'b' }));
            await change();
        }
        fixture.text = 'Changed @apple{1}.';
        fixture.responses.push(JSON.stringify({ output: 'c' }));
        await service.render(URI_A, TEMPLATE, 1);
        expect(fixture.renders).to.have.length(6);
    });
});
```

- [ ] **Step 2: Run, expect failure** (module missing)

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: FAIL `Cannot find module './plugin-report-service'`.

- [ ] **Step 3: Implement** `plugin-report-service.ts`:

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { PluginReportFailureReason, PluginReportResult } from '../common/plugin-report-types';
import { ReportConfigService } from './report-config-service';

/**
 * Renders a plugin's Jinja template against a recipe or menu with the same
 * configuration as the Reports feature (login token, nutrition service,
 * pantry, aisle, datastore, scale), so plugins can build on report functions
 * such as `aggregate_nutrition` without ever seeing the token. Backs
 * `cooklang.api.renderReport`.
 */
@injectable()
export class PluginReportService {

    static readonly CACHE_SIZE = 20;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    /** Successful results only, least recently used first. */
    protected readonly cache = new Map<string, PluginReportResult>();

    async render(uri: URI, template: string, scale: number): Promise<PluginReportResult> {
        const text = await this.readText(uri);
        const key = JSON.stringify([uri.toString(), text, template, scale]);
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }
        const result = await this.renderUncached(uri, text, template, scale);
        if (result.ok) {
            this.cache.set(key, result);
            if (this.cache.size > PluginReportService.CACHE_SIZE) {
                this.cache.delete(this.cache.keys().next().value!);
            }
        }
        return result;
    }

    /** Unsaved edits count: the open editor model wins over the file on disk. */
    protected async readText(uri: URI): Promise<string> {
        const model = this.monacoWorkspace.getTextDocument(uri.toString());
        return model ? model.getText() : (await this.fileService.read(uri)).value;
    }

    protected async renderUncached(uri: URI, text: string, template: string, scale: number): Promise<PluginReportResult> {
        const config = await this.reportConfigService.buildConfigJson(scale, uri);
        const raw = await this.languageService.renderReport(text, template, config);
        let parsed: { output?: unknown; error?: unknown };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { ok: false, reason: 'template', message: 'Unexpected response from the report engine.' };
        }
        if (typeof parsed.error === 'string') {
            const message = parsed.error.replace(/^Error: /, '').split('\n')[0];
            return { ok: false, reason: this.reason(message), message };
        }
        if (typeof parsed.output !== 'string') {
            return { ok: false, reason: 'template', message: 'Unexpected response from the report engine.' };
        }
        return { ok: true, output: parsed.output };
    }

    protected reason(message: string): PluginReportFailureReason {
        if (/authentication required|unauthori[sz]ed/i.test(message)) {
            return 'unauthenticated';
        }
        if (/subscription|payment required|forbidden|\b40[23]\b/i.test(message)) {
            return 'forbidden';
        }
        if (/transport error|unavailable/i.test(message)) {
            return 'network';
        }
        if (/server error/i.test(message)) {
            return 'server';
        }
        return 'template';
    }
}
```

- [ ] **Step 4: Bind** in `cooklang-frontend-module.ts` next to `bind(ReportConfigService)…` (line ~176):

```ts
    bind(PluginReportService).toSelf().inSingletonScope();
```

and add `import { PluginReportService } from './plugin-report-service';`.

- [ ] **Step 5: Compile and test**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: all `PluginReportService` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/plugin-report-service.ts packages/cooklang/src/browser/plugin-report-service.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): PluginReportService — render plugin templates with the report config"
```

---

## Task 5: `cooklang.api.hasFeature` and `cooklang.api.renderReport`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write failing tests.** In the spec's `Fixture`, add fields and stubs inside `create()` (next to the other `(contribution as any).…` lines):

```ts
    features = new Set<string>(['nutrition']);
    reportCalls: Array<{ uri: string; template: string; scale: number }> = [];
```

```ts
        (contribution as any).subscriptions = { hasFeature: async (name: string) => this.features.has(name) };
        (contribution as any).pluginReports = {
            render: async (uri: URI, template: string, scale: number) => {
                this.reportCalls.push({ uri: uri.toString(), template, scale });
                return { ok: true, output: 'rendered' };
            },
        };
```

Then add a `describe` block at the end of the file, using the fixture's existing `run(id, args)` and `error(id, args)` helpers:

```ts
describe('CooklangPluginApiContribution — hasFeature and renderReport', () => {
    const { HAS_FEATURE, RENDER_REPORT } = CooklangPluginApi.Commands;

    it('reports plan features', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(HAS_FEATURE, { name: 'nutrition' })).to.equal(true);
        expect(await fixture.run(HAS_FEATURE, { name: 'sync' })).to.equal(false);
    });

    it('treats a failing subscription lookup as no feature', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (contribution as any).subscriptions = { hasFeature: async () => { throw new Error('offline'); } };
        expect(await fixture.run(HAS_FEATURE, { name: 'nutrition' })).to.equal(false);
    });

    it('rejects a missing feature name', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.error(HAS_FEATURE, {})).to.match(/^Invalid arguments/);
    });

    it('renders a template for a recipe or menu URI of any scheme, scale 1 by default', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(RENDER_REPORT, { uri: 'cooklang-hub:/x/Soup.cook', template: '{{ 1 }}' }))
            .to.deep.equal({ ok: true, output: 'rendered' });
        await fixture.run(RENDER_REPORT, { uri: 'file:///ws/week.menu', template: '{{ 2 }}', scale: 3 });
        expect(fixture.reportCalls).to.deep.equal([
            { uri: 'cooklang-hub:/x/Soup.cook', template: '{{ 1 }}', scale: 1 },
            { uri: 'file:///ws/week.menu', template: '{{ 2 }}', scale: 3 },
        ]);
    });

    it('rejects bad URIs, scales and templates', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            { uri: 'file:///ws/notes.md', template: '{{ 1 }}' },
            { uri: 'a.cook', template: '{{ 1 }}' },
            { uri: 'file:///ws/a.cook', template: '{{ 1 }}', scale: 0 },
            { uri: 'file:///ws/a.cook', template: '' },
            { uri: 'file:///ws/a.cook', template: 'x'.repeat(64 * 1024 + 1) },
        ]) {
            expect(await fixture.error(RENDER_REPORT, args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.reportCalls).to.deep.equal([]);
    });
});
```

The existing first test (`registers every API command without a label`) automatically covers the two new commands.

- [ ] **Step 2: Run, expect failure** (commands not registered)

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: FAIL in the new describe block.

- [ ] **Step 3: Implement.** In `cooklang-plugin-api-contribution.ts`:

Imports:

```ts
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import { PluginReportResult } from '../common/plugin-report-types';
import { PluginReportService } from './plugin-report-service';
```

Add to `Commands`:

```ts
        /** `{ name }` → boolean: whether the signed-in user's plan includes a feature, e.g. `nutrition`. False when signed out. */
        HAS_FEATURE: 'cooklang.api.hasFeature',
        /**
         * `{ uri, template, scale? }` → `PluginReportResult`: renders a Jinja template (≤ 64 KB)
         * against a `.cook` or `.menu` URI of any scheme (unsaved edits included) with the
         * Reports engine and configuration. Template functions include everything reports
         * have (e.g. `aggregate_nutrition`, the `tojson` filter).
         */
        RENDER_REPORT: 'cooklang.api.renderReport',
```

Add a constant inside the `CooklangPluginApi` namespace:

```ts
    export const MAX_TEMPLATE_LENGTH = 64 * 1024;
```

Injections:

```ts
    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;

    @inject(PluginReportService)
    protected readonly pluginReports: PluginReportService;
```

Registration in `registerCommands`:

```ts
        registry.registerCommand({ id: Commands.HAS_FEATURE }, { execute: (args: unknown) => this.hasFeature(args) });
        registry.registerCommand({ id: Commands.RENDER_REPORT }, { execute: (args: unknown) => this.renderReport(args) });
```

Methods (after `editPantry`):

```ts
    protected async hasFeature(args: unknown): Promise<boolean> {
        const name = this.string(this.object(args).name, '`name`');
        try {
            return await this.subscriptions.hasFeature(name);
        } catch (e) {
            console.debug('[cooklang] hasFeature failed, treating as absent:', e);
            return false;
        }
    }

    protected async renderReport(args: unknown): Promise<PluginReportResult> {
        const request = this.object(args);
        const raw = this.string(request.uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !(CooklangUri.isRecipe(uri) || CooklangUri.isMenu(uri))) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe or .menu file.');
        }
        const template = this.text(request.template, '`template`');
        if (template.trim() === '' || template.length > CooklangPluginApi.MAX_TEMPLATE_LENGTH) {
            throw this.invalid(`\`template\` must be non-empty and at most ${CooklangPluginApi.MAX_TEMPLATE_LENGTH} characters.`);
        }
        const scale = request.scale === undefined ? 1 : request.scale;
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
            throw this.invalid('`scale` must be a positive number.');
        }
        return this.pluginReports.render(uri, template, scale);
    }
```

- [ ] **Step 4: Run tests, expect pass**

Run: same as Step 2. Expected: PASS (whole package).

- [ ] **Step 5: Verify against the real engine.** With the dev app built later this is covered end to end (Task 14); here, a quick native check that report functions and `tojson` combine (no token → auth error proves `aggregate_nutrition` ran; with `NUTRITION_TOKEN` set → JSON):

```bash
cd packages/cooklang-native && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH node -e "
const n=require('./index.js');
console.log(n.renderReport('Mix @apple{2} and @flour{200%g}.', '{{ aggregate_nutrition(ingredients) | tojson }}', JSON.stringify({nutritionApiUrl:'https://nutrition.cook.md',nutritionToken:process.env.NUTRITION_TOKEN||''})).slice(0,300));"
```

Expected without token: `{"error":"Error: authentication required: …`. With token: `{"output":"{\"items\":[…`.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.hasFeature and cooklang.api.renderReport"
```

---

## Task 6: Badge outlet and `CooklangOutletService.collectBadges`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-outlets.ts`
- Modify: `packages/cooklang/src/browser/cooklang-outlet-service.ts`
- Test: `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts`

- [ ] **Step 1: Write failing tests.** In the spec's `Fixture`:
  - add field `results = new Map<string, unknown>();`
  - change `(service as any).commands = …` to:

```ts
        (service as any).commands = {
            onCommandsChanged: this.commandsChanged.event,
            executeCommand: async (id: string, ...args: unknown[]) => {
                this.runs.push({ id, args });
                const result = this.results.get(id);
                if (result instanceof Error) { throw result; }
                return result;
            },
        };
```

Append:

```ts
describe('CooklangOutletService.collectBadges', () => {
    it('executes each visible command with the context and keeps valid badges in order', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('b', '2'), fixture.command('a', '1'), fixture.command('hidden', '3', { visible: () => false })];
        fixture.results.set('a', { kind: 'nutriscore', grade: 'A', tooltipMarkdown: 'first' });
        fixture.results.set('b', { kind: 'nutriscore', grade: 'C', tooltipMarkdown: 'second' });
        const badges = await fixture.create().collectBadges(PATH, CONTEXT);
        expect(badges.map(b => b.tooltipMarkdown)).to.deep.equal(['first', 'second']);
        expect(fixture.runs).to.deep.equal([{ id: 'a', args: [CONTEXT] }, { id: 'b', args: [CONTEXT] }]);
    });

    it('drops undefined, malformed and throwing providers without showing errors', async () => {
        const fixture = new Fixture();
        fixture.root!.children = [fixture.command('none', '1'), fixture.command('bad', '2'), fixture.command('boom', '3')];
        fixture.results.set('bad', { kind: 'nutriscore', grade: 'Z', tooltipMarkdown: '' });
        fixture.results.set('boom', new Error('boom'));
        expect(await fixture.create().collectBadges(PATH, CONTEXT)).to.deep.equal([]);
        expect(fixture.errors).to.deep.equal([]);
    });
});
```

- [ ] **Step 2: Run, expect failure** (`collectBadges` missing). Command as in Task 3 Step 5.

- [ ] **Step 3: Implement.** In `cooklang-outlets.ts` after `RECIPE_PREVIEW_TOOLBAR`:

```ts
    /**
     * Badges in the recipe preview header. The editor executes each contributed
     * command with a `PreviewOutletContext` and draws the `PreviewBadge` it
     * returns (or nothing for `undefined`). Re-run when the recipe, scale or
     * plan changes.
     */
    export const RECIPE_PREVIEW_BADGE: MenuPath = ['cooklang/recipePreview/badge'];
```

In `cooklang-outlet-service.ts` import `PreviewBadge` from `'../common/cooklang-outlet-context'` and add after `run`:

```ts
    /**
     * Runs every visible command of a badge outlet with `context` and returns
     * the valid badges in outlet order. A provider that fails or returns
     * something else just shows no badge; badges are passive, so no error
     * notification.
     */
    async collectBadges(menuPath: MenuPath, context: object, element?: HTMLElement): Promise<PreviewBadge[]> {
        const nodes = this.visibleCommands(menuPath, context, element);
        const results = await Promise.all(nodes.map(async node => {
            try {
                return PreviewBadge.parse(await this.commands.executeCommand(node.id, context));
            } catch (e) {
                console.warn(`[cooklang] badge provider ${node.id} failed:`, e);
                return undefined;
            }
        }));
        return results.filter((badge): badge is PreviewBadge => badge !== undefined);
    }
```

- [ ] **Step 4: Run tests, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-outlets.ts packages/cooklang/src/browser/cooklang-outlet-service.ts packages/cooklang/src/browser/cooklang-outlet-service.spec.ts
git commit -m "feat(cooklang): recipe preview badge outlet"
```

---

## Task 7: Badge component (Nutri-Score strip and pill), colors and CSS

**Files:**
- Create: `packages/cooklang/src/browser/nutriscore-colors.ts`
- Create: `packages/cooklang/src/browser/preview-badge.tsx`
- Create: `packages/cooklang/src/browser/style/preview-badge.css`
- Test: `packages/cooklang/src/browser/preview-badge.spec.tsx`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- [ ] **Step 1: Write the failing test** `preview-badge.spec.tsx` (same JSDOM preamble as `cooklang-action-bar.spec.tsx` lines 14–32):

```tsx
import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { PreviewBadgeView } from './preview-badge';

const { act } = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PreviewBadgeView', () => {
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

    it('renders the A–E strip with the grade selected and an accessible label', () => {
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'nutriscore', grade: 'B', tooltipMarkdown: 'x' }} onShowDetails={() => undefined} onHideDetails={() => undefined} />));
        const badge = host.querySelector('.cooklang-nutriscore')!;
        expect(badge.getAttribute('aria-label')).to.equal('Nutri-Score B');
        expect(badge.getAttribute('tabindex')).to.equal('0');
        const cells = [...host.querySelectorAll('.cooklang-nutriscore-cell')];
        expect(cells.map(cell => cell.textContent)).to.deep.equal(['A', 'B', 'C', 'D', 'E']);
        expect(cells.filter(cell => cell.classList.contains('selected')).map(cell => cell.textContent)).to.deep.equal(['B']);
    });

    it('greys the strip and shows a question mark for an unknown grade', () => {
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x' }} onShowDetails={() => undefined} onHideDetails={() => undefined} />));
        const badge = host.querySelector('.cooklang-nutriscore')!;
        expect(badge.classList.contains('unknown')).to.equal(true);
        expect(badge.getAttribute('aria-label')).to.equal('Nutri-Score unknown');
        expect(host.querySelector('.cooklang-nutriscore-cell.selected')!.textContent).to.equal('?');
    });

    it('asks for details on hover and focus, and hides them on blur', () => {
        const events: string[] = [];
        const badge = { kind: 'nutriscore' as const, grade: 'A' as const, tooltipMarkdown: 'x' };
        act(() => root.render(<PreviewBadgeView badge={badge}
            onShowDetails={(shown, target, immediate) => events.push(`show:${shown.grade}:${target.className.split(' ')[0]}:${immediate}`)}
            onHideDetails={() => events.push('hide')} />));
        const element = host.querySelector('.cooklang-nutriscore') as HTMLElement;
        act(() => { element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        act(() => { element.focus(); });
        act(() => { element.blur(); });
        expect(events).to.deep.equal(['show:A:cooklang-nutriscore:false', 'show:A:cooklang-nutriscore:true', 'hide']);
    });

    it('renders a pill with its text, tone and the same hover behaviour', () => {
        const events: string[] = [];
        act(() => root.render(<PreviewBadgeView badge={{ kind: 'pill', text: '540 kcal', tone: 'warning', tooltipMarkdown: 'x' }}
            onShowDetails={(shown, _target, immediate) => events.push(`show:${shown.kind}:${immediate}`)}
            onHideDetails={() => events.push('hide')} />));
        const pill = host.querySelector('.cooklang-badge-pill') as HTMLElement;
        expect(pill.textContent).to.equal('540 kcal');
        expect(pill.classList.contains('warning')).to.equal(true);
        expect(pill.getAttribute('tabindex')).to.equal('0');
        expect(host.querySelector('.cooklang-nutriscore')).to.equal(null); // eslint-disable-line no-null/no-null
        act(() => { pill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        act(() => { pill.focus(); });
        act(() => { pill.blur(); });
        expect(events).to.deep.equal(['show:pill:false', 'show:pill:true', 'hide']);
    });
});
```

(React's `onMouseEnter` is driven by `mouseover`/`mouseout` in React 18's event system, hence `mouseover` in the test.)

- [ ] **Step 2: Run, expect failure** (module missing).

- [ ] **Step 3: Implement `preview-badge.tsx`:**

```tsx
import * as React from '@theia/core/shared/react';
import { nls } from '@theia/core/lib/common/nls';
import { PreviewBadge } from '../common/cooklang-outlet-context';

import '../../src/browser/style/preview-badge.css';

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface PreviewBadgeViewProps {
    badge: PreviewBadge;
    /** `immediate` is true for keyboard focus, where the hover delay would feel broken. */
    onShowDetails: (badge: PreviewBadge, target: HTMLElement, immediate: boolean) => void;
    onHideDetails: () => void;
}

/**
 * A plugin badge in the recipe preview header: the official-style Nutri-Score
 * strip (five letter cells, the grade enlarged) or a short text pill. Details
 * live only in the hover card (see `onShowDetails`).
 */
export const PreviewBadgeView = ({ badge, onShowDetails, onHideDetails }: PreviewBadgeViewProps): React.ReactElement => {
    const handleMouseEnter = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        onShowDetails(badge, event.currentTarget, false);
    }, [badge, onShowDetails]);
    const handleFocus = React.useCallback((event: React.FocusEvent<HTMLElement>) => {
        onShowDetails(badge, event.currentTarget, true);
    }, [badge, onShowDetails]);
    if (badge.kind === 'pill') {
        return (
            <span className={`cooklang-badge-pill ${badge.tone}`} tabIndex={0}
                onMouseEnter={handleMouseEnter} onFocus={handleFocus} onBlur={onHideDetails}>
                {badge.text}
            </span>
        );
    }
    const unknown = badge.grade === 'unknown';
    return (
        <div
            className={`cooklang-nutriscore${unknown ? ' unknown' : ''}`}
            role='img'
            tabIndex={0}
            aria-label={nls.localize('theia/cooklang/nutriscoreLabel', 'Nutri-Score {0}', badge.grade)}
            onMouseEnter={handleMouseEnter}
            onFocus={handleFocus}
            onBlur={onHideDetails}
        >
            <span className='cooklang-nutriscore-title'>NUTRI-SCORE</span>
            <span className='cooklang-nutriscore-strip'>
                {LETTERS.map(letter => (
                    <span key={letter}
                        className={`cooklang-nutriscore-cell cooklang-nutriscore-${letter.toLowerCase()}${letter === badge.grade ? ' selected' : ''}`}>
                        {letter}
                    </span>
                ))}
                {unknown && <span className='cooklang-nutriscore-cell selected'>?</span>}
            </span>
        </div>
    );
};
```

The `?` cell renders only for `unknown`, so graded badges have exactly five cells.

- [ ] **Step 4: Implement `nutriscore-colors.ts`:**

```ts
import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';

/**
 * Nutri-Score grade colors. These are the official label colors, not theme
 * colors, so they are the same in every theme; registered (not hard-coded in
 * CSS) so a theme can still override them.
 */
@injectable()
export class NutriScoreColorContribution implements ColorContribution {
    registerColors(colors: ColorRegistry): void {
        const grade = (letter: string, color: string): void => {
            colors.register({
                id: `cooklang.nutriscore${letter}`,
                defaults: { dark: color, light: color, hcDark: color, hcLight: color },
                description: `Nutri-Score grade ${letter} color in the recipe preview.`,
            });
        };
        grade('A', '#038141');
        grade('B', '#85BB2F');
        grade('C', '#FECB02');
        grade('D', '#EE8100');
        grade('E', '#E63E11');
        colors.register({
            id: 'cooklang.nutriscoreForeground',
            defaults: { dark: '#FFFFFF', light: '#FFFFFF', hcDark: '#FFFFFF', hcLight: '#FFFFFF' },
            description: 'Letter color on the Nutri-Score strip.',
        });
    }
}
```

- [ ] **Step 5: Implement `style/preview-badge.css`:**

```css
.cooklang-nutriscore {
    display: inline-flex;
    flex-direction: column;
    align-items: stretch;
    padding: 2px 4px 3px;
    border: 1px solid var(--theia-widget-border, var(--theia-panel-border));
    border-radius: 8px;
    background: var(--theia-editor-background);
    cursor: default;
    user-select: none;
}

.cooklang-nutriscore:focus-visible {
    outline: 1px solid var(--theia-focusBorder);
    outline-offset: 1px;
}

.cooklang-nutriscore-title {
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--theia-descriptionForeground);
    text-align: center;
    line-height: 1.2;
}

.cooklang-nutriscore-strip {
    display: flex;
    align-items: center;
}

.cooklang-nutriscore-cell {
    width: 14px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--theia-cooklang-nutriscoreForeground);
    opacity: 0.55;
}

.cooklang-nutriscore-cell:first-child { border-radius: 6px 0 0 6px; }
.cooklang-nutriscore-cell:last-child { border-radius: 0 6px 6px 0; }

.cooklang-nutriscore-a { background: var(--theia-cooklang-nutriscoreA); }
.cooklang-nutriscore-b { background: var(--theia-cooklang-nutriscoreB); }
.cooklang-nutriscore-c { background: var(--theia-cooklang-nutriscoreC); }
.cooklang-nutriscore-d { background: var(--theia-cooklang-nutriscoreD); }
.cooklang-nutriscore-e { background: var(--theia-cooklang-nutriscoreE); }

.cooklang-nutriscore-cell.selected {
    width: 20px;
    height: 22px;
    margin: -3px 0;
    font-size: 14px;
    opacity: 1;
    border-radius: 7px;
    box-shadow: 0 0 0 2px var(--theia-editor-background);
    z-index: 1;
}

.cooklang-nutriscore.unknown .cooklang-nutriscore-cell {
    background: var(--theia-disabledForeground);
}

.cooklang-nutriscore.unknown .cooklang-nutriscore-cell.selected {
    background: var(--theia-descriptionForeground);
}

.cooklang-badge-pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--theia-badge-background);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--theia-foreground);
    white-space: nowrap;
    cursor: default;
}

.cooklang-badge-pill:focus-visible {
    outline: 1px solid var(--theia-focusBorder);
    outline-offset: 1px;
}

.cooklang-badge-pill.good { border-color: var(--theia-charts-green); color: var(--theia-charts-green); }
.cooklang-badge-pill.warning { border-color: var(--theia-charts-yellow); color: var(--theia-charts-yellow); }
.cooklang-badge-pill.bad { border-color: var(--theia-charts-red); color: var(--theia-charts-red); }

.theia-hover.cooklang-preview-badge-hover {
    max-width: 360px;
}
```

- [ ] **Step 6: Bind colors** in `cooklang-frontend-module.ts`:

```ts
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { NutriScoreColorContribution } from './nutriscore-colors';
…
    bind(NutriScoreColorContribution).toSelf().inSingletonScope();
    bind(ColorContribution).toService(NutriScoreColorContribution);
```

(If `ColorContribution` is already imported in the module, reuse the import.)

- [ ] **Step 7: Compile, test, expect pass.**

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang/src/browser/preview-badge.tsx packages/cooklang/src/browser/preview-badge.spec.tsx packages/cooklang/src/browser/style/preview-badge.css packages/cooklang/src/browser/nutriscore-colors.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): preview badge component — Nutri-Score strip and pill"
```

---

## Task 8: Wire badges into the recipe preview

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx` (`RecipeViewProps` ~565, header ~607–630)
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`

- [ ] **Step 1: `RecipeView` props.** In `RecipeViewProps` add (optional, so existing tests that build `RecipeView` keep compiling):

```ts
    badges?: readonly PreviewBadge[];
    onShowBadgeDetails?: (badge: PreviewBadge, target: HTMLElement, immediate: boolean) => void;
    onHideBadgeDetails?: () => void;
```

Import `PreviewBadge` from `'../common/cooklang-outlet-context'` and `PreviewBadgeView` from `'./preview-badge'`. Destructure the three props in `RecipeView`, and in `recipe-header-actions` insert before `<CooklangActionBar …/>`:

```tsx
                    {onShowBadgeDetails && onHideBadgeDetails && badges?.map((badge, index) => (
                        <PreviewBadgeView key={`${badge.kind}-${index}`} badge={badge}
                            onShowDetails={onShowBadgeDetails} onHideDetails={onHideBadgeDetails} />
                    ))}
```

- [ ] **Step 2: Widget state and refresh.** In `recipe-preview-widget.tsx`:

Imports:

```ts
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import { IngredientOutletInfo, PreviewBadge, PreviewOutletContext } from '../common/cooklang-outlet-context';
```

(replace the existing `IngredientOutletInfo, PreviewOutletContext` import line.)

Injections next to `outlets`:

```ts
    @inject(HoverService)
    protected readonly hoverService: HoverService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;
```

Fields next to `scale`:

```ts
    protected badges: PreviewBadge[] = [];
    protected badgeSequence = 0;
    protected badgeTimer: ReturnType<typeof setTimeout> | undefined;
    static readonly BADGE_DEBOUNCE_MS = 500;
```

In `init()` replace `this.toDispose.push(this.outlets.onDidChange(() => this.update()));` with:

```ts
        this.toDispose.push(this.outlets.onDidChange(() => {
            this.update();
            this.scheduleBadges();
        }));
        this.toDispose.push(this.subscriptions.onDidChangeSubscription(() => this.scheduleBadges()));
```

In `parseContent`'s success branch, after `this.update();` add `this.scheduleBadges();`. In `handleScaleChange` and `setScale` after `this.update();` add `this.scheduleBadges();`.

Methods (in the Rendering section):

```ts
    /** Badges call plugins (and the network), so they refresh after edits settle. */
    protected scheduleBadges(): void {
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
        }
        this.badgeTimer = setTimeout(() => {
            this.badgeTimer = undefined;
            this.refreshBadges();
        }, RecipePreviewWidget.BADGE_DEBOUNCE_MS);
    }

    protected async refreshBadges(): Promise<void> {
        const sequence = ++this.badgeSequence;
        const context = this.recipe ? this.previewContext() : undefined;
        const badges = context ? await this.outlets.collectBadges(CooklangOutlets.RECIPE_PREVIEW_BADGE, context, this.node) : [];
        if (this.isDisposed || sequence !== this.badgeSequence) {
            return;
        }
        if (!PreviewBadge.equals(this.badges, badges)) {
            this.badges = badges;
            this.update();
        }
    }

    protected handleShowBadgeDetails = (badge: PreviewBadge, target: HTMLElement, immediate: boolean): void => {
        this.hoverService.requestHover({
            // Untrusted, no HTML: plugin text never runs commands or injects markup.
            content: new MarkdownStringImpl(badge.tooltipMarkdown, { isTrusted: false, supportHtml: false }),
            target,
            position: 'bottom',
            cssClasses: ['cooklang-preview-badge-hover'],
            skipHoverDelay: immediate,
        });
    };

    protected handleHideBadgeDetails = (): void => {
        this.hoverService.cancelHover();
    };
```

In `render()` pass to `RecipeView`:

```tsx
                            badges={this.badges}
                            onShowBadgeDetails={this.handleShowBadgeDetails}
                            onHideBadgeDetails={this.handleHideBadgeDetails}
```

In `dispose()` next to the other timers:

```ts
        if (this.badgeTimer !== undefined) {
            clearTimeout(this.badgeTimer);
            this.badgeTimer = undefined;
        }
```

In `setUri`, reset `this.badges = [];` so a reused widget never shows a previous recipe's grade.

- [ ] **Step 3: Update widget spec stubs.** In `recipe-preview-widget.spec.ts`'s fixture constructor (~line 95), add to the `Object.assign(outlets, { … })` object:

```ts
            collectBadges: async () => [],
```

and to the `Object.assign(widget, { … })` object (next to `timerService`):

```ts
            hoverService: { requestHover: () => undefined, cancelHover: () => undefined },
            subscriptions: { onDidChangeSubscription: never },
```

- [ ] **Step 4: Compile, lint, test**

Run: `npx lerna run compile --scope @theia/cooklang && npx lerna run lint --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-components.tsx packages/cooklang/src/browser/recipe-preview-widget.tsx packages/cooklang/src/browser/recipe-preview-widget.spec.ts
git commit -m "feat(cooklang): show plugin badges in the recipe preview header"
```

---

## Task 9: Plugin scaffold

**Files (all in `~/Cooklang/plugins/nutriscore/`):** `package.json`, `tsconfig.json`, `LICENSE`, `README.md`, `scripts/deploy.js`, `src/extension.ts` (stub)

- [ ] **Step 1: Branch.** `cd ~/Cooklang/plugins && git checkout -b feature/nutriscore`

- [ ] **Step 2: `package.json`:**

```json
{
  "name": "nutriscore",
  "displayName": "Nutri-Score",
  "description": "Nutri-Score badge on recipe previews, computed from the cook.md nutrition service, with a hover card showing how reliable it is. Needs a Basic or Pro plan.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "nutriscore" },
  "keywords": ["cooklang", "nutrition", "nutri-score", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "cooklang.nutriscore.provideBadge", "title": "Nutri-Score", "category": "Nutri-Score" }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.nutriscore.provideBadge", "when": "false" }
      ],
      "cooklang/recipePreview/badge": [
        { "command": "cooklang.nutriscore.provideBadge" }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -w -p .",
    "test": "tsc -p . && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js",
    "vscode:prepublish": "npm run compile",
    "package": "vsce package --no-dependencies",
    "publish:marketplace": "ovsx publish --packagePath nutriscore-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^3.3.0",
    "mocha": "^10.4.0",
    "ovsx": "^1.0.0",
    "typescript": "~5.4.5"
  }
}
```

- [ ] **Step 3: Copy boilerplate.** `cp ../pantry/tsconfig.json ../pantry/LICENSE .` and create `scripts/deploy.js` as a copy of `../pantry/scripts/deploy.js` with `plugins/cooklang.pantry` → `plugins/cooklang.nutriscore` and the copied entries list `['package.json', 'out', 'README.md', 'LICENSE']` (no `media`).

- [ ] **Step 4: `README.md`:**

```markdown
# Nutri-Score for Cook Editor

Shows a Nutri-Score (A–E) in the header of every recipe preview. Hover the
badge to see how reliable the score is: how many ingredients were matched,
which were estimated, the data sources and the estimated fruit/vegetable
share.

Requires signing in to cook.md with a Basic or Pro plan (nutrition data comes
from the cook.md nutrition service). Without it, no badge is shown.

The score is an estimate from the recipe's ingredients using the 2023
Nutri-Score algorithm for general foods. It is not a certified label.

Install it from the Extensions view (plugins.cook.md).
```

- [ ] **Step 5: Stub `src/extension.ts`** so the package compiles:

```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
    // Wired in Task 13.
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 6: Install and compile**

Run: `cd ~/Cooklang/plugins/nutriscore && npm install && npm run compile`
Expected: `out/extension.js` exists, no errors.

- [ ] **Step 7: Commit**

```bash
git add nutriscore/package.json nutriscore/package-lock.json nutriscore/tsconfig.json nutriscore/LICENSE nutriscore/README.md nutriscore/scripts/deploy.js nutriscore/src/extension.ts
git commit -m "feat(nutriscore): scaffold plugin"
```

---

## Task 10: 2023 Nutri-Score algorithm

**Files:** Create `nutriscore/src/nutriscore.ts`, Test `nutriscore/src/nutriscore.spec.ts`

- [ ] **Step 1: Failing tests** `nutriscore.spec.ts`:

```ts
import * as assert from 'assert';
import { gradeFor, nutriScore, Per100g } from './nutriscore';

const base: Per100g = { energyKj: 0, sugarsG: 0, satFatG: 0, saltG: 0, proteinG: 0, fibreG: 0, fvlPercent: 0 };

describe('nutriScore (2023, general foods)', () => {
    it('scores a fruit-heavy, low-energy dish as A', () => {
        // N = 0; P = protein 2 (>4.8) + fibre 1 (>3.0) + fvl 5 (>80) = 8; score -8.
        const result = nutriScore({ ...base, energyKj: 250, sugarsG: 2, satFatG: 0.5, saltG: 0.1, proteinG: 5, fibreG: 4, fvlPercent: 90 });
        assert.deepStrictEqual(result, { grade: 'A', score: -8, negative: 0, positive: 8, proteinCounted: true });
    });

    it('scores an energy-dense, sugary, salty dish as E and ignores protein', () => {
        // energy 6 (>2010), sugars 8 (>27), sat fat 10 (>10), salt 7 (>1.4) => N = 31; protein ignored (N >= 11).
        const result = nutriScore({ ...base, energyKj: 2100, sugarsG: 30, satFatG: 12, saltG: 1.5, proteinG: 10 });
        assert.deepStrictEqual(result, { grade: 'E', score: 31, negative: 31, positive: 0, proteinCounted: false });
    });

    it('does not count protein once negative points reach 11', () => {
        // energy 2 (>670), sat fat 5 (>5), salt 5 (>1.0) => N = 12; protein 20 g would be 7 points.
        const result = nutriScore({ ...base, energyKj: 700, sugarsG: 1, satFatG: 5.5, saltG: 1.1, proteinG: 20 });
        assert.strictEqual(result.proteinCounted, false);
        assert.strictEqual(result.score, 12);
        assert.strictEqual(result.grade, 'D');
    });

    it('counts protein below 11 negative points', () => {
        // energy 2, sat fat 5, salt 3 (>0.6) => N = 10; protein 7 (>17).
        const result = nutriScore({ ...base, energyKj: 700, satFatG: 5.5, saltG: 0.7, proteinG: 20 });
        assert.strictEqual(result.proteinCounted, true);
        assert.strictEqual(result.score, 3);
        assert.strictEqual(result.grade, 'C');
    });

    it('uses strictly-greater thresholds', () => {
        assert.strictEqual(nutriScore({ ...base, energyKj: 335 }).negative, 0);
        assert.strictEqual(nutriScore({ ...base, energyKj: 335.1 }).negative, 1);
        assert.strictEqual(nutriScore({ ...base, saltG: 0.6 }).negative, 2);
        assert.strictEqual(nutriScore({ ...base, fvlPercent: 80 }).positive, 2);
    });

    it('maps scores to grades at the 2023 boundaries', () => {
        assert.deepStrictEqual([-15, 0, 1, 2, 3, 10, 11, 18, 19].map(gradeFor), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E']);
    });
});
```

- [ ] **Step 2: Run, expect failure** — `npm test` → `Cannot find module './nutriscore'`.

- [ ] **Step 3: Implement** `nutriscore.ts`:

```ts
// Nutri-Score, 2023 algorithm for general foods (not beverages, cheese, or
// fats/oils/nuts). Thresholds are "strictly greater than": a value earns one
// point per threshold it exceeds. Source: Nutri-Score Scientific Committee
// update report (2022), as implemented by Open Food Facts.

export type NutriGrade = 'A' | 'B' | 'C' | 'D' | 'E';

/** Values per 100 g of the dish. */
export interface Per100g {
    energyKj: number;
    sugarsG: number;
    satFatG: number;
    saltG: number;
    proteinG: number;
    fibreG: number;
    /** Share of fruit, vegetables and legumes by weight, 0–100. */
    fvlPercent: number;
}

export interface NutriScoreResult {
    grade: NutriGrade;
    score: number;
    negative: number;
    positive: number;
    /** False when negative points are 11 or more: protein then does not count. */
    proteinCounted: boolean;
}

const ENERGY_KJ = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS_G = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];
const SAT_FAT_G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SALT_G = Array.from({ length: 20 }, (_, index) => Math.round((index + 1) * 2) / 10);
const PROTEIN_G = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];
const FIBRE_G = [3.0, 4.1, 5.2, 6.3, 7.4];

function points(value: number, thresholds: readonly number[]): number {
    return thresholds.filter(threshold => value > threshold).length;
}

function fvlPoints(percent: number): number {
    if (percent > 80) {
        return 5;
    }
    if (percent > 60) {
        return 2;
    }
    return percent > 40 ? 1 : 0;
}

export function gradeFor(score: number): NutriGrade {
    if (score <= 0) {
        return 'A';
    }
    if (score <= 2) {
        return 'B';
    }
    if (score <= 10) {
        return 'C';
    }
    return score <= 18 ? 'D' : 'E';
}

export function nutriScore(values: Per100g): NutriScoreResult {
    const negative = points(values.energyKj, ENERGY_KJ) + points(values.sugarsG, SUGARS_G)
        + points(values.satFatG, SAT_FAT_G) + points(values.saltG, SALT_G);
    const proteinCounted = negative < 11;
    const positive = points(values.fibreG, FIBRE_G) + fvlPoints(values.fvlPercent)
        + (proteinCounted ? points(values.proteinG, PROTEIN_G) : 0);
    const score = negative - positive;
    return { grade: gradeFor(score), score, negative, positive, proteinCounted };
}
```

- [ ] **Step 4: Run tests, expect pass.** `npm test` → all `nutriScore` tests PASS.

- [ ] **Step 5: Cross-check thresholds** against Open Food Facts' 2023 implementation (`lib/ProductOpener/Nutriscore.pm`, `%points_thresholds_2023`, in github.com/openfoodfacts/openfoodfacts-server). If any table or the protein rule differs, fix the constant **and** the affected test expectations, re-run.

- [ ] **Step 6: Commit**

```bash
git add nutriscore/src/nutriscore.ts nutriscore/src/nutriscore.spec.ts
git commit -m "feat(nutriscore): 2023 Nutri-Score algorithm for general foods"
```

---

## Task 11: Cooklang API wrapper, nutrition template and per-100 g input

**Files:** Create in `nutriscore/src/`: `cooklang-api.ts` (+ spec), `nutrition-template.ts` (+ spec), `nutrition-input.ts` (+ spec)

- [ ] **Step 1: Failing tests** `cooklang-api.spec.ts`:

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
    it('calls hasFeature and renderReport with one JSON argument', async () => {
        const { api, calls } = recorder(true);
        await api.hasFeature('nutrition');
        await api.renderReport({ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', args: [{ name: 'nutrition' }] },
            { command: 'cooklang.api.renderReport', args: [{ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 }] },
        ]);
    });

    it('reports support only when both commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.hasFeature', 'cooklang.api.renderReport']).api.supportsReports(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.renderReport']).api.supportsReports(), false);
    });
});
```

`nutrition-template.ts` spec — `nutrition-template.spec.ts`:

```ts
import * as assert from 'assert';
import { nutritionTemplate, parseNutritionOutput } from './nutrition-template';

const aggregate = {
    items: [
        { ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'flour', preparation: '', amount: { value: 200, unit: 'g', mass_g: 200 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 500 },
};

describe('nutritionTemplate', () => {
    it('embeds the category slugs and returns JSON through tojson', () => {
        const template = nutritionTemplate(['fruit', 'vegetable']);
        assert.ok(template.startsWith('{%- set categories = ["fruit","vegetable"] -%}'));
        assert.ok(template.includes('aggregate_nutrition(ingredients)'));
        assert.ok(template.trimEnd().endsWith('{{ {"aggregate": agg, "categoryIngredients": found.names} | tojson }}'));
    });

    it('rejects slugs that could break the template', () => {
        assert.throws(() => nutritionTemplate(['fruit"] %}{{ x']), /slug/);
    });
});

describe('parseNutritionOutput', () => {
    it('sums the mass of category ingredients', () => {
        const data = parseNutritionOutput(JSON.stringify({ aggregate, categoryIngredients: ['apple'] }), true);
        assert.strictEqual(data?.categoryMassG, 300);
        assert.strictEqual(data?.aggregate.totals.mass_g, 500);
    });

    it('leaves categoryMassG undefined when no categories were requested', () => {
        const data = parseNutritionOutput(JSON.stringify({ aggregate, categoryIngredients: [] }), false);
        assert.strictEqual(data?.categoryMassG, undefined);
    });

    it('returns undefined for output that is not the template result', () => {
        assert.strictEqual(parseNutritionOutput('not json', true), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: {} }), true), undefined);
    });
});
```

`nutrition-input.spec.ts`:

```ts
import * as assert from 'assert';
import { toPer100g } from './nutrition-input';
import { NutritionAggregate } from './nutrition-template';

const aggregate = (mass: number, micros: Record<string, number> = { sodium_mg: 400 }): NutritionAggregate => ({
    items: [],
    failures: [],
    totals: {
        mass_g: mass,
        macros: { kcal: 400, protein_g: 10, fat_g: 5, carb_g: 50, fiber_g: 6, sugar_g: 8, sat_fat_g: 2 },
        micros,
        confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 2, failed_count: 0,
    },
});

describe('toPer100g', () => {
    it('scales totals to 100 g, converts kcal to kJ and sodium to salt', () => {
        const values = toPer100g(aggregate(200), 50)!;
        assert.strictEqual(Math.round(values.energyKj * 100) / 100, 836.8);
        assert.strictEqual(values.proteinG, 5);
        assert.strictEqual(values.fibreG, 3);
        assert.strictEqual(values.sugarsG, 4);
        assert.strictEqual(values.satFatG, 1);
        assert.strictEqual(values.saltG, 0.5);
        assert.strictEqual(values.fvlPercent, 25);
    });

    it('prefers the service energy_kj over converting kcal', () => {
        assert.strictEqual(toPer100g(aggregate(200, { energy_kj: 1000 }), undefined)!.energyKj, 500);
    });

    it('treats an unknown fruit/veg share as 0 and missing sodium as 0', () => {
        const values = toPer100g(aggregate(100, {}), undefined)!;
        assert.strictEqual(values.fvlPercent, 0);
        assert.strictEqual(values.saltG, 0);
    });

    it('returns undefined without a total mass', () => {
        assert.strictEqual(toPer100g(aggregate(0), undefined), undefined);
    });

    it('caps the fruit/veg share at 100 %', () => {
        assert.strictEqual(toPer100g(aggregate(100), 150)!.fvlPercent, 100);
    });
});
```

- [ ] **Step 2: Run, expect failure.** `npm test` → cannot find modules.

- [ ] **Step 3: Implement `cooklang-api.ts`:**

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/plugin-report-types.ts`
// and `cooklang-outlet-context.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;
export const REPORT_COMMANDS = ['cooklang.api.hasFeature', 'cooklang.api.renderReport'] as const;

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };

export interface PreviewOutletContext {
    version: number;
    uri: string;
    path: string;
    scale: number;
}

/** The subset of the editor's `PreviewBadge` this plugin returns. */
export interface NutriScoreBadge {
    kind: 'nutriscore';
    grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'unknown';
    tooltipMarkdown: string;
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    async supportsReports(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return REPORT_COMMANDS.every(command => commands.has(command));
    }

    hasFeature(name: string): Promise<boolean> {
        return this.call('cooklang.api.hasFeature', { name });
    }

    renderReport(args: { uri: string; template: string; scale: number }): Promise<PluginReportResult> {
        return this.call('cooklang.api.renderReport', args);
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

- [ ] **Step 4: Implement `nutrition-template.ts`:**

```ts
// The Jinja template this plugin asks the editor's Reports engine to render.
// It uses the engine's nutrition functions (`aggregate_nutrition`,
// `is_in_category`) and hands the data back with the `tojson` filter. Types mirror the
// cook.md nutrition service's `/aggregate` response (snake_case, verbatim).

export interface NutritionMacros {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carb_g: number;
    fiber_g: number;
    sugar_g: number;
    sat_fat_g: number;
}

export interface NutritionItem {
    ingredient: string;
    preparation: string;
    amount: { value: number; unit: string; mass_g: number };
    macros: NutritionMacros;
    micros: Record<string, number>;
    source: string;
    confidence: string;
    warnings: unknown[];
}

export interface NutritionFailure {
    index: number;
    ingredient: string;
    error: { code: string; message: string; suggestions?: string[] };
}

export interface NutritionAggregate {
    items: NutritionItem[];
    failures: NutritionFailure[];
    totals: {
        mass_g: number;
        macros: NutritionMacros;
        micros: Record<string, number>;
        confidence: string;
        confidence_weighted: string;
        is_partial: boolean;
        included_count: number;
        failed_count: number;
    };
}

export interface NutritionData {
    aggregate: NutritionAggregate;
    /** Grams of matched ingredients in any requested category; undefined when none were requested. */
    categoryMassG?: number;
}

const SLUG = /^[a-z0-9-]{1,40}$/;

/** `categories` are embedded as a JSON list, so they must be plain slugs. */
export function nutritionTemplate(categories: readonly string[]): string {
    if (!categories.every(slug => SLUG.test(slug))) {
        throw new Error('Category slug must be lowercase letters, digits or dashes.');
    }
    return [
        `{%- set categories = ${JSON.stringify(categories)} -%}`,
        '{%- set agg = aggregate_nutrition(ingredients) -%}',
        '{%- set found = namespace(names=[]) -%}',
        '{%- for item in agg["items"] -%}',
        '{%- set hit = namespace(value=false) -%}',
        '{%- for slug in categories -%}',
        '{%- if not hit.value and is_in_category(item.ingredient, slug) -%}{%- set hit.value = true -%}{%- endif -%}',
        '{%- endfor -%}',
        '{%- if hit.value -%}{%- set found.names = found.names + [item.ingredient] -%}{%- endif -%}',
        '{%- endfor -%}',
        '{{ {"aggregate": agg, "categoryIngredients": found.names} | tojson }}',
    ].join('\n');
}

export function parseNutritionOutput(output: string, categoriesRequested: boolean): NutritionData | undefined {
    let data: { aggregate?: NutritionAggregate; categoryIngredients?: unknown };
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    const aggregate = data.aggregate;
    if (!aggregate || !Array.isArray(aggregate.items) || !Array.isArray(aggregate.failures) || typeof aggregate.totals !== 'object') {
        return undefined;
    }
    if (!categoriesRequested) {
        return { aggregate };
    }
    const members = new Set(Array.isArray(data.categoryIngredients) ? data.categoryIngredients : []);
    const categoryMassG = aggregate.items
        .filter(item => members.has(item.ingredient))
        .reduce((sum, item) => sum + (item.amount?.mass_g ?? 0), 0);
    return { aggregate, categoryMassG };
}
```

- [ ] **Step 5: Implement `nutrition-input.ts`** (verified 2026-09-26: totals carry `micros.sodium_mg` and `micros.energy_kj`):

```ts
import { NutritionAggregate } from './nutrition-template';
import { Per100g } from './nutriscore';

/** Micro keys the service uses for sodium in mg, most likely first. */
export const SODIUM_KEYS = ['sodium_mg'];
const KJ_PER_KCAL = 4.184;

/**
 * Recipe totals as per-100 g Nutri-Score input. `categoryMassG` is the weight
 * of fruit/vegetable/legume ingredients, or undefined when unknown (counted
 * as 0 %). Undefined when the service could not weigh the recipe.
 */
export function toPer100g(aggregate: NutritionAggregate, categoryMassG: number | undefined): Per100g | undefined {
    const mass = aggregate.totals.mass_g;
    if (!(mass > 0)) {
        return undefined;
    }
    const factor = 100 / mass;
    const macros = aggregate.totals.macros;
    // The service reports energy in kJ directly; fall back to converting kcal.
    const energyKj = typeof aggregate.totals.micros.energy_kj === 'number'
        ? aggregate.totals.micros.energy_kj
        : macros.kcal * KJ_PER_KCAL;
    const sodiumKey = SODIUM_KEYS.find(key => typeof aggregate.totals.micros[key] === 'number');
    const sodiumMg = sodiumKey ? aggregate.totals.micros[sodiumKey] : 0;
    return {
        energyKj: energyKj * factor,
        sugarsG: macros.sugar_g * factor,
        satFatG: macros.sat_fat_g * factor,
        saltG: sodiumMg * 2.5 / 1000 * factor,
        proteinG: macros.protein_g * factor,
        fibreG: macros.fiber_g * factor,
        fvlPercent: Math.min(100, ((categoryMassG ?? 0) / mass) * 100),
    };
}
```

- [ ] **Step 6: Run tests, expect pass.**

- [ ] **Step 7: Verify the template against the real engine** (no token → the auth error proves `aggregate_nutrition` ran; with `NUTRITION_TOKEN` → JSON with `categoryIngredients` containing `apple`):

```bash
cd ~/Cooklang/plugins/nutriscore && npm run compile && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH node -e "
const n=require('/Users/alexeydubovskoy/Cooklang/editor/packages/cooklang-native/index.js');
const t=require('./out/nutrition-template.js').nutritionTemplate(['fruits']);
console.log(n.renderReport('Mix @apple{2} and @flour{200%g}.', t, JSON.stringify({nutritionApiUrl:'https://nutrition.cook.md',nutritionToken:process.env.NUTRITION_TOKEN||''})).slice(0,400));"
```

If minijinja rejects `namespace` or the `and` short-circuit, fix `nutritionTemplate` and its test together.

- [ ] **Step 8: Commit**

```bash
git add nutriscore/src/cooklang-api.ts nutriscore/src/cooklang-api.spec.ts nutriscore/src/nutrition-template.ts nutriscore/src/nutrition-template.spec.ts nutriscore/src/nutrition-input.ts nutriscore/src/nutrition-input.spec.ts
git commit -m "feat(nutriscore): API wrapper, nutrition template and per-100 g input"
```

---

## Task 12: Trust summary and hover markdown

**Files:** Create `nutriscore/src/trust.ts`, `nutriscore/src/trust.spec.ts`

- [ ] **Step 1: Failing tests** `trust.spec.ts`:

```ts
import * as assert from 'assert';
import { escapeMarkdown, summarizeTrust, tooltipMarkdown } from './trust';
import { NutritionAggregate, NutritionItem } from './nutrition-template';

const item = (ingredient: string, mass: number, confidence: string, source = 'usda'): NutritionItem => ({
    ingredient, preparation: '', amount: { value: 1, unit: 'g', mass_g: mass },
    macros: { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 },
    micros: {}, source, confidence, warnings: [],
});

const aggregate = (items: NutritionItem[], failed: string[] = []): NutritionAggregate => ({
    items,
    failures: failed.map((ingredient, index) => ({ index, ingredient, error: { code: 'ingredient_not_found', message: 'not found' } })),
    totals: {
        mass_g: items.reduce((sum, i) => sum + i.amount.mass_g, 0),
        macros: { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 },
        micros: {}, confidence: '', confidence_weighted: '', is_partial: failed.length > 0,
        included_count: items.length, failed_count: failed.length,
    },
});

describe('summarizeTrust', () => {
    it('rolls confidence up by mass', () => {
        // (900*1 + 100*0.3) / 1000 = 0.93 -> High
        assert.strictEqual(summarizeTrust(aggregate([item('flour', 900, 'confirmed'), item('vanilla', 100, 'estimated')])).level, 'High');
        // (500*0.6 + 500*0.3) / 1000 = 0.45 -> Low
        assert.strictEqual(summarizeTrust(aggregate([item('a', 500, 'partial'), item('b', 500, 'estimated')])).level, 'Low');
        // (500*1 + 500*0.3) / 1000 = 0.65 -> Medium
        assert.strictEqual(summarizeTrust(aggregate([item('a', 500, 'confirmed'), item('b', 500, 'estimated')])).level, 'Medium');
    });

    it('counts matches, lists unmatched and estimated ingredients and groups sources', () => {
        const summary = summarizeTrust(aggregate(
            [item('flour', 500, 'confirmed'), item('milk', 300, 'partial', 'off'), item('egg', 100, 'confirmed')],
            ['pinch of magic'],
        ));
        assert.strictEqual(summary.matched, 3);
        assert.strictEqual(summary.total, 4);
        assert.deepStrictEqual(summary.unmatched, ['pinch of magic']);
        assert.deepStrictEqual(summary.estimated, [{ name: 'milk', confidence: 'partial' }]);
        assert.deepStrictEqual(summary.sources, [{ source: 'usda', count: 2 }, { source: 'off', count: 1 }]);
        assert.strictEqual(summary.reliable, true);
    });

    it('is unreliable when more than 30 % of ingredients are unmatched', () => {
        const summary = summarizeTrust(aggregate([item('a', 1, 'confirmed'), item('b', 1, 'confirmed')], ['x']));
        assert.strictEqual(summary.reliable, false);
    });
});

describe('tooltipMarkdown', () => {
    it('explains a graded score', () => {
        const summary = summarizeTrust(aggregate([item('flour', 900, 'confirmed'), item('milk', 100, 'partial', 'off')], ['salt']));
        const text = tooltipMarkdown({ grade: 'B', score: 1, negative: 7, positive: 6, proteinCounted: true }, summary, 35);
        assert.strictEqual(text, [
            '**Nutri-Score B** · 1 point (negative 7, positive 6)',
            '',
            'Confidence: **High**',
            '',
            'Matched: 2 of 3 ingredients',
            '',
            'Not matched: salt',
            '',
            'Estimated: milk (partial)',
            '',
            'Sources: USDA (1), OFF (1)',
            '',
            'Fruit/veg/legumes: ~35 % (estimated from categories)',
            '',
            '_Estimate from recipe ingredients, not a certified label._',
        ].join('\n'));
    });

    it('says why there is no grade and when the fruit/veg share is unknown', () => {
        const summary = summarizeTrust(aggregate([item('a', 1, 'confirmed')], ['x', 'y']));
        const text = tooltipMarkdown(undefined, summary, undefined);
        assert.ok(text.startsWith('**Nutri-Score unavailable**\n\nOnly 1 of 3 ingredients could be matched.'));
        assert.ok(text.includes('Fruit/veg/legumes: unknown (counted as 0 %)'));
    });

    it('says when the recipe could not be weighed', () => {
        const summary = summarizeTrust(aggregate([item('a', 0, 'confirmed')]));
        assert.ok(tooltipMarkdown(undefined, summary, undefined).includes("Ingredient weights are missing, so the score can't be computed per 100 g."));
    });
});

describe('escapeMarkdown', () => {
    it('escapes markdown and HTML specials in ingredient names', () => {
        assert.strictEqual(escapeMarkdown('[x](command:y) *b* <i>'), '\\[x\\]\\(command:y\\) \\*b\\* \\<i\\>');
    });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** `trust.ts`:

```ts
import { NutritionAggregate } from './nutrition-template';
import { NutriScoreResult } from './nutriscore';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface TrustSummary {
    level: ConfidenceLevel;
    matched: number;
    total: number;
    unmatched: string[];
    estimated: Array<{ name: string; confidence: string }>;
    sources: Array<{ source: string; count: number }>;
    /** At most 30 % of the ingredients unmatched. */
    reliable: boolean;
    /** The service could weigh the recipe. */
    weighed: boolean;
}

const CONFIDENCE_WEIGHT: Record<string, number> = { confirmed: 1, partial: 0.6, estimated: 0.3 };
export const MIN_MATCHED_SHARE = 0.7;

export function summarizeTrust(aggregate: NutritionAggregate): TrustSummary {
    const items = aggregate.items;
    const mass = items.reduce((sum, item) => sum + item.amount.mass_g, 0);
    const weighted = mass > 0
        ? items.reduce((sum, item) => sum + item.amount.mass_g * (CONFIDENCE_WEIGHT[item.confidence] ?? 0.3), 0) / mass
        : 0;
    const level: ConfidenceLevel = weighted >= 0.8 ? 'High' : weighted >= 0.5 ? 'Medium' : 'Low';
    const sources = new Map<string, number>();
    for (const item of items) {
        sources.set(item.source, (sources.get(item.source) ?? 0) + 1);
    }
    const matched = items.length;
    const total = matched + aggregate.failures.length;
    return {
        level,
        matched,
        total,
        unmatched: aggregate.failures.map(failure => failure.ingredient),
        estimated: items.filter(item => item.confidence !== 'confirmed').map(item => ({ name: item.ingredient, confidence: item.confidence })),
        sources: [...sources].map(([source, count]) => ({ source, count })),
        reliable: total > 0 && matched / total >= MIN_MATCHED_SHARE,
        weighed: aggregate.totals.mass_g > 0,
    };
}

export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, character => `\\${character}`);
}

/** `score` undefined means no grade (unreliable or not weighed). `fvlPercent` undefined means unknown. */
export function tooltipMarkdown(score: NutriScoreResult | undefined, summary: TrustSummary, fvlPercent: number | undefined): string {
    const lines: string[] = [];
    if (score) {
        const unit = Math.abs(score.score) === 1 ? 'point' : 'points';
        lines.push(`**Nutri-Score ${score.grade}** · ${score.score} ${unit} (negative ${score.negative}, positive ${score.positive})`);
    } else {
        lines.push('**Nutri-Score unavailable**');
        lines.push(!summary.weighed
            ? "Ingredient weights are missing, so the score can't be computed per 100 g."
            : `Only ${summary.matched} of ${summary.total} ingredients could be matched.`);
    }
    lines.push(`Confidence: **${summary.level}**`);
    lines.push(`Matched: ${summary.matched} of ${summary.total} ingredients`);
    if (summary.unmatched.length > 0) {
        lines.push(`Not matched: ${summary.unmatched.map(escapeMarkdown).join(', ')}`);
    }
    if (summary.estimated.length > 0) {
        lines.push(`Estimated: ${summary.estimated.map(e => `${escapeMarkdown(e.name)} (${escapeMarkdown(e.confidence)})`).join(', ')}`);
    }
    if (summary.sources.length > 0) {
        lines.push(`Sources: ${summary.sources.map(s => `${escapeMarkdown(s.source.toUpperCase())} (${s.count})`).join(', ')}`);
    }
    lines.push(fvlPercent === undefined
        ? 'Fruit/veg/legumes: unknown (counted as 0 %)'
        : `Fruit/veg/legumes: ~${Math.round(fvlPercent)} % (estimated from categories)`);
    if (score && !score.proteinCounted) {
        lines.push('Protein not counted (Nutri-Score rule for 11+ negative points).');
    }
    lines.push('_Estimate from recipe ingredients, not a certified label._');
    return lines.join('\n\n');
}
```

Note: the graded test expects no protein line because `proteinCounted: true`.

- [ ] **Step 4: Run tests, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add nutriscore/src/trust.ts nutriscore/src/trust.spec.ts
git commit -m "feat(nutriscore): trust summary and hover text"
```

---

## Task 13: Badge provider and extension wiring

**Files:** Create `nutriscore/src/provider.ts`, `nutriscore/src/provider.spec.ts`; Modify `nutriscore/src/extension.ts`

- [ ] **Step 1: Failing tests** `provider.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { NutritionAggregate, nutritionTemplate } from './nutrition-template';
import { FVL_CATEGORIES, NutriScoreBadgeProvider } from './provider';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };

const aggregate: NutritionAggregate = {
    items: [{
        ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 },
        macros: { kcal: 156, protein_g: 0.9, fat_g: 0.5, carb_g: 41, fiber_g: 7.2, sugar_g: 31, sat_fat_g: 0.1 },
        micros: { sodium_mg: 3 }, source: 'usda', confidence: 'confirmed', warnings: [],
    }],
    failures: [],
    totals: {
        mass_g: 300,
        macros: { kcal: 156, protein_g: 0.9, fat_g: 0.5, carb_g: 41, fiber_g: 7.2, sugar_g: 31, sat_fat_g: 0.1 },
        micros: { sodium_mg: 3 }, confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 1, failed_count: 0,
    },
};

const rendered = (agg: NutritionAggregate, categoryIngredients: string[]): PluginReportResult =>
    ({ ok: true, output: JSON.stringify({ aggregate: agg, categoryIngredients }) });

function provider(options: { feature?: boolean; results?: PluginReportResult[] }): {
    provider: NutriScoreBadgeProvider; calls: Array<{ command: string; arg: unknown }>; logs: string[];
} {
    const calls: Array<{ command: string; arg: unknown }> = [];
    const logs: string[] = [];
    const results = options.results ?? [rendered(aggregate, ['apple'])];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, arg: args[0] });
        if (command === 'cooklang.api.hasFeature') {
            return options.feature ?? true;
        }
        return results.shift();
    }, async () => []);
    return { provider: new NutriScoreBadgeProvider(api, message => logs.push(message)), calls, logs };
}

describe('NutriScoreBadgeProvider', () => {
    it('renders the nutrition template and returns a graded badge', async () => {
        const { provider: p, calls } = provider({});
        const badge = await p.provide(CONTEXT);
        // per 100 g: 218 kJ (0), sugars 10.3 (3), sat fat 0.03 (0), salt 0.0025 (0) => N 3;
        // fibre 2.4 (0), fvl 100 % (5), protein 0.3 (0) => P 5; score -2 => A.
        assert.strictEqual(badge?.grade, 'A');
        assert.ok(badge?.tooltipMarkdown.startsWith('**Nutri-Score A** · -2 points'));
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', arg: { name: 'nutrition' } },
            { command: 'cooklang.api.renderReport', arg: { uri: CONTEXT.uri, template: nutritionTemplate(FVL_CATEGORIES), scale: 2 } },
        ]);
    });

    it('retries without categories when the service does not know a slug', async () => {
        const { provider: p, calls } = provider({ results: [
            { ok: false, reason: 'template', message: 'category not found: legume' },
            rendered(aggregate, []),
        ] });
        const badge = await p.provide(CONTEXT);
        assert.strictEqual(calls.length, 3);
        assert.deepStrictEqual(calls[2].arg, { uri: CONTEXT.uri, template: nutritionTemplate([]), scale: 2 });
        assert.ok(badge?.tooltipMarkdown.includes('Fruit/veg/legumes: unknown (counted as 0 %)'));
    });

    it('shows no badge without the nutrition feature, and does not render', async () => {
        const { provider: p, calls } = provider({ feature: false });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(calls.length, 1);
    });

    it('shows no badge on failures and logs each reason once', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const { provider: p, logs } = provider({ results: [failure, failure] });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Nutri-Score unavailable (network): offline']);
    });

    it('shows no badge when the output is not nutrition data', async () => {
        const { provider: p, logs } = provider({ results: [{ ok: true, output: 'nope' }] });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Nutri-Score unavailable (output): unexpected template output']);
    });

    it('returns an unknown grade when too few ingredients matched', async () => {
        const failing = { ...aggregate, failures: [{ index: 1, ingredient: 'x', error: { code: 'ingredient_not_found', message: '' } }] };
        const { provider: p } = provider({ results: [rendered(failing, ['apple'])] });
        assert.strictEqual((await p.provide(CONTEXT))?.grade, 'unknown');
    });

    it('ignores anything that is not a preview context', async () => {
        const { provider: p, calls } = provider({});
        assert.strictEqual(await p.provide({ uri: 3 }), undefined);
        assert.strictEqual(calls.length, 0);
    });
});
```

(1 of 2 matched = 50 % < 70 % → unknown.)

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** `provider.ts` (slugs verified against nutrition.cook.md on 2026-09-26: `fruits`, `vegetables`, `legumes`; singular forms return `category_not_found`):

```ts
import { CooklangApi, NutriScoreBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { toPer100g } from './nutrition-input';
import { nutritionTemplate, parseNutritionOutput } from './nutrition-template';
import { nutriScore } from './nutriscore';
import { summarizeTrust, tooltipMarkdown } from './trust';

/** Category slugs of the nutrition service that count toward the fruit/vegetable/legume share. */
export const FVL_CATEGORIES = ['fruits', 'vegetables', 'legumes'];

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && typeof context.uri === 'string' && typeof context.scale === 'number';
}

/** Backs `cooklang.nutriscore.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class NutriScoreBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) { }

    async provide(context: unknown): Promise<NutriScoreBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        if (!await this.api.hasFeature('nutrition')) {
            return undefined;
        }
        let categories: readonly string[] = FVL_CATEGORIES;
        let result = await this.render(context, categories);
        if (!result.ok && result.reason === 'template' && /category not found/i.test(result.message)) {
            categories = [];
            result = await this.render(context, categories);
        }
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            return undefined;
        }
        const data = parseNutritionOutput(result.output, categories.length > 0);
        if (!data) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        const summary = summarizeTrust(data.aggregate);
        const per100g = toPer100g(data.aggregate, data.categoryMassG);
        const fvlPercent = data.categoryMassG === undefined ? undefined : per100g?.fvlPercent;
        const score = per100g && summary.reliable ? nutriScore(per100g) : undefined;
        return {
            kind: 'nutriscore',
            grade: score ? score.grade : 'unknown',
            tooltipMarkdown: tooltipMarkdown(score, summary, fvlPercent),
        };
    }

    protected render(context: PreviewOutletContext, categories: readonly string[]): Promise<PluginReportResult> {
        return this.api.renderReport({ uri: context.uri, template: nutritionTemplate(categories), scale: context.scale });
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Nutri-Score unavailable (${reason}): ${message}`);
        }
    }
}
```

- [ ] **Step 4: Wire `extension.ts`:**

```ts
import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { NutriScoreBadgeProvider } from './provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Nutri-Score');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    let supported = false;
    try {
        supported = await api.version() === SUPPORTED_API_VERSION && await api.supportsReports();
    } catch {
        supported = false;
    }
    if (!supported) {
        output.appendLine('Nutri-Score needs a newer Cook Editor (cooklang.api.renderReport is missing).');
    }
    const provider = new NutriScoreBadgeProvider(api, message => output.appendLine(message));
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.nutriscore.provideBadge',
        (outletContext: unknown) => supported ? provider.provide(outletContext) : undefined));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 5: Run all plugin tests, expect pass.** `cd ~/Cooklang/plugins/nutriscore && npm test`

- [ ] **Step 6: Commit**

```bash
git add nutriscore/src/provider.ts nutriscore/src/provider.spec.ts nutriscore/src/extension.ts
git commit -m "feat(nutriscore): badge provider"
```

---

## Task 14: End-to-end check in the running editor

- [ ] **Step 1: Build.** `cd /Users/alexeydubovskoy/Cooklang/editor && npm run compile && cd app && npm run bundle`
- [ ] **Step 2: Deploy the plugin.** `cd ~/Cooklang/plugins/nutriscore && npm run deploy` (writes to `editor/plugins/cooklang.nutriscore`; that folder is local only — make sure it is gitignored like `cooklang.recipe-hub`: check `editor/.gitignore` line ~30 and add `plugins/cooklang.nutriscore` if needed, committing that one-line change in the editor repo).
- [ ] **Step 3: Run** `npm run start:electron`, open a workspace, open a recipe with YAML frontmatter, e.g.:

```cooklang
---
servings: 2
---
Slice @apples{3} and toss with @lemon juice{1%tbsp} and @oats{80%g}.
```

- [ ] **Step 4: Check each case** (use the `run` skill / CDP workflow from `plugins-repo-meal-journal` memory if driving the app automatically):
  1. Signed out → no badge.
  2. Signed in, plan without `nutrition` in `features[]` → no badge. (Until the backend change ships, this is every account; to test the rest, temporarily return `true` from `hasFeature` in `cooklang-plugin-api-contribution.ts`, and **revert before committing**.)
  3. With the feature → strip appears after ~0.5 s; hover shows the card after the hover delay; Tab-focus shows it immediately; the card contains no clickable command links.
  4. Change scale → badge refreshes (grade typically unchanged, per-100 g).
  5. Type an unknown ingredient `@unobtainium{50%g}` → hover lists it under "Not matched"; add enough unknowns (>30 %) → greyed strip with `?`.
  6. Offline (disable network) → badge disappears, "Nutri-Score" output channel has one `network` line.
  7. Light, dark and high-contrast themes → strip readable.
- [ ] **Step 5: Screenshot** the badge + hover for the PR description.

---

## Task 15: Wrap up both repos

- [ ] **Step 1: Editor full checks**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npm run lint && npx lerna run compile --scope @theia/cooklang && (cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test) && (cd packages/cooklang-native && cargo test --features nutrition)`
Expected: all green.

- [ ] **Step 2: Plugins README** — add a row to the table in `~/Cooklang/plugins/README.md`:

```markdown
| [`nutriscore`](./nutriscore) | Nutri-Score badge on recipe previews with a hover card on how reliable it is. Needs a Basic or Pro plan. Install it from the Extensions view. Shows the preview badge outlet and rendering a report template with `cooklang.api.renderReport`. |
```

Commit: `git add README.md && git commit -m "docs: list the nutriscore plugin"`

- [ ] **Step 3: Open PRs** (editor first; plugin PR notes it needs the editor release). Ask the user before pushing. PR bodies mention the backend dependency: `/api/subscription` must include `nutrition` in `features[]` for Basic and Pro.

- [ ] **Step 4: Publishing** `cooklang.nutriscore` 0.1.0 (`npm run package` then `OVSX_PAT=… npm run publish:marketplace`) is the user's call after the editor release; do not publish without being asked.
