# Nutri-Score Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an official-style Nutri-Score strip (A–E) in the recipe preview header, computed from the cook.md nutrition API by an optional plugin, with a hover card explaining how trustworthy the score is, for users whose plan has the `nutrition` feature.

**Architecture:** The editor gains three generic pieces: `cooklang.api.hasFeature`, `cooklang.api.nutrition` (renders a fixed internal Jinja template through the existing report engine, so the login token never leaves the editor) and a data-driven badge outlet `cooklang/recipePreview/badge` (plugins return `{ kind, grade, tooltipMarkdown }`, the editor draws the strip and shows the markdown in Theia's `HoverService`). The new `cooklang.nutriscore` plugin in `~/Cooklang/plugins/nutriscore` owns the 2023 Nutri-Score algorithm and the trust summary.

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
| `cooklang-native/Cargo.toml` | add `minijinja = "2"` |
| `cooklang-native/src/lib.rs` | `JsonExtension` (`to_json`), registered in `render_report`; test |
| `cooklang/src/common/nutrition-types.ts` | create: service response types, `NutritionResult` |
| `cooklang/src/common/cooklang-outlet-context.ts` | add `PreviewBadge` JSON type + namespace |
| `cooklang/src/common/cooklang-outlet-context.spec.ts` | tests for `PreviewBadge.parse/equals` |
| `cooklang/src/browser/recipe-nutrition-service.ts` | create: template, error mapping, category retry, cache |
| `cooklang/src/browser/recipe-nutrition-service.spec.ts` | create |
| `cooklang/src/browser/cooklang-plugin-api-contribution.ts` | `HAS_FEATURE`, `NUTRITION` commands |
| `cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | tests |
| `cooklang/src/browser/cooklang-outlets.ts` | `RECIPE_PREVIEW_BADGE` |
| `cooklang/src/browser/cooklang-outlet-service.ts` | `collectBadges` |
| `cooklang/src/browser/cooklang-outlet-service.spec.ts` | tests |
| `cooklang/src/browser/nutriscore-colors.ts` | create: `ColorContribution` |
| `cooklang/src/browser/preview-badge.tsx` | create: `PreviewBadgeView` |
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
| `src/nutriscore.ts` (+ spec) | pure 2023 algorithm |
| `src/nutrition-input.ts` (+ spec) | aggregate → per-100 g input |
| `src/trust.ts` (+ spec) | confidence rollup, markdown |
| `src/provider.ts` (+ spec) | `provideBadge` flow |
| `src/extension.ts` | wiring |

---

## Task 1: Probe the live nutrition service (no code)

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

- [ ] **Step 3: Record results.** Write the working slugs into the constant `FVL_CATEGORIES` used in Task 12 (default `['fruit', 'vegetable', 'legume']`) and the sodium key into `SODIUM_KEYS` in Task 11 (default `['sodium_mg']`). If none of the slugs exist, keep the default: the editor retries without categories and the hover says the fruit/veg share is unknown.

---

## Task 2: Native `to_json` template function

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml`
- Modify: `packages/cooklang-native/src/lib.rs` (near `render_report`, ~line 1320–1370)

- [ ] **Step 1: Add dependency.** In `[dependencies]` after `cooklang-reports = "0.5"`:

```toml
minijinja = "2"
```

(Cargo unifies with the `2.20.0` already in `Cargo.lock` via `cooklang-reports`; the `ConfigExtension` trait takes that crate's `Environment`, so the major version must match.)

- [ ] **Step 2: Write the failing test.** Append to `lib.rs`:

```rust
#[cfg(test)]
mod to_json_tests {
    use super::*;

    #[test]
    fn to_json_renders_values_as_json() {
        let out = render_report(
            "Mix @flour{200%g}.".to_string(),
            r#"{{ to_json({"a": [1, 2], "s": "x<y"}) }}"#.to_string(),
            "{}".to_string(),
        );
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["output"].as_str().unwrap(), r#"{"a":[1,2],"s":"x<y"}"#);
    }
}
```

- [ ] **Step 3: Run it, expect failure**

Run: `cd packages/cooklang-native && cargo test --features nutrition to_json_tests`
Expected: FAIL — output contains `"error"` with `unknown function` / `to_json`.

- [ ] **Step 4: Implement.** Above `render_report` add:

```rust
/// Registers `to_json(value)`: serializes any template value to a JSON
/// string. The report engine ships no `tojson` filter; the editor's internal
/// templates (e.g. nutrition for plugins) use this to hand structured data
/// back to TypeScript. Marked safe so no escaping touches the JSON.
struct JsonExtension;

impl cooklang_reports::extension::ConfigExtension for JsonExtension {
    fn register(&self, env: &mut minijinja::Environment<'_>) {
        env.add_function(
            "to_json",
            |value: minijinja::Value| -> Result<minijinja::Value, minijinja::Error> {
                serde_json::to_string(&value)
                    .map(minijinja::Value::from_safe_string)
                    .map_err(|e| {
                        minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, e.to_string())
                    })
            },
        );
    }
}
```

In `render_report`, change `let config = builder.build();` to:

```rust
    let config = builder.build().with_extension(JsonExtension);
```

- [ ] **Step 5: Run tests, expect pass**

Run: `cd packages/cooklang-native && cargo test --features nutrition to_json_tests && cargo test`
Expected: PASS; the plain `cargo test` (no nutrition feature) also passes because the `#[cfg(not(feature = "nutrition"))]` path uses the same `config`.

- [ ] **Step 6: Rebuild the addon**

Run: `cd packages/cooklang-native && npm run build`
Expected: `cooklang-native.darwin-x64.node` rebuilt. Smoke-check:

```bash
PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH node -e "const n=require('./index.js');console.log(n.renderReport('Mix @flour{200%g}.','{{ to_json([1]) }}','{}'))"
```

Expected: `{"output":"[1]"}`

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-native/Cargo.toml packages/cooklang-native/Cargo.lock packages/cooklang-native/src/lib.rs
git commit -m "feat(native): to_json template function for internal report templates"
```

---

## Task 3: Shared types — nutrition result and preview badge

**Files:**
- Create: `packages/cooklang/src/common/nutrition-types.ts`
- Modify: `packages/cooklang/src/common/cooklang-outlet-context.ts`
- Test: `packages/cooklang/src/common/cooklang-outlet-context.spec.ts`

- [ ] **Step 1: Create `nutrition-types.ts`** (header + body):

```ts
/*
 * Result of `cooklang.api.nutrition`. `aggregate` is the cook.md nutrition
 * service's `/aggregate` response verbatim (snake_case keys), so plugins see
 * exactly what the service returned. Plain JSON: it crosses the plugin host.
 */

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
    /** Data source, e.g. `usda`. */
    source: string;
    /** `confirmed` | `partial` | `estimated`. */
    confidence: string;
    warnings: unknown[];
}

export interface NutritionFailure {
    index: number;
    ingredient: string;
    error: { code: string; message: string; suggestions?: string[] };
}

export interface NutritionTotals {
    mass_g: number;
    macros: NutritionMacros;
    micros: Record<string, number>;
    confidence: string;
    confidence_weighted: string;
    is_partial: boolean;
    included_count: number;
    failed_count: number;
}

export interface NutritionAggregate {
    items: NutritionItem[];
    failures: NutritionFailure[];
    totals: NutritionTotals;
}

export type NutritionFailureReason = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'parse';

export type NutritionResult =
    | {
        ok: true;
        aggregate: NutritionAggregate;
        /** Grams of matched ingredients in any requested category; absent when categories were not requested or not supported. */
        categoryMassG?: number;
    }
    | { ok: false; reason: NutritionFailureReason; message: string };
```

- [ ] **Step 2: Write failing tests** — append to `cooklang-outlet-context.spec.ts` (keep its existing imports; add `PreviewBadge` to the import from `./cooklang-outlet-context`):

```ts
describe('PreviewBadge', () => {
    it('accepts a well-formed badge', () => {
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' }))
            .to.deep.equal({ kind: 'nutriscore', grade: 'B', tooltipMarkdown: '**B**' });
    });

    it('rejects unknown kinds, grades and non-string tooltips', () => {
        expect(PreviewBadge.parse({ kind: 'other', grade: 'B', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'F', tooltipMarkdown: '' })).to.equal(undefined);
        expect(PreviewBadge.parse({ kind: 'nutriscore', grade: 'A', tooltipMarkdown: 3 })).to.equal(undefined);
        expect(PreviewBadge.parse(undefined)).to.equal(undefined);
    });

    it('drops extra keys and truncates very long tooltips', () => {
        const parsed = PreviewBadge.parse({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(10000), extra: 1 });
        expect(parsed).to.deep.equal({ kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: 'x'.repeat(PreviewBadge.MAX_TOOLTIP_LENGTH) });
    });

    it('compares badge lists by value', () => {
        const a = { kind: 'nutriscore' as const, grade: 'A' as const, tooltipMarkdown: 't' };
        expect(PreviewBadge.equals([a], [{ ...a }])).to.equal(true);
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

/**
 * What a command contributed to the `cooklang/recipePreview/badge` outlet
 * returns. The editor owns the visuals: `kind` picks a built-in rendering,
 * and `tooltipMarkdown` is shown untrusted (no HTML, no `command:` links) on
 * hover. Return `undefined` for no badge.
 */
export interface PreviewBadge {
    kind: 'nutriscore';
    grade: PreviewBadgeGrade;
    tooltipMarkdown: string;
}

export namespace PreviewBadge {
    export const GRADES: readonly PreviewBadgeGrade[] = ['A', 'B', 'C', 'D', 'E', 'unknown'];
    export const MAX_TOOLTIP_LENGTH = 4000;

    /** A validated copy of a plugin's return value, or `undefined` when it is not a badge. */
    export function parse(value: unknown): PreviewBadge | undefined {
        if (typeof value !== 'object' || value === undefined || value === null) { // eslint-disable-line no-null/no-null
            return undefined;
        }
        const candidate = value as Record<string, unknown>;
        if (candidate.kind !== 'nutriscore'
            || !GRADES.includes(candidate.grade as PreviewBadgeGrade)
            || typeof candidate.tooltipMarkdown !== 'string') {
            return undefined;
        }
        return {
            kind: 'nutriscore',
            grade: candidate.grade as PreviewBadgeGrade,
            tooltipMarkdown: candidate.tooltipMarkdown.slice(0, MAX_TOOLTIP_LENGTH),
        };
    }

    export function equals(a: readonly PreviewBadge[], b: readonly PreviewBadge[]): boolean {
        return a.length === b.length && a.every((badge, index) =>
            badge.kind === b[index].kind && badge.grade === b[index].grade && badge.tooltipMarkdown === b[index].tooltipMarkdown);
    }
}
```

- [ ] **Step 5: Compile and run tests**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: PASS, including the four new `PreviewBadge` tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/common/nutrition-types.ts packages/cooklang/src/common/cooklang-outlet-context.ts packages/cooklang/src/common/cooklang-outlet-context.spec.ts
git commit -m "feat(cooklang): PreviewBadge and nutrition result types for plugins"
```

---

## Task 4: `RecipeNutritionService`

Reads the recipe text, renders the internal template, maps errors, retries without categories, caches.

**Files:**
- Create: `packages/cooklang/src/browser/recipe-nutrition-service.ts`
- Test: `packages/cooklang/src/browser/recipe-nutrition-service.spec.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts` (bind)

- [ ] **Step 1: Write the failing test** `recipe-nutrition-service.spec.ts` (header, then the JSDOM preamble from Conventions, then):

```ts
import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { RecipeNutritionService } from './recipe-nutrition-service';

const AGGREGATE = {
    items: [
        { ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'flour', preparation: '', amount: { value: 200, unit: 'g', mass_g: 200 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 500 },
};

class Fixture {
    renders: Array<{ content: string; template: string; config: string }> = [];
    responses: string[] = [];
    text = 'Mix @apple{2} and @flour{200%g}.';

    create(): RecipeNutritionService {
        const service = new RecipeNutritionService();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (service as any).languageService = {
            renderReport: async (content: string, template: string, config: string) => {
                this.renders.push({ content, template, config });
                return this.responses.shift() ?? JSON.stringify({ error: 'no response queued' });
            },
        };
        (service as any).reportConfigService = { buildConfigJson: async (scale: number) => JSON.stringify({ scale }) };
        (service as any).monacoWorkspace = { getTextDocument: () => ({ getText: () => this.text }) };
        (service as any).fileService = { read: async () => ({ value: this.text }) };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return service;
    }
}

const URI_A = new URI('file:///ws/a.cook');
const output = (value: unknown): string => JSON.stringify({ output: JSON.stringify(value) });

describe('RecipeNutritionService', () => {
    it('returns the aggregate and sums the mass of category ingredients', async () => {
        const fixture = new Fixture();
        fixture.responses.push(output({ aggregate: AGGREGATE, categoryIngredients: ['apple'] }));
        const result = await fixture.create().compute(URI_A, 2, ['fruit']);
        expect(result).to.deep.equal({ ok: true, aggregate: AGGREGATE, categoryMassG: 300 });
        expect(fixture.renders[0].content).to.equal(fixture.text);
        expect(fixture.renders[0].config).to.equal(JSON.stringify({ scale: 2 }));
        expect(fixture.renders[0].template).to.contain('{%- set categories = ["fruit"] -%}');
    });

    it('omits categoryMassG when no categories were requested', async () => {
        const fixture = new Fixture();
        fixture.responses.push(output({ aggregate: AGGREGATE, categoryIngredients: [] }));
        const result = await fixture.create().compute(URI_A, 1, []);
        expect(result).to.deep.equal({ ok: true, aggregate: AGGREGATE });
    });

    it('retries without categories when the service does not know a slug', async () => {
        const fixture = new Fixture();
        fixture.responses.push(JSON.stringify({ error: 'Error: category not found: legume' }));
        fixture.responses.push(output({ aggregate: AGGREGATE, categoryIngredients: [] }));
        const result = await fixture.create().compute(URI_A, 1, ['legume']);
        expect(result).to.deep.equal({ ok: true, aggregate: AGGREGATE });
        expect(fixture.renders).to.have.length(2);
        expect(fixture.renders[1].template).to.contain('{%- set categories = [] -%}');
    });

    for (const [message, reason] of [
        ['Error: authentication required: missing or invalid API key', 'unauthenticated'],
        ['Error: subscription required for nutrition', 'forbidden'],
        ['Error: transport error: dns failure', 'network'],
        ['Error: nutrition service unavailable: 503', 'network'],
        ['Error: server error: status 500', 'server'],
        ['Error: unknown function', 'parse'],
    ] as const) {
        it(`maps "${message}" to ${reason}`, async () => {
            const fixture = new Fixture();
            fixture.responses.push(JSON.stringify({ error: message }));
            const result = await fixture.create().compute(URI_A, 1, []);
            expect(result).to.deep.equal({ ok: false, reason, message: message.replace(/^Error: /, '').split('\n')[0] });
        });
    }

    it('serves repeated requests for the same text and scale from the cache, but not failures', async () => {
        const fixture = new Fixture();
        const service = fixture.create();
        fixture.responses.push(JSON.stringify({ error: 'Error: server error: status 500' }));
        fixture.responses.push(output({ aggregate: AGGREGATE, categoryIngredients: [] }));
        await service.compute(URI_A, 1, []);
        await service.compute(URI_A, 1, []);
        await service.compute(URI_A, 1, []);
        expect(fixture.renders).to.have.length(2);
        fixture.text = 'Changed @apple{1}.';
        fixture.responses.push(output({ aggregate: AGGREGATE, categoryIngredients: [] }));
        await service.compute(URI_A, 1, []);
        expect(fixture.renders).to.have.length(3);
    });

    it('rejects category slugs that could break the template', async () => {
        const fixture = new Fixture();
        let error: unknown;
        try {
            await fixture.create().compute(URI_A, 1, ['fruit"] %}{{ x']);
        } catch (e) {
            error = e;
        }
        expect(String(error)).to.contain('Invalid arguments');
    });
});
```

- [ ] **Step 2: Run, expect failure** (module missing)

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: FAIL `Cannot find module './recipe-nutrition-service'`.

- [ ] **Step 3: Implement** `recipe-nutrition-service.ts`:

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { NutritionAggregate, NutritionFailureReason, NutritionResult } from '../common/nutrition-types';
import { ReportConfigService } from './report-config-service';

/**
 * Nutrition for one recipe, computed by the cook.md nutrition service through
 * the report engine (`aggregate_nutrition`, `is_in_category`), so the login
 * token and service URL stay in the editor. Backs `cooklang.api.nutrition`.
 */
@injectable()
export class RecipeNutritionService {

    static readonly CACHE_SIZE = 20;
    static readonly SLUG = /^[a-z0-9-]{1,40}$/;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    /** Successful results only, most recent last. */
    protected readonly cache = new Map<string, NutritionResult>();

    async compute(uri: URI, scale: number, categories: readonly string[]): Promise<NutritionResult> {
        if (!categories.every(slug => RecipeNutritionService.SLUG.test(slug))) {
            throw new Error('Invalid arguments: `categories` must be lowercase slugs (a-z, 0-9, -).');
        }
        const text = await this.readText(uri);
        const key = JSON.stringify([text, scale, categories]);
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }
        let result = await this.render(uri, text, scale, categories);
        if (!result.ok && categories.length > 0 && /category not found/i.test(result.message)) {
            result = await this.render(uri, text, scale, []);
        }
        if (result.ok) {
            this.cache.set(key, result);
            if (this.cache.size > RecipeNutritionService.CACHE_SIZE) {
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

    protected async render(uri: URI, text: string, scale: number, categories: readonly string[]): Promise<NutritionResult> {
        const config = await this.reportConfigService.buildConfigJson(scale, uri);
        const raw = await this.languageService.renderReport(text, this.template(categories), config);
        let parsed: { output?: string; error?: string };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { ok: false, reason: 'parse', message: 'Unexpected response from the report engine.' };
        }
        if (typeof parsed.error === 'string') {
            const message = parsed.error.replace(/^Error: /, '').split('\n')[0];
            return { ok: false, reason: this.reason(message), message };
        }
        try {
            const data = JSON.parse(parsed.output ?? '') as { aggregate: NutritionAggregate; categoryIngredients: string[] };
            const result: Extract<NutritionResult, { ok: true }> = { ok: true, aggregate: data.aggregate };
            if (categories.length > 0) {
                const members = new Set(data.categoryIngredients);
                result.categoryMassG = data.aggregate.items
                    .filter(item => members.has(item.ingredient))
                    .reduce((sum, item) => sum + (item.amount?.mass_g ?? 0), 0);
            }
            return result;
        } catch {
            return { ok: false, reason: 'parse', message: 'Unexpected nutrition data.' };
        }
    }

    protected reason(message: string): NutritionFailureReason {
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
        return 'parse';
    }

    /** `categories` are validated slugs, so embedding them as a JSON list is safe. */
    protected template(categories: readonly string[]): string {
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
            '{{ to_json({"aggregate": agg, "categoryIngredients": found.names}) }}',
        ].join('\n');
    }
}
```

Note for the retry test: the slug check runs before rendering; the retry passes `[]`, whose template line is `{%- set categories = [] -%}` as asserted.

- [ ] **Step 4: Bind** in `cooklang-frontend-module.ts` next to `bind(ReportConfigService)…` (line ~176):

```ts
    bind(RecipeNutritionService).toSelf().inSingletonScope();
```

and add `import { RecipeNutritionService } from './recipe-nutrition-service';`.

- [ ] **Step 5: Compile and test**

Run: `npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx theiaext test`
Expected: all `RecipeNutritionService` tests PASS.

- [ ] **Step 6: Verify the template against the real engine** (no token → expect the auth error, which proves `aggregate_nutrition` ran; with a token from Task 1 → expect JSON):

```bash
cd packages/cooklang-native && PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH node -e "
const n=require('./index.js');
const t=['{%- set categories = [\"fruit\"] -%}','{%- set agg = aggregate_nutrition(ingredients) -%}','{%- set found = namespace(names=[]) -%}','{%- for item in agg[\"items\"] -%}','{%- set hit = namespace(value=false) -%}','{%- for slug in categories -%}','{%- if not hit.value and is_in_category(item.ingredient, slug) -%}{%- set hit.value = true -%}{%- endif -%}','{%- endfor -%}','{%- if hit.value -%}{%- set found.names = found.names + [item.ingredient] -%}{%- endif -%}','{%- endfor -%}','{{ to_json({\"aggregate\": agg, \"categoryIngredients\": found.names}) }}'].join('\n');
console.log(n.renderReport('Mix @apple{2} and @flour{200%g}.', t, JSON.stringify({nutritionApiUrl:'https://nutrition.cook.md',nutritionToken:process.env.NUTRITION_TOKEN||''})).slice(0,400));"
```

Expected without token: `{"error":"Error: authentication required: …`. With token: `{"output":"{\"aggregate\":{\"items\":[…` and `categoryIngredients` containing `apple`. If minijinja rejects `namespace` or the `and` short-circuit, fix the template in the service and the spec's expected strings together.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang/src/browser/recipe-nutrition-service.ts packages/cooklang/src/browser/recipe-nutrition-service.spec.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): RecipeNutritionService — nutrition via the report engine"
```

---

## Task 5: `cooklang.api.hasFeature` and `cooklang.api.nutrition`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write failing tests.** In the spec's `Fixture`, add fields and stubs inside `create()` (next to the other `(contribution as any).…` lines):

```ts
    features = new Set<string>(['nutrition']);
    nutritionCalls: Array<{ uri: string; scale: number; categories: readonly string[] }> = [];
```

```ts
        (contribution as any).subscriptions = { hasFeature: async (name: string) => this.features.has(name) };
        (contribution as any).nutrition = {
            compute: async (uri: URI, scale: number, categories: readonly string[]) => {
                this.nutritionCalls.push({ uri: uri.toString(), scale, categories });
                return { ok: true, aggregate: { items: [], failures: [], totals: {} } };
            },
        };
```

Then add a `describe` block at the end of the file, using the fixture's existing `run(id, args)` and `error(id, args)` helpers:

```ts
describe('CooklangPluginApiContribution — nutrition', () => {
    const { HAS_FEATURE, NUTRITION } = CooklangPluginApi.Commands;

    it('reports plan features', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(HAS_FEATURE, { name: 'nutrition' })).to.equal(true);
        expect(await fixture.run(HAS_FEATURE, { name: 'sync' })).to.equal(false);
    });

    it('rejects a missing feature name', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.error(HAS_FEATURE, {})).to.match(/^Invalid arguments/);
    });

    it('computes nutrition for a .cook URI of any scheme with defaults', async () => {
        const fixture = new Fixture();
        fixture.create();
        const result = await fixture.run(NUTRITION, { uri: 'cooklang-hub:/x/Soup.cook' });
        expect(result).to.deep.equal({ ok: true, aggregate: { items: [], failures: [], totals: {} } });
        expect(fixture.nutritionCalls).to.deep.equal([{ uri: 'cooklang-hub:/x/Soup.cook', scale: 1, categories: [] }]);
    });

    it('passes scale and categories through', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(NUTRITION, { uri: 'file:///ws/a.cook', scale: 2, categories: ['fruit'] });
        expect(fixture.nutritionCalls[0]).to.deep.equal({ uri: 'file:///ws/a.cook', scale: 2, categories: ['fruit'] });
    });

    it('rejects non-recipe URIs, bad scales and bad categories', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            { uri: 'file:///ws/a.menu' },
            { uri: 'a.cook' },
            { uri: 'file:///ws/a.cook', scale: 0 },
            { uri: 'file:///ws/a.cook', categories: 'fruit' },
        ]) {
            expect(await fixture.error(NUTRITION, args)).to.match(/^Invalid arguments/);
        }
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
import { NutritionResult } from '../common/nutrition-types';
import { RecipeNutritionService } from './recipe-nutrition-service';
```

Add to `Commands`:

```ts
        /** `{ name }` → boolean: whether the signed-in user's plan includes a feature, e.g. `nutrition`. False when signed out. */
        HAS_FEATURE: 'cooklang.api.hasFeature',
        /**
         * `{ uri, scale?, categories? }` → `NutritionResult`: nutrition for a `.cook` URI of any
         * scheme (unsaved edits included) from the cook.md nutrition service. `categories` are
         * category slugs whose matched ingredient mass is summed into `categoryMassG`.
         */
        NUTRITION: 'cooklang.api.nutrition',
```

Injections:

```ts
    @inject(SubscriptionFrontendService)
    protected readonly subscriptions: SubscriptionFrontendService;

    @inject(RecipeNutritionService)
    protected readonly nutrition: RecipeNutritionService;
```

Registration in `registerCommands`:

```ts
        registry.registerCommand({ id: Commands.HAS_FEATURE }, { execute: (args: unknown) => this.hasFeature(args) });
        registry.registerCommand({ id: Commands.NUTRITION }, { execute: (args: unknown) => this.computeNutrition(args) });
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

    protected async computeNutrition(args: unknown): Promise<NutritionResult> {
        const request = this.object(args);
        const raw = this.string(request.uri, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !CooklangUri.isRecipe(uri)) {
            throw this.invalid('`uri` must be an absolute URI of a .cook recipe.');
        }
        const scale = request.scale === undefined ? 1 : request.scale;
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
            throw this.invalid('`scale` must be a positive number.');
        }
        const categories = request.categories === undefined ? [] : request.categories;
        if (!Array.isArray(categories) || !categories.every(slug => typeof slug === 'string')) {
            throw this.invalid('`categories` must be an array of strings.');
        }
        return this.nutrition.compute(uri, scale, categories);
    }
```

- [ ] **Step 4: Run tests, expect pass**

Run: same as Step 2. Expected: PASS (whole package).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.hasFeature and cooklang.api.nutrition"
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

## Task 7: Nutri-Score strip component, colors and CSS

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
 * The official-style Nutri-Score strip: five letter cells, the recipe's grade
 * enlarged. Details live only in the hover card (see `onShowDetails`).
 */
export const PreviewBadgeView = ({ badge, onShowDetails, onHideDetails }: PreviewBadgeViewProps): React.ReactElement => {
    const unknown = badge.grade === 'unknown';
    const handleMouseEnter = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        onShowDetails(badge, event.currentTarget, false);
    }, [badge, onShowDetails]);
    const handleFocus = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
        onShowDetails(badge, event.currentTarget, true);
    }, [badge, onShowDetails]);
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

.theia-hover.cooklang-nutriscore-hover {
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
git commit -m "feat(cooklang): Nutri-Score strip component and colors"
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
            cssClasses: ['cooklang-nutriscore-hover'],
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

## Task 11: Cooklang API wrapper and per-100 g input

**Files:** Create `nutriscore/src/cooklang-api.ts`, `nutriscore/src/cooklang-api.spec.ts`, `nutriscore/src/nutrition-input.ts`, `nutriscore/src/nutrition-input.spec.ts`

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
    it('calls the nutrition commands with one JSON argument', async () => {
        const { api, calls } = recorder(true);
        await api.hasFeature('nutrition');
        await api.nutrition({ uri: 'file:///a.cook', scale: 2, categories: ['fruit'] });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', args: [{ name: 'nutrition' }] },
            { command: 'cooklang.api.nutrition', args: [{ uri: 'file:///a.cook', scale: 2, categories: ['fruit'] }] },
        ]);
    });

    it('reports support only when both commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.hasFeature', 'cooklang.api.nutrition']).api.supportsNutrition(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.nutrition']).api.supportsNutrition(), false);
    });
});
```

`nutrition-input.spec.ts`:

```ts
import * as assert from 'assert';
import { toPer100g } from './nutrition-input';
import { NutritionAggregate } from './cooklang-api';

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

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement `cooklang-api.ts`:**

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/nutrition-types.ts`
// and `cooklang-outlet-context.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;
export const NUTRITION_COMMANDS = ['cooklang.api.hasFeature', 'cooklang.api.nutrition'] as const;

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

export type NutritionResult =
    | { ok: true; aggregate: NutritionAggregate; categoryMassG?: number }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'parse'; message: string };

export interface PreviewOutletContext {
    version: number;
    uri: string;
    path: string;
    scale: number;
}

export interface PreviewBadge {
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

    async supportsNutrition(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return NUTRITION_COMMANDS.every(command => commands.has(command));
    }

    hasFeature(name: string): Promise<boolean> {
        return this.call('cooklang.api.hasFeature', { name });
    }

    nutrition(args: { uri: string; scale: number; categories: readonly string[] }): Promise<NutritionResult> {
        return this.call('cooklang.api.nutrition', args);
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

`nutrition-input.ts` (use the key found in Task 1 in `SODIUM_KEYS`):

```ts
import { NutritionAggregate } from './cooklang-api';
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
    const sodiumKey = SODIUM_KEYS.find(key => typeof aggregate.totals.micros[key] === 'number');
    const sodiumMg = sodiumKey ? aggregate.totals.micros[sodiumKey] : 0;
    return {
        energyKj: macros.kcal * KJ_PER_KCAL * factor,
        sugarsG: macros.sugar_g * factor,
        satFatG: macros.sat_fat_g * factor,
        saltG: sodiumMg * 2.5 / 1000 * factor,
        proteinG: macros.protein_g * factor,
        fibreG: macros.fiber_g * factor,
        fvlPercent: Math.min(100, ((categoryMassG ?? 0) / mass) * 100),
    };
}
```

- [ ] **Step 4: Run tests, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add nutriscore/src/cooklang-api.ts nutriscore/src/cooklang-api.spec.ts nutriscore/src/nutrition-input.ts nutriscore/src/nutrition-input.spec.ts
git commit -m "feat(nutriscore): Cooklang API wrapper and per-100 g input"
```

---

## Task 12: Trust summary and hover markdown

**Files:** Create `nutriscore/src/trust.ts`, `nutriscore/src/trust.spec.ts`

- [ ] **Step 1: Failing tests** `trust.spec.ts`:

```ts
import * as assert from 'assert';
import { escapeMarkdown, summarizeTrust, tooltipMarkdown } from './trust';
import { NutritionAggregate, NutritionItem } from './cooklang-api';

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
import { NutritionAggregate } from './cooklang-api';
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
import { CooklangApi, NutritionAggregate, NutritionResult } from './cooklang-api';
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

function provider(options: { feature?: boolean; result?: NutritionResult }): { provider: NutriScoreBadgeProvider; calls: string[]; logs: string[] } {
    const calls: string[] = [];
    const logs: string[] = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push(`${command} ${JSON.stringify(args[0])}`);
        if (command === 'cooklang.api.hasFeature') {
            return options.feature ?? true;
        }
        return options.result ?? { ok: true, aggregate, categoryMassG: 300 };
    }, async () => []);
    return { provider: new NutriScoreBadgeProvider(api, message => logs.push(message)), calls, logs };
}

describe('NutriScoreBadgeProvider', () => {
    it('returns a graded badge with the trust summary', async () => {
        const { provider: p, calls } = provider({});
        const badge = await p.provide(CONTEXT);
        // per 100 g: 218 kJ (0), sugars 10.3 (3), sat fat 0.03 (0), salt 0.0025 (0) => N 3;
        // fibre 2.4 (0), fvl 100 % (5), protein 0.3 (0) => P 5; score -2 => A.
        assert.strictEqual(badge?.kind, 'nutriscore');
        assert.strictEqual(badge?.grade, 'A');
        assert.ok(badge?.tooltipMarkdown.startsWith('**Nutri-Score A** · -2 points'));
        assert.deepStrictEqual(calls, [
            'cooklang.api.hasFeature {"name":"nutrition"}',
            `cooklang.api.nutrition ${JSON.stringify({ uri: CONTEXT.uri, scale: 2, categories: FVL_CATEGORIES })}`,
        ]);
    });

    it('shows no badge without the nutrition feature, and does not call the service', async () => {
        const { provider: p, calls } = provider({ feature: false });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(calls.length, 1);
    });

    it('shows no badge on service errors and logs each reason once', async () => {
        const { provider: p, logs } = provider({ result: { ok: false, reason: 'network', message: 'offline' } });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Nutri-Score unavailable (network): offline']);
    });

    it('returns an unknown grade when too few ingredients matched', async () => {
        const failing: NutritionResult = { ok: true, aggregate: { ...aggregate, failures: [
            { index: 1, ingredient: 'x', error: { code: 'ingredient_not_found', message: '' } },
        ] } };
        const { provider: p } = provider({ result: failing });
        const badge = await p.provide(CONTEXT);
        assert.strictEqual(badge?.grade, 'unknown');
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

- [ ] **Step 3: Implement** `provider.ts` (use Task 1's verified slugs in `FVL_CATEGORIES`):

```ts
import { CooklangApi, PreviewBadge, PreviewOutletContext } from './cooklang-api';
import { toPer100g } from './nutrition-input';
import { nutriScore } from './nutriscore';
import { summarizeTrust, tooltipMarkdown } from './trust';

/** Category slugs of the nutrition service that count toward the fruit/vegetable/legume share. */
export const FVL_CATEGORIES = ['fruit', 'vegetable', 'legume'];

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && typeof context.uri === 'string' && typeof context.scale === 'number';
}

/** Backs `cooklang.nutriscore.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class NutriScoreBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) { }

    async provide(context: unknown): Promise<PreviewBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        if (!await this.api.hasFeature('nutrition')) {
            return undefined;
        }
        const result = await this.api.nutrition({ uri: context.uri, scale: context.scale, categories: FVL_CATEGORIES });
        if (!result.ok) {
            if (!this.logged.has(result.reason)) {
                this.logged.add(result.reason);
                this.log(`Nutri-Score unavailable (${result.reason}): ${result.message}`);
            }
            return undefined;
        }
        const summary = summarizeTrust(result.aggregate);
        const per100g = toPer100g(result.aggregate, result.categoryMassG);
        const fvlPercent = result.categoryMassG === undefined ? undefined : per100g?.fvlPercent;
        const score = per100g && summary.reliable ? nutriScore(per100g) : undefined;
        return {
            kind: 'nutriscore',
            grade: score ? score.grade : 'unknown',
            tooltipMarkdown: tooltipMarkdown(score, summary, fvlPercent),
        };
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
        supported = await api.version() === SUPPORTED_API_VERSION && await api.supportsNutrition();
    } catch {
        supported = false;
    }
    if (!supported) {
        output.appendLine('Nutri-Score needs a newer Cook Editor (cooklang.api.nutrition is missing).');
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
| [`nutriscore`](./nutriscore) | Nutri-Score badge on recipe previews with a hover card on how reliable it is. Needs a Basic or Pro plan. Install it from the Extensions view. Shows the preview badge outlet and `cooklang.api.nutrition`. |
```

Commit: `git add README.md && git commit -m "docs: list the nutriscore plugin"`

- [ ] **Step 3: Open PRs** (editor first; plugin PR notes it needs the editor release). Ask the user before pushing. PR bodies mention the backend dependency: `/api/subscription` must include `nutrition` in `features[]` for Basic and Pro.

- [ ] **Step 4: Publishing** `cooklang.nutriscore` 0.1.0 (`npm run package` then `OVSX_PAT=… npm run publish:marketplace`) is the user's call after the editor release; do not publish without being asked.
