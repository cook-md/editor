# Recipe Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a hero image and per-step images in the editor's `.cook` recipe preview, discovered with exactly the same rules CookCLI's web server uses.

**Architecture:** A new napi function in `packages/cooklang-native` wraps `cooklang-find`'s `title_image()` / `step_images()` and returns them as JSON. The frontend keeps the section/step lookup and the URI resolution in a pure, monaco-free module so both are unit-testable. Because the Theia renderer is served from `http://localhost:<port>`, Chromium blocks `file://` image sources, so local files are read via `FileService` and turned into blob URLs by a per-widget service.

**Tech Stack:** Rust + NAPI-RS (`napi` 2, `cooklang-find` 0.6.1, `serde_json`), TypeScript 5.4, React 18, InversifyJS, Theia 1.70 (`FileService`, `ReactWidget`), mocha + chai.

**Spec:** `docs/superpowers/specs/2026-08-29-recipe-images-design.md`

---

## Background you need before starting

**The naming convention** (defined by `cooklang-find`, see
`/Users/alexeydubovskoy/Cooklang/cooklang-find/src/model/recipe_entry.rs`):

- Title image: metadata `image` / `images` / `picture` / `pictures` wins; otherwise
  a sibling file `Pancakes.jpg`, `.jpeg`, `.png`, `.webp` next to `Pancakes.cook`.
- Step images: `Recipe.N.ext` is step N counted continuously across all sections
  and is stored at map key `[0][N-1]`. `Recipe.S.N.ext` is step N inside section S
  and is stored at `[S-1][N-1]`. Filenames are one-indexed, map keys are
  zero-indexed, and section 0 is reserved for the linear form.

**The lookup order** CookCLI uses per step
(`/Users/alexeydubovskoy/Cooklang/cookcli/src/web/builders.rs:502-506`) — the
section-specific image wins, the linear one is the fallback:

```rust
entry.step_images()
    .get(section_index + 1, step_count + 1)
    .or_else(|| entry.step_images().get(0, total_steps + step_count + 1))
```

`StepImageCollection::get(section, step)` normalises its arguments as
`section_idx = if section == 0 { 0 } else { section - 1 }` and `step_idx = step - 1`,
returning `None` when `step == 0`. Note the consequence: `get(0, N)` and
`get(1, N)` address the *same* map entry. That collision exists upstream and we
reproduce it deliberately — do not "fix" it.

**File conventions in this repo:** 4-space indent, single quotes, `undefined`
never `null`, explicit return types, property injection with `@inject`, kebab-case
filenames. Every new `.ts`/`.tsx` file starts with the same 12-line AGPL header
block used by its siblings — copy it verbatim from
`packages/cooklang/src/common/cooklang-uri.ts`.

**Running tests:** specs are compiled to `lib/` first, then run from there.

```bash
npx lerna run compile --scope @theia/cooklang
npx mocha --config configs/mocharc.yml "packages/cooklang/lib/common/recipe-images.spec.js"
```

---

### Task 1: `recipeImages` napi function

**Files:**
- Modify: `packages/cooklang-native/src/lib.rs` (append near the other
  `cooklang_find` helper, `napi_find_recipe`, around line 939)

- [ ] **Step 1: Write the failing Rust tests**

Append to the bottom of `packages/cooklang-native/src/lib.rs`:

```rust
#[cfg(test)]
mod recipe_images_tests {
    use super::*;
    use std::fs;

    /// Creates a temp dir with `Recipe.cook` plus the given sibling image files.
    fn fixture(name: &str, images: &[&str]) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!(
            "cooklang-images-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let recipe = dir.join("Pancakes.cook");
        fs::write(&recipe, "Crack the @eggs{2}.\nFry it.\n").unwrap();
        for image in images {
            fs::write(dir.join(image), b"fake").unwrap();
        }
        (dir.clone(), recipe.to_string_lossy().to_string())
    }

    #[test]
    fn reports_no_images_when_folder_has_none() {
        let (_dir, path) = fixture("none", &[]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["title"].is_null());
        assert_eq!(value["steps"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn finds_the_sibling_title_image() {
        let (_dir, path) = fixture("title", &["Pancakes.jpg"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["title"].as_str().unwrap().ends_with("Pancakes.jpg"));
    }

    #[test]
    fn finds_a_title_image_for_every_supported_extension() {
        for ext in ["jpg", "jpeg", "png", "webp"] {
            let (_dir, path) = fixture(ext, &[&format!("Pancakes.{ext}")]);
            let json = napi_recipe_images(path).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert!(
                value["title"]
                    .as_str()
                    .unwrap_or_default()
                    .ends_with(&format!("Pancakes.{ext}")),
                "extension {ext} was not discovered"
            );
        }
    }

    // `Recipe.N.ext` is the linear form: step N across all sections, stored at [0][N-1].
    #[test]
    fn stores_linear_step_images_under_section_zero() {
        let (_dir, path) = fixture("linear", &["Pancakes.1.jpg", "Pancakes.3.png"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["steps"]["0"]["0"].as_str().unwrap().ends_with("Pancakes.1.jpg"));
        assert!(value["steps"]["0"]["2"].as_str().unwrap().ends_with("Pancakes.3.png"));
    }

    // `Recipe.S.N.ext` is the sectioned form: section S step N, stored at [S-1][N-1].
    #[test]
    fn stores_section_step_images_under_the_section_index() {
        let (_dir, path) = fixture("sectioned", &["Pancakes.2.4.jpg"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["steps"]["1"]["3"].as_str().unwrap().ends_with("Pancakes.2.4.jpg"));
    }

    #[test]
    fn errors_when_the_recipe_does_not_exist() {
        assert!(napi_recipe_images("/definitely/not/here/Nope.cook".to_string()).is_err());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/cooklang-native && cargo test recipe_images
```

Expected: FAIL to compile — `cannot find function 'napi_recipe_images' in this scope`.

- [ ] **Step 3: Write the implementation**

Insert into `packages/cooklang-native/src/lib.rs`, directly after the closing
brace of `napi_find_recipe`:

```rust
/// Title and step images for the recipe at `recipe_path`, discovered with
/// `cooklang-find`'s naming rules (the same ones CookCLI's web server uses).
///
/// Returns JSON `{ "title": string | null, "steps": { section: { step: path } } }`.
/// `title` is the raw value from metadata (which may be a URL or a relative path)
/// or an absolute path to a sibling file. `steps` keys are zero-indexed, with
/// section 0 holding the linear `Recipe.N.ext` form.
#[napi(js_name = "recipeImages")]
pub fn napi_recipe_images(recipe_path: String) -> napi::Result<String> {
    let path = Utf8PathBuf::from(recipe_path);
    let entry = cooklang_find::RecipeEntry::from_path(path)
        .map_err(|e| napi::Error::from_reason(format!("recipeImages: {e}")))?;
    let payload = serde_json::json!({
        "title": entry.title_image(),
        "steps": entry.step_images().images,
    });
    serde_json::to_string(&payload)
        .map_err(|e| napi::Error::from_reason(format!("recipeImages serialize: {e}")))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/cooklang-native && cargo test recipe_images
```

Expected: PASS, 6 tests.

If `RecipeEntry` is not in scope, add `use cooklang_find::RecipeEntry;` — but
prefer the fully-qualified `cooklang_find::RecipeEntry` shown above, which
matches how `napi_find_recipe` refers to the crate.

- [ ] **Step 5: Build the addon so the new export exists in `index.d.ts`**

```bash
cd packages/cooklang-native && npm run build
grep -n "recipeImages" index.d.ts
```

Expected: a `export declare function recipeImages(recipePath: string): string` line.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-native/src/lib.rs packages/cooklang-native/index.d.ts packages/cooklang-native/index.js
git commit -m "feat(native): add recipeImages for cooklang-find image discovery"
```

---

### Task 2: Expose `recipeImages` on the language service

**Files:**
- Modify: `packages/cooklang/src/common/cooklang-language-service.ts` (add to the
  `CooklangLanguageService` interface, next to `findRecipe`)
- Modify: `packages/cooklang/src/node/cooklang-language-service-impl.ts` (add
  next to `findRecipe`, around line 272)

- [ ] **Step 1: Add the interface method**

In `packages/cooklang/src/common/cooklang-language-service.ts`, directly after
the `findRecipe` declaration:

```ts
    /**
     * Title and step images for the recipe at `recipePath`, discovered with
     * `cooklang-find`'s naming rules (the same ones CookCLI's web server uses).
     *
     * Returns JSON `{ title: string | null, steps: { [section]: { [step]: path } } }`.
     * `title` is raw: an absolute path, a URL, or a relative path from metadata.
     * `steps` keys are zero-indexed; section 0 holds the linear `Recipe.N.ext` form.
     *
     * `recipePath` must be an OS filesystem path (not a URI) — this RPC reads
     * from disk directly via `cooklang-find` and bypasses Theia's `FileService`.
     * Electron-only by design; remote/virtual workspaces are not supported.
     */
    recipeImages(recipePath: string): Promise<string>;
```

- [ ] **Step 2: Add the backend delegation**

In `packages/cooklang/src/node/cooklang-language-service-impl.ts`, directly
after the `findRecipe` method:

```ts
    async recipeImages(recipePath: string): Promise<string> {
        const native = require('@theia/cooklang-native');
        return native.recipeImages(recipePath);
    }
```

- [ ] **Step 3: Compile to verify the interface is satisfied**

```bash
npx lerna run compile --scope @theia/cooklang
```

Expected: exits 0. A missing method would fail with
`Class 'CooklangLanguageServiceImpl' incorrectly implements interface`.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-language-service.ts packages/cooklang/src/node/cooklang-language-service-impl.ts
git commit -m "feat(cooklang): expose recipeImages over the language service RPC"
```

---

### Task 3: Step-image lookup (pure logic)

This module must not import anything that transitively pulls in `@theia/monaco`,
or its spec will abort the whole mocha run with a `.css` extension error. `URI`
from `@theia/core/lib/common/uri` is safe; anything from
`@theia/monaco` or `@theia/filesystem/lib/browser` is not.

**Files:**
- Create: `packages/cooklang/src/common/recipe-images.ts`
- Test: `packages/cooklang/src/common/recipe-images.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/common/recipe-images.spec.ts` (with the standard
12-line AGPL header at the top, copied from `cooklang-uri.ts`):

```ts
import { expect } from 'chai';
import { RecipeImages, lookupStepImage } from './recipe-images';

describe('lookupStepImage', () => {

    const linear: RecipeImages = {
        steps: { '0': { '0': '/r/Pancakes.1.jpg', '2': '/r/Pancakes.3.jpg' } }
    };

    it('finds a linear image by its global step index', () => {
        expect(lookupStepImage(linear, 0, 0, 0)).to.equal('/r/Pancakes.1.jpg');
        expect(lookupStepImage(linear, 0, 2, 2)).to.equal('/r/Pancakes.3.jpg');
    });

    it('returns undefined for a step with no image', () => {
        expect(lookupStepImage(linear, 0, 1, 1)).to.be.undefined;
    });

    it('finds a section image at [section][step]', () => {
        // Pancakes.2.4.jpg -> section 2, step 4 -> stored at [1][3].
        const sectioned: RecipeImages = { steps: { '1': { '3': '/r/Pancakes.2.4.jpg' } } };
        expect(lookupStepImage(sectioned, 1, 3, 7)).to.equal('/r/Pancakes.2.4.jpg');
    });

    // Mirrors cookcli builders.rs: the section-specific image wins over the linear one.
    it('prefers the section image over the linear fallback', () => {
        const both: RecipeImages = {
            steps: {
                '1': { '0': '/r/Pancakes.2.1.jpg' },
                '0': { '3': '/r/Pancakes.4.jpg' }
            }
        };
        expect(lookupStepImage(both, 1, 0, 3)).to.equal('/r/Pancakes.2.1.jpg');
    });

    it('falls back to the linear image when the section has none', () => {
        const both: RecipeImages = { steps: { '0': { '3': '/r/Pancakes.4.jpg' } } };
        expect(lookupStepImage(both, 1, 0, 3)).to.equal('/r/Pancakes.4.jpg');
    });

    // StepImageCollection::get normalises section 0 and section 1 to the same
    // index, so the first section of a sectioned recipe shares keys with the
    // linear form. This collision exists upstream; it is reproduced, not fixed.
    it('treats section index 0 as section index 0, like the upstream collection', () => {
        const images: RecipeImages = { steps: { '0': { '1': '/r/Pancakes.2.jpg' } } };
        expect(lookupStepImage(images, 0, 1, 1)).to.equal('/r/Pancakes.2.jpg');
    });

    it('returns undefined when there are no images at all', () => {
        expect(lookupStepImage({ steps: {} }, 0, 0, 0)).to.be.undefined;
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx lerna run compile --scope @theia/cooklang
```

Expected: FAIL — `Cannot find module './recipe-images'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/common/recipe-images.ts` (standard AGPL header,
then):

```ts
/**
 * Image paths for one recipe, as returned by the `recipeImages` RPC.
 *
 * `steps` mirrors `cooklang-find`'s `StepImageCollection`: section index ->
 * step index -> path, both zero-indexed, with section 0 holding the linear
 * `Recipe.N.ext` form.
 */
export interface RecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

/** The same shape after every entry has been turned into an `<img>` src. */
export interface ResolvedRecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

/**
 * The image for one step, following the two naming conventions cookcli
 * supports (see `builders.rs`): the section-specific `Recipe.S.N.ext` wins,
 * and the continuous `Recipe.N.ext` is the fallback.
 *
 * @param sectionIndex zero-based index of the section the step is in
 * @param stepInSection zero-based index of the step within that section
 * @param globalStepIndex zero-based index of the step counted across all sections
 */
export function lookupStepImage(
    images: RecipeImages | ResolvedRecipeImages,
    sectionIndex: number,
    stepInSection: number,
    globalStepIndex: number
): string | undefined {
    return images.steps[String(sectionIndex)]?.[String(stepInSection)]
        ?? images.steps['0']?.[String(globalStepIndex)];
}
```

Note there is no `section - 1` arithmetic here: `builders.rs` calls
`get(section_index + 1, ...)` and `get` immediately undoes that with
`section - 1`, so the two cancel and the section key is just the zero-based
index. The `?? images.steps['0']` fallback is what makes section 0 and section 1
collide, matching upstream.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx lerna run compile --scope @theia/cooklang
npx mocha --config configs/mocharc.yml "packages/cooklang/lib/common/recipe-images.spec.js"
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/common/recipe-images.ts packages/cooklang/src/common/recipe-images.spec.ts
git commit -m "feat(cooklang): add step-image lookup matching cookcli conventions"
```

---

### Task 4: Image URI resolution (pure logic)

**Files:**
- Modify: `packages/cooklang/src/common/recipe-images.ts`
- Modify: `packages/cooklang/src/common/recipe-images.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cooklang/src/common/recipe-images.spec.ts`, and add
`URI` plus `resolveImageUri` to the imports at the top of the file:

```ts
import URI from '@theia/core/lib/common/uri';
import { RecipeImages, lookupStepImage, resolveImageUri } from './recipe-images';
```

```ts
describe('resolveImageUri', () => {

    const recipe = new URI('file:///work/recipes/Pancakes.cook');
    const root = new URI('file:///work');

    it('passes http and https URLs through untouched', () => {
        expect(resolveImageUri('https://cdn.example/p.jpg', recipe, root))
            .to.deep.equal({ kind: 'remote', url: 'https://cdn.example/p.jpg' });
        expect(resolveImageUri('http://cdn.example/p.jpg', recipe, root))
            .to.deep.equal({ kind: 'remote', url: 'http://cdn.example/p.jpg' });
    });

    // Discovery is sibling-based, so an absolute path always names a file next
    // to the recipe. Rebuilding it from the recipe URI avoids converting a raw
    // OS path into a URI in browser code.
    it('resolves an absolute path against the recipe folder by basename', () => {
        const result = resolveImageUri('/work/recipes/Pancakes.jpg', recipe, root);
        expect(result?.kind).to.equal('file');
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/Pancakes.jpg');
    });

    it('resolves a Windows-style absolute path by basename too', () => {
        const result = resolveImageUri('C:\\work\\recipes\\Pancakes.jpg', recipe, root);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/Pancakes.jpg');
    });

    it('resolves a relative metadata path against the recipe folder', () => {
        const result = resolveImageUri('photo.jpg', recipe, root);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/photo.jpg');
    });

    it('resolves a root-relative metadata path against the workspace root', () => {
        const result = resolveImageUri('images/photo.jpg', recipe, root);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/images/photo.jpg');
    });

    it('falls back to the recipe folder when there is no workspace root', () => {
        const result = resolveImageUri('images/photo.jpg', recipe, undefined);
        expect((result as { uri: URI }).uri.toString())
            .to.equal('file:///work/recipes/images/photo.jpg');
    });

    it('returns undefined for blank input', () => {
        expect(resolveImageUri('', recipe, root)).to.be.undefined;
        expect(resolveImageUri('   ', recipe, root)).to.be.undefined;
    });
});
```

The two multi-segment cases encode the rule: a relative path with no separator
is a sibling of the recipe, and one with a separator is resolved from the
workspace root (matching cookcli's `ServeDir` at the root), falling back to the
recipe folder when no root is open.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx lerna run compile --scope @theia/cooklang
```

Expected: FAIL — `Module './recipe-images' has no exported member 'resolveImageUri'`.

- [ ] **Step 3: Write the implementation**

Append to `packages/cooklang/src/common/recipe-images.ts`, and add the import
`import URI from '@theia/core/lib/common/uri';` at the top:

```ts
/** Where an image should be loaded from. */
export type ImageLocation =
    | { kind: 'remote'; url: string }
    | { kind: 'file'; uri: URI };

/** Image file extensions `cooklang-find` discovers, lower-case, in its own order. */
export const RECIPE_IMAGE_EXTENSIONS: ReadonlyArray<string> = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Turn a raw image value from the `recipeImages` RPC into something loadable.
 *
 * - `http(s)` URLs are passed through.
 * - An absolute path names a sibling of the recipe, so only its basename is
 *   used and it is resolved against the recipe's folder. This keeps browser
 *   code free of raw OS paths and works for both POSIX and Windows separators.
 * - A relative path from metadata with no separator resolves against the
 *   recipe's folder; one with a separator resolves against the workspace root
 *   (matching cookcli, which serves relative metadata paths from the root),
 *   falling back to the recipe's folder when no workspace is open.
 */
export function resolveImageUri(
    raw: string,
    recipeUri: URI,
    workspaceRootUri: URI | undefined
): ImageLocation | undefined {
    const value = raw.trim();
    if (value.length === 0) {
        return undefined;
    }
    if (/^https?:\/\//i.test(value)) {
        return { kind: 'remote', url: value };
    }
    const folder = recipeUri.parent;
    const normalized = value.replace(/\\/g, '/');
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
    if (isAbsolute) {
        const base = normalized.substring(normalized.lastIndexOf('/') + 1);
        return base.length === 0 ? undefined : { kind: 'file', uri: folder.resolve(base) };
    }
    if (normalized.includes('/') && workspaceRootUri) {
        return { kind: 'file', uri: workspaceRootUri.resolve(normalized) };
    }
    return { kind: 'file', uri: folder.resolve(normalized) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx lerna run compile --scope @theia/cooklang
npx mocha --config configs/mocharc.yml "packages/cooklang/lib/common/recipe-images.spec.js"
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Export the module from the package barrel**

In `packages/cooklang/src/common/index.ts`, after the
`export * from './recipe-types';` line:

```ts
export * from './recipe-images';
```

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang/src/common/recipe-images.ts packages/cooklang/src/common/recipe-images.spec.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): resolve recipe image paths to URIs"
```

---

### Task 5: `RecipeImageService` — blob URLs for local images

`<img src="file://…">` is blocked because the renderer is served from
`http://localhost:<port>`, so local files are read through `FileService` and
handed to the DOM as blob URLs.

**Files:**
- Create: `packages/cooklang/src/browser/recipe-image-service.ts`
- Test: `packages/cooklang/src/browser/recipe-image-service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang/src/browser/recipe-image-service.spec.ts` (standard
AGPL header, then):

```ts
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { RecipeImageService } from './recipe-image-service';

after(() => disableJSDOM());

class FakeFileService {
    size = 1024;
    reads: string[] = [];
    missing = false;
    async resolve(uri: URI): Promise<{ size: number }> {
        if (this.missing) { throw new Error(`not found: ${uri.toString()}`); }
        return { size: this.size };
    }
    async readFile(uri: URI): Promise<{ value: BinaryBuffer }> {
        if (this.missing) { throw new Error(`not found: ${uri.toString()}`); }
        this.reads.push(uri.toString());
        return { value: BinaryBuffer.wrap(new Uint8Array([1, 2, 3])) };
    }
}

function createService(): { service: RecipeImageService; files: FakeFileService; created: string[]; revoked: string[] } {
    const created: string[] = [];
    const revoked: string[] = [];
    let counter = 0;
    // jsdom has no URL.createObjectURL; stub it so the service is observable.
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
        const url = `blob:fake/${counter++}`;
        created.push(url);
        return url;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = url => {
        revoked.push(url);
    };
    const service = new RecipeImageService();
    const files = new FakeFileService();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (service as any).fileService = files;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { service, files, created, revoked };
}

describe('RecipeImageService', () => {

    it('reads a local file and returns a blob URL', async () => {
        const { service, created } = createService();
        const url = await service.resolve(new URI('file:///r/Pancakes.jpg'));
        expect(url).to.equal(created[0]);
    });

    it('reads each file once and reuses the cached URL', async () => {
        const { service, files } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        const first = await service.resolve(uri);
        const second = await service.resolve(uri);
        expect(second).to.equal(first);
        expect(files.reads).to.have.length(1);
    });

    // FileService reads travel over RPC to the backend; a huge file would stall
    // the preview, so it is skipped rather than loaded.
    it('skips files over the size cap', async () => {
        const { service, files } = createService();
        files.size = 40 * 1024 * 1024;
        expect(await service.resolve(new URI('file:///r/Huge.png'))).to.be.undefined;
        expect(files.reads).to.be.empty;
    });

    it('resolves to undefined for a missing or unreadable file', async () => {
        const { service, files } = createService();
        files.missing = true;
        expect(await service.resolve(new URI('file:///r/Gone.jpg'))).to.be.undefined;
    });

    it('resolves to undefined for an unsupported extension', async () => {
        const { service, files } = createService();
        expect(await service.resolve(new URI('file:///r/notes.txt'))).to.be.undefined;
        expect(files.reads).to.be.empty;
    });

    // A file replaced in place keeps its URI, so the cache must be invalidated
    // for it or the preview keeps showing the old bytes forever.
    it('re-reads a single file after release', async () => {
        const { service, files, revoked } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        const first = await service.resolve(uri);
        service.release(uri);
        expect(revoked).to.deep.equal([first!]);
        const second = await service.resolve(uri);
        expect(second).to.not.equal(first);
        expect(files.reads).to.have.length(2);
    });

    it('ignores release for a URI it never loaded', () => {
        const { service, revoked } = createService();
        service.release(new URI('file:///r/never.jpg'));
        expect(revoked).to.be.empty;
    });

    it('revokes every object URL on releaseAll', async () => {
        const { service, revoked } = createService();
        const a = await service.resolve(new URI('file:///r/a.jpg'));
        const b = await service.resolve(new URI('file:///r/b.png'));
        service.releaseAll();
        expect(revoked).to.have.members([a!, b!]);
    });

    it('re-reads a file after releaseAll', async () => {
        const { service, files } = createService();
        const uri = new URI('file:///r/Pancakes.jpg');
        await service.resolve(uri);
        service.releaseAll();
        await service.resolve(uri);
        expect(files.reads).to.have.length(2);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx lerna run compile --scope @theia/cooklang
```

Expected: FAIL — `Cannot find module './recipe-image-service'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang/src/browser/recipe-image-service.ts` (standard AGPL
header, then):

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';

const MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/**
 * Turns local image files into `blob:` URLs an `<img>` can load.
 *
 * The Theia renderer is served from `http://localhost:<port>`, so Chromium
 * blocks `file://` sources: the bytes have to come through `FileService`.
 * One instance is bound per preview widget, and `releaseAll` runs on dispose.
 */
@injectable()
export class RecipeImageService {

    /**
     * `FileService` reads travel over the RPC channel to the backend, so a very
     * large file would stall the preview. Recipe photos are far below this.
     */
    static readonly MAX_BYTES = 20 * 1024 * 1024;

    @inject(FileService)
    protected readonly fileService: FileService;

    protected readonly urls = new Map<string, string>();

    /**
     * A `blob:` URL for `uri`, or `undefined` when the file is missing,
     * unreadable, too large, or not a supported image type. Repeated calls for
     * the same URI reuse one object URL.
     */
    async resolve(uri: URI): Promise<string | undefined> {
        const key = uri.toString();
        const cached = this.urls.get(key);
        if (cached) {
            return cached;
        }
        const type = MIME_TYPES[uri.path.ext.replace(/^\./, '').toLowerCase()];
        if (!type) {
            return undefined;
        }
        try {
            const stat = await this.fileService.resolve(uri);
            if ((stat.size ?? 0) > RecipeImageService.MAX_BYTES) {
                return undefined;
            }
            const content = await this.fileService.readFile(uri);
            const url = URL.createObjectURL(new Blob([content.value.buffer], { type }));
            // Another call may have populated the cache while we awaited.
            const raced = this.urls.get(key);
            if (raced) {
                URL.revokeObjectURL(url);
                return raced;
            }
            this.urls.set(key, url);
            return url;
        } catch {
            return undefined;
        }
    }

    /**
     * Drop the cached URL for one file, so the next `resolve` re-reads it.
     * Needed when an image is replaced in place: the URI is unchanged, so
     * without this the preview would keep showing the old bytes.
     */
    release(uri: URI): void {
        const key = uri.toString();
        const url = this.urls.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            this.urls.delete(key);
        }
    }

    /** Revoke every object URL handed out so far and empty the cache. */
    releaseAll(): void {
        for (const url of this.urls.values()) {
            URL.revokeObjectURL(url);
        }
        this.urls.clear();
    }
}
```

`fileService.resolve(uri)` without options returns a `FileStat` whose `size` is
optional, hence the `?? 0`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx lerna run compile --scope @theia/cooklang
npx mocha --config configs/mocharc.yml "packages/cooklang/lib/browser/recipe-image-service.spec.js"
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser/recipe-image-service.ts packages/cooklang/src/browser/recipe-image-service.spec.ts
git commit -m "feat(cooklang): load local recipe images as blob URLs"
```

---

### Task 6: Render the hero and step images

Rendering comes before the widget wiring so the components can be reviewed with
plain props before any async plumbing exists.

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-components.tsx`
- Modify: `packages/cooklang/src/browser/style/recipe-preview.css`

- [ ] **Step 1: Add `picture`/`pictures` to the skipped metadata keys**

In `packages/cooklang/src/browser/recipe-preview-components.tsx`, replace the
`SKIP_META_KEYS` constant (around line 42):

```tsx
const SKIP_META_KEYS = new Set([
    'name', 'tags', 'tag', 'description', 'images', 'image', 'locale',
    'picture', 'pictures',
]);
```

`cooklang-find` reads the title image from any of `image`, `images`, `picture`
or `pictures`, so all four must stay out of the metadata pills.

- [ ] **Step 2: Add the import and a shared image element**

Add a new import line directly below the existing multi-line import from
`'../common/recipe-types'` (which ends around line 35):

```tsx
import { ResolvedRecipeImages, lookupStepImage } from '../common/recipe-images';
```

Then add this component just above the `StepItemView` section header:

```tsx
// ---------------------------------------------------------------------------
// RecipeImage
// ---------------------------------------------------------------------------

interface RecipeImageProps {
    src: string;
    alt: string;
    className: string;
}

/**
 * An image that removes itself when the source fails to load, so a corrupt or
 * vanished file degrades to no image rather than a broken-image icon.
 */
const RecipeImage = ({ src, alt, className }: RecipeImageProps): React.ReactElement => {
    const [failed, setFailed] = React.useState(false);
    const onError = React.useCallback(() => setFailed(true), []);
    // A new src is a new attempt: clear the previous failure.
    React.useEffect(() => setFailed(false), [src]);
    if (failed) {
        return <></>;
    }
    return <img className={className} src={src} alt={alt} onError={onError} />;
};
```

- [ ] **Step 3: Thread an image through `SectionContentView`**

In `packages/cooklang/src/browser/recipe-preview-components.tsx`, add
`imageSrc` to `SectionContentViewProps` and render it. Replace the whole
`SectionContentViewProps` interface and `SectionContentView` component
(currently lines 192-229) with:

```tsx
interface SectionContentViewProps {
    content: SectionContent;
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
    imageSrc?: string;
}

const SectionContentView = ({
    content,
    ingredients,
    cookware,
    timers,
    inlineQuantities,
    imageSrc,
}: SectionContentViewProps): React.ReactElement => {
    if (content.type === 'text') {
        return <div className='note-item'>{content.value}</div>;
    }

    const { items, number } = content.value;
    return (
        <div className='step-item'>
            <div className='step-number'>{number}</div>
            <div className='step-content'>
                {items.map((item, idx) => (
                    <StepItemView
                        key={idx}
                        item={item}
                        ingredients={ingredients}
                        cookware={cookware}
                        timers={timers}
                        inlineQuantities={inlineQuantities}
                    />
                ))}
                <StepIngredientsSummary items={items} ingredients={ingredients} />
                {imageSrc && (
                    <RecipeImage className='step-image' src={imageSrc} alt={`Step ${number}`} />
                )}
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Count steps and look up images in `InstructionsPanel`**

Replace the whole `InstructionsPanelProps` interface and `InstructionsPanel`
component (currently lines 236-269) with:

```tsx
interface InstructionsPanelProps {
    sections: Section[];
    ingredients: Ingredient[];
    cookware: Cookware[];
    timers: Timer[];
    inlineQuantities: InlineQuantity[];
    images?: ResolvedRecipeImages;
}

export const InstructionsPanel = ({
    sections,
    ingredients,
    cookware,
    timers,
    inlineQuantities,
    images,
}: InstructionsPanelProps): React.ReactElement => {
    // Steps are counted here rather than read from `content.value.number` so the
    // per-section and global counters match cookcli's `builders.rs` exactly,
    // whichever convention the parser uses for `number`.
    let globalStepIndex = 0;
    return (
        <div className='recipe-instructions'>
            <h2 className='instructions-title'>Instructions</h2>
            {sections.map((section, sIdx) => {
                let stepInSection = 0;
                return (
                    <React.Fragment key={sIdx}>
                        {section.name && (
                            <h3 className='section-header'>{section.name}</h3>
                        )}
                        {section.content.map((content, cIdx) => {
                            let imageSrc: string | undefined;
                            if (content.type === 'step') {
                                if (images) {
                                    imageSrc = lookupStepImage(images, sIdx, stepInSection, globalStepIndex);
                                }
                                stepInSection++;
                                globalStepIndex++;
                            }
                            return (
                                <SectionContentView
                                    key={cIdx}
                                    content={content}
                                    ingredients={ingredients}
                                    cookware={cookware}
                                    timers={timers}
                                    inlineQuantities={inlineQuantities}
                                    imageSrc={imageSrc}
                                />
                            );
                        })}
                    </React.Fragment>
                );
            })}
        </div>
    );
};
```

- [ ] **Step 5: Add the hero image to `RecipeView`**

In `RecipeViewProps` (around line 437) add:

```tsx
    images?: ResolvedRecipeImages;
```

Change the destructuring on the `RecipeView` line to include `images`:

```tsx
export const RecipeView = ({ recipe, fileName, images, onShowSource, onAddToShoppingList, onNavigateToRecipe }: RecipeViewProps): React.ReactElement => {
```

Insert the hero image as the first child of the outer `<div>`, immediately
before `<div className='recipe-header'>`:

```tsx
            {images?.title && (
                <RecipeImage className='recipe-hero-image' src={images.title} alt={title} />
            )}
```

And pass `images` down to the instructions panel — replace the
`<InstructionsPanel .../>` call at the bottom with:

```tsx
                <InstructionsPanel
                    sections={scaled.sections}
                    ingredients={scaled.ingredients}
                    cookware={scaled.cookware}
                    timers={scaled.timers}
                    inlineQuantities={scaled.inline_quantities}
                    images={images}
                />
```

- [ ] **Step 6: Add the styles**

Append to `packages/cooklang/src/browser/style/recipe-preview.css`:

```css
/* Recipe images -------------------------------------------------------- */

.recipe-hero-image {
    display: block;
    margin: 0 auto 16px;
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 2px 8px var(--theia-widget-shadow);
}

.step-image {
    display: block;
    margin-top: 10px;
    max-width: 320px;
    width: 100%;
    height: auto;
    border-radius: 6px;
    box-shadow: 0 1px 4px var(--theia-widget-shadow);
}
```

- [ ] **Step 7: Compile and lint**

```bash
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-components.tsx packages/cooklang/src/browser/style/recipe-preview.css
git commit -m "feat(cooklang): render hero and step images in the recipe preview"
```

---

### Task 7: Wire discovery, resolution and watching into the widget

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-widget.tsx`

- [ ] **Step 1: Add the imports and state**

At the top of `packages/cooklang/src/browser/recipe-preview-widget.tsx`, add
after the existing `Recipe` import:

```tsx
import {
    RecipeImages,
    ResolvedRecipeImages,
    resolveImageUri,
    RECIPE_IMAGE_EXTENSIONS,
} from '../common/recipe-images';
import { RecipeImageService } from './recipe-image-service';
```

Add the injection next to the other `@inject` properties:

```tsx
    @inject(RecipeImageService)
    protected readonly imageService: RecipeImageService;
```

Add the state next to `parseSequence`:

```tsx
    protected images: ResolvedRecipeImages = { steps: {} };
    protected imageSequence = 0;
    protected imageDebounceTimer: ReturnType<typeof setTimeout> | undefined;
```

- [ ] **Step 2: Trigger discovery from `setUri` and start watching**

Replace the body of `setUri` (currently lines 96-106) with:

```tsx
    setUri(uri: URI): void {
        this.uri = uri;
        this.id = createRecipePreviewWidgetId(uri);
        this.title.label = `Preview: ${uri.path.base}`;
        this.title.caption = `Recipe preview for ${uri.toString()}`;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-open-preview';
        this.watchImageFolder();
        this.refreshImages();
        this.parseCurrentContent();
    }
```

- [ ] **Step 3: Add the discovery, resolution and watching methods**

Add these methods after `parseContent`:

```tsx
    // --- Image helpers ---

    /**
     * Watch the recipe's folder so an image dropped in from Finder shows up in
     * an already-open preview, and a deleted one disappears.
     */
    protected watchImageFolder(): void {
        const folder = this.uri.parent;
        this.toDispose.push(this.fileService.watch(folder));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            const touched = event.changes
                .map(change => change.resource)
                .filter(resource => this.isImageOfThisRecipe(resource));
            if (touched.length === 0) {
                return;
            }
            // An image replaced in place keeps its URI, so the cached blob for
            // it has to go or the preview would keep showing the old bytes.
            for (const resource of touched) {
                this.imageService.release(resource);
            }
            this.debouncedRefreshImages();
        }));
    }

    /** True when `resource` is a `<stem>.….<ext>` image belonging to this recipe. */
    protected isImageOfThisRecipe(resource: URI): boolean {
        if (resource.parent.toString() !== this.uri.parent.toString()) {
            return false;
        }
        const name = resource.path.base;
        const stem = this.uri.path.name;
        if (!name.toLowerCase().startsWith(stem.toLowerCase() + '.')) {
            return false;
        }
        const ext = resource.path.ext.replace(/^\./, '').toLowerCase();
        return RECIPE_IMAGE_EXTENSIONS.includes(ext);
    }

    /** Coalesce the burst of events a multi-file copy produces into one refresh. */
    protected debouncedRefreshImages(): void {
        if (this.imageDebounceTimer !== undefined) {
            clearTimeout(this.imageDebounceTimer);
        }
        this.imageDebounceTimer = setTimeout(() => {
            this.imageDebounceTimer = undefined;
            this.refreshImages();
        }, 150);
    }

    /**
     * Ask the backend which images exist for this recipe and turn each one into
     * an `<img>` src. Guarded by `imageSequence` so a slow refresh cannot
     * overwrite a newer one.
     */
    protected async refreshImages(): Promise<void> {
        if (!this.uri) {
            return;
        }
        const sequence = ++this.imageSequence;
        const resolved: ResolvedRecipeImages = { steps: {} };
        try {
            const json = await this.service.recipeImages(this.uri.path.fsPath());
            const discovered = JSON.parse(json) as RecipeImages;
            resolved.title = await this.toImageSrc(discovered.title);
            for (const [section, steps] of Object.entries(discovered.steps ?? {})) {
                for (const [step, raw] of Object.entries(steps)) {
                    const src = await this.toImageSrc(raw);
                    if (src) {
                        (resolved.steps[section] ??= {})[step] = src;
                    }
                }
            }
        } catch {
            // No images, an unsaved file, or an unreadable folder: render none.
        }
        if (this.isDisposed || sequence !== this.imageSequence) {
            return;
        }
        this.images = resolved;
        this.update();
    }

    /** Resolve one raw image value to a URL an `<img>` can load. */
    protected async toImageSrc(raw: string | undefined): Promise<string | undefined> {
        if (!raw) {
            return undefined;
        }
        const root = this.workspaceService.tryGetRoots()[0];
        const location = resolveImageUri(
            raw,
            this.uri,
            root ? new URI(root.resource.toString()) : undefined
        );
        if (!location) {
            return undefined;
        }
        return location.kind === 'remote'
            ? location.url
            : this.imageService.resolve(location.uri);
    }
```

`this.uri.path.fsPath()` gives the OS path the RPC expects. Note the widget
already injects `FileService` and `WorkspaceService`, so no new injections are
needed beyond `RecipeImageService`.

- [ ] **Step 4: Re-run discovery whenever the recipe is reparsed**

Metadata can name the title image, so an edit can change it. In
`parseContent`, add a `refreshImages()` call in the success path — insert it
immediately before the `this.update();` at the end of the `.then(...)` callback:

```tsx
            this.refreshImages();
            this.update();
```

- [ ] **Step 5: Pass the images to `RecipeView`**

In `render()`, add the prop:

```tsx
                <RecipeView
                    recipe={this.recipe}
                    fileName={this.uri?.path.base ?? ''}
                    images={this.images}
                    onShowSource={this.handleShowSource}
                    onAddToShoppingList={this.handleAddToShoppingList}
                    onNavigateToRecipe={this.handleNavigateToRecipe}
                />
```

- [ ] **Step 6: Release the object URLs on dispose**

Replace the `dispose` override at the bottom of the class with:

```tsx
    override dispose(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        if (this.imageDebounceTimer !== undefined) {
            clearTimeout(this.imageDebounceTimer);
            this.imageDebounceTimer = undefined;
        }
        this.imageService.releaseAll();
        super.dispose();
    }
```

- [ ] **Step 7: Bind the service per widget**

In the same file, in `createRecipePreviewWidget`, bind `RecipeImageService` into
the child container so its lifetime matches the preview panel:

```tsx
export function createRecipePreviewWidget(
    container: interfaces.Container,
    uri: URI
): RecipePreviewWidget {
    const child = container.createChild();
    child.bind(RecipeImageService).toSelf().inSingletonScope();
    child.bind(RecipePreviewWidget).toSelf().inTransientScope();
    const widget = child.get(RecipePreviewWidget);
    widget.setUri(uri);
    return widget;
}
```

`inSingletonScope` here means one instance *per child container*, i.e. one per
preview widget — which is exactly the caching and release scope we want.

- [ ] **Step 8: Compile, lint and run the package tests**

```bash
npx lerna run compile --scope @theia/cooklang
npx lerna run lint --scope @theia/cooklang
npx lerna run test --scope @theia/cooklang
```

Expected: all three exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-widget.tsx
git commit -m "feat(cooklang): discover, resolve and watch recipe images in the preview"
```

---

### Task 8: Verify in the running app

**Files:** none — this is a manual check.

- [ ] **Step 1: Build the app**

```bash
cd app && npm run bundle
```

Expected: exits 0.

- [ ] **Step 2: Create a fixture recipe**

```bash
mkdir -p /tmp/recipe-images-check
cat > /tmp/recipe-images-check/Pancakes.cook <<'EOF'
---
title: Pancakes
---
Crack the @eggs{2} into a bowl.

Whisk in the @flour{200%g}.

= Serving

Stack and pour over the @syrup{}.
EOF
```

Copy any four JPEGs in as `Pancakes.jpg` (hero), `Pancakes.1.jpg` (linear step
1), `Pancakes.3.jpg` (linear step 3) and `Pancakes.2.1.jpg` (section 2, step 1).

- [ ] **Step 3: Start the app and open the fixture**

```bash
npm run start:electron
```

Open `/tmp/recipe-images-check` as the workspace, open `Pancakes.cook`, and open
the recipe preview.

- [ ] **Step 4: Check each behaviour**

- The hero image appears above the title, capped at 400px tall and centred.
- Step 1 shows `Pancakes.1.jpg`; step 2 shows no image.
- The step under `= Serving` shows `Pancakes.2.1.jpg`, not `Pancakes.3.jpg` —
  the section-specific image wins over the linear one.
- `title`, and no `image`/`picture` key, appears in the metadata pills.
- With the preview still open, copy another image in as `Pancakes.2.jpg`; step 2
  gains an image within a second without touching the `.cook` file.
- Overwrite `Pancakes.1.jpg` with a visibly different photo; step 1 updates to
  the new image rather than keeping the old one.
- Delete `Pancakes.jpg`; the hero image disappears.
- Add `image: https://cooklang.org/images/logo.png` to the frontmatter; the
  hero switches to the remote image.
- Close the preview tab and confirm no errors appear in the devtools console.

- [ ] **Step 5: Commit nothing, but record the result**

If any check fails, fix it and amend the relevant task's commit. If all pass,
the feature is done.

---

## Definition of done

- `cd packages/cooklang-native && cargo test recipe_images` passes.
- `npx lerna run test --scope @theia/cooklang` passes.
- `npx lerna run lint --scope @theia/cooklang` passes.
- Every manual check in Task 8 passes.
- No changes were made to menu previews, editor hovers, the report/PDF export
  path, or any drag-and-drop attach flow — all four are out of scope.
