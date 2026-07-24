# Recipe Import — Design

**Date:** 2026-07-24
**Status:** Approved by user (brainstorming session)

## Goal

Let users import recipes into Cooklang format from four sources — a URL, pasted text,
dragged-and-dropped recipe images, and an internal clipping browser (Paprika-style) —
and save the result into a `Drafts/` folder in the workspace.

Image import is available only to signed-in users. Anonymous users can use the other
three methods but get low server-side API limits and are prompted to sign in to
increase them.

## Background

- The iOS app (`../mobile-app-ios`) already ships this feature against the cook.md
  REST API. This design replicates its backend contract:
  - `POST https://cook.md/api/cookify/url` — body `{"url": "..."}` → `200 {"cooklang": "...", "name": "..."}` (`name` optional). Bearer token optional.
  - `POST https://cook.md/api/cookify/text` — body `{"text": "..."}` → `200 {"cooklang": "..."}`. Bearer token optional.
  - `POST https://cook.md/api/cookify/images` — body `{"images": ["<base64 JPEG>", ...]}` → `200 {"cooklang": "..."}`. Bearer token **required**.
  - Errors for all three: `401` unauthorized, `422` conversion failed, `429` rate limited.
  - Headers: `Content-Type: application/json`, `Accept: application/json`,
    `X-Client-Version: editor/<app version>`.
  - The base URL respects the `WEB_BASE_URL` env override (default `https://cook.md`),
    consistent with `@theia/cooklang-account`.
- The editor already has cook.md auth in `@theia/cooklang-account`
  (`AuthService.getToken()`, `cooked.login` command, JWT persisted in
  `~/.theia/cookbot-auth.json`).
- `@theia/cooklang-ai` has gRPC-based URL/text conversion reachable only through the
  AI chat agent. **Decision:** the import feature uses the REST cookify API instead
  (images + anonymous rate limiting already exist server-side; no backend changes
  needed). The gRPC tools remain untouched.
- No drafts-folder convention exists yet; CookCloud sync treats the workspace root as
  the recipe library, so a `Drafts/` subfolder syncs automatically. The iOS app uses
  the same `Drafts` folder name.
- No embedded browser exists; the Electron window must enable `webviewTag` for the
  clipping browser.

## Architecture

New package **`packages/cooklang-import` (`@theia/cooklang-import`)**, registered in
`app/package.json` and `app/tsconfig.json` like the other custom packages.

### `src/common/recipe-import-protocol.ts`

- `RecipeImportService` symbol + interface, RPC path `/services/cooklang-import`
  (remote service ⇒ interface + symbol, per coding guidelines).
- Methods:
  - `convertUrl(url: string): Promise<ConvertResult>`
  - `convertText(text: string): Promise<ConvertResult>`
  - `convertImages(imagesBase64: string[]): Promise<ConvertResult>`
- `ConvertResult = { cooklang: string; name?: string }`
- Errors carry a typed code: `'unauthorized' | 'rate-limited' | 'conversion-failed' | 'network'`.

### `src/node/cookify-api-client.ts` + backend module

- REST client implementing the contract above.
- Injects `AuthService` (from `@theia/cooklang-account`); attaches
  `Authorization: Bearer <token>` when a token exists. For `convertImages`, rejects
  locally with `unauthorized` when no token is present (mirrors iOS).
- Maps HTTP 401/422/429 and network failures to the typed error codes.
- Bound as the `RecipeImportService` backend with a `ConnectionHandler`.

### `src/browser/import-widget.tsx`

`ReactWidget` opened as a main-area tab ("Import Recipe") with four internal tabs:

1. **URL** — input field + Import button → `convertUrl`.
2. **Text** — textarea + Import button → `convertText`.
3. **Images** — drag-and-drop zone + file picker. Up to **5** images (iOS parity).
   Client-side resize + JPEG compression (canvas, quality 0.7) → base64 →
   `convertImages`. When signed out, the tab content is replaced by
   "Sign in to CookCloud to use image clipping" + a Sign in button that runs the
   existing `cooked.login` command.
4. **Web Browser** — Electron `<webview>` with URL bar, back/forward/reload, and a
   **"Clip Recipe"** button. Clip executes a script in the page that:
   - collects `<script type="application/ld+json">` blocks and looks for a
     schema.org `Recipe` object (including `@graph` nesting); if found, sends the
     serialized Recipe JSON as text;
   - otherwise falls back to the page's rendered `document.body.innerText`;
   - either way the payload goes to `convertText`.
   Clip is disabled until a page has finished loading.

Cross-tab UI:

- **Signed-out banner** on URL/Text/Browser tabs: "Sign in for higher import limits"
  with a Sign in link.
- Busy/progress state during conversion; success state after save.

Auth state comes from the injected `AuthService` proxy (same pattern as
`AccountWidget`); refreshed on widget activation and after the sign-in flow.

### `src/browser/draft-saver.ts`

Browser-side service that, given a `ConvertResult`:

1. Resolves the title: API `name` → `title:` in the returned Cooklang frontmatter →
   localized "Imported Recipe" fallback. Injects `---\ntitle: ...\n---` frontmatter
   when missing (iOS parity).
2. Sanitizes the title into a filename.
3. Ensures `Drafts/` exists at the workspace root (via `FileService` +
   `WorkspaceService`), dedupes collisions with a counter (`Name-2.cook`).
4. Writes the file and opens it in the editor.

Nothing is written to disk unless conversion succeeds.

### `src/browser/import-contribution.ts`

- Command `cooklang.import.open` ("Import Recipe…"), File menu entry, view
  contribution opening the widget in the main area.

### Change outside the package

- `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts`:
  set `webPreferences.webviewTag: true` in the window options so the Browser tab's
  `<webview>` works.

## Data flow

User input (URL / text / images / clipped page content) → `ImportWidget` → RPC →
`CookifyApiClient` (node) → cook.md → `{ cooklang, name? }` → `DraftSaver` writes
`Drafts/<Title>.cook` and opens it in the editor. `Drafts/` syncs to CookCloud like
any workspace folder.

## Error handling

| Condition | Behavior |
|---|---|
| 422 conversion failed | "Couldn't extract a recipe from this URL/text/image. Try another source." |
| 429 rate limited, signed out | "Import limit reached — sign in to increase your limits" + Sign in button |
| 429 rate limited, signed in | "Import limit reached. Please try again later." |
| 401 unauthorized | Prompt to sign in (token missing/expired) |
| Network failure | Generic retryable error message |
| No workspace open | Import command shows a message asking to open a folder first |
| Webview load failure | Error state in the browser tab; Clip disabled until a page loads |

All user-facing strings localized via `nls.localize`.

## Testing

- Unit specs (`*.spec.ts`):
  - `CookifyApiClient` against mocked fetch: status→error mapping, optional vs
    required auth header, images-without-token rejection.
  - Title resolution + frontmatter injection.
  - Filename sanitization and dedup logic.
  - JSON-LD Recipe extraction (pure function) against sample page HTML, including
    `@graph` and missing-Recipe fallback.
- Manual verification of widget/webview flows (Electron-only surface).

## Out of scope

- Backend/server changes (all endpoints already exist).
- Changes to the gRPC cookbot conversion tools in `@theia/cooklang-ai`.
- Client-side quota counters (limits are enforced server-side).
- OCR on-device; image extraction is server-side.
