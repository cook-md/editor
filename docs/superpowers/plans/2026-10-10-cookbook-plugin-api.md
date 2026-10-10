# Cookbook Plugin API (exportPdf, recipeImages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two public plugin commands, `cooklang.api.exportPdf` (HTML → PDF through the report export service, with a native save dialog) and `cooklang.api.recipeImages` (a recipe's title and step photos as absolute URIs, found by the same rules as the preview), so the Cookbook plugin can export a folder as a PDF book.

**Architecture:** `CooklangPluginApiContribution` gains both commands. `exportPdf` validates strictly and delegates to the existing `ReportExportService` RPC proxy (bound in the `frontendElectron` module, so it can be injected in the browser contribution). The electron-main implementation runs print/PDF windows with `javascript: false` and accepts an optional `pageSize`. `recipeImages` uses three pure helpers moved into `common/recipe-images.ts` (`discoverRecipeImages`, `locateRecipeImage`, `mapRecipeImages`), which the recipe preview also switches to, so preview and API cannot drift. Additive: `CooklangPluginApi.VERSION` stays 1.

**Tech Stack:** TypeScript 5.4, InversifyJS, Theia `FileService` / RPC proxies, Electron 44 (`BrowserWindow`, `webContents.printToPDF`), mocha/chai (+ jsdom for browser specs), Rust (`cooklang-find` 0.8 via NAPI-RS), Rails request specs (cook.md docs).

**Spec:** `docs/superpowers/specs/2026-10-10-cookbook-plugin-api-design.md` (consumer: `~/Cooklang/plugins/docs/superpowers/specs/2026-10-10-cookbook-plugin-design.md`).

---

## Deviations from spec

The spec was checked against the code on branch `docs/cookbook-plugin-api-spec` (2026-10-10). Where they differ, the plan follows the code:

1. **There is no TypeScript merge to factor out.** `RecipePreviewWidget.discoverImages()` calls `recipeImages(path)` for `file:` recipes and `recipeImagesFromContent(text)` for every other scheme, never both. The "metadata wins over sibling" precedence lives in Rust: `cooklang_find::RecipeEntry::title_image()` (0.8.0, `model/recipe_entry.rs`) returns `metadata.image_url()` first and only then `find_title_image(path)`. So the plan (a) pins that precedence with a new Rust test in `packages/cooklang-native/src/lib.rs` (`recipe_images_tests`), and (b) factors out what the preview really does in TypeScript into pure functions shared with the API: choose the native lookup (`discoverRecipeImages`), apply the preview's source rules to each raw value (`locateRecipeImage`), and rebuild the `{ title, steps }` shape from converted entries (`mapRecipeImages`).
2. **Step keys are zero-based, not "step numbers".** The native JSON (and `lookupStepImage`) use `steps[section][step]` with both indexes zero-based, section `"0"` also holding the linear `Recipe.N.ext` form: `Recipe.2.4.jpg` → `steps["1"]["3"]`, `Recipe.3.jpg` → `steps["0"]["2"]`. The API returns that shape unchanged; the docs spell out the lookup rule.
3. **`http:` metadata images follow the preview's rules.** For a `file:` recipe, `http(s)` URLs come back verbatim (as the spec says). For a recipe on another file system (e.g. `cooklang-hub:`), the preview only loads `https:` and never names a file, so the API does the same. Local files with an extension the preview cannot show (anything but jpg/jpeg/png/webp) are dropped.
4. **`.pdf` handling.** `ReportExportServiceImpl.saveBuffer` already appends `.${extension}`, so appending `.pdf` in the API would give `Book.pdf.pdf`. The API instead strips one trailing `.pdf` (any case) and the service adds it back; the dialog shows `Book.pdf` either way.
5. **`javascript: false` applies to print and PDF only.** `exportPng` measures the page and waits for paint with `webContents.executeJavaScript`, which needs scripts, so the PNG window keeps `javascript: true`. Report HTML needs no script for print/PDF: report `html` output is `DOMPurify.sanitize`d before it is shown (`report-widget.tsx:293`), the export clones that DOM, and Mermaid diagrams are re-rendered to static SVG before export (`mermaidRenderer.renderExport`). Core Vitals charts are inline SVG from `vitals-template.ts`, no script.
6. **`pageSize` ships now, not "if needed".** Electron's `printToPDF` defaults to `Letter` and ignores CSS `@page { size }` unless `preferCSSPageSize` is set, so the Cookbook plugin's `cookbook.pageSize` (default `A4`) is unreachable without it. `pageSize?: 'A4' | 'Letter'` is passed through; the default stays Electron's (Letter) so report exports are unchanged.
7. **Result field names.** The service returns `filePath`; the API maps it to `path` as the spec says. A rejected RPC call (e.g. the IPC channel dropped) is also turned into `{ saved: false, error }`, so plugins only ever see the documented shape.
8. **Editor version for the docs.** `.release-please-manifest.json` is at `0.1.0-alpha.51`; the docs say `0.1.0-alpha.52` and Task 8 checks it against the release that actually ships the change.

## Conventions for every task

- Repo: `/Users/alexeydubovskoy/Cooklang/editor`. Work on branch `feature/cookbook-plugin-api`, created from `docs/cookbook-plugin-api-spec` in Task 1 (so spec, plan and code ship in one PR).
- Mocha needs Node 22 (Node 22.23.2 is in `~/.local/bin`): prefix every compile/test command with `PATH=~/.local/bin:$PATH`. On Node 20 browser specs abort with `ERR_UNKNOWN_FILE_EXTENSION ... .css`.
- Specs run from compiled output. Compile from the repo root with `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang`. `noEmitOnError` is false, so a type error still emits JS; read the compile output **and** the mocha output.
- Run one spec file: `cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/<dir>/<name>.spec.js; cd ../..`
- Whole package: `cd packages/cooklang && PATH=~/.local/bin:$PATH npx theiaext test; cd ../..`
- Lint before each commit: `PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang`.
- New `.ts` files start with the AGPL header copied verbatim from `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` lines 1–12.
- Style: 4 spaces, single quotes, `undefined` not `null` (add `// eslint-disable-line no-null/no-null` where a `null` is unavoidable), explicit return types, property injection, `override` on overridden members (`noImplicitOverride` is on).
- Commits: conventional commits with the `cooklang` / `cooklang-native` scope (release-please builds the changelog; never edit `CHANGELOG.md`).

## File Structure

| File | Change |
|---|---|
| `packages/cooklang-native/src/lib.rs` | add a precedence test to `recipe_images_tests` |
| `packages/cooklang/src/common/recipe-images.ts` | add `discoverRecipeImages`, `locateRecipeImage`, `mapRecipeImages`, `RecipeImageEntry` |
| `packages/cooklang/src/common/recipe-images.spec.ts` | tests for the three helpers |
| `packages/cooklang/src/browser/recipe-preview-widget.tsx` | `refreshImages`/`toImageSrc` use the helpers; `discoverImages` removed |
| `packages/cooklang/src/common/report-export-protocol.ts` | `ReportPageSize`, `ReportExportPdfOptions`; `exportPdf` gets an optional third argument |
| `packages/cooklang/src/electron-main/report-export-service-impl.ts` | `javascript: false` for print/PDF, `pageSize`, `createWindow`/`showSaveDialog` seams |
| `packages/cooklang/src/electron-main/report-export-service-impl.spec.ts` | create: window options, page size, cancel/save/error |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` | `EXPORT_PDF`, `RECIPE_IMAGES` commands + docs, limits, `providedUri` helper |
| `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts` | fixture mocks + tests for both commands |
| `~/Cooklang/cook.md/web/app/views/help/plugins/api.html.erb` | new section (separate repo, own branch + PR) |
| `~/Cooklang/cook.md/web/spec/requests/help/plugins_spec.rb` | expect the two new command names |

---

### Task 1: Branch, and pin the native title-image precedence

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs` (inside `mod recipe_images_tests`, after `stores_section_step_images_under_the_section_index`)

- [ ] **Step 1: Create the branch and commit the plan**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git checkout docs/cookbook-plugin-api-spec
git checkout -b feature/cookbook-plugin-api
git add docs/superpowers/plans/2026-10-10-cookbook-plugin-api.md
git commit -m "docs: implementation plan for cooklang.api.exportPdf and recipeImages"
```

- [ ] **Step 2: Add the precedence test**

This is a characterization test: the behaviour already exists in `cooklang-find`, the test makes a future `cooklang-find` bump that changes it fail loudly, because the preview and `cooklang.api.recipeImages` both depend on it. Insert after the `stores_section_step_images_under_the_section_index` test:

```rust
    // `cooklang-find` checks metadata before sibling files, so a recipe's own
    // `image:` wins over `Recipe.jpg`, while sibling step images are still found.
    // The preview and `cooklang.api.recipeImages` both rely on this order.
    #[test]
    fn metadata_image_wins_over_the_sibling_title_image() {
        let (dir, path) = fixture("precedence", &["Pancakes.jpg", "Pancakes.1.jpg"]);
        fs::write(
            dir.join("Pancakes.cook"),
            "---\nimage: hero.jpg\n---\nCrack the @eggs{2}.\nFry it.\n",
        )
        .unwrap();
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["title"], "hero.jpg");
        assert!(value["steps"]["0"]["0"].as_str().unwrap().ends_with("Pancakes.1.jpg"));
    }
```

- [ ] **Step 3: Run it**

Run: `cd packages/cooklang-native && cargo test recipe_images_tests; cd ../..`
Expected: `test result: ok. 10 passed` (9 existing + the new one). If the new test fails, stop: the precedence assumption behind the whole `recipeImages` design is wrong; report it instead of continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-native/src/lib.rs
git commit -m "test(cooklang-native): pin metadata-over-sibling title image precedence"
```

---

### Task 2: Shared recipe-image helpers

**Files:**
- Modify: `packages/cooklang/src/common/recipe-images.ts`
- Test: `packages/cooklang/src/common/recipe-images.spec.ts`

- [ ] **Step 1: Write the failing tests**

Change the import line at the top of `packages/cooklang/src/common/recipe-images.spec.ts` from

```ts
import { RecipeImages, lookupStepImage, resolveImageUri } from './recipe-images';
```

to

```ts
import {
    RecipeImages,
    discoverRecipeImages,
    locateRecipeImage,
    lookupStepImage,
    mapRecipeImages,
    resolveImageUri,
} from './recipe-images';
```

Append to the end of the file:

```ts
describe('locateRecipeImage', () => {

    const local = new URI('file:///work/recipes/Pancakes.cook');
    const hub = new URI('cooklang-hub:/recipes/12/Pancakes.cook');

    it('resolves a relative path against a local recipe folder', () => {
        const location = locateRecipeImage('img/hero.jpg', local);
        expect(location?.kind).to.equal('file');
        expect(location?.kind === 'file' ? location.uri.toString() : undefined).to.equal('file:///work/recipes/img/hero.jpg');
    });

    it('keeps an absolute path for a local recipe', () => {
        const location = locateRecipeImage('/work/recipes/Pancakes.1.jpg', local);
        expect(location?.kind === 'file' ? location.uri.toString() : undefined).to.equal('file:///work/recipes/Pancakes.1.jpg');
    });

    it('keeps http and https URLs for a local recipe', () => {
        expect(locateRecipeImage('http://cdn.example/p.jpg', local)).to.deep.equal({ kind: 'remote', url: 'http://cdn.example/p.jpg' });
        expect(locateRecipeImage('https://cdn.example/p.jpg', local)).to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
    });

    it('keeps only https URLs for a recipe on another file system', () => {
        expect(locateRecipeImage('https://cdn.example/p.jpg', hub)).to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
        expect(locateRecipeImage('http://cdn.example/p.jpg', hub)).to.equal(undefined);
    });

    it('never names a file for a recipe on another file system', () => {
        for (const raw of ['Pancakes.jpg', '/etc/passwd', 'C:\\photos\\p.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
            expect(locateRecipeImage(raw, hub), raw).to.equal(undefined);
        }
    });

    it('ignores blank and missing values', () => {
        expect(locateRecipeImage('', local)).to.equal(undefined);
        expect(locateRecipeImage('   ', local)).to.equal(undefined);
        expect(locateRecipeImage(undefined, local)).to.equal(undefined);
    });
});

describe('mapRecipeImages', () => {

    it('converts the title and every section step, keeping the keys', async () => {
        const images: RecipeImages = {
            title: '/r/P.jpg',
            steps: { '0': { '0': '/r/P.1.jpg' }, '1': { '3': '/r/P.2.4.jpg' } },
        };
        expect(await mapRecipeImages(images, async raw => `x:${raw}`)).to.deep.equal({
            title: 'x:/r/P.jpg',
            steps: { '0': { '0': 'x:/r/P.1.jpg' }, '1': { '3': 'x:/r/P.2.4.jpg' } },
        });
    });

    it('drops entries the converter rejects and leaves no empty section behind', async () => {
        const images: RecipeImages = { title: 'a', steps: { '0': { '0': 'b', '1': 'c' }, '2': { '0': 'd' } } };
        const result = await mapRecipeImages(images, async raw => (raw === 'a' || raw === 'd' ? undefined : raw.toUpperCase()));
        expect(result).to.deep.equal({ steps: { '0': { '0': 'B', '1': 'C' } } });
    });

    it('treats a null native title and missing images as nothing', async () => {
        const fromNative = JSON.parse('{"title":null,"steps":{}}') as RecipeImages;
        expect(await mapRecipeImages(fromNative, async raw => raw)).to.deep.equal({ steps: {} });
        expect(await mapRecipeImages(undefined, async raw => raw)).to.deep.equal({ steps: {} });
    });

    it('starts every conversion before awaiting any, so reads overlap', async () => {
        const images: RecipeImages = { title: 't', steps: { '0': { '0': 'a', '1': 'b' } } };
        let inFlight = 0;
        let peak = 0;
        await mapRecipeImages(images, async raw => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return raw;
        });
        expect(peak).to.equal(3);
    });
});

describe('discoverRecipeImages', () => {

    function service(calls: string[]): {
        recipeImages: (path: string) => Promise<string>;
        recipeImagesFromContent: (content: string) => Promise<string>;
    } {
        return {
            recipeImages: async (path: string) => {
                calls.push(`path:${path}`);
                return '{"title":"/r/P.jpg","steps":{"0":{"0":"/r/P.1.jpg"}}}';
            },
            recipeImagesFromContent: async (content: string) => {
                calls.push(`content:${content}`);
                return '{"title":"https://cdn.example/p.jpg","steps":{}}';
            },
        };
    }

    it('asks the on-disk lookup for a local recipe, ignoring any content', async () => {
        const calls: string[] = [];
        const images = await discoverRecipeImages(service(calls), new URI('file:///r/P.cook'), 'text');
        expect(images).to.deep.equal({ title: '/r/P.jpg', steps: { '0': { '0': '/r/P.1.jpg' } } });
        expect(calls).to.deep.equal(['path:/r/P.cook']);
    });

    it('asks the content lookup for a recipe on another file system', async () => {
        const calls: string[] = [];
        const images = await discoverRecipeImages(service(calls), new URI('cooklang-hub:/recipes/12/P.cook'), 'text');
        expect(images).to.deep.equal({ title: 'https://cdn.example/p.jpg', steps: {} });
        expect(calls).to.deep.equal(['content:text']);
    });

    it('reports nothing for a recipe on another file system before its content is known', async () => {
        const calls: string[] = [];
        expect(await discoverRecipeImages(service(calls), new URI('cooklang-hub:/recipes/12/P.cook'), undefined)).to.equal(undefined);
        expect(calls).to.deep.equal([]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/common/recipe-images.spec.js; cd ../..`
Expected: compile errors `Module '"./recipe-images"' has no exported member 'discoverRecipeImages'` (and the same for `locateRecipeImage`, `mapRecipeImages`); mocha reports the new tests failing with `TypeError: (0 , recipe_images_1.locateRecipeImage) is not a function` (and likewise for the other two). The existing `lookupStepImage` / `resolveImageUri` tests still pass.

- [ ] **Step 3: Implement the helpers**

In `packages/cooklang/src/common/recipe-images.ts`, add below the existing `import URI ...` line:

```ts
import { CooklangLanguageService } from './cooklang-language-service';
```

Append to the end of the file:

```ts
/**
 * Where a raw image value may be loaded from, under the recipe preview's rules
 * (also the rules of `cooklang.api.recipeImages`):
 *
 * - A local (`file:`) recipe may name any `http(s)` URL, or a file by absolute
 *   path or by a path relative to its own folder.
 * - A recipe on any other file system (a plugin's, such as `cooklang-hub:`) has
 *   third-party metadata and no folder: only `https:` URLs are kept, so its
 *   images never travel in the clear, and paths name nothing.
 *
 * Blank or missing values yield `undefined`.
 */
export function locateRecipeImage(raw: string | undefined, recipeUri: URI): ImageLocation | undefined {
    if (!raw) {
        return undefined;
    }
    const location = resolveImageUri(raw, recipeUri);
    if (!location) {
        return undefined;
    }
    const local = recipeUri.scheme === 'file';
    if (location.kind === 'remote') {
        return local || /^https:/i.test(location.url) ? location : undefined;
    }
    return local ? location : undefined;
}

/** One raw value from the `recipeImages` RPC; no `section`/`step` means the title image. */
export interface RecipeImageEntry {
    section?: string;
    step?: string;
    raw: string;
}

/**
 * Rebuild `images` with every value passed through `convert`, keeping the
 * section and step keys. Entries `convert` maps to `undefined` are left out,
 * and a section with no entries left is left out too. Every conversion starts
 * before any is awaited: they are usually file reads over RPC, and a 20-image
 * recipe should not pay for twenty sequential round-trips.
 */
export async function mapRecipeImages(
    images: RecipeImages | undefined,
    convert: (raw: string) => Promise<string | undefined>
): Promise<ResolvedRecipeImages> {
    const entries: RecipeImageEntry[] = [];
    if (images?.title) {
        entries.push({ raw: images.title });
    }
    for (const [section, steps] of Object.entries(images?.steps ?? {})) {
        for (const [step, raw] of Object.entries(steps)) {
            if (raw) {
                entries.push({ section, step, raw });
            }
        }
    }
    const resolved: ResolvedRecipeImages = { steps: {} };
    await Promise.all(entries.map(async entry => {
        const value = await convert(entry.raw);
        if (!value) {
            return;
        }
        if (entry.section === undefined || entry.step === undefined) {
            resolved.title = value;
        } else {
            (resolved.steps[entry.section] ??= {})[entry.step] = value;
        }
    }));
    return resolved;
}

/**
 * The recipe's images as `cooklang-find` reports them. A local (`file:`)
 * recipe is looked up on disk, where `cooklang-find` takes the metadata image
 * first and sibling files (`Recipe.jpg`, `Recipe.N.jpg`, `Recipe.S.N.jpg`)
 * after. Any other recipe has no folder, so only its metadata can name an
 * image, read from `content`; with no content yet there is nothing to report.
 */
export async function discoverRecipeImages(
    service: Pick<CooklangLanguageService, 'recipeImages' | 'recipeImagesFromContent'>,
    recipeUri: URI,
    content: string | undefined
): Promise<RecipeImages | undefined> {
    if (recipeUri.scheme === 'file') {
        return JSON.parse(await service.recipeImages(recipeUri.path.fsPath())) as RecipeImages;
    }
    if (content === undefined) {
        return undefined;
    }
    return JSON.parse(await service.recipeImagesFromContent(content)) as RecipeImages;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/common/recipe-images.spec.js; cd ../..`
Expected: compile exits 0; all tests pass, including 6 under `locateRecipeImage`, 4 under `mapRecipeImages`, 3 under `discoverRecipeImages`.

- [ ] **Step 5: Lint and commit**

```bash
PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/common/recipe-images.ts packages/cooklang/src/common/recipe-images.spec.ts
git commit -m "feat(cooklang): shared recipe image discovery and location rules"
```

---

### Task 3: The recipe preview uses the shared helpers

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`
- Test (unchanged, must keep passing): `packages/cooklang/src/browser/recipe-preview-widget.spec.ts`, `packages/cooklang/src/browser/recipe-preview-components.spec.ts`

This is a pure refactor: the existing preview specs (`RecipePreviewWidget for non-file recipes` covers https-only, relative-path, `javascript:`/`data:`, local lookup and local `http:`) are the safety net.

- [ ] **Step 1: Record the baseline**

Run: `cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js lib/browser/recipe-preview-components.spec.js; cd ../..`
Expected: all passing. Note the count (`N passing`); Step 4 must report the same number.

- [ ] **Step 2: Swap the imports**

In `packages/cooklang/src/browser/recipe-preview-widget.tsx` replace

```ts
import {
    RecipeImages,
    ResolvedRecipeImages,
    resolveImageUri,
    RECIPE_IMAGE_EXTENSIONS,
} from '../common/recipe-images';
```

with

```ts
import {
    ResolvedRecipeImages,
    RECIPE_IMAGE_EXTENSIONS,
    discoverRecipeImages,
    locateRecipeImage,
    mapRecipeImages,
} from '../common/recipe-images';
```

- [ ] **Step 3: Replace `refreshImages`, `discoverImages` and `toImageSrc`**

Replace the three methods (from the doc comment `Ask \`cooklang-find\` which images exist for this recipe` through the end of `toImageSrc`, just before `// --- Rendering ---`) with:

```ts
    /**
     * Ask `cooklang-find` which images exist for this recipe and turn each one
     * into an `<img>` src. Guarded by `imageSequence` so a slow refresh cannot
     * overwrite a newer one. Discovery and the source rules are shared with
     * `cooklang.api.recipeImages` (see `common/recipe-images.ts`).
     */
    protected async refreshImages(): Promise<void> {
        if (!this.uri) {
            return;
        }
        const sequence = ++this.imageSequence;
        let resolved: ResolvedRecipeImages = { steps: {} };
        const fileUris = new Set<string>();
        try {
            const discovered = await discoverRecipeImages(this.service, this.uri, this.content);
            resolved = await mapRecipeImages(discovered, raw => this.toImageSrc(raw, fileUris));
        } catch (e) {
            // Usually harmless: no images, an unsaved file, or an unreadable
            // folder. But it also catches a native addon that predates
            // `recipeImages` and needs rebuilding, so say what happened.
            console.debug('Recipe image refresh failed', e);
        }
        if (this.isDisposed || sequence !== this.imageSequence) {
            return;
        }
        this.images = resolved;
        this.resolvedImageUris = fileUris;
        this.update();
    }

    /**
     * Resolve one raw image value to a URL an `<img>` can load, recording every
     * local file URI in `fileUris` so the watcher knows what this recipe reads.
     */
    protected async toImageSrc(raw: string, fileUris: Set<string>): Promise<string | undefined> {
        const location = locateRecipeImage(raw, this.uri);
        if (!location) {
            return undefined;
        }
        if (location.kind === 'remote') {
            return location.url;
        }
        // Recorded even when the read fails: a file that is missing now may be
        // created later, and the watcher should notice when it is.
        fileUris.add(location.uri.toString());
        return this.imageService.resolve(location.uri);
    }
```

`hasLocalSource()` stays: it is still used by the parse and provider-registration code. If the compiler reports it unused, check with `grep -n hasLocalSource packages/cooklang/src/browser/recipe-preview-widget.tsx` before touching it (it should still have callers at the parse helpers).

- [ ] **Step 4: Run the preview specs**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/recipe-preview-widget.spec.js lib/browser/recipe-preview-components.spec.js lib/common/recipe-images.spec.js; cd ../..`
Expected: compile exits 0 with no `declared but its value is never read` errors; the preview specs report the same `N passing` as Step 1 (plus the recipe-images tests).

- [ ] **Step 5: Lint and commit**

```bash
PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/recipe-preview-widget.tsx
git commit -m "refactor(cooklang): recipe preview finds images through the shared helpers"
```

---

### Task 4: Report export window runs without JavaScript; optional PDF page size

**Files:**
- Modify: `packages/cooklang/src/common/report-export-protocol.ts`
- Modify: `packages/cooklang/src/electron-main/report-export-service-impl.ts`
- Create: `packages/cooklang/src/electron-main/report-export-service-impl.spec.ts`

Under plain Node (mocha), `@theia/electron/shared/electron` re-exports `require('electron')`, which is the path string of the Electron binary, so `BrowserWindow`, `dialog` and `app` are `undefined` there. The impl already falls back to `os.tmpdir()` when `app` is missing; the spec overrides two new seams, `createWindow` and `showSaveDialog`, so nothing else touches Electron.

- [ ] **Step 1: Write the failing spec**

Create `packages/cooklang/src/electron-main/report-export-service-impl.spec.ts` (AGPL header first, then):

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
    BrowserWindow,
    BrowserWindowConstructorOptions,
    PrintToPDFOptions,
    SaveDialogOptions,
    SaveDialogReturnValue,
} from '@theia/electron/shared/electron';
import { ReportExportServiceImpl } from './report-export-service-impl';

/** The slice of `BrowserWindow` the export service uses. */
class FakeWindow {
    destroyed = false;
    pdfError: Error | undefined = undefined;
    readonly loaded: string[] = [];
    readonly pdfOptions: PrintToPDFOptions[] = [];
    readonly webContents = {
        printToPDF: async (options: PrintToPDFOptions): Promise<Buffer> => {
            this.pdfOptions.push(options);
            if (this.pdfError) {
                throw this.pdfError;
            }
            return Buffer.from('%PDF-1.7');
        },
        print: (_options: unknown, callback: (success: boolean, reason: string) => void): void => callback(true, ''),
        executeJavaScript: async (): Promise<number> => 100,
        capturePage: async (): Promise<{ toPNG: () => Buffer }> => ({ toPNG: () => Buffer.from('png') }),
    };

    async loadFile(file: string): Promise<void> {
        this.loaded.push(fs.readFileSync(file, 'utf8'));
    }

    setContentSize(): void { /* no layout in tests */ }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    destroy(): void {
        this.destroyed = true;
    }
}

class TestExportService extends ReportExportServiceImpl {
    readonly windows: Array<{ options: BrowserWindowConstructorOptions; window: FakeWindow }> = [];
    readonly dialogs: SaveDialogOptions[] = [];
    dialogResult: SaveDialogReturnValue = { canceled: true, filePath: '' };
    pdfError: Error | undefined = undefined;

    protected override createWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        const window = new FakeWindow();
        window.pdfError = this.pdfError;
        this.windows.push({ options, window });
        return window as unknown as BrowserWindow;
    }

    protected override async showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
        this.dialogs.push(options);
        return this.dialogResult;
    }
}

const HTML = '<!doctype html><p>Soup</p>';

describe('ReportExportServiceImpl', () => {

    it('renders PDFs in a sandboxed window with JavaScript disabled, then destroys it', async () => {
        const service = new TestExportService();
        await service.exportPdf(HTML, 'Book');
        expect(service.windows).to.have.length(1);
        const { options, window } = service.windows[0];
        expect(options.show).to.equal(false);
        expect(options.webPreferences).to.include({ javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
        expect(window.loaded).to.deep.equal([HTML]);
        expect(window.destroyed).to.equal(true);
    });

    it('prints with JavaScript disabled', async () => {
        const service = new TestExportService();
        await service.print(HTML);
        expect(service.windows[0].options.webPreferences).to.include({ javascript: false });
    });

    it('keeps JavaScript for PNG export, which measures the page with executeJavaScript', async () => {
        const service = new TestExportService();
        await service.exportPng(HTML, 'Book');
        expect(service.windows[0].options.webPreferences).to.include({ javascript: true, sandbox: true });
    });

    it("uses Chromium's default page size unless one is given", async () => {
        const service = new TestExportService();
        await service.exportPdf(HTML, 'Book');
        await service.exportPdf(HTML, 'Book', { pageSize: 'A4' });
        await service.exportPdf(HTML, 'Book', { pageSize: 'Letter' });
        expect(service.windows.map(entry => entry.window.pdfOptions[0])).to.deep.equal([
            { printBackground: true },
            { printBackground: true, pageSize: 'A4' },
            { printBackground: true, pageSize: 'Letter' },
        ]);
    });

    it('reports a cancelled save dialog as not saved and suggests <name>.pdf', async () => {
        const service = new TestExportService();
        expect(await service.exportPdf(HTML, 'Family Book')).to.deep.equal({ saved: false });
        expect(service.dialogs[0].defaultPath).to.equal('Family Book.pdf');
        expect(service.dialogs[0].filters).to.deep.equal([{ name: 'PDF Document', extensions: ['pdf'] }]);
    });

    it('writes the PDF where the user chose', async () => {
        const service = new TestExportService();
        const target = path.join(os.tmpdir(), `cooklang-export-spec-${Date.now()}.pdf`);
        service.dialogResult = { canceled: false, filePath: target };
        try {
            expect(await service.exportPdf(HTML, 'Book')).to.deep.equal({ saved: true, filePath: target });
            expect(fs.readFileSync(target, 'utf8')).to.equal('%PDF-1.7');
        } finally {
            fs.rmSync(target, { force: true });
        }
    });

    it('turns a rendering failure into an error result and still destroys the window', async () => {
        const service = new TestExportService();
        service.pdfError = new Error('GPU process crashed');
        expect(await service.exportPdf(HTML, 'Book')).to.deep.equal({ saved: false, error: 'GPU process crashed' });
        expect(service.windows[0].window.destroyed).to.equal(true);
        expect(service.dialogs).to.deep.equal([]);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/electron-main/report-export-service-impl.spec.js; cd ../..`
Expected: compile errors `This member cannot have an 'override' modifier because it is not declared in the base class 'ReportExportServiceImpl'` (`createWindow`, `showSaveDialog`) and `Expected 2 arguments, but got 3` (`exportPdf`); mocha fails every test with `TypeError: BrowserWindow is not a constructor` (or `Cannot read properties of undefined (reading 'showSaveDialog')`), because the real methods still call Electron directly.

- [ ] **Step 3: Extend the protocol**

In `packages/cooklang/src/common/report-export-protocol.ts`, add above `export const ReportExportService = Symbol(...)`:

```ts
/** Paper sizes plugins may ask for; Electron's `printToPDF` default (`Letter`) applies when absent. */
export type ReportPageSize = 'A4' | 'Letter';

export interface ReportExportPdfOptions {
    /**
     * Paper size passed to `printToPDF`. CSS `@page { size }` is ignored by the
     * export (Electron's `preferCSSPageSize` is off), so this is the only way to
     * pick one.
     */
    pageSize?: ReportPageSize;
}
```

and change the `exportPdf` member of the `ReportExportService` interface to:

```ts
    /** Render the HTML to PDF and prompt for a save location. */
    exportPdf(html: string, defaultFileName: string, options?: ReportExportPdfOptions): Promise<ReportExportResult>;
```

- [ ] **Step 4: Update the implementation**

In `packages/cooklang/src/electron-main/report-export-service-impl.ts`:

Replace the Electron and protocol imports with:

```ts
// eslint-disable-next-line import/no-extraneous-dependencies
import {
    app,
    dialog,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    PrintToPDFOptions,
    SaveDialogOptions,
    SaveDialogReturnValue,
} from '@theia/electron/shared/electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportExportPdfOptions, ReportExportResult, ReportExportService } from '../common/report-export-protocol';
```

In `print`, change `await this.withWindow(html, win => new Promise<void>(...` to `await this.withWindow(html, { javascript: false }, win => new Promise<void>(...` (the body is unchanged).

Replace `exportPdf` with:

```ts
    async exportPdf(html: string, defaultFileName: string, options: ReportExportPdfOptions = {}): Promise<ReportExportResult> {
        try {
            return await this.withWindow(html, { javascript: false }, async win => {
                const printOptions: PrintToPDFOptions = { printBackground: true };
                if (options.pageSize) {
                    printOptions.pageSize = options.pageSize;
                }
                const data = await win.webContents.printToPDF(printOptions);
                return this.saveBuffer(data, defaultFileName, 'pdf', 'PDF Document');
            });
        } catch (error) {
            return { saved: false, error: this.message(error) };
        }
    }
```

In `exportPng`, change `return await this.withWindow(html, async win => {` to `return await this.withWindow(html, { javascript: true }, async win => {` (body unchanged).

Replace `withWindow` (doc comment included) with:

```ts
    /**
     * Render `html` in a hidden, offscreen-painting BrowserWindow, run `fn`,
     * and always destroy the window and remove the temp file afterwards.
     *
     * `javascript` is off for print and PDF: report HTML is sanitised before it
     * is shown (DOMPurify strips scripts), Mermaid diagrams are exported as
     * pre-rendered SVG, and plugin HTML (`cooklang.api.exportPdf`) is static by
     * contract. PNG export keeps it on, because it measures the page and waits
     * for paint with `executeJavaScript`.
     */
    protected async withWindow<T>(
        html: string,
        options: { javascript: boolean },
        fn: (win: BrowserWindow) => Promise<T>
    ): Promise<T> {
        const tmpFile = path.join(
            app?.getPath?.('temp') ?? os.tmpdir(),
            `cooklang-report-${Date.now()}-${Math.floor(Math.random() * 1e6)}.html`
        );
        fs.writeFileSync(tmpFile, html, 'utf8');
        const win = this.createWindow({
            show: false,
            paintWhenInitiallyHidden: true,
            width: ReportExportServiceImpl.CONTENT_WIDTH,
            height: 1024,
            // The window loads report HTML from a local file: keep the renderer
            // locked down (sandbox, isolation and no Node are the current Electron
            // defaults, stated explicitly for a security-sensitive operation).
            webPreferences: {
                backgroundThrottling: false,
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                javascript: options.javascript
            }
        });
        try {
            await win.loadFile(tmpFile);
            return await fn(win);
        } finally {
            if (!win.isDestroyed()) {
                win.destroy();
            }
            fs.promises.unlink(tmpFile).catch(() => { /* best effort */ });
        }
    }

    /** Seam for tests: the hidden export window. */
    protected createWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        return new BrowserWindow(options);
    }

    /** Seam for tests: the native save dialog. */
    protected showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
        return dialog.showSaveDialog(options);
    }
```

In `saveBuffer`, change `const result = await dialog.showSaveDialog({` to `const result = await this.showSaveDialog({` (the rest is unchanged).

`browser/report-export-contribution.ts` calls `exportPdf(html, name)` with two arguments, which still type-checks; leave it alone.

- [ ] **Step 5: Run the spec to see it pass**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/electron-main/report-export-service-impl.spec.js; cd ../..`
Expected: compile exits 0; `7 passing`.

- [ ] **Step 6: Lint and commit**

```bash
PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/common/report-export-protocol.ts packages/cooklang/src/electron-main/report-export-service-impl.ts packages/cooklang/src/electron-main/report-export-service-impl.spec.ts
git commit -m "feat(cooklang): report export windows run without JavaScript; optional PDF page size"
```

---

### Task 5: `cooklang.api.exportPdf`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

`ReportExportService` is bound in `electron-browser/cooklang-electron-browser-module.ts` (an `ElectronIpcConnectionProvider` proxy to electron-main), which is a `frontendElectron` module loaded into the same frontend container as `cooklang-frontend-module.ts`; `ReportExportContribution` already injects it from the browser folder. The app is Electron-only, so injecting it into `CooklangPluginApiContribution` is safe.

- [ ] **Step 1: Extend the spec fixture**

In `cooklang-plugin-api-contribution.spec.ts`, add after `import { ReportWidgetOptions } from './report-widget-types';`:

```ts
import { ReportExportResult } from '../common/report-export-protocol';
```

In `class Fixture`, add after `shown: ReportWidgetOptions[] = [];`:

```ts
    exportCalls: Array<{ html: string; name: string; options: unknown }> = [];
    exportResult: ReportExportResult = { saved: true, filePath: '/out/Family Book.pdf' };
    exportError: Error | undefined = undefined;
```

In `create()`, add after the `(contribution as any).outlets = ...` line:

```ts
        (contribution as any).reportExport = {
            exportPdf: async (html: string, name: string, options?: unknown) => {
                this.exportCalls.push({ html, name, options });
                if (this.exportError) {
                    throw this.exportError;
                }
                return this.exportResult;
            },
        };
```

- [ ] **Step 2: Write the failing tests**

Append to the end of the spec file:

```ts
describe('CooklangPluginApiContribution — exportPdf', () => {
    const { EXPORT_PDF } = CooklangPluginApi.Commands;
    const HTML = '<!doctype html><html><body><h1>Family Book</h1></body></html>';

    it('delegates to the report export service and maps filePath to path', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Family Book' }))
            .to.deep.equal({ saved: true, path: '/out/Family Book.pdf' });
        expect(fixture.exportCalls).to.deep.equal([{ html: HTML, name: 'Family Book', options: undefined }]);
    });

    it('drops a trailing .pdf, because the service adds the extension', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Family Book.pdf' });
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: ' Soups.PDF ' });
        expect(fixture.exportCalls.map(call => call.name)).to.deep.equal(['Family Book', 'Soups']);
    });

    it('passes pageSize through', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book', pageSize: 'A4' });
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book', pageSize: 'Letter' });
        expect(fixture.exportCalls.map(call => call.options)).to.deep.equal([{ pageSize: 'A4' }, { pageSize: 'Letter' }]);
    });

    it('reports a cancelled dialog as not saved, without an error', async () => {
        const fixture = new Fixture();
        fixture.exportResult = { saved: false };
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' })).to.deep.equal({ saved: false });
    });

    it("passes the service's error message through", async () => {
        const fixture = new Fixture();
        fixture.exportResult = { saved: false, error: 'EACCES: permission denied' };
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' }))
            .to.deep.equal({ saved: false, error: 'EACCES: permission denied' });
    });

    it('turns a rejected service call into an error result instead of throwing', async () => {
        const fixture = new Fixture();
        fixture.exportError = new Error('connection closed');
        fixture.create();
        expect(await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'Book' }))
            .to.deep.equal({ saved: false, error: 'connection closed' });
    });

    it('rejects bad html, file names and page sizes before exporting', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            undefined,
            { defaultFileName: 'Book' },
            { html: '', defaultFileName: 'Book' },
            { html: ' \n\t ', defaultFileName: 'Book' },
            { html: 42, defaultFileName: 'Book' },
            { html: HTML },
            { html: HTML, defaultFileName: '   ' },
            { html: HTML, defaultFileName: 'Books/Family' },
            { html: HTML, defaultFileName: 'Books\\Family' },
            { html: HTML, defaultFileName: 'Family\nBook' },
            { html: HTML, defaultFileName: 'x'.repeat(201) },
            { html: HTML, defaultFileName: '.pdf' },
            { html: HTML, defaultFileName: 'Book', pageSize: 'A3' },
            { html: HTML, defaultFileName: 'Book', pageSize: 4 },
        ]) {
            expect(await fixture.error(EXPORT_PDF, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.exportCalls).to.deep.equal([]);
    });

    it('accepts html up to the limit and rejects one character more', async () => {
        const fixture = new Fixture();
        fixture.create();
        const limit = CooklangPluginApi.MAX_EXPORT_HTML_LENGTH;
        expect(limit).to.equal(100 * 1024 * 1024);
        expect(await fixture.error(EXPORT_PDF, { html: 'x'.repeat(limit + 1), defaultFileName: 'Book' }))
            .to.match(/^Invalid arguments: `html`/);
        await fixture.run(EXPORT_PDF, { html: 'x'.repeat(limit), defaultFileName: 'Book' });
        expect(fixture.exportCalls).to.have.length(1);
    });

    it('accepts a 200-character file name', async () => {
        const fixture = new Fixture();
        fixture.create();
        await fixture.run(EXPORT_PDF, { html: HTML, defaultFileName: 'x'.repeat(200) });
        expect(fixture.exportCalls[0].name).to.equal('x'.repeat(200));
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js; cd ../..`
Expected: compile errors `Property 'EXPORT_PDF' does not exist` and `Property 'MAX_EXPORT_HTML_LENGTH' does not exist`; the new `exportPdf` tests fail with `TypeError: Cannot read properties of undefined (reading 'execute')` (no handler registered) or an `expected undefined to equal 104857600` assertion. All pre-existing tests still pass.

- [ ] **Step 4: Implement**

In `cooklang-plugin-api-contribution.ts`:

Add after `import { CooklangOutletService } from './cooklang-outlet-service';`:

```ts
import { ReportExportResult, ReportExportService, ReportPageSize } from '../common/report-export-protocol';
```

In `CooklangPluginApi.Commands`, add after `OPEN_REPORT: 'cooklang.api.openReport',`:

```ts
        /**
         * `{ html, defaultFileName, pageSize? }` → `{ saved, path?, error? }`: renders a standalone
         * HTML document (at most {@link MAX_EXPORT_HTML_LENGTH} characters, so inline photos as
         * `data:` URIs) to PDF and shows the native save dialog, the same path as a report tab's
         * **Export PDF**. The document is loaded from a temp file into a hidden, sandboxed window
         * with JavaScript disabled. `defaultFileName` prefills the dialog: at most
         * {@link MAX_EXPORT_FILE_NAME_LENGTH} characters, no `/`, `\` or control characters; `.pdf`
         * is added when missing. `pageSize` is `A4` or `Letter`; without it Chromium's default
         * (Letter) applies, and CSS `@page { size }` is ignored. Resolves `{ saved: false }` when the
         * user cancels and `{ saved: false, error }` when rendering or writing fails; the editor
         * shows no message of its own.
         */
        EXPORT_PDF: 'cooklang.api.exportPdf',
```

(`RECIPE_IMAGES` comes in Task 6: an id in `Commands` without a registered handler fails the "registers every API command" test.)

After `export const MAX_REPORT_LABEL_LENGTH = 60;` add:

```ts

    /** Maximum `cooklang.api.exportPdf` HTML length, in characters (100 Mi); photos travel inline as `data:` URIs. */
    export const MAX_EXPORT_HTML_LENGTH = 100 * 1024 * 1024;

    /** Maximum `cooklang.api.exportPdf` default file name length, in characters. */
    export const MAX_EXPORT_FILE_NAME_LENGTH = 200;

    /** `cooklang.api.exportPdf` result. */
    export interface ExportPdfResult {
        /** False when the user cancelled the dialog or the export failed. */
        saved: boolean;
        /** Absolute path of the written file, when saved. */
        path?: string;
        /** Why the export failed, when it did. */
        error?: string;
    }
```

Add the injection after the `reportPresenter` field:

```ts
    @inject(ReportExportService)
    protected readonly reportExport: ReportExportService;
```

In `registerCommands`, add after the `OPEN_REPORT` registration:

```ts
        registry.registerCommand({ id: Commands.EXPORT_PDF }, { execute: (args: unknown) => this.exportPdf(args) });
```

Add after the `openReport` method:

```ts
    protected async exportPdf(args: unknown): Promise<CooklangPluginApi.ExportPdfResult> {
        const request = this.object(args);
        const html = this.text(request.html, '`html`');
        // `/\S/` instead of `trim()`: no copy of a document that may be 100 Mi characters.
        if (!/\S/.test(html) || html.length > CooklangPluginApi.MAX_EXPORT_HTML_LENGTH) {
            throw this.invalid(`\`html\` must be non-empty and at most ${CooklangPluginApi.MAX_EXPORT_HTML_LENGTH} characters.`);
        }
        const fileName = this.string(request.defaultFileName, '`defaultFileName`');
        if (fileName.length > CooklangPluginApi.MAX_EXPORT_FILE_NAME_LENGTH || /[\\/]/.test(fileName)) {
            throw this.invalid(
                `\`defaultFileName\` must be at most ${CooklangPluginApi.MAX_EXPORT_FILE_NAME_LENGTH} characters, without path separators.`
            );
        }
        // The export service appends `.pdf` itself.
        const baseName = fileName.replace(/\.pdf$/i, '').trim();
        if (baseName === '') {
            throw this.invalid('`defaultFileName` must name the file, not only its extension.');
        }
        const pageSize = request.pageSize;
        if (pageSize !== undefined && pageSize !== 'A4' && pageSize !== 'Letter') {
            throw this.invalid('`pageSize` must be "A4" or "Letter".');
        }
        let result: ReportExportResult;
        try {
            result = await this.reportExport.exportPdf(html, baseName, pageSize === undefined ? undefined : { pageSize: pageSize as ReportPageSize });
        } catch (e) {
            return { saved: false, error: e instanceof Error ? e.message : String(e) };
        }
        const mapped: CooklangPluginApi.ExportPdfResult = { saved: result.saved };
        if (result.filePath !== undefined) {
            mapped.path = result.filePath;
        }
        if (result.error !== undefined) {
            mapped.error = result.error;
        }
        return mapped;
    }
```

- [ ] **Step 5: Run the spec to see it pass**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js; cd ../..`
Expected: compile exits 0; all tests pass, including the 9 under `CooklangPluginApiContribution — exportPdf` and the existing `registers every API command without a label`.

- [ ] **Step 6: Lint and commit**

```bash
PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.exportPdf renders plugin HTML to PDF with a save dialog"
```

---

### Task 6: `cooklang.api.recipeImages`

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Extend the spec fixture**

In `class Fixture`, add after the `exportError` field from Task 5:

```ts
    nativeImages: { title?: string; steps: Record<string, Record<string, string>> } = { steps: {} };
    contentImages: { title?: string; steps: Record<string, Record<string, string>> } = { steps: {} };
    imageLookups: string[] = [];
    contentLookups: string[] = [];
    fileReads: string[] = [];
```

In `create()`, add two members to the `languageService` mock object (after `editPantry`):

```ts
            recipeImages: async (path: string) => {
                this.imageLookups.push(path);
                return JSON.stringify(this.nativeImages);
            },
            recipeImagesFromContent: async (content: string) => {
                this.contentLookups.push(content);
                return JSON.stringify(this.contentImages);
            },
```

and replace the `fileService` mock line with:

```ts
        (contribution as any).fileService = {
            hasProvider: (scheme: string) => this.hasProvider(scheme),
            read: async (uri: URI) => {
                this.fileReads.push(uri.toString());
                return { value: 'remote recipe text' };
            },
        };
```

- [ ] **Step 2: Write the failing tests**

Append to the end of the spec file:

```ts
describe('CooklangPluginApiContribution — recipeImages', () => {
    const { RECIPE_IMAGES } = CooklangPluginApi.Commands;

    it('returns a local recipe\'s images as absolute file URIs, looked up on disk', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = {
            title: 'photos/hero.jpg',
            steps: {
                '0': { '0': '/ws/Dinner/Soup.1.jpg', '2': '/ws/Dinner/My Soup.3.webp' },
                '1': { '3': '/ws/Dinner/Soup.2.4.PNG' },
            },
        };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Dinner/Soup.cook' })).to.deep.equal({
            title: 'file:///ws/Dinner/photos/hero.jpg',
            steps: {
                '0': { '0': 'file:///ws/Dinner/Soup.1.jpg', '2': 'file:///ws/Dinner/My%20Soup.3.webp' },
                '1': { '3': 'file:///ws/Dinner/Soup.2.4.PNG' },
            },
        });
        expect(fixture.imageLookups).to.deep.equal(['/ws/Dinner/Soup.cook']);
        expect(fixture.contentLookups).to.deep.equal([]);
        expect(fixture.fileReads).to.deep.equal([]);
    });

    it('returns http(s) metadata URLs of a local recipe verbatim', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = { title: 'http://cdn.example/soup.jpg', steps: {} };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' }))
            .to.deep.equal({ title: 'http://cdn.example/soup.jpg', steps: {} });
    });

    it('leaves out files the preview cannot show and recipes with no images', async () => {
        const fixture = new Fixture();
        fixture.nativeImages = { title: 'hero.gif', steps: { '0': { '0': '/ws/Soup.1.tiff' } } };
        fixture.create();
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' })).to.deep.equal({ steps: {} });
        fixture.nativeImages = { steps: {} };
        expect(await fixture.run(RECIPE_IMAGES, { uri: 'file:///ws/Soup.cook' })).to.deep.equal({ steps: {} });
    });

    it('reads a recipe on another file system through FileService and keeps only https images', async () => {
        const fixture = new Fixture();
        fixture.contentImages = { title: 'https://cdn.example/p.jpg', steps: {} };
        fixture.create();
        const uri = 'cooklang-hub:/recipes/12/Pancakes.cook';
        expect(await fixture.run(RECIPE_IMAGES, { uri })).to.deep.equal({ title: 'https://cdn.example/p.jpg', steps: {} });
        expect(fixture.fileReads).to.deep.equal([uri]);
        expect(fixture.contentLookups).to.deep.equal(['remote recipe text']);
        expect(fixture.imageLookups).to.deep.equal([]);
        for (const title of ['http://cdn.example/p.jpg', 'Pancakes.jpg', '/etc/passwd']) {
            fixture.contentImages = { title, steps: {} };
            expect(await fixture.run(RECIPE_IMAGES, { uri }), title).to.deep.equal({ steps: {} });
        }
    });

    it('rejects anything but an absolute .cook URI', async () => {
        const fixture = new Fixture();
        fixture.create();
        for (const args of [
            undefined,
            {},
            { uri: '' },
            { uri: 'Soup.cook' },
            { uri: 'file:///ws/week.menu' },
            { uri: 'file:///ws/notes.md' },
            { uri: 'file:///ws/So\nup.cook' },
        ]) {
            expect(await fixture.error(RECIPE_IMAGES, args), JSON.stringify(args)).to.match(/^Invalid arguments/);
        }
        expect(fixture.imageLookups).to.deep.equal([]);
    });

    it('rejects a URI whose scheme has no file system provider', async () => {
        const fixture = new Fixture();
        fixture.hasProvider = scheme => scheme === 'file';
        fixture.create();
        expect(await fixture.error(RECIPE_IMAGES, { uri: 'foo:/x/Soup.cook' }))
            .to.equal('Invalid arguments: no file system for scheme "foo".');
        expect(fixture.fileReads).to.deep.equal([]);
    });

    it('propagates a native lookup failure', async () => {
        const fixture = new Fixture();
        const contribution = fixture.create();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (contribution as any).languageService.recipeImages = async () => { throw new Error('recipeImages: not found'); };
        expect(await fixture.error(RECIPE_IMAGES, { uri: 'file:///ws/Gone.cook' })).to.equal('recipeImages: not found');
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js; cd ../..`
Expected: compile error `Property 'RECIPE_IMAGES' does not exist`; the 7 new tests fail with `TypeError: Cannot read properties of undefined (reading 'execute')`. Every other test passes.

- [ ] **Step 4: Implement**

In `cooklang-plugin-api-contribution.ts`:

Add after the `report-export-protocol` import from Task 5:

```ts
import {
    RECIPE_IMAGE_MIME_TYPES,
    ResolvedRecipeImages,
    discoverRecipeImages,
    locateRecipeImage,
    mapRecipeImages,
} from '../common/recipe-images';
```

In `CooklangPluginApi.Commands`, add after `EXPORT_PDF: 'cooklang.api.exportPdf',`:

```ts
        /**
         * `{ uri }` → `{ title?, steps }`: the recipe's photos, found by the preview's rules. A
         * `file:` recipe is looked up on disk (saved content): metadata `image` / `images` /
         * `picture` / `pictures` first, else the sibling `Recipe.jpg`; step photos `Recipe.N.jpg`
         * and `Recipe.S.N.jpg` (jpg, jpeg, png, webp). `steps[section][step]` keys are zero-based
         * strings; section `"0"` also holds the linear `Recipe.N` form, so look a step up as
         * `steps[s][j] ?? steps["0"][k]` (`k` counts steps across sections; see
         * `lookupStepImage`). Files come back as absolute `file:` URIs (read them with
         * `workspace.fs`), `http(s)` metadata URLs verbatim. A recipe on another file system
         * (e.g. `cooklang-hub:`) has no folder: only its `https:` metadata image is reported.
         * `uri` must be an absolute `.cook` URI whose scheme has a file system provider; a recipe
         * that cannot be read rejects with the native error.
         */
        RECIPE_IMAGES: 'cooklang.api.recipeImages',
```

In `registerCommands`, add after the `EXPORT_PDF` registration:

```ts
        registry.registerCommand({ id: Commands.RECIPE_IMAGES }, { execute: (args: unknown) => this.recipeImages(args) });
```

Add a shared URI check above `reportRequest` (inside the class):

```ts
    /**
     * `value` as an absolute URI that `accepts` and whose scheme has a file
     * system provider. Fails closed: `FileService.activateProvider()` never
     * settles for a scheme with no registered (or registering) provider, so an
     * unhandled scheme would hang the caller forever instead of rejecting.
     */
    protected providedUri(value: unknown, accepts: (uri: URI) => boolean, expected: string): URI {
        const raw = this.string(value, '`uri`');
        const uri = new URI(raw);
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || !accepts(uri)) {
            throw this.invalid(`\`uri\` must be an absolute URI of ${expected}.`);
        }
        if (!this.fileService.hasProvider(uri.scheme)) {
            throw this.invalid(`no file system for scheme "${uri.scheme}".`);
        }
        return uri;
    }
```

Replace the body of `openPreview` (keep its doc comment) with:

```ts
    protected async openPreview(args: unknown): Promise<void> {
        const uri = this.providedUri(this.object(args).uri, candidate => CooklangUri.isRecipe(candidate), 'a .cook recipe');
        await this.recipePreview.open(uri);
    }
```

In `reportRequest`, replace the first block (from `const raw = this.string(request.uri, '\`uri\`');` through the closing brace of the `hasProvider` check) with:

```ts
        const uri = this.providedUri(
            request.uri,
            candidate => CooklangUri.isRecipe(candidate) || CooklangUri.isMenu(candidate),
            'a .cook recipe or .menu file'
        );
```

(Error messages are unchanged: `` `uri` must be an absolute URI of a .cook recipe. `` / `` … of a .cook recipe or .menu file. `` / `no file system for scheme "…".`)

Add after the `exportPdf` method:

```ts
    protected async recipeImages(args: unknown): Promise<ResolvedRecipeImages> {
        const uri = this.providedUri(this.object(args).uri, candidate => CooklangUri.isRecipe(candidate), 'a .cook recipe');
        // A local recipe is looked up on disk; any other has only its metadata, read through its file system.
        const content = uri.scheme === 'file' ? undefined : (await this.fileService.read(uri)).value;
        const discovered = await discoverRecipeImages(this.languageService, uri, content);
        return mapRecipeImages(discovered, async raw => this.recipeImageUri(raw, uri));
    }

    /**
     * The plugin-facing form of one raw image value: `http(s)` URLs verbatim,
     * local files as absolute URIs when the preview can show their type.
     */
    protected recipeImageUri(raw: string, recipeUri: URI): string | undefined {
        const location = locateRecipeImage(raw, recipeUri);
        if (location?.kind === 'remote') {
            return location.url;
        }
        if (location?.kind === 'file' && RECIPE_IMAGE_MIME_TYPES[location.uri.path.ext.replace(/^\./, '').toLowerCase()]) {
            return location.uri.toString();
        }
        return undefined;
    }
```

- [ ] **Step 5: Run the spec to see it pass**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx mocha --config ../../configs/mocharc.yml lib/browser/cooklang-plugin-api-contribution.spec.js; cd ../..`
Expected: compile exits 0; all tests pass, including the 7 under `recipeImages` and the unchanged `openPreview` / `renderReport` / `openReport` URI tests (they now go through `providedUri`).

- [ ] **Step 6: Lint and commit**

```bash
PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang
git add packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts
git commit -m "feat(cooklang): cooklang.api.recipeImages returns recipe photos as URIs, same rules as the preview"
```

---

### Task 7: Whole-package check, bundle, manual verification

**Files:**
- Create (temporary, git-ignored, deleted at the end): `plugins/cooklang.api-smoke/extension/package.json`, `plugins/cooklang.api-smoke/extension/out/extension.js`

- [ ] **Step 1: Run the whole package**

Run: `PATH=~/.local/bin:$PATH npx lerna run compile --scope @theia/cooklang && cd packages/cooklang && PATH=~/.local/bin:$PATH npx theiaext test; cd ../..`
Expected: exit 0, no failures (the count grows by the tests added in Tasks 2, 4, 5 and 6).

- [ ] **Step 2: Lint**

Run: `PATH=~/.local/bin:$PATH npx lerna run lint --scope @theia/cooklang`
Expected: exit 0.

- [ ] **Step 3: Build the native addon and bundle the app**

Run: `cd packages/cooklang-native && PATH=~/.local/bin:$PATH npm run build; cd ../../app && PATH=~/.local/bin:$PATH npm run bundle; cd ..`
Expected: both exit 0 (the native build is only needed if the local addon is stale; it does not change in this plan).

- [ ] **Step 4: Add a throwaway smoke plugin**

`plugins/` is git-ignored and `npm run start` copies it into `app/plugins`. Create `plugins/cooklang.api-smoke/extension/package.json`:

```json
{
  "name": "api-smoke",
  "displayName": "API Smoke",
  "publisher": "cooklang",
  "version": "0.0.1",
  "engines": { "vscode": "^1.80.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "apiSmoke.images", "title": "API Smoke: Recipe Images" },
      { "command": "apiSmoke.pdf", "title": "API Smoke: Export PDF" },
      { "command": "apiSmoke.bigPdf", "title": "API Smoke: Export 60 MB PDF" }
    ]
  }
}
```

and `plugins/cooklang.api-smoke/extension/out/extension.js`:

```js
const vscode = require('vscode');

async function pickRecipe() {
    const files = await vscode.workspace.findFiles('**/*.cook', '**/node_modules/**', 200);
    const pick = await vscode.window.showQuickPick(files.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })));
    return pick && pick.uri;
}

async function report(label, run) {
    try {
        const result = await run();
        console.log(`[api-smoke] ${label}`, JSON.stringify(result, undefined, 2));
        vscode.window.showInformationMessage(`${label}: ${JSON.stringify(result)}`);
    } catch (e) {
        console.log(`[api-smoke] ${label} failed`, e);
        vscode.window.showErrorMessage(`${label} failed: ${e && e.message ? e.message : e}`);
    }
}

exports.activate = context => {
    context.subscriptions.push(
        vscode.commands.registerCommand('apiSmoke.images', async () => {
            const uri = await pickRecipe();
            if (uri) {
                await report('recipeImages', () => vscode.commands.executeCommand('cooklang.api.recipeImages', { uri: uri.toString() }));
            }
        }),
        vscode.commands.registerCommand('apiSmoke.pdf', async () => {
            const html = '<!doctype html><html><head><meta charset="utf-8"><style>@page { margin: 20mm } h1 { color: #b33 }</style></head>'
                + '<body><h1 id="top">Smoke Book</h1><p>If this page says JS RAN, JavaScript was not disabled.</p>'
                + '<p><a href="#top">internal link</a></p>'
                + '<script>document.body.innerHTML = "<h1>JS RAN</h1>";</script></body></html>';
            await report('exportPdf', () => vscode.commands.executeCommand('cooklang.api.exportPdf', { html, defaultFileName: 'Smoke Book', pageSize: 'A4' }));
            await report('exportPdf invalid', () => vscode.commands.executeCommand('cooklang.api.exportPdf', { html: '', defaultFileName: 'x' }));
        }),
        vscode.commands.registerCommand('apiSmoke.bigPdf', async () => {
            const html = `<!doctype html><html><body><h1>Big</h1><!--${'x'.repeat(60 * 1024 * 1024)}--></body></html>`;
            await report('exportPdf 60 MB', () => vscode.commands.executeCommand('cooklang.api.exportPdf', { html, defaultFileName: 'Big' }));
        }),
    );
};
```

- [ ] **Step 5: Exercise the commands in a dev build**

Run: `PATH=~/.local/bin:$PATH npm run start:electron`, open a recipe folder that has a recipe with frontmatter `image:` plus a sibling `Recipe.jpg`, and one with `Recipe.1.jpg` / `Recipe.2.1.jpg`. Open the recipe preview of each first and confirm the photos still show (Task 3 regression check). Then, from the command palette:

1. **API Smoke: Recipe Images** on each recipe → the toast shows `title` = the metadata image as a `file:///…` URI (not `Recipe.jpg`), and `steps` with zero-based keys (`Recipe.2.1.jpg` under `"1": {"0": …}`). On a recipe without photos → `{"steps":{}}`.
2. **API Smoke: Export PDF** → the save dialog suggests `Smoke Book.pdf`; save it and open it: page size A4, red heading "Smoke Book", **not** "JS RAN"; the internal link works. The second call shows an `Invalid arguments: \`html\` …` error toast. Run it again and cancel the dialog → toast `{"saved":false}`.
3. **API Smoke: Export 60 MB PDF** → the dialog appears within a few seconds and the saved PDF has the heading "Big". Watch the terminal and DevTools console (Help → Toggle Developer Tools) for disconnect or `maxHttpBufferSize` errors; there must be none, and the editor must stay connected afterwards (open a file to check).
4. Open any report tab (e.g. a built-in report on a recipe, and the Core Vitals report on a `.menu` if that plugin is installed) and use **Export PDF**, **Print** and **Export PNG**: output matches what the tab shows, including Mermaid diagrams and SVG charts; PNG still captures the full height.

Close the app.

- [ ] **Step 6: Remove the smoke plugin**

Run: `rm -rf plugins/cooklang.api-smoke app/plugins/cooklang.api-smoke && git status --short`
Expected: no untracked or modified files from this task.

No commit in this task.

---

### Task 8: Document the commands on cook.md (separate repo, own branch and PR)

**Files (in `/Users/alexeydubovskoy/Cooklang/cook.md`):**
- Modify: `web/app/views/help/plugins/api.html.erb`
- Test: `web/spec/requests/help/plugins_spec.rb`

`cook.md`'s main checkout has unrelated uncommitted work, so this task uses its own worktree and branch, and becomes its own PR. Ship it once the editor release that contains Tasks 5–6 is out.

- [ ] **Step 1: Worktree and branch**

```bash
cd /Users/alexeydubovskoy/Cooklang/cook.md
git fetch origin
git worktree add ../cook.md-plugin-api-docs -b docs/plugin-api-cookbook-commands origin/main
cd ../cook.md-plugin-api-docs/web
bundle install
bin/rails tailwindcss:build
```

(`tailwindcss:build` is required in a fresh worktree, or every request spec fails with "tailwind.css not present".)

- [ ] **Step 2: Confirm the editor version**

Run: `cat /Users/alexeydubovskoy/Cooklang/editor/.release-please-manifest.json` on the editor's `main` after the editor PR is merged and released. Use that release (expected `0.1.0-alpha.52`) in Step 5 wherever `0.1.0-alpha.52` appears.

- [ ] **Step 3: Write the failing spec**

In `web/spec/requests/help/plugins_spec.rb`, in `describe "api content"`, change the `%w[...]` list to:

```ruby
      %w[
        cooklang.api.version cooklang.api.generateShoppingList cooklang.api.resolveRecipeReferences
        cooklang.api.parseShoppingList cooklang.api.writeShoppingList cooklang.api.parseShoppingChecked
        cooklang.api.writeShoppingChecked cooklang.api.compactShoppingChecked cooklang.apiVersion
        cooklang.api.parsePantry cooklang.api.editPantry
        cooklang.api.exportPdf cooklang.api.recipeImages
      ].each { |name| expect(response.body).to include(name) }
```

- [ ] **Step 4: Run it to see it fail**

Run: `bundle exec rspec spec/requests/help/plugins_spec.rb -e "documents every cooklang.api command"`
Expected: 1 example, 1 failure: `expected "…" to include "cooklang.api.exportPdf"`.

- [ ] **Step 5: Add the section**

In `web/app/views/help/plugins/api.html.erb`, add to the "On This Page" list after `<li><a href="#pantry">The pantry file</a></li>`:

```erb
        <li><a href="#pdf-and-photos">PDF export and recipe photos</a></li>
```

Insert before `<nav class="page-nav-bottom">`:

```erb
    <section id="pdf-and-photos">
      <h2>PDF export and recipe photos</h2>
      <p>
        These two commands let a plugin build a document from recipes and save it as a PDF, the way the Cookbook plugin does.
      </p>
      <table>
        <thead><tr><th>Command</th><th>Arguments</th><th>Returns</th></tr></thead>
        <tbody>
          <tr>
            <td><code>cooklang.api.exportPdf</code></td>
            <td><code>{ html, defaultFileName, pageSize? }</code></td>
            <td>
              <code>{ saved, path?, error? }</code><br>
              Turns a complete HTML document into a PDF and shows the save dialog, the same way a report's <strong>Export PDF</strong> button does. JavaScript is off while the page renders, so pass finished HTML with its CSS inline and photos as <code>data:</code> URIs. <code>html</code> may be up to 104,857,600 characters (100&nbsp;MiB). <code>defaultFileName</code> fills in the dialog: up to 200 characters, no <code>/</code> or <code>\</code>, and <code>.pdf</code> is added for you. <code>pageSize</code> is <code>'A4'</code> or <code>'Letter'</code>. Leave it out and you get Letter. CSS <code>@page { size }</code> is ignored, so set the size here. <code>@page</code> margins do work. Internal links (<code>&lt;a href="#id"&gt;</code>) are kept as PDF links.<br>
              You get <code>{ saved: false }</code> when the user cancels and <code>{ saved: false, error }</code> when the export fails. The editor doesn't show a message, so tell the user yourself.
            </td>
          </tr>
          <tr>
            <td><code>cooklang.api.recipeImages</code></td>
            <td><code>{ uri }</code>: an absolute <code>.cook</code> URI, e.g. <code>uri.toString()</code></td>
            <td>
              <code>{ title?, steps: { [section]: { [step]: uri } } }</code><br>
              The photos the recipe preview shows. <code>title</code> is the metadata <code>image</code> (or <code>images</code>, <code>picture</code>, <code>pictures</code>). If there is none, it's <code>Recipe.jpg</code> from the recipe's folder. Step photos are <code>Recipe.N.jpg</code> (step N, counted across the whole recipe) and <code>Recipe.S.N.jpg</code> (section S, step N). Keys are zero-based strings. <code>Recipe.2.4.jpg</code> is <code>steps["1"]["3"]</code>, and <code>Recipe.3.jpg</code> is <code>steps["0"]["2"]</code>. To find step <code>j</code> of section <code>s</code>, use <code>steps[s]?.[j] ?? steps["0"]?.[k]</code>, where <code>k</code> counts steps across all sections.<br>
              Local photos come back as absolute <code>file:</code> URIs (jpg, jpeg, png or webp); read them with <code>vscode.workspace.fs.readFile</code>. <code>http(s)</code> image URLs in metadata come back as written. The editor reads recipes from disk, so it won't see unsaved edits. For a recipe from another file system, such as the Recipe Hub, you only get its <code>https</code> metadata image.
            </td>
          </tr>
        </tbody>
      </table>
      <pre><code>const images = await vscode.commands.executeCommand('cooklang.api.recipeImages', { uri: recipeUri.toString() });
let hero = '';
if (images.title?.startsWith('file:')) {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(images.title));
  hero = `&lt;img src="data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}"&gt;`;
}
const html = `&lt;!doctype html&gt;&lt;html&gt;&lt;head&gt;&lt;meta charset="utf-8"&gt;&lt;/head&gt;&lt;body&gt;&lt;h1&gt;My book&lt;/h1&gt;${hero}&lt;/body&gt;&lt;/html&gt;`;
const result = await vscode.commands.executeCommand('cooklang.api.exportPdf', {
  html, defaultFileName: 'My book', pageSize: 'A4',
});
if (result.error) {
  vscode.window.showErrorMessage(`Export failed: ${result.error}`);
} else if (result.saved) {
  vscode.window.showInformationMessage(`Saved ${result.path}`);
}</code></pre>
      <p>
        Added in Cook Editor 0.1.0-alpha.52. Check that they exist with <code>(await vscode.commands.getCommands(true)).includes('cooklang.api.exportPdf')</code> and ask users on an older Cook Editor to update.
      </p>
    </section>
```

(In the example, pick the MIME type from the file extension in real code. `image/jpeg` keeps the sample short.)

- [ ] **Step 6: Run the specs to see them pass**

Run: `bundle exec rspec spec/requests/help/plugins_spec.rb`
Expected: all examples pass, 0 failures.

- [ ] **Step 7: Look at it**

Run: `bin/rails server -p 3010`, open `http://localhost:3010/help/plugins/api#pdf-and-photos` and check that the new sidebar link jumps to the section, the table reads well, and the code sample shows `<img …>` and `<!doctype html>` as text, not as markup. Stop the server.

- [ ] **Step 8: Commit, push, PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/cook.md-plugin-api-docs
git add web/app/views/help/plugins/api.html.erb web/spec/requests/help/plugins_spec.rb
git commit -m "docs(help): cooklang.api.exportPdf and recipeImages on the plugin API page"
git push -u origin docs/plugin-api-cookbook-commands
gh pr create --title "docs(help): plugin API exportPdf and recipeImages" --body "Documents the two Cook Editor plugin commands the Cookbook plugin uses (editor spec: docs/superpowers/specs/2026-10-10-cookbook-plugin-api-design.md). Merge after the editor release that ships them."
```

The page goes live with the next `web` release and deploy, which is a separate step. When the PR is merged, remove the worktree with `git worktree remove ../cook.md-plugin-api-docs`.

---

## Self-review: spec coverage

| Spec section / requirement | Task |
|---|---|
| `exportPdf` signature `{ html, defaultFileName }` → `{ saved, path?, error? }` | 5 (mapping `filePath` → `path`, deviation 7) |
| Delegates to `ReportExportService.exportPdf`, same path as report **Export PDF** | 5 (injection; proxy bound in `frontendElectron` module) |
| Strict validation: `html` non-empty ≤ 100 MB chars; `defaultFileName` non-empty ≤ 200, no separators/control chars, `.pdf` appended | 5 (`.pdf` handling: deviation 4) |
| `saved: false` on cancel; `error` passes through; editor shows nothing | 4 (impl), 5 (API mapping, RPC rejection) |
| Security: `javascript: false` on the hidden window; report export unaffected | 4 (print + PDF; PNG keeps JS, deviation 5), 7 Step 5.2 and 5.4 (manual) |
| Optional `pageSize: 'A4' \| 'Letter'`, default unchanged | 4 (protocol + impl), 5 (API), deviation 6 |
| `recipeImages` signature, absolute URIs | 6 |
| `uri` absolute `.cook` with a file system provider (reuse `reportRequest` checks) | 6 (`providedUri`, shared by `openPreview` and `reportRequest`) |
| Same lookup as the preview; metadata wins for title | 1 (Rust precedence test), 2 (`discoverRecipeImages`), deviation 1 |
| Factor out a pure function shared by preview and API | 2 (helpers), 3 (preview uses them), 6 (API uses them) |
| API returns URIs, not blob URLs | 6 (`recipeImageUri`) |
| Metadata `http(s)` URLs verbatim | 6 (local recipes; https-only for other schemes, deviation 3) |
| Docs: command doc block | 5 (`EXPORT_PDF`), 6 (`RECIPE_IMAGES`) |
| Docs: cook.md `/help/plugins/api` with version note | 8 |
| Testing: argument validation for both commands | 5, 6 |
| Testing: `exportPdf` delegates, maps cancel / error | 4, 5 |
| Testing: shared merge function, existing preview specs keep passing, precedence + section step images | 1, 2, 3 |
| Version stays 1, feature detection by command presence | no `VERSION` change; documented in 8 |
| Manual verification in a dev build | 7 |

**Open risks:**

- **Payload size.** A 100 MiB string goes from the plugin host to the backend, then to the frontend (websocket), then to electron-main (IPC), in one message. Theia's websocket endpoint caps *incoming* server messages at `maxHttpBufferSize = 1e8` (`packages/core/src/node/messaging/websocket-endpoint.ts`). The command argument goes backend → frontend, so that cap should not apply, but nothing has tested this path near the limit. Task 7 Step 5.3 tests 60 MB. If that fails, lower `MAX_EXPORT_HTML_LENGTH` and update the docs.
- **Cookbook size.** The consumer allows 500 recipes and skips only photos over 10 MB. Large original photos as base64 can blow past 100 MiB. The plugin should cap total inlined bytes or downscale, and handle the `Invalid arguments: \`html\`` rejection.
- **`javascript: false` and `executeJavaScript`.** This is why PNG keeps scripts on. If a future change moves PNG to the scripts-off window, the height measurement breaks.
