# Recipe Images in the Recipe Preview

Date: 2026-08-29

## Goal

Show recipe images in the editor's `.cook` preview panel, using the same
discovery rules as the CookCLI web server so a recipe folder renders
identically in both tools.

## Background: how CookCLI does it

Discovery lives in the `cooklang-find` crate (`src/model/recipe_entry.rs`);
CookCLI consumes it in `src/web/builders.rs`.

**Title image** — `RecipeEntry::title_image()`, in priority order:

1. Metadata field `image`, `images`, `picture`, or `pictures` (a string, or the
   first element of an array). May be a URL or a path.
2. A sibling file with the recipe's stem: `Pancakes.jpg`, `.jpeg`, `.png`,
   `.webp` next to `Pancakes.cook` (extensions tried in that order).

**Step images** — `RecipeEntry::step_images()` globs the recipe's directory for
`<stem>.*.<ext>` and parses the numeric components:

- `Recipe.N.ext` — step N counted continuously across all sections, stored at
  `[0][N-1]`.
- `Recipe.S.N.ext` — step N within section S, stored at `[S-1][N-1]`.

Filenames are one-indexed; the map keys are zero-indexed. Section 0 is reserved
for the linear form.

When rendering a step, `builders.rs` prefers the section-specific image and
falls back to the linear one:

```rust
entry.step_images()
    .get(section_index + 1, step_count + 1)
    .or_else(|| entry.step_images().get(0, total_steps + step_count + 1))
```

`step_count` is the zero-based step index within the current section;
`total_steps` is the number of steps in all preceding sections. Both arguments
to `get()` are one-indexed. This two-convention lookup is CookCLI issue #374:
the iOS app writes `Recipe.S.N.ext`, other tools write `Recipe.N.ext`.

CookCLI serves the resolved files over an `/api/static` `ServeDir` mounted at
the workspace root, and passes `http(s)` metadata values through untouched.

## Current state of the editor

`packages/cooklang/src/browser/recipe-preview-{widget,components}.tsx` render
the parsed recipe. There is no image support at all — `image` and `images` are
in `SKIP_META_KEYS` so they are not even shown as metadata pills.

The editor has no static-file endpoint (no `@theia/mini-browser`), and the
Theia renderer is loaded from `http://localhost:<port>`, so Chromium blocks
`<img src="file://…">`. Local images must be read through `FileService` and
converted to blob URLs.

## Scope

In scope:

- Title (hero) image and per-step images in the `.cook` recipe preview.
- Read-only display. Users add image files through Finder / their file manager.
- `http(s)` URLs from metadata are loaded directly.

Out of scope:

- Menu (`.menu`) previews.
- Monaco hover cards or editor decorations.
- The report / PDF / PNG export path.
- Drag-and-drop or paste to attach an image.

## Design

### 1. Native layer — `packages/cooklang-native`

`cooklang-find` 0.6.1 is already a dependency. Add one napi function:

```rust
#[napi(js_name = "recipeImages")]
pub fn napi_recipe_images(recipe_path: String) -> napi::Result<String>
```

It builds a `RecipeEntry::from_path(...)` and serialises:

```json
{
  "title": "/abs/path/Pancakes.jpg",
  "steps": { "0": { "2": "/abs/path/Pancakes.3.jpg" }, "1": { "0": "…" } }
}
```

- `title` is `entry.title_image()` verbatim — an absolute path, a URL, a
  relative path from metadata, or `null`.
- `steps` is `entry.step_images().images` serialised as-is: section index →
  step index, both zero-indexed, section 0 meaning the linear form.

Returning the raw collection rather than a flattened list keeps the editor's
lookup identical to `builders.rs` and inherits upstream's behaviour — including
the known key collision where `get(0, N)` and `get(1, N)` both address section
index 0 — instead of reinventing it.

A `#[cfg(test)]` block with a tempdir covers: no images, title image only, each
supported extension, linear step images, section-step images, and a recipe path
that does not exist.

Plumbing follows the existing `findRecipe` pattern exactly:

- `recipeImages(recipePath: string): Promise<string>` on the
  `CooklangLanguageService` interface in `src/common/cooklang-language-service.ts`,
  documented with the same "OS filesystem path, not a URI; Electron-only"
  caveat as its neighbours.
- One `require('@theia/cooklang-native')` delegation in
  `src/node/cooklang-language-service-impl.ts`.

### 2. Pure logic — `packages/cooklang/src/common/recipe-images.ts`

This module must not import anything that transitively pulls in
`@theia/monaco`, so its spec can run under the mocha harness.

```ts
export interface RecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

/** The same shape after every entry has been turned into an <img> src. */
export interface ResolvedRecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

export function lookupStepImage(
    images: RecipeImages | ResolvedRecipeImages,
    sectionIndex: number,     // zero-based section
    stepInSection: number,    // zero-based step within that section
    globalStepIndex: number   // zero-based step counted across all sections
): string | undefined;
```

`lookupStepImage` mirrors `builders.rs`: try the section-specific entry first,
applying the same section normalisation `StepImageCollection::get` uses, then
fall back to the linear entry at `steps[0][globalStepIndex]`. The
section-specific image wins.

Path resolution also lives here:

```ts
export function resolveImageUri(
    raw: string,
    recipeUri: URI,
    workspaceRootUri: URI | undefined
): { kind: 'remote'; url: string } | { kind: 'file'; uri: URI } | undefined;
```

- `http://` / `https://` → passed through unchanged.
- An absolute path → take its basename and resolve it against the recipe's
  parent URI. Discovery is sibling-based, so this is always correct and avoids
  converting a raw OS path into a URI in browser code.
- A relative path from metadata → resolve against the recipe's folder first,
  then the workspace root.

That last fallback is a deliberate, small superset of CookCLI, which resolves
relative metadata paths against the workspace root only. `image: photo.jpg`
next to the recipe is the obvious intent and currently 404s in CookCLI; trying
the recipe folder first fixes that without breaking the root-relative case.

### 3. Image loading — `packages/cooklang/src/browser/recipe-image-service.ts`

`file://` is blocked from the renderer's `http://localhost` origin, so local
images are read and turned into blob URLs.

```ts
@injectable()
export class RecipeImageService {
    resolve(uri: URI): Promise<string | undefined>;
    releaseAll(): void;
}
```

- `FileService.readFile(uri)` → `Blob([buffer], { type })` →
  `URL.createObjectURL`. The MIME type is derived from the extension
  (`jpg`/`jpeg` → `image/jpeg`, `png` → `image/png`, `webp` → `image/webp`).
- An internal `Map<string, string>` keyed by URI string means repeated renders
  of the same image reuse one object URL. `releaseAll()` revokes every URL.
- Files larger than 20 MB are skipped: `FileService` reads travel over the RPC
  channel to the backend, so a huge file would stall the preview.
- A missing or unreadable file resolves to `undefined` rather than throwing.

`http(s)` URLs never reach this service; they go straight into `src`.

The service is bound in the child container that
`createRecipePreviewWidget` already creates, so its lifetime matches the
preview panel and `releaseAll()` runs on widget dispose.

### 4. Widget wiring — `recipe-preview-widget.tsx`

New state beside `recipe` and `parseErrors`:

```ts
protected images: ResolvedRecipeImages = { steps: {} };
```

where the values are `src` strings ready for an `<img>`.

- `setUri()` and the existing parse path both trigger `refreshImages()`.
- `refreshImages()` calls `service.recipeImages(path)`, resolves every entry
  through `RecipeImageService`, and guards on an `imageSequence` counter — the
  same pattern `parseContent` uses — so a stale async resolve cannot overwrite
  a newer result. Then `update()`.
- Watching: `fileService.watch(this.uri.parent)` plus an `onDidFilesChange`
  listener filtered to files whose name matches the recipe stem followed by a
  dot and a supported image extension. Dropping `Pancakes.jpg` into the folder
  refreshes an open preview; deleting it removes the image. The watcher
  disposable goes on `this.toDispose`, and the handler is debounced by 150 ms
  so a multi-file copy triggers one refresh.

### 5. Rendering — `recipe-preview-components.tsx`

- `RecipeView` gains an optional `images` prop. When `images.title` is set it
  renders a hero `<img className='recipe-hero-image'>` above `.recipe-header`,
  with `alt` set to the recipe title.
- `SectionContentView` gains an optional `imageSrc`. When present it renders
  `<img className='step-image'>` inside `.step-content`, below the step text
  and the ingredients summary.
- `InstructionsPanel` does the step counting — per-section and global — and
  calls `lookupStepImage` for each step. It counts steps itself rather than
  trusting the parser's `number` field, so the counters match `builders.rs`
  regardless of whether `number` is per-section or global.
- Both images get an `onError` handler that hides the element, so a corrupt
  file degrades to no image rather than a broken-image icon.
- `SKIP_META_KEYS` gains `picture` and `pictures` so those do not leak into the
  metadata pills.

CSS in `style/recipe-preview.css`: the hero image gets `max-width: 100%`,
`max-height: 400px`, `object-fit: contain`, centred, rounded, with
`var(--theia-widget-shadow)`. Step images are capped narrower (~320px) and
left-aligned. No hard-coded colours.

## Testing

- Rust `#[cfg(test)]` tempdir cases for `recipeImages` (see section 1).
- `recipe-images.spec.ts` — lookup precedence (section-specific beats linear),
  linear-only, section-only, missing, and every `resolveImageUri` branch.
  Monaco-free, no DOM.
- `recipe-image-service.spec.ts` — MIME mapping, cache reuse, the size cap, and
  missing-file → `undefined`, against a stubbed `FileService`.
- Manual: open a recipe with `Pancakes.jpg`, `Pancakes.1.jpg` and
  `Pancakes.2.3.jpg`; confirm hero and step placement; then drop a new image
  into the folder and confirm the preview refreshes live.

## Notes

- The native addon must be rebuilt (`cd packages/cooklang-native && npm run
  build`) for the new function to be callable, and the change ships to users
  only with a new platform build.
- Image discovery keys off the recipe's path on disk, not the editor buffer, so
  images appear for unsaved edits as long as the file itself exists.
