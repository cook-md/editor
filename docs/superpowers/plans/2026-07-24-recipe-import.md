# Recipe Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A main-area "Import Recipe" widget that converts recipes from URL / pasted text / images / an internal clipping browser into Cooklang via the cook.md REST cookify API and saves them into `Drafts/` in the workspace.

**Architecture:** New Theia extension package `@theia/cooklang-import`. A node-side `CookifyApiClient` (RPC service at `/services/cooklang-import`) calls `POST https://cook.md/api/cookify/{url,text,images}` with the cook.md JWT from `@theia/cooklang-account`'s `AuthService`. A browser-side `ImportWidget` (ReactWidget, 4 tabs) collects input and hands successful conversions to `DraftSaver`, which writes `Drafts/<Title>.cook` and opens it. The clipping browser is an Electron `<webview>` (requires enabling `webviewTag` in `cooklang-branding`).

**Tech Stack:** TypeScript ~5.4, InversifyJS (property injection), React 18 via `ReactWidget`, mocha+chai specs (`theiaext test`), Node `https` for HTTP (matches `subscription-service.ts`), Electron `<webview>`.

**Spec:** `docs/superpowers/specs/2026-07-24-recipe-import-design.md` — read it first.

**Conventions that apply to every task:**

- Every new `.ts`/`.tsx` file starts with the standard license header used across custom packages (copy verbatim from `packages/cooklang-account/src/common/auth-protocol.ts` lines 1–12: `Copyright (C) 2024-2026 cook.md and contributors`, AGPL-3.0-only with linking exception).
- 4-space indent, single quotes, explicit return types, `undefined` not `null`, property injection, `nls.localize` for all user-facing strings.
- Compile: `npx lerna run compile --scope @theia/cooklang-import`
- Test: `npx lerna run test --scope @theia/cooklang-import` (tests run against compiled `lib/`, so compile first).

## File structure

```
packages/cooklang-import/
  package.json                            (Task 1)
  tsconfig.json                           (Task 1)
  src/common/recipe-import-protocol.ts    (Task 2)  RPC path, symbol, ConvertResult union
  src/node/cookify-api-client.ts          (Task 3)  REST client, implements RecipeImportService
  src/node/cookify-api-client.spec.ts     (Task 3)
  src/node/cooklang-import-backend-module.ts (Task 1 stub, Task 3 bindings)
  src/browser/recipe-payload.ts           (Task 4)  JSON-LD Recipe extraction (pure)
  src/browser/recipe-payload.spec.ts      (Task 4)
  src/browser/draft-name.ts               (Task 5)  title/frontmatter/filename helpers (pure)
  src/browser/draft-name.spec.ts          (Task 5)
  src/browser/draft-saver.ts              (Task 6)  writes Drafts/<name>.cook, opens editor
  src/browser/import-widget.tsx           (Task 7 shell; Tasks 8–10 fill tabs)
  src/browser/import-contribution.ts      (Task 7)  command + File menu + view contribution
  src/browser/style/index.css             (Task 7)
  src/browser/cooklang-import-frontend-module.ts (Task 1 stub, Tasks 6–7 bindings)
app/package.json                          (Task 1: add dependency)
app/tsconfig.json                         (Task 1: add reference)
packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts (Task 10: webviewTag)
docs/superpowers/specs/…                  (already committed)
```

---

### Task 1: Scaffold `@theia/cooklang-import` and wire it into the app

**Files:**
- Create: `packages/cooklang-import/package.json`
- Create: `packages/cooklang-import/tsconfig.json`
- Create: `packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts`
- Create: `packages/cooklang-import/src/node/cooklang-import-backend-module.ts`
- Modify: `app/package.json` (dependencies)
- Modify: `app/tsconfig.json` (references)

- [ ] **Step 1: Create a feature branch**

```bash
git checkout -b feature/recipe-import
```

- [ ] **Step 2: Create `packages/cooklang-import/package.json`**

Model: `packages/cooklang-account/package.json`.

```json
{
  "name": "@theia/cooklang-import",
  "version": "1.70.0",
  "description": "Theia - Cooklang Recipe Import (URL, text, images, clipping browser)",
  "dependencies": {
    "@theia/core": "1.70.0",
    "@theia/filesystem": "1.70.0",
    "@theia/workspace": "1.70.0",
    "@theia/cooklang-account": "1.70.0",
    "tslib": "^2.6.2"
  },
  "main": "lib/common",
  "theiaExtensions": [
    {
      "frontend": "lib/browser/cooklang-import-frontend-module",
      "backend": "lib/node/cooklang-import-backend-module"
    }
  ],
  "keywords": ["theia-extension"],
  "license": "AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception",
  "files": ["lib", "src"],
  "scripts": {
    "build": "theiaext build",
    "clean": "theiaext clean",
    "compile": "theiaext compile",
    "lint": "theiaext lint",
    "test": "theiaext test",
    "watch": "theiaext watch"
  },
  "devDependencies": {
    "@theia/ext-scripts": "1.70.0"
  }
}
```

- [ ] **Step 3: Create `packages/cooklang-import/tsconfig.json`**

```json
{
  "extends": "../../configs/base.tsconfig",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "lib"
  },
  "include": ["src"],
  "references": [
    { "path": "../core" },
    { "path": "../filesystem" },
    { "path": "../workspace" },
    { "path": "../cooklang-account" }
  ]
}
```

- [ ] **Step 4: Create empty container modules** (so the package compiles)

`src/browser/cooklang-import-frontend-module.ts` (license header, then):

```ts
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
});
```

`src/node/cooklang-import-backend-module.ts`: same content.

- [ ] **Step 5: Wire into the app**

In `app/package.json`, add to dependencies (alphabetical, next to the other cooklang packages):

```json
    "@theia/cooklang-import": "1.70.0",
```

In `app/tsconfig.json`, add to references (alphabetical):

```json
    { "path": "../packages/cooklang-import" },
```

- [ ] **Step 6: Install (creates the workspace symlink) and compile**

```bash
npm install
npx lerna run compile --scope @theia/cooklang-import
```

Expected: compiles with no errors (an ESLint "empty function" warning on the modules is fine at this stage; the modules gain bindings in Tasks 3 and 6–7).

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-import app/package.json app/tsconfig.json package-lock.json
git commit -m "feat(import): scaffold @theia/cooklang-import package"
```

---

### Task 2: Protocol — `RecipeImportService`

**Files:**
- Create: `packages/cooklang-import/src/common/recipe-import-protocol.ts`

Pure types — no unit test.

- [ ] **Step 1: Write the protocol**

Design note: conversion failures are returned as a **result union**, not thrown. Theia's RPC proxy does not preserve custom fields on thrown Errors, so a typed `error` code in the return value is the reliable way to get the failure kind across the wire. (Theia RPC has other serialization pitfalls too — see the `on*`-property warning in `packages/cooklang-account/src/common/auth-protocol.ts`.)

```ts
export const RecipeImportServicePath = '/services/cooklang-import';
export const RecipeImportService = Symbol('RecipeImportService');

export type ImportErrorCode = 'unauthorized' | 'rate-limited' | 'conversion-failed' | 'network';

export interface ConvertSuccess {
    cooklang: string;
    name?: string;
    error?: undefined;
}

export interface ConvertFailure {
    error: ImportErrorCode;
    cooklang?: undefined;
    name?: undefined;
}

export type ConvertResult = ConvertSuccess | ConvertFailure;

/**
 * Converts recipes to Cooklang via the cook.md cookify REST API.
 * Remote service: interface + symbol (used from both frontend and backend).
 */
export interface RecipeImportService {
    convertUrl(url: string): Promise<ConvertResult>;
    convertText(text: string): Promise<ConvertResult>;
    /** Base64-encoded JPEGs, max 5. Requires a signed-in user. */
    convertImages(imagesBase64: string[]): Promise<ConvertResult>;
}
```

- [ ] **Step 2: Compile and commit**

```bash
npx lerna run compile --scope @theia/cooklang-import
git add packages/cooklang-import/src/common
git commit -m "feat(import): add RecipeImportService protocol"
```

---

### Task 3: `CookifyApiClient` (node) — TDD

**Files:**
- Create: `packages/cooklang-import/src/node/cookify-api-client.ts`
- Test: `packages/cooklang-import/src/node/cookify-api-client.spec.ts`
- Modify: `packages/cooklang-import/src/node/cooklang-import-backend-module.ts`

The client mirrors the iOS contract (see spec "Background"). HTTP goes through a protected `httpPost` method (Node `https`/`http`, same style as `subscription-service.ts:262`) so tests subclass and stub it — no network in tests.

- [ ] **Step 1: Write the failing tests**

`src/node/cookify-api-client.spec.ts` (license header, then):

```ts
import { expect } from 'chai';
import { CookifyApiClient, HttpResponse } from './cookify-api-client';
import { ConvertResult } from '../common/recipe-import-protocol';

class TestClient extends CookifyApiClient {
    requests: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    nextResponse: HttpResponse = { status: 200, body: '{"cooklang": "recipe"}' };
    failWith: Error | undefined;

    protected override httpPost(url: URL, body: string, headers: Record<string, string>): Promise<HttpResponse> {
        this.requests.push({ url: url.toString(), body, headers });
        return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.nextResponse);
    }
}

function createClient(token: string | undefined): TestClient {
    const client = new TestClient();
    // Property injection: assign the injected services directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).authService = { getToken: () => Promise.resolve(token) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).applicationServer = { getApplicationInfo: () => Promise.resolve({ name: 'cook-editor', version: '0.1.0' }) };
    return client;
}

describe('CookifyApiClient', () => {

    it('POSTs the url and returns cooklang + name on 200', async () => {
        const client = createClient(undefined);
        client.nextResponse = { status: 200, body: '{"cooklang": "---\\ntitle: Pancakes\\n---\\n", "name": "Pancakes"}' };
        const result = await client.convertUrl('https://example.com/pancakes');
        expect(result.cooklang).to.contain('Pancakes');
        expect(result.name).to.equal('Pancakes');
        expect(client.requests[0].url).to.equal('https://cook.md/api/cookify/url');
        expect(JSON.parse(client.requests[0].body)).to.deep.equal({ url: 'https://example.com/pancakes' });
    });

    it('omits the Authorization header when logged out and adds it when a token exists', async () => {
        const anonymous = createClient(undefined);
        await anonymous.convertText('some recipe text');
        expect(anonymous.requests[0].headers).to.not.have.property('Authorization');

        const signedIn = createClient('jwt-token');
        await signedIn.convertText('some recipe text');
        expect(signedIn.requests[0].headers.Authorization).to.equal('Bearer jwt-token');
    });

    it('sends JSON and client-version headers', async () => {
        const client = createClient(undefined);
        await client.convertText('text');
        const headers = client.requests[0].headers;
        expect(headers['Content-Type']).to.equal('application/json');
        expect(headers.Accept).to.equal('application/json');
        expect(headers['X-Client-Version']).to.equal('editor/0.1.0');
    });

    it('rejects convertImages locally when no token is present', async () => {
        const client = createClient(undefined);
        const result = await client.convertImages(['base64data']);
        expect(result.error).to.equal('unauthorized');
        expect(client.requests).to.have.length(0);
    });

    it('sends images with the bearer token when signed in', async () => {
        const client = createClient('jwt-token');
        const result = await client.convertImages(['aaa', 'bbb']);
        expect(result.error).to.equal(undefined);
        expect(client.requests[0].url).to.equal('https://cook.md/api/cookify/images');
        expect(JSON.parse(client.requests[0].body)).to.deep.equal({ images: ['aaa', 'bbb'] });
    });

    const statusCases: Array<[number, string]> = [
        [401, 'unauthorized'],
        [422, 'conversion-failed'],
        [429, 'rate-limited'],
        [500, 'network'],
    ];
    for (const [status, code] of statusCases) {
        it(`maps HTTP ${status} to '${code}'`, async () => {
            const client = createClient(undefined);
            client.nextResponse = { status, body: '' };
            const result: ConvertResult = await client.convertUrl('https://example.com');
            expect(result.error).to.equal(code);
        });
    }

    it('maps transport failures to network error', async () => {
        const client = createClient(undefined);
        client.failWith = new Error('ECONNREFUSED');
        const result = await client.convertUrl('https://example.com');
        expect(result.error).to.equal('network');
    });

    it('maps a 200 with unparseable body to conversion-failed', async () => {
        const client = createClient(undefined);
        client.nextResponse = { status: 200, body: 'not json' };
        const result = await client.convertUrl('https://example.com');
        expect(result.error).to.equal('conversion-failed');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx lerna run compile --scope @theia/cooklang-import
```

Expected: compile FAILS — `cookify-api-client` module does not exist. (Compile failure is this stage's "red".)

- [ ] **Step 3: Implement `src/node/cookify-api-client.ts`**

```ts
import * as http from 'http';
import * as https from 'https';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';
import { ConvertResult, ImportErrorCode, RecipeImportService } from '../common/recipe-import-protocol';

export interface HttpResponse {
    status: number;
    body: string;
}

/**
 * REST client for the cook.md cookify API. Mirrors the contract used by the
 * iOS app: POST /api/cookify/{url,text,images}; Bearer token optional for
 * url/text, required for images; 401/422/429 map to typed error codes.
 */
@injectable()
export class CookifyApiClient implements RecipeImportService {

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    protected get baseUrl(): string {
        return process.env.WEB_BASE_URL || 'https://cook.md';
    }

    convertUrl(url: string): Promise<ConvertResult> {
        return this.post('/api/cookify/url', { url }, false);
    }

    convertText(text: string): Promise<ConvertResult> {
        return this.post('/api/cookify/text', { text }, false);
    }

    convertImages(imagesBase64: string[]): Promise<ConvertResult> {
        return this.post('/api/cookify/images', { images: imagesBase64 }, true);
    }

    protected async post(path: string, payload: object, requireAuth: boolean): Promise<ConvertResult> {
        const token = await this.authService.getToken();
        if (requireAuth && !token) {
            return { error: 'unauthorized' };
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Client-Version': `editor/${await this.clientVersion()}`,
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        let response: HttpResponse;
        try {
            response = await this.httpPost(new URL(path, this.baseUrl), JSON.stringify(payload), headers);
        } catch (err) {
            console.warn('cookify request failed:', err instanceof Error ? err.message : String(err));
            return { error: 'network' };
        }
        if (response.status >= 200 && response.status < 300) {
            try {
                const data = JSON.parse(response.body);
                if (typeof data.cooklang !== 'string') {
                    return { error: 'conversion-failed' };
                }
                return { cooklang: data.cooklang, name: typeof data.name === 'string' ? data.name : undefined };
            } catch {
                return { error: 'conversion-failed' };
            }
        }
        return { error: this.errorForStatus(response.status) };
    }

    protected errorForStatus(status: number): ImportErrorCode {
        switch (status) {
            case 401: return 'unauthorized';
            case 422: return 'conversion-failed';
            case 429: return 'rate-limited';
            default: return 'network';
        }
    }

    protected async clientVersion(): Promise<string> {
        try {
            const info = await this.applicationServer.getApplicationInfo();
            return info?.version ?? 'dev';
        } catch {
            return 'dev';
        }
    }

    protected httpPost(url: URL, body: string, headers: Record<string, string>): Promise<HttpResponse> {
        const lib = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, { method: 'POST', headers }, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }
}
```

- [ ] **Step 4: Bind it in the backend module**

Replace the body of `src/node/cooklang-import-backend-module.ts`:

```ts
import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { RecipeImportService, RecipeImportServicePath } from '../common/recipe-import-protocol';
import { CookifyApiClient } from './cookify-api-client';

export default new ContainerModule(bind => {
    bind(CookifyApiClient).toSelf().inSingletonScope();
    bind(RecipeImportService).toService(CookifyApiClient);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(RecipeImportServicePath, () =>
            ctx.container.get(RecipeImportService)
        )
    ).inSingletonScope();
});
```

- [ ] **Step 5: Compile and run the tests — verify they pass**

```bash
npx lerna run compile --scope @theia/cooklang-import
npx lerna run test --scope @theia/cooklang-import
```

Expected: all `CookifyApiClient` specs PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-import/src/node
git commit -m "feat(import): cookify REST client with typed error mapping"
```

---

### Task 4: JSON-LD Recipe extraction — TDD

**Files:**
- Create: `packages/cooklang-import/src/browser/recipe-payload.ts`
- Test: `packages/cooklang-import/src/browser/recipe-payload.spec.ts`

Pure function used by the clipping browser: given the raw `<script type="application/ld+json">` block contents and the page's rendered text, return the best payload for `/api/cookify/text` — the serialized schema.org Recipe if one exists, otherwise the page text. No DOM access here (the in-page script that *collects* blocks/text lives in the widget, Task 10).

- [ ] **Step 1: Write the failing tests**

`src/browser/recipe-payload.spec.ts`:

```ts
import { expect } from 'chai';
import { RecipePayload } from './recipe-payload';

const RECIPE = { '@type': 'Recipe', name: 'Pancakes', recipeIngredient: ['2 eggs'] };

describe('RecipePayload.extract', () => {

    it('returns the serialized Recipe from a plain JSON-LD block', () => {
        const result = RecipePayload.extract([JSON.stringify(RECIPE)], 'page text');
        expect(JSON.parse(result)).to.deep.equal(RECIPE);
    });

    it('finds a Recipe inside a top-level array', () => {
        const block = JSON.stringify([{ '@type': 'WebSite' }, RECIPE]);
        expect(JSON.parse(RecipePayload.extract([block], ''))).to.deep.equal(RECIPE);
    });

    it('finds a Recipe inside an @graph', () => {
        const block = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, RECIPE] });
        expect(JSON.parse(RecipePayload.extract([block], ''))).to.deep.equal(RECIPE);
    });

    it('matches @type arrays containing Recipe', () => {
        const recipe = { '@type': ['Thing', 'Recipe'], name: 'Soup' };
        expect(JSON.parse(RecipePayload.extract([JSON.stringify(recipe)], ''))).to.deep.equal(recipe);
    });

    it('skips malformed blocks and still finds a Recipe in a later block', () => {
        const result = RecipePayload.extract(['{not json', JSON.stringify(RECIPE)], '');
        expect(JSON.parse(result)).to.deep.equal(RECIPE);
    });

    it('falls back to trimmed page text when no Recipe is present', () => {
        const block = JSON.stringify({ '@type': 'NewsArticle' });
        expect(RecipePayload.extract([block], '  Grandma’s stew: brown the beef…  ')).to.equal('Grandma’s stew: brown the beef…');
    });

    it('falls back to page text when there are no blocks at all', () => {
        expect(RecipePayload.extract([], 'just text')).to.equal('just text');
    });
});
```

- [ ] **Step 2: Compile — verify red** (module missing → compile error)

```bash
npx lerna run compile --scope @theia/cooklang-import
```

- [ ] **Step 3: Implement `src/browser/recipe-payload.ts`**

```ts
/**
 * Chooses the payload sent to /api/cookify/text when clipping a page:
 * the schema.org Recipe from JSON-LD when present, otherwise the page text.
 */
export namespace RecipePayload {

    export function extract(jsonLdBlocks: string[], pageText: string): string {
        for (const block of jsonLdBlocks) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(block);
            } catch {
                continue;
            }
            const recipe = findRecipe(parsed);
            if (recipe) {
                return JSON.stringify(recipe);
            }
        }
        return pageText.trim();
    }

    function findRecipe(node: unknown): object | undefined {
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findRecipe(item);
                if (found) {
                    return found;
                }
            }
            return undefined;
        }
        if (node && typeof node === 'object') {
            const type = (node as { '@type'?: unknown })['@type'];
            if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
                return node;
            }
            const graph = (node as { '@graph'?: unknown })['@graph'];
            if (Array.isArray(graph)) {
                return findRecipe(graph);
            }
        }
        return undefined;
    }
}
```

- [ ] **Step 4: Compile, run tests — verify green**

```bash
npx lerna run compile --scope @theia/cooklang-import
npx lerna run test --scope @theia/cooklang-import
```

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-import/src/browser/recipe-payload.ts packages/cooklang-import/src/browser/recipe-payload.spec.ts
git commit -m "feat(import): JSON-LD Recipe extraction for page clipping"
```

---

### Task 5: Draft naming helpers — TDD

**Files:**
- Create: `packages/cooklang-import/src/browser/draft-name.ts`
- Test: `packages/cooklang-import/src/browser/draft-name.spec.ts`

Pure helpers for title resolution (API `name` → frontmatter `title:` → caller's fallback), frontmatter injection (iOS parity), filename sanitization, and collision-free naming.

- [ ] **Step 1: Write the failing tests**

`src/browser/draft-name.spec.ts`:

```ts
import { expect } from 'chai';
import { DraftName } from './draft-name';

describe('DraftName', () => {

    describe('resolveTitle', () => {
        it('prefers the API-provided name', () => {
            expect(DraftName.resolveTitle('---\ntitle: Other\n---\n', 'Pancakes')).to.equal('Pancakes');
        });
        it('ignores a blank API name and reads the frontmatter title', () => {
            expect(DraftName.resolveTitle('---\ntitle: Pancakes\n---\nMix @eggs{2}.', '  ')).to.equal('Pancakes');
        });
        it('returns undefined when neither source has a title', () => {
            expect(DraftName.resolveTitle('Mix @eggs{2}.', undefined)).to.equal(undefined);
            expect(DraftName.resolveTitle('---\nservings: 4\n---\nMix.', undefined)).to.equal(undefined);
        });
    });

    describe('ensureTitleFrontmatter', () => {
        it('leaves content with a titled frontmatter unchanged', () => {
            const src = '---\ntitle: Pancakes\n---\nMix @eggs{2}.';
            expect(DraftName.ensureTitleFrontmatter(src, 'Pancakes')).to.equal(src);
        });
        it('inserts title into an existing frontmatter without one', () => {
            expect(DraftName.ensureTitleFrontmatter('---\nservings: 4\n---\nMix.', 'Pancakes'))
                .to.equal('---\ntitle: Pancakes\nservings: 4\n---\nMix.');
        });
        it('prepends frontmatter when there is none', () => {
            expect(DraftName.ensureTitleFrontmatter('Mix @eggs{2}.', 'Pancakes'))
                .to.equal('---\ntitle: Pancakes\n---\n\nMix @eggs{2}.');
        });
    });

    describe('sanitizeFilename', () => {
        it('strips characters that are unsafe in filenames', () => {
            expect(DraftName.sanitizeFilename('Mom’s "Best" Soup: a/b\\c?')).to.equal('Mom’s Best Soup ab c');
        });
        it('collapses whitespace and trims leading/trailing dots and spaces', () => {
            expect(DraftName.sanitizeFilename('  .Fancy   Bread.  ')).to.equal('Fancy Bread');
        });
        it('falls back for names that sanitize to nothing', () => {
            expect(DraftName.sanitizeFilename('::""//')).to.equal('Imported Recipe');
        });
    });

    describe('uniqueBaseName', () => {
        it('returns the base name when it is free', async () => {
            const name = await DraftName.uniqueBaseName('Pancakes', async () => false);
            expect(name).to.equal('Pancakes');
        });
        it('appends an incrementing counter until the name is free', async () => {
            const taken = new Set(['Pancakes', 'Pancakes-2']);
            const name = await DraftName.uniqueBaseName('Pancakes', async candidate => taken.has(candidate));
            expect(name).to.equal('Pancakes-3');
        });
    });
});
```

- [ ] **Step 2: Compile — verify red**

- [ ] **Step 3: Implement `src/browser/draft-name.ts`**

```ts
/**
 * Naming helpers for imported drafts: title resolution, frontmatter
 * injection (parity with the iOS app's clipping flow), and safe,
 * collision-free file names.
 */
export namespace DraftName {

    export function resolveTitle(cooklang: string, apiName: string | undefined): string | undefined {
        if (apiName && apiName.trim().length > 0) {
            return apiName.trim();
        }
        return frontmatterTitle(cooklang);
    }

    export function ensureTitleFrontmatter(cooklang: string, title: string): string {
        const lines = cooklang.split('\n');
        if (lines[0]?.trim() === '---') {
            if (frontmatterTitle(cooklang) !== undefined) {
                return cooklang;
            }
            return [lines[0], `title: ${title}`, ...lines.slice(1)].join('\n');
        }
        return `---\ntitle: ${title}\n---\n\n${cooklang}`;
    }

    export function sanitizeFilename(title: string): string {
        const cleaned = title
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/^[. ]+|[. ]+$/g, '');
        return cleaned.length > 0 ? cleaned : 'Imported Recipe';
    }

    export async function uniqueBaseName(base: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
        if (!await exists(base)) {
            return base;
        }
        for (let i = 2; ; i++) {
            const candidate = `${base}-${i}`;
            if (!await exists(candidate)) {
                return candidate;
            }
        }
    }

    function frontmatterTitle(cooklang: string): string | undefined {
        const lines = cooklang.split('\n');
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                return undefined;
            }
            const match = lines[i].match(/^title:\s*(.+)$/);
            if (match) {
                return match[1].trim();
            }
        }
        return undefined;
    }
}
```

- [ ] **Step 4: Compile, run tests — verify green**

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-import/src/browser/draft-name.ts packages/cooklang-import/src/browser/draft-name.spec.ts
git commit -m "feat(import): draft naming and frontmatter helpers"
```

---

### Task 6: `DraftSaver` service

**Files:**
- Create: `packages/cooklang-import/src/browser/draft-saver.ts`
- Modify: `packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts`

Thin orchestration over the tested helpers + Theia services; no unit test (covered by manual verification in Task 11).

- [ ] **Step 1: Implement `src/browser/draft-saver.ts`**

```ts
import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { nls } from '@theia/core/lib/common/nls';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ConvertSuccess } from '../common/recipe-import-protocol';
import { DraftName } from './draft-name';

export const DRAFTS_FOLDER_NAME = 'Drafts';

/**
 * Writes a converted recipe into <workspace root>/Drafts/<Title>.cook
 * (creating the folder and de-duplicating the name) and opens it.
 */
@injectable()
export class DraftSaver {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    async save(result: ConvertSuccess): Promise<URI> {
        const roots = await this.workspaceService.roots;
        if (roots.length === 0) {
            throw new Error(nls.localize('theia/cooklang-import/noWorkspace', 'Open a folder before importing recipes.'));
        }
        const draftsDir = roots[0].resource.resolve(DRAFTS_FOLDER_NAME);
        if (!await this.fileService.exists(draftsDir)) {
            await this.fileService.createFolder(draftsDir);
        }
        const title = DraftName.resolveTitle(result.cooklang, result.name)
            ?? nls.localize('theia/cooklang-import/importedRecipe', 'Imported Recipe');
        const content = DraftName.ensureTitleFrontmatter(result.cooklang, title);
        const base = await DraftName.uniqueBaseName(
            DraftName.sanitizeFilename(title),
            candidate => this.fileService.exists(draftsDir.resolve(`${candidate}.cook`))
        );
        const uri = draftsDir.resolve(`${base}.cook`);
        await this.fileService.create(uri, content);
        await open(this.openerService, uri);
        return uri;
    }
}
```

- [ ] **Step 2: Bind it** — in `cooklang-import-frontend-module.ts` add:

```ts
import { DraftSaver } from './draft-saver';
// inside the ContainerModule callback:
bind(DraftSaver).toSelf().inSingletonScope();
```

- [ ] **Step 3: Compile, commit**

```bash
npx lerna run compile --scope @theia/cooklang-import
git add packages/cooklang-import/src/browser
git commit -m "feat(import): DraftSaver writes converted recipes to Drafts/"
```

---

### Task 7: Widget shell, contribution, frontend wiring, styles

**Files:**
- Create: `packages/cooklang-import/src/browser/import-widget.tsx`
- Create: `packages/cooklang-import/src/browser/import-contribution.ts`
- Create: `packages/cooklang-import/src/browser/style/index.css`
- Modify: `packages/cooklang-import/src/browser/cooklang-import-frontend-module.ts`

This task produces a working main-area widget with a tab bar and placeholder tab bodies; Tasks 8–10 fill the tabs. Model: `AccountWidget` / `AccountContribution`.

- [ ] **Step 1: Create `src/browser/import-widget.tsx`**

```tsx
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import { AuthService, AuthState } from '@theia/cooklang-account/lib/common/auth-protocol';
import { AuthContribution, CookmdLoginCommand } from '@theia/cooklang-account/lib/browser/auth-contribution';
import { ImportErrorCode, RecipeImportService } from '../common/recipe-import-protocol';
import { DraftSaver } from './draft-saver';

export const IMPORT_WIDGET_ID = 'cooklang-import-widget';

export type ImportTab = 'url' | 'text' | 'images' | 'browser';

@injectable()
export class ImportWidget extends ReactWidget {

    static readonly ID = IMPORT_WIDGET_ID;
    static readonly LABEL = nls.localize('theia/cooklang-import/widgetLabel', 'Import Recipe');

    @inject(RecipeImportService)
    protected readonly importService: RecipeImportService;

    @inject(DraftSaver)
    protected readonly draftSaver: DraftSaver;

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(AuthContribution)
    protected readonly authContribution: AuthContribution;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    protected activeTab: ImportTab = 'url';
    protected authState: AuthState = { status: 'logged-out' };
    protected busy = false;
    protected errorMessage: string | undefined;
    protected errorShowsSignIn = false;
    protected successMessage: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = ImportWidget.ID;
        this.title.label = ImportWidget.LABEL;
        this.title.caption = ImportWidget.LABEL;
        this.title.iconClass = 'codicon codicon-cloud-download';
        this.title.closable = true;
        this.addClass('cooklang-import-widget');
        this.refreshAuthState();
        this.toDispose.push(this.authContribution.onDidChangeAuth(() => this.refreshAuthState()));
    }

    protected refreshAuthState(): void {
        this.authService.getAuthState().then(state => {
            this.authState = state;
            this.update();
        });
    }

    protected get signedIn(): boolean {
        return this.authState.status === 'logged-in';
    }

    protected signIn = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    protected selectTab(tab: ImportTab): void {
        this.activeTab = tab;
        this.errorMessage = undefined;
        this.successMessage = undefined;
        this.update();
    }

    // Shared conversion pipeline used by all tabs (Tasks 8-10 call this).
    protected async runImport(convert: () => Promise<import('../common/recipe-import-protocol').ConvertResult>): Promise<void> {
        this.busy = true;
        this.errorMessage = undefined;
        this.successMessage = undefined;
        this.update();
        try {
            const result = await convert();
            if (result.error !== undefined) {
                this.showError(result.error);
                return;
            }
            const uri = await this.draftSaver.save(result);
            this.successMessage = nls.localize('theia/cooklang-import/savedTo', 'Saved to {0}', `Drafts/${uri.path.base}`);
        } catch (err) {
            this.errorMessage = err instanceof Error ? err.message : String(err);
            this.errorShowsSignIn = false;
        } finally {
            this.busy = false;
            this.update();
        }
    }

    protected showError(code: ImportErrorCode): void {
        this.errorShowsSignIn = false;
        switch (code) {
            case 'rate-limited':
                if (this.signedIn) {
                    this.errorMessage = nls.localize('theia/cooklang-import/rateLimited', 'Import limit reached. Please try again later.');
                } else {
                    this.errorMessage = nls.localize('theia/cooklang-import/rateLimitedAnon', 'Import limit reached — sign in to increase your limits.');
                    this.errorShowsSignIn = true;
                }
                break;
            case 'unauthorized':
                this.errorMessage = nls.localize('theia/cooklang-import/unauthorized', 'Please sign in to continue.');
                this.errorShowsSignIn = true;
                break;
            case 'conversion-failed':
                this.errorMessage = nls.localize('theia/cooklang-import/conversionFailed', 'Couldn’t extract a recipe from this source. Try another one.');
                break;
            default:
                this.errorMessage = nls.localize('theia/cooklang-import/networkError', 'Connection problem. Please try again.');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='cooklang-import-content'>
                {this.renderTabBar()}
                {!this.signedIn && this.activeTab !== 'images' && this.renderLimitsBanner()}
                {this.renderStatus()}
                <div className='cooklang-import-tab-body'>
                    {this.renderActiveTab()}
                </div>
            </div>
        );
    }

    protected renderTabBar(): React.ReactNode {
        const tabs: Array<{ id: ImportTab; label: string }> = [
            { id: 'url', label: nls.localize('theia/cooklang-import/tabUrl', 'URL') },
            { id: 'text', label: nls.localize('theia/cooklang-import/tabText', 'Text') },
            { id: 'images', label: nls.localize('theia/cooklang-import/tabImages', 'Images') },
            { id: 'browser', label: nls.localize('theia/cooklang-import/tabBrowser', 'Web Browser') },
        ];
        return (
            <div className='cooklang-import-tabbar' role='tablist'>
                {tabs.map(tab => (
                    <TabButton key={tab.id} tab={tab.id} label={tab.label}
                        active={this.activeTab === tab.id}
                        onSelect={this.onTabSelected} />
                ))}
            </div>
        );
    }

    protected onTabSelected = (tab: ImportTab): void => {
        this.selectTab(tab);
    };

    protected renderLimitsBanner(): React.ReactNode {
        return (
            <div className='cooklang-import-banner'>
                <span>{nls.localize('theia/cooklang-import/limitsBanner', 'Sign in for higher import limits.')}</span>
                <a onClick={this.signIn}>{nls.localize('theia/cooklang-import/signIn', 'Sign in')}</a>
            </div>
        );
    }

    protected renderStatus(): React.ReactNode {
        if (this.busy) {
            return <div className='cooklang-import-status'>
                <i className='codicon codicon-loading codicon-modifier-spin' />
                {nls.localize('theia/cooklang-import/importing', 'Importing…')}
            </div>;
        }
        if (this.errorMessage) {
            return <div className='cooklang-import-status cooklang-import-error'>
                <span>{this.errorMessage}</span>
                {this.errorShowsSignIn && !this.signedIn &&
                    <button className='theia-button' onClick={this.signIn}>
                        {nls.localize('theia/cooklang-import/signIn', 'Sign in')}
                    </button>}
            </div>;
        }
        if (this.successMessage) {
            return <div className='cooklang-import-status cooklang-import-success'>{this.successMessage}</div>;
        }
        return undefined;
    }

    protected renderActiveTab(): React.ReactNode {
        // Tabs are implemented in Tasks 8-10; placeholders until then.
        switch (this.activeTab) {
            case 'url': return this.renderUrlTab();
            case 'text': return this.renderTextTab();
            case 'images': return this.renderImagesTab();
            case 'browser': return this.renderBrowserTab();
        }
    }

    protected renderUrlTab(): React.ReactNode {
        return <div />;
    }

    protected renderTextTab(): React.ReactNode {
        return <div />;
    }

    protected renderImagesTab(): React.ReactNode {
        return <div />;
    }

    protected renderBrowserTab(): React.ReactNode {
        return <div />;
    }
}

interface TabButtonProps {
    tab: ImportTab;
    label: string;
    active: boolean;
    onSelect: (tab: ImportTab) => void;
}

class TabButton extends React.Component<TabButtonProps> {
    override render(): React.ReactNode {
        const { label, active } = this.props;
        return <div role='tab' aria-selected={active}
            className={'cooklang-import-tab' + (active ? ' cooklang-import-tab-active' : '')}
            onClick={this.handleClick}>{label}</div>;
    }
    protected handleClick = (): void => {
        this.props.onSelect(this.props.tab);
    };
}
```

Note: event handlers are class-property arrow functions and per-tab state is a child component — no `bind()`/inline lambdas in JSX (see `doc/coding-guidelines.md` React rules). Keep this discipline in Tasks 8–10.

- [ ] **Step 2: Create `src/browser/import-contribution.ts`**

```ts
import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { ImportWidget, IMPORT_WIDGET_ID } from './import-widget';

export namespace ImportCommands {
    export const OPEN: Command = Command.toLocalizedCommand({
        id: 'cooklang.import.open',
        label: 'Import Recipe…',
    }, 'theia/cooklang-import/openCommand');
}

@injectable()
export class ImportContribution extends AbstractViewContribution<ImportWidget> {

    constructor() {
        super({
            widgetId: IMPORT_WIDGET_ID,
            widgetName: ImportWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(ImportCommands.OPEN, {
            execute: () => this.openView({ activate: true, reveal: true }),
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: ImportCommands.OPEN.id,
            order: 'z10',
        });
    }
}
```

- [ ] **Step 3: Create `src/browser/style/index.css`**

```css
.cooklang-import-widget {
    display: flex;
    flex-direction: column;
}

.cooklang-import-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--theia-ui-padding);
}

.cooklang-import-tabbar {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--theia-panel-border);
    margin-bottom: var(--theia-ui-padding);
}

.cooklang-import-tab {
    padding: 4px 12px;
    cursor: pointer;
    color: var(--theia-descriptionForeground);
}

.cooklang-import-tab-active {
    color: var(--theia-foreground);
    border-bottom: 2px solid var(--theia-focusBorder);
}

.cooklang-import-banner {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 8px;
    margin-bottom: var(--theia-ui-padding);
    background-color: var(--theia-editorWidget-background);
    border: 1px solid var(--theia-panel-border);
    border-radius: 3px;
}

.cooklang-import-banner a {
    cursor: pointer;
    color: var(--theia-textLink-foreground);
}

.cooklang-import-status {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
}

.cooklang-import-error {
    color: var(--theia-errorForeground);
}

.cooklang-import-success {
    color: var(--theia-descriptionForeground);
}

.cooklang-import-tab-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.cooklang-import-form {
    display: flex;
    flex-direction: column;
    gap: var(--theia-ui-padding);
    max-width: 640px;
}

.cooklang-import-form textarea {
    min-height: 200px;
    resize: vertical;
}

.cooklang-import-dropzone {
    border: 2px dashed var(--theia-panel-border);
    border-radius: 4px;
    padding: 32px;
    text-align: center;
    color: var(--theia-descriptionForeground);
}

.cooklang-import-dropzone.cooklang-import-dropzone-active {
    border-color: var(--theia-focusBorder);
}

.cooklang-import-thumbs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.cooklang-import-thumbs img {
    max-width: 96px;
    max-height: 96px;
    object-fit: cover;
    border-radius: 3px;
}

.cooklang-import-signin-gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--theia-ui-padding);
    padding: 48px 16px;
    color: var(--theia-descriptionForeground);
}

.cooklang-import-browser {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 4px;
}

.cooklang-import-browser-toolbar {
    display: flex;
    gap: 4px;
    align-items: center;
}

.cooklang-import-browser-toolbar input {
    flex: 1;
}

.cooklang-import-browser webview {
    flex: 1;
    border: 1px solid var(--theia-panel-border);
}
```

- [ ] **Step 4: Wire the frontend module**

Replace `src/browser/cooklang-import-frontend-module.ts` content:

```ts
import '../../src/browser/style/index.css';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { RecipeImportService, RecipeImportServicePath } from '../common/recipe-import-protocol';
import { DraftSaver } from './draft-saver';
import { ImportWidget, IMPORT_WIDGET_ID } from './import-widget';
import { ImportContribution } from './import-contribution';

export default new ContainerModule(bind => {
    bind(RecipeImportService).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy<RecipeImportService>(ctx.container, RecipeImportServicePath)
    ).inSingletonScope();

    bind(DraftSaver).toSelf().inSingletonScope();

    bind(ImportWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: IMPORT_WIDGET_ID,
        createWidget: () => ctx.container.get(ImportWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ImportContribution);
});
```

- [ ] **Step 5: Compile and lint**

```bash
npx lerna run compile --scope @theia/cooklang-import
npx lerna run lint --scope @theia/cooklang-import
```

Expected: clean. If `AuthContribution`'s `onDidChangeAuth` name differs, check `packages/cooklang-account/src/browser/auth-contribution.ts` and use the actual event name (the account widget subscribes to it at `account-widget.tsx:72`).

- [ ] **Step 6: Smoke-run the app** (verifies the widget opens; tabs are empty placeholders)

```bash
cd app && npm run bundle && npm run start:electron
```

Open a workspace folder, run "Import Recipe…" from the command palette (and File menu). Expected: main-area tab with 4 tab headers; signed-out banner visible on URL/Text/Browser tabs when logged out.

- [ ] **Step 7: Commit**

```bash
git add packages/cooklang-import/src/browser
git commit -m "feat(import): Import Recipe widget shell, command and menu entry"
```

---

### Task 8: URL and Text tabs

**Files:**
- Modify: `packages/cooklang-import/src/browser/import-widget.tsx`

- [ ] **Step 1: Add tab state fields to `ImportWidget`**

```ts
protected urlValue = '';
protected textValue = '';
```

- [ ] **Step 2: Replace `renderUrlTab` / `renderTextTab` and add handlers**

```tsx
protected renderUrlTab(): React.ReactNode {
    return (
        <div className='cooklang-import-form'>
            <label>{nls.localize('theia/cooklang-import/urlLabel', 'Recipe page URL')}</label>
            <input className='theia-input' type='text' value={this.urlValue}
                placeholder='https://example.com/best-pancakes'
                onChange={this.onUrlChanged} onKeyDown={this.onUrlKeyDown} disabled={this.busy} />
            <button className='theia-button main' onClick={this.importFromUrl}
                disabled={this.busy || this.urlValue.trim().length === 0}>
                {nls.localize('theia/cooklang-import/importButton', 'Import')}
            </button>
        </div>
    );
}

protected onUrlChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.urlValue = event.target.value;
    this.update();
};

protected onUrlKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && this.urlValue.trim().length > 0 && !this.busy) {
        this.importFromUrl();
    }
};

protected importFromUrl = (): void => {
    const url = this.urlValue.trim();
    this.runImport(() => this.importService.convertUrl(url));
};

protected renderTextTab(): React.ReactNode {
    return (
        <div className='cooklang-import-form'>
            <label>{nls.localize('theia/cooklang-import/textLabel', 'Paste the recipe text')}</label>
            <textarea className='theia-input' value={this.textValue}
                onChange={this.onTextChanged} disabled={this.busy} />
            <button className='theia-button main' onClick={this.importFromText}
                disabled={this.busy || this.textValue.trim().length === 0}>
                {nls.localize('theia/cooklang-import/importButton', 'Import')}
            </button>
        </div>
    );
}

protected onTextChanged = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    this.textValue = event.target.value;
    this.update();
};

protected importFromText = (): void => {
    const text = this.textValue.trim();
    this.runImport(() => this.importService.convertText(text));
};
```

- [ ] **Step 3: Compile, lint, smoke-test**

Compile + lint as before, then run the app. Import a real recipe URL (e.g. a public recipe page) while signed out: expect a new `Drafts/<Title>.cook` opened in the editor, success message in the widget. Paste plain recipe text in the Text tab and import: same. Break the network (or use an invalid URL like `https://invalid.invalid`): expect the network/conversion error message.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-import/src/browser/import-widget.tsx
git commit -m "feat(import): URL and text import tabs"
```

---

### Task 9: Images tab (auth-gated, drag-and-drop, compression)

**Files:**
- Create: `packages/cooklang-import/src/browser/image-encoder.ts`
- Modify: `packages/cooklang-import/src/browser/import-widget.tsx`

- [ ] **Step 1: Create `src/browser/image-encoder.ts`**

DOM/canvas-dependent — no unit test; verified manually.

```ts
export const MAX_IMPORT_IMAGES = 5;
const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.7;

/**
 * Downscales (longest edge <= 2048px) and re-encodes an image file as a
 * base64 JPEG string (no data-URL prefix), matching the payload the
 * cookify images endpoint expects.
 */
export namespace ImageEncoder {

    export async function toBase64Jpeg(file: File): Promise<string> {
        const bitmap = await createImageBitmap(file);
        try {
            const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Canvas 2D context unavailable');
            }
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            return dataUrl.substring(dataUrl.indexOf(',') + 1);
        } finally {
            bitmap.close();
        }
    }
}
```

- [ ] **Step 2: Implement the images tab in `ImportWidget`**

Add state:

```ts
protected images: Array<{ file: File; previewUrl: string }> = [];
protected dropActive = false;
```

Replace `renderImagesTab` and add handlers:

```tsx
protected renderImagesTab(): React.ReactNode {
    if (!this.signedIn) {
        return (
            <div className='cooklang-import-signin-gate'>
                <i className='codicon codicon-account' />
                <span>{nls.localize('theia/cooklang-import/imagesSignIn', 'Sign in to CookCloud to use image clipping.')}</span>
                <button className='theia-button main' onClick={this.signIn}>
                    {nls.localize('theia/cooklang-import/signIn', 'Sign in')}
                </button>
            </div>
        );
    }
    return (
        <div className='cooklang-import-form'>
            <div className={'cooklang-import-dropzone' + (this.dropActive ? ' cooklang-import-dropzone-active' : '')}
                onDragOver={this.onDragOver} onDragLeave={this.onDragLeave} onDrop={this.onDrop}>
                {nls.localize('theia/cooklang-import/dropImages', 'Drop up to {0} recipe photos here, or', MAX_IMPORT_IMAGES)}
                <input type='file' accept='image/*' multiple onChange={this.onFilesPicked} disabled={this.busy} />
            </div>
            {this.images.length > 0 &&
                <div className='cooklang-import-thumbs'>
                    {this.images.map(image => <img key={image.previewUrl} src={image.previewUrl} />)}
                </div>}
            <button className='theia-button main' onClick={this.importFromImages}
                disabled={this.busy || this.images.length === 0}>
                {nls.localize('theia/cooklang-import/importButton', 'Import')}
            </button>
        </div>
    );
}

protected onDragOver = (event: React.DragEvent): void => {
    event.preventDefault();
    this.dropActive = true;
    this.update();
};

protected onDragLeave = (): void => {
    this.dropActive = false;
    this.update();
};

protected onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    this.dropActive = false;
    this.addImageFiles(Array.from(event.dataTransfer.files));
};

protected onFilesPicked = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.addImageFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
};

protected addImageFiles(files: File[]): void {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    for (const file of imageFiles) {
        if (this.images.length >= MAX_IMPORT_IMAGES) {
            break;
        }
        this.images.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    this.update();
}

protected clearImages(): void {
    this.images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    this.images = [];
}

protected importFromImages = (): void => {
    const files = this.images.map(image => image.file);
    this.runImport(async () => {
        const encoded = await Promise.all(files.map(file => ImageEncoder.toBase64Jpeg(file)));
        return this.importService.convertImages(encoded);
    }).then(() => {
        if (this.successMessage) {
            this.clearImages();
            this.update();
        }
    }, (err: unknown) => console.error('Image import failed:', err));
};
```

Add imports at the top: `import { ImageEncoder, MAX_IMPORT_IMAGES } from './image-encoder';`

Also revoke preview URLs on widget disposal — in `init()`:

```ts
this.toDispose.push({ dispose: () => this.clearImages() });
```

- [ ] **Step 3: Compile, lint, smoke-test**

Signed out: images tab shows the sign-in gate (no picker). Signed in: drop 1–2 photos of a cookbook page → Import → draft created and opened. Also verify the 5-image cap (drop 6, only 5 thumbnails).

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-import/src/browser
git commit -m "feat(import): auth-gated image import with drag-and-drop"
```

---

### Task 10: Clipping browser tab + `webviewTag` enablement

**Files:**
- Modify: `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts`
- Modify: `packages/cooklang-import/src/browser/import-widget.tsx`

- [ ] **Step 1: Enable the webview tag in the branding electron-main**

In `CooklangElectronMainApplication.getDefaultOptions()` (line 23), merge `webPreferences` **after** the config spread so it cannot be overridden off:

```ts
protected override getDefaultOptions(): TheiaBrowserWindowOptions {
    const options = super.getDefaultOptions();
    const resolved = {
        ...options,
        ...this.resolveWindowOptions(this.config.electron?.windowOptions || {}),
    };
    return {
        ...resolved,
        webPreferences: {
            ...resolved.webPreferences,
            // Required by the recipe-import clipping browser (<webview> tag).
            webviewTag: true,
        },
    };
}
```

- [ ] **Step 2: Implement the browser tab in `ImportWidget`**

The `<webview>` element has no React/TS typings in browser code; declare the minimal surface locally. Security per spec: isolated `partition`, no node integration (webview default when not explicitly enabled — do NOT set `nodeintegration`).

Add to `import-widget.tsx`:

```tsx
import { RecipePayload } from './recipe-payload';

interface WebviewElement extends HTMLElement {
    src: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
}

const CLIP_SCRIPT = `(() => ({
    jsonLdBlocks: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent || ''),
    pageText: document.body ? document.body.innerText : ''
}))()`;
```

State + handlers on `ImportWidget`:

```ts
protected webview: WebviewElement | undefined;
protected browserAddress = '';
protected browserUrl = '';           // committed URL loaded in the webview
protected pageLoaded = false;
protected pageLoadFailed = false;
```

```tsx
protected renderBrowserTab(): React.ReactNode {
    return (
        <div className='cooklang-import-browser'>
            <div className='cooklang-import-browser-toolbar'>
                <button className='theia-button secondary' onClick={this.browserBack} disabled={!this.canGoBack()}>
                    <i className='codicon codicon-arrow-left' />
                </button>
                <button className='theia-button secondary' onClick={this.browserForward} disabled={!this.canGoForward()}>
                    <i className='codicon codicon-arrow-right' />
                </button>
                <button className='theia-button secondary' onClick={this.browserReload} disabled={!this.browserUrl}>
                    <i className='codicon codicon-refresh' />
                </button>
                <input className='theia-input' type='text' value={this.browserAddress}
                    placeholder={nls.localize('theia/cooklang-import/browserPlaceholder', 'Enter a URL and press Enter')}
                    onChange={this.onAddressChanged} onKeyDown={this.onAddressKeyDown} />
                <button className='theia-button main' onClick={this.clipPage}
                    disabled={this.busy || !this.pageLoaded}>
                    {nls.localize('theia/cooklang-import/clipButton', 'Clip Recipe')}
                </button>
            </div>
            {this.pageLoadFailed &&
                <div className='cooklang-import-status cooklang-import-error'>
                    {nls.localize('theia/cooklang-import/pageLoadFailed', 'The page failed to load.')}
                </div>}
            {this.browserUrl
                ? React.createElement('webview', {
                    ref: this.setWebview,
                    src: this.browserUrl,
                    partition: 'import-browser',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any)
                : <div className='cooklang-import-dropzone'>
                    {nls.localize('theia/cooklang-import/browserHint', 'Browse to a recipe page, then press Clip Recipe.')}
                </div>}
        </div>
    );
}

protected setWebview = (element: HTMLElement | null): void => {
    if (this.webview === element) {
        return;
    }
    this.webview = (element ?? undefined) as WebviewElement | undefined;
    if (this.webview) {
        this.webview.addEventListener('did-finish-load', this.onPageLoaded);
        this.webview.addEventListener('did-fail-load', this.onPageFailed);
        this.webview.addEventListener('did-navigate', this.onPageNavigated);
        this.webview.addEventListener('did-navigate-in-page', this.onPageNavigated);
    }
};

protected onAddressChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.browserAddress = event.target.value;
    this.update();
};

protected onAddressKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' || this.browserAddress.trim().length === 0) {
        return;
    }
    let address = this.browserAddress.trim();
    if (!/^https?:\/\//i.test(address)) {
        address = `https://${address}`;
    }
    this.pageLoaded = false;
    this.pageLoadFailed = false;
    if (this.browserUrl === address && this.webview) {
        this.webview.reload();
    } else if (this.browserUrl && this.webview) {
        // Reuse the existing webview; setting src navigates it.
        this.webview.src = address;
        this.browserUrl = address;
    } else {
        this.browserUrl = address;
    }
    this.browserAddress = address;
    this.update();
};

protected onPageLoaded = (): void => {
    this.pageLoaded = true;
    this.pageLoadFailed = false;
    this.update();
};

protected onPageFailed = (): void => {
    this.pageLoaded = false;
    this.pageLoadFailed = true;
    this.update();
};

protected onPageNavigated = (): void => {
    if (this.webview) {
        this.browserAddress = this.webview.getURL();
    }
    this.update();
};

// Electron throws if webview methods are called before the webview's
// dom-ready; only query navigation state once a page has loaded.
protected canGoBack(): boolean {
    return this.pageLoaded && !!this.webview?.canGoBack();
}

protected canGoForward(): boolean {
    return this.pageLoaded && !!this.webview?.canGoForward();
}

protected browserBack = (): void => {
    if (this.pageLoaded) {
        this.webview?.goBack();
    }
};

protected browserForward = (): void => {
    if (this.pageLoaded) {
        this.webview?.goForward();
    }
};
protected browserReload = (): void => {
    this.pageLoaded = false;
    this.pageLoadFailed = false;
    this.webview?.reload();
    this.update();
};

protected clipPage = (): void => {
    const webview = this.webview;
    if (!webview) {
        return;
    }
    this.runImport(async () => {
        const data = await webview.executeJavaScript(CLIP_SCRIPT) as { jsonLdBlocks: string[]; pageText: string };
        const payload = RecipePayload.extract(data.jsonLdBlocks ?? [], data.pageText ?? '');
        return this.importService.convertText(payload);
    });
};
```

Note: `renderActiveTab` must keep the webview mounted only while the browser tab is active — the current switch already does that; leaving the tab drops navigation state, which is acceptable for v1.

- [ ] **Step 3: Rebuild and smoke-test**

```bash
npx lerna run compile --scope @theia/cooklang-branding
npx lerna run compile --scope @theia/cooklang-import
cd app && npm run bundle && npm run start:electron
```

In the Browser tab: navigate to a recipe site with JSON-LD (most major recipe sites), press Clip Recipe → draft created from the structured recipe. Then try a plain blog page without JSON-LD → clip falls back to page text. Verify back/forward/reload work and Clip is disabled before the first page finishes loading.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts packages/cooklang-import/src/browser/import-widget.tsx
git commit -m "feat(import): internal clipping browser with JSON-LD extraction"
```

---

### Task 11: Final verification

**Files:** none new.

- [ ] **Step 1: Full package checks**

```bash
npx lerna run compile --scope @theia/cooklang-import --scope @theia/cooklang-branding
npx lerna run lint --scope @theia/cooklang-import --scope @theia/cooklang-branding
npx lerna run test --scope @theia/cooklang-import
```

Expected: all pass.

- [ ] **Step 2: Manual E2E checklist** (`cd app && npm run bundle && npm run start:electron`, open a workspace folder)

- URL import (signed out): success → `Drafts/<Title>.cook` opened; banner visible.
- Text import (signed out): success.
- Images tab signed out: sign-in gate, no picker.
- Sign in (`Cook.md: Login`), images tab: drag-and-drop 2 photos → import succeeds; banner gone.
- Browser tab: clip a JSON-LD recipe site; clip a non-recipe text page (fallback path).
- Duplicate name: import the same URL twice → second file is `<Title>-2.cook`.
- No workspace open: command reports "Open a folder before importing recipes."
- Rate limit (if reachable): repeated anonymous imports → 429 message with Sign in button.

- [ ] **Step 3: Use the superpowers:verification-before-completion skill, then the superpowers:finishing-a-development-branch skill** (merge/PR decision belongs to the user).
