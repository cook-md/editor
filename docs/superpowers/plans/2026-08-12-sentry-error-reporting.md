# Sentry Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report unhandled errors from all three Cook Editor processes to Sentry, on by default with a preference to disable, sending nothing that could carry personal recipe content or credentials.

**Architecture:** A new `@theia/cooklang-telemetry` package contributes four `theiaExtensions` entries — `electronMain`, `preload`, `frontend`, `backend`. The Electron main and renderer use `@sentry/electron`; the *forked* backend Node process uses `@sentry/node`, because `@sentry/electron` does not cover it. All processes share pure, unit-tested scrubbing and consent logic from `src/common/`.

**Tech Stack:** TypeScript, InversifyJS, Theia 1.70, `@sentry/electron@7.16.0`, `@sentry/node@10.67.0` (pinned exactly — `@sentry/electron` depends on that exact version, and a mismatch loads two copies of `@sentry/core`), mocha + chai.

**Spec:** `docs/superpowers/specs/2026-08-12-sentry-error-reporting-design.md`

**Prerequisite:** Node >= 22 (`nvm use`; see `.nvmrc`). Tests will refuse to run otherwise.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/cooklang-telemetry/package.json` | Package manifest, four `theiaExtensions` entries |
| `packages/cooklang-telemetry/tsconfig.json` | Project references |
| `src/common/scrub.ts` | Pure payload scrubbing. No Sentry import, no fs. |
| `src/common/scrub.spec.ts` | Unit tests for scrubbing |
| `src/common/telemetry-consent.ts` | Pure parsing of the consent file contents |
| `src/common/telemetry-consent.spec.ts` | Unit tests for consent parsing |
| `src/common/telemetry-options.ts` | Shared DSN/release/environment + hook wiring |
| `src/common/telemetry-options.spec.ts` | Unit tests for option building |
| `src/node/telemetry-consent-file.ts` | Reads the consent file from disk (Node only) |
| `src/node/cooklang-telemetry-backend-module.ts` | `@sentry/node` init for the forked backend |
| `src/electron-main/cooklang-telemetry-electron-main-module.ts` | `@sentry/electron/main` init |
| `src/preload/cooklang-telemetry-preload.ts` | Sentry IPC bridge for `contextIsolation` |
| `src/browser/cooklang-telemetry-frontend-module.ts` | Renderer init + preference binding |
| `src/browser/telemetry-preferences.ts` | Preference schema |
| `src/browser/telemetry-consent-writer.ts` | Writes the consent file when the preference changes |

Splitting `scrub`/`consent`/`options` keeps the correctness-critical logic pure and testable without a Sentry client, an Electron app, or a filesystem.

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/cooklang-telemetry/package.json`
- Create: `packages/cooklang-telemetry/tsconfig.json`
- Create: `packages/cooklang-telemetry/.eslintrc.js`
- Modify: `app/package.json` (dependencies)
- Modify: `app/tsconfig.json` (references)

- [ ] **Step 0: Create `packages/cooklang-telemetry/.eslintrc.js`**

Every one of the 36 packages in `packages/` has this file; without it
`theiaext lint` fails with "ESLint couldn't find a configuration file".

```javascript
/** @type {import('eslint').Linter.Config} */
module.exports = {
    extends: [
        '../../configs/build.eslintrc.json'
    ],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: 'tsconfig.json'
    }
};
```

- [ ] **Step 1: Create `packages/cooklang-telemetry/package.json`**

```json
{
  "name": "@theia/cooklang-telemetry",
  "version": "1.70.0",
  "description": "Cook Editor error reporting",
  "dependencies": {
    "@theia/core": "1.70.0",
    "@sentry/electron": "^7.16.0",
    "@sentry/node": "10.67.0",
    "tslib": "^2.6.2"
  },
  "main": "lib/common",
  "theiaExtensions": [
    { "electronMain": "lib/electron-main/cooklang-telemetry-electron-main-module" },
    { "preload": "lib/preload/cooklang-telemetry-preload" },
    { "frontend": "lib/browser/cooklang-telemetry-frontend-module" },
    { "backend": "lib/node/cooklang-telemetry-backend-module" }
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

Four separate entries, not one entry with four keys: targets in the same entry replace rather than merge.

The `test` script is included because this package *will* have spec files. Do not add it to packages without specs — mocha exits non-zero on "No test files found" and aborts the whole run.

- [ ] **Step 2: Create `packages/cooklang-telemetry/tsconfig.json`**

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
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Add the dependency to `app/package.json`**

In the `dependencies` object, alphabetically among the other `@theia/cooklang-*` entries:

```json
"@theia/cooklang-telemetry": "1.70.0",
```

- [ ] **Step 4: Add the project reference to `app/tsconfig.json`**

In the `references` array:

```json
{ "path": "../packages/cooklang-telemetry" },
```

- [ ] **Step 5: Install and verify the workspace symlink**

Run: `npm install`
Expected: completes without error.

Run: `ls -l node_modules/@theia/cooklang-telemetry`
Expected: a symlink pointing at `../../packages/cooklang-telemetry`.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-telemetry/package.json packages/cooklang-telemetry/tsconfig.json app/package.json app/tsconfig.json package-lock.json
git commit -m "feat(telemetry): scaffold @theia/cooklang-telemetry package"
```

---

## Task 2: Consent parsing

Pure parsing, separated from the filesystem so it can be tested directly. Opt-out semantics: anything unreadable or absent means **enabled**.

**Files:**
- Create: `packages/cooklang-telemetry/src/common/telemetry-consent.ts`
- Test: `packages/cooklang-telemetry/src/common/telemetry-consent.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang-telemetry/src/common/telemetry-consent.spec.ts`:

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
import { parseErrorReportingConsent } from './telemetry-consent';

describe('parseErrorReportingConsent', () => {

    // Opt-out: the absence of a stored choice means the user has not opted out.
    it('is enabled when the file is missing', () => {
        expect(parseErrorReportingConsent(undefined)).to.be.true;
    });

    it('is enabled when the file is empty', () => {
        expect(parseErrorReportingConsent('')).to.be.true;
    });

    it('is enabled when the file is not valid JSON', () => {
        expect(parseErrorReportingConsent('{ not json')).to.be.true;
    });

    it('is enabled when the flag is absent from an otherwise valid file', () => {
        expect(parseErrorReportingConsent('{"somethingElse": true}')).to.be.true;
    });

    it('is disabled only on an explicit false', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": false}')).to.be.false;
    });

    it('is enabled on an explicit true', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": true}')).to.be.true;
    });

    // A non-boolean must not be coerced: `"false"` is truthy in JS, and silently
    // enabling reporting because of a malformed value is the wrong direction to fail.
    it('is disabled when the flag is the string "false"', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": "false"}')).to.be.false;
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: FAIL — `Cannot find module './telemetry-consent'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang-telemetry/src/common/telemetry-consent.ts`:

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

/** Name of the consent file inside the Theia config directory. */
export const TELEMETRY_CONSENT_FILE_NAME = 'cook-telemetry.json';

/** Shape persisted to the consent file. */
export interface TelemetryConsent {
    errorReportingEnabled: boolean;
}

/**
 * Whether error reporting is enabled, given the raw contents of the consent
 * file. Reporting is opt-out, so an absent, empty or unparseable file means
 * enabled - the user has not chosen to turn it off.
 *
 * Only a literal `false`, or the string `'false'`, disables it. A malformed
 * value is treated as a disable rather than coerced, because silently
 * re-enabling reporting is the worse way to be wrong.
 */
export function parseErrorReportingConsent(raw: string | undefined): boolean {
    if (!raw) {
        return true;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return true;
    }
    if (!parsed || typeof parsed !== 'object' || !('errorReportingEnabled' in parsed)) {
        return true;
    }
    const value = (parsed as { errorReportingEnabled: unknown }).errorReportingEnabled;
    if (typeof value === 'boolean') {
        return value;
    }
    return String(value) !== 'false';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry && npx lerna run test --scope @theia/cooklang-telemetry`
Expected: PASS, 7 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-telemetry/src/common/telemetry-consent.ts packages/cooklang-telemetry/src/common/telemetry-consent.spec.ts
git commit -m "feat(telemetry): parse the opt-out consent file"
```

---

## Task 3: Payload scrubbing

The correctness-critical piece. A leak cannot be undone after the fact, so `extra` and `contexts` use an allowlist rather than a denylist.

**Files:**
- Create: `packages/cooklang-telemetry/src/common/scrub.ts`
- Test: `packages/cooklang-telemetry/src/common/scrub.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang-telemetry/src/common/scrub.spec.ts`:

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
import { REDACTED, ScrubbableEvent, scrubEvent } from './scrub';

const HOME = '/Users/jane';

function scrub(event: ScrubbableEvent): ScrubbableEvent {
    return scrubEvent(event, { homeDir: HOME });
}

describe('scrubEvent', () => {

    describe('home directory removal', () => {

        // Absolute paths carry the OS username, which is personal data we have
        // no need for.
        it('rewrites the home directory in an exception value', () => {
            const event = scrub({
                exception: { values: [{ value: `ENOENT: open '${HOME}/Recipes/dinner.cook'` }] }
            });
            expect(event.exception!.values![0].value).to.equal("ENOENT: open '~/Recipes/dinner.cook'");
        });

        it('rewrites the home directory in stack frames', () => {
            const event = scrub({
                exception: {
                    values: [{
                        stacktrace: { frames: [{ filename: `${HOME}/app/lib/x.js`, abs_path: `${HOME}/app/lib/x.js` }] }
                    }]
                }
            });
            const frame = event.exception!.values![0].stacktrace!.frames![0];
            expect(frame.filename).to.equal('~/app/lib/x.js');
            expect(frame.abs_path).to.equal('~/app/lib/x.js');
        });

        it('rewrites the home directory in a breadcrumb message', () => {
            const event = scrub({ breadcrumbs: [{ message: `read ${HOME}/notes.md` }] });
            expect(event.breadcrumbs![0].message).to.equal('read ~/notes.md');
        });

        it('rewrites every occurrence, not just the first', () => {
            const event = scrub({
                exception: { values: [{ value: `copy ${HOME}/a.cook to ${HOME}/b.cook` }] }
            });
            expect(event.exception!.values![0].value).to.equal('copy ~/a.cook to ~/b.cook');
        });
    });

    describe('secret redaction', () => {

        // CookbotGrpcClient holds a live auth token, so this is not hypothetical.
        it('redacts a token in an allowlisted extra field', () => {
            const event = scrub({ extra: { grpcStatus: 'authToken=eyJhbGciOiJIUzI1NiJ9.abc.def' } });
            expect(event.extra!.grpcStatus).to.equal(`authToken=${REDACTED}`);
        });

        it('redacts a bearer token wherever it appears', () => {
            const event = scrub({
                exception: { values: [{ value: 'request failed: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' }] }
            });
            expect(event.exception!.values![0].value).to.contain(REDACTED);
            expect(event.exception!.values![0].value).to.not.contain('eyJhbGciOiJIUzI1NiJ9');
        });
    });

    describe('allowlisting', () => {

        it('drops extra fields that are not allowlisted', () => {
            const event = scrub({ extra: { recipeContent: 'Add @salt{1%tsp}', grpcStatus: 'UNAVAILABLE' } });
            expect(event.extra).to.not.have.property('recipeContent');
            expect(event.extra!.grpcStatus).to.equal('UNAVAILABLE');
        });

        it('drops contexts that are not allowlisted', () => {
            const event = scrub({ contexts: { chatPrompt: { text: 'my secret recipe' }, os: { name: 'macOS' } } });
            expect(event.contexts).to.not.have.property('chatPrompt');
            expect(event.contexts).to.have.property('os');
        });

        it('drops the request entirely', () => {
            const event = scrub({ request: { data: 'Add @salt{1%tsp}' } });
            expect(event.request).to.be.undefined;
        });
    });

    it('leaves an event with nothing sensitive untouched', () => {
        const event = scrub({ exception: { values: [{ value: 'Cannot read properties of undefined' }] } });
        expect(event.exception!.values![0].value).to.equal('Cannot read properties of undefined');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: FAIL — `Cannot find module './scrub'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang-telemetry/src/common/scrub.ts`:

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

/** Replacement for any value that must not leave the machine. */
export const REDACTED = '[redacted]';

/**
 * Keys allowed to survive in `extra`. An allowlist rather than a denylist:
 * a field nobody anticipated must default to being dropped, because a leak of
 * recipe content or credentials cannot be undone after the fact.
 */
export const ALLOWED_EXTRA_KEYS: ReadonlySet<string> = new Set([
    'grpcStatus',
    'grpcCode',
    'processType',
    'theiaVersion'
]);

/** Contexts allowed to survive. These are SDK-populated and carry no user content. */
export const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
    'os',
    'device',
    'runtime',
    'app',
    'browser',
    'trace'
]);

const SECRET_ASSIGNMENT = /\b(authToken|token|password|secret|apiKey|sessionId|Authorization)\b(\s*[:=]\s*)(\S+)/gi;
const BEARER_TOKEN = /\bBearer\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export interface ScrubOptions {
    /** Absolute path to the user's home directory. */
    homeDir: string;
}

export interface ScrubbableFrame {
    filename?: string;
    abs_path?: string;
}

export interface ScrubbableException {
    value?: string;
    stacktrace?: { frames?: ScrubbableFrame[] };
}

export interface ScrubbableBreadcrumb {
    message?: string;
    data?: Record<string, unknown>;
}

/**
 * Structural subset of a Sentry event. Deliberately not Sentry's own type, so
 * this module stays dependency-free and directly testable.
 */
export interface ScrubbableEvent {
    message?: string;
    exception?: { values?: ScrubbableException[] };
    breadcrumbs?: ScrubbableBreadcrumb[];
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    request?: unknown;
}

/** Remove the home directory and any secret-shaped substring from a string. */
export function scrubString(value: string, options: ScrubOptions): string {
    let result = value;
    if (options.homeDir) {
        result = result.split(options.homeDir).join('~');
    }
    result = result.replace(SECRET_ASSIGNMENT, (_match, key, separator) => `${key}${separator}${REDACTED}`);
    result = result.replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
    result = result.replace(JWT, REDACTED);
    return result;
}

function scrubUnknown(value: unknown, options: ScrubOptions): unknown {
    if (typeof value === 'string') {
        return scrubString(value, options);
    }
    if (Array.isArray(value)) {
        return value.map(item => scrubUnknown(item, options));
    }
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            result[key] = scrubUnknown(nested, options);
        }
        return result;
    }
    return value;
}

/** Scrub a breadcrumb in place-safe fashion, returning a new object. */
export function scrubBreadcrumb(breadcrumb: ScrubbableBreadcrumb, options: ScrubOptions): ScrubbableBreadcrumb {
    return {
        ...breadcrumb,
        message: breadcrumb.message === undefined ? undefined : scrubString(breadcrumb.message, options),
        data: breadcrumb.data === undefined ? undefined : scrubUnknown(breadcrumb.data, options) as Record<string, unknown>
    };
}

/**
 * Strip everything from an event that could carry personal content or
 * credentials. Returns a new event; the input is not modified.
 */
export function scrubEvent(event: ScrubbableEvent, options: ScrubOptions): ScrubbableEvent {
    const result: ScrubbableEvent = { ...event };

    if (result.message !== undefined) {
        result.message = scrubString(result.message, options);
    }

    if (result.exception?.values) {
        result.exception = {
            values: result.exception.values.map(value => ({
                ...value,
                value: value.value === undefined ? undefined : scrubString(value.value, options),
                stacktrace: value.stacktrace && {
                    frames: value.stacktrace.frames?.map(frame => ({
                        ...frame,
                        filename: frame.filename === undefined ? undefined : scrubString(frame.filename, options),
                        abs_path: frame.abs_path === undefined ? undefined : scrubString(frame.abs_path, options)
                    }))
                }
            }))
        };
    }

    if (result.breadcrumbs) {
        result.breadcrumbs = result.breadcrumbs.map(breadcrumb => scrubBreadcrumb(breadcrumb, options));
    }

    if (result.extra) {
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result.extra)) {
            if (ALLOWED_EXTRA_KEYS.has(key)) {
                extra[key] = scrubUnknown(value, options);
            }
        }
        result.extra = extra;
    }

    if (result.contexts) {
        const contexts: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result.contexts)) {
            if (ALLOWED_CONTEXT_KEYS.has(key)) {
                contexts[key] = scrubUnknown(value, options);
            }
        }
        result.contexts = contexts;
    }

    // Request bodies can contain anything; never send them.
    result.request = undefined;

    return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry && npx lerna run test --scope @theia/cooklang-telemetry`
Expected: PASS, 17 passing (7 consent + 10 scrub).

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-telemetry/src/common/scrub.ts packages/cooklang-telemetry/src/common/scrub.spec.ts
git commit -m "feat(telemetry): scrub paths, secrets and unallowlisted fields from events"
```

---

## Task 4: Shared init options

One place that decides the DSN, release, environment, and whether to initialise at all — so the three processes cannot drift apart.

**Files:**
- Create: `packages/cooklang-telemetry/src/common/telemetry-options.ts`
- Test: `packages/cooklang-telemetry/src/common/telemetry-options.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cooklang-telemetry/src/common/telemetry-options.spec.ts`:

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
import { shouldInitialize, buildOptions } from './telemetry-options';

describe('shouldInitialize', () => {

    it('does not initialize when the user opted out, even when packaged', () => {
        expect(shouldInitialize({ consented: false, packaged: true, devOverride: false })).to.be.false;
    });

    // Local development must not pollute the project with errors from work in progress.
    it('does not initialize in development by default', () => {
        expect(shouldInitialize({ consented: true, packaged: false, devOverride: false })).to.be.false;
    });

    it('initializes in development when explicitly overridden', () => {
        expect(shouldInitialize({ consented: true, packaged: false, devOverride: true })).to.be.true;
    });

    it('does not initialize on the dev override when the user opted out', () => {
        expect(shouldInitialize({ consented: false, packaged: false, devOverride: true })).to.be.false;
    });

    it('initializes when packaged and consented', () => {
        expect(shouldInitialize({ consented: true, packaged: true, devOverride: false })).to.be.true;
    });
});

describe('buildOptions', () => {

    it('tags the release and environment', () => {
        const options = buildOptions({ release: '0.1.0-alpha.36', packaged: true, homeDir: '/Users/jane' });
        expect(options.release).to.equal('0.1.0-alpha.36');
        expect(options.environment).to.equal('production');
        expect(options.dsn).to.contain('ingest.us.sentry.io');
    });

    it('marks a non-packaged build as development', () => {
        const options = buildOptions({ release: '0.0.0', packaged: false, homeDir: '/Users/jane' });
        expect(options.environment).to.equal('development');
    });

    it('never sends default PII', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        expect(options.sendDefaultPii).to.be.false;
    });

    it('scrubs events through beforeSend', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        const scrubbed = options.beforeSend({
            exception: { values: [{ value: 'failed at /Users/jane/Recipes/x.cook' }] },
            extra: { recipeContent: 'Add @salt{}' }
        });
        expect(scrubbed.exception!.values![0].value).to.equal('failed at ~/Recipes/x.cook');
        expect(scrubbed.extra).to.not.have.property('recipeContent');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: FAIL — `Cannot find module './telemetry-options'`.

- [ ] **Step 3: Write the implementation**

Create `packages/cooklang-telemetry/src/common/telemetry-options.ts`:

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

import { ScrubbableBreadcrumb, ScrubbableEvent, scrubBreadcrumb, scrubEvent } from './scrub';

/**
 * Sentry DSN for the Cook Editor project. A DSN is write-only and not a
 * secret; cook.md treats its own the same way.
 */
export const SENTRY_DSN = 'https://0ab1ee49571b67c4c8fc0384f31d77ce@o4506865729404928.ingest.us.sentry.io/4511898607091712';

/** Set this to `1` to report from a development build. */
export const DEV_OVERRIDE_ENV_VAR = 'COOK_TELEMETRY_DEV';

export interface InitDecision {
    consented: boolean;
    packaged: boolean;
    devOverride: boolean;
}

/**
 * Whether to initialize Sentry at all. Development builds stay silent unless
 * explicitly overridden, so local work does not pollute the project.
 */
export function shouldInitialize(decision: InitDecision): boolean {
    if (!decision.consented) {
        return false;
    }
    return decision.packaged || decision.devOverride;
}

export interface BuildOptionsArgs {
    release: string;
    packaged: boolean;
    homeDir: string;
}

export interface TelemetryOptions {
    dsn: string;
    release: string;
    environment: string;
    sendDefaultPii: false;
    beforeSend(event: ScrubbableEvent): ScrubbableEvent;
    beforeBreadcrumb(breadcrumb: ScrubbableBreadcrumb): ScrubbableBreadcrumb;
}

/** Options shared by every process, so the three cannot drift apart. */
export function buildOptions(args: BuildOptionsArgs): TelemetryOptions {
    const scrubOptions = { homeDir: args.homeDir };
    return {
        dsn: SENTRY_DSN,
        release: args.release,
        environment: args.packaged ? 'production' : 'development',
        sendDefaultPii: false,
        beforeSend: event => scrubEvent(event, scrubOptions),
        beforeBreadcrumb: breadcrumb => scrubBreadcrumb(breadcrumb, scrubOptions)
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry && npx lerna run test --scope @theia/cooklang-telemetry`
Expected: PASS, 26 passing (17 + 9 options).

Note: `Sentry.setUser` is never called anywhere in this plan, and must not be
added. Attaching the cook.md account id turns anonymous crash data into
per-user records — a different privacy commitment, and its own decision.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-telemetry/src/common/telemetry-options.ts packages/cooklang-telemetry/src/common/telemetry-options.spec.ts
git commit -m "feat(telemetry): shared Sentry init options and init decision"
```

---

## Task 5: Consent file reader (Node)

Kept out of `common/` because it touches `fs`, which `common/` must not.

**Files:**
- Create: `packages/cooklang-telemetry/src/node/telemetry-consent-file.ts`

- [ ] **Step 1: Write the implementation**

There is no unit test here: the whole body is a filesystem read whose parsing is already covered by Task 2. Coverage comes from the packaged-build verification in Task 10.

Create `packages/cooklang-telemetry/src/node/telemetry-consent-file.ts`:

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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TELEMETRY_CONSENT_FILE_NAME, parseErrorReportingConsent } from '../common/telemetry-consent';

/**
 * Path of the consent file. Matches the existing convention for
 * `cookbot-auth.json` and `cookcloud-sync.json`.
 */
export function consentFilePath(): string {
    return path.join(os.homedir(), '.theia', TELEMETRY_CONSENT_FILE_NAME);
}

/**
 * Whether error reporting is enabled, read synchronously because Sentry has to
 * be initialized before anything else can throw.
 */
export function readErrorReportingConsent(): boolean {
    let raw: string | undefined;
    try {
        raw = fs.readFileSync(consentFilePath(), 'utf-8');
    } catch {
        raw = undefined;
    }
    return parseErrorReportingConsent(raw);
}

/** Persist the user's choice. Used by the frontend when the preference changes. */
export function writeErrorReportingConsent(enabled: boolean): void {
    const file = consentFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ errorReportingEnabled: enabled }, undefined, 2), 'utf-8');
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: success, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-telemetry/src/node/telemetry-consent-file.ts
git commit -m "feat(telemetry): read and write the consent file"
```

---

## Task 6: Backend process init

The highest-value process: this is where `CookbotLanguageModel` and every other backend service runs. It is a `fork()`ed Node process, so it uses `@sentry/node`, not `@sentry/electron`.

**Files:**
- Create: `packages/cooklang-telemetry/src/node/cooklang-telemetry-backend-module.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/cooklang-telemetry/src/node/cooklang-telemetry-backend-module.ts`:

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

import * as os from 'os';
import * as Sentry from '@sentry/node';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DEV_OVERRIDE_ENV_VAR, buildOptions, shouldInitialize } from '../common/telemetry-options';
import { readErrorReportingConsent } from './telemetry-consent-file';

// Initialized at module load, before any container binding runs, so that an
// error thrown during backend startup is still captured. The forked backend is
// a plain Node process - @sentry/electron does not apply here.
const packaged = !!process.resourcesPath && !(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;

if (shouldInitialize({
    consented: readErrorReportingConsent(),
    packaged,
    devOverride: process.env[DEV_OVERRIDE_ENV_VAR] === '1'
})) {
    const options = buildOptions({
        release: process.env.THEIA_APP_VERSION ?? 'unknown',
        packaged,
        homeDir: os.homedir()
    });
    Sentry.init({
        dsn: options.dsn,
        release: options.release,
        environment: options.environment,
        sendDefaultPii: options.sendDefaultPii,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeSend: event => options.beforeSend(event as any) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeBreadcrumb: breadcrumb => options.beforeBreadcrumb(breadcrumb as any) as any
    });
    Sentry.setTag('processType', 'backend');
}

export default new ContainerModule(() => {
    // No bindings: initialization above is the whole contribution.
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-telemetry/src/node/cooklang-telemetry-backend-module.ts
git commit -m "feat(telemetry): report errors from the forked backend process"
```

---

## Task 7: Electron main process init

**Files:**
- Create: `packages/cooklang-telemetry/src/electron-main/cooklang-telemetry-electron-main-module.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/cooklang-telemetry/src/electron-main/cooklang-telemetry-electron-main-module.ts`:

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

import * as os from 'os';
import * as Sentry from '@sentry/electron/main';
import { app } from '@theia/core/electron-shared/electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { DEV_OVERRIDE_ENV_VAR, buildOptions, shouldInitialize } from '../common/telemetry-options';
import { readErrorReportingConsent } from '../node/telemetry-consent-file';

// The forked backend reads the version from this, so it must be set whether or
// not reporting is enabled.
process.env.THEIA_APP_VERSION ??= app.getVersion();

if (shouldInitialize({
    consented: readErrorReportingConsent(),
    packaged: app.isPackaged,
    devOverride: process.env[DEV_OVERRIDE_ENV_VAR] === '1'
})) {
    const options = buildOptions({
        release: app.getVersion(),
        packaged: app.isPackaged,
        homeDir: os.homedir()
    });
    Sentry.init({
        dsn: options.dsn,
        release: options.release,
        environment: options.environment,
        sendDefaultPii: options.sendDefaultPii,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeSend: event => options.beforeSend(event as any) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeBreadcrumb: breadcrumb => options.beforeBreadcrumb(breadcrumb as any) as any
    });
    Sentry.setTag('processType', 'electron-main');
}

export default new ContainerModule(() => {
    // No bindings: initialization above is the whole contribution.
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/cooklang-telemetry/src/electron-main/cooklang-telemetry-electron-main-module.ts
git commit -m "feat(telemetry): report errors from the Electron main process"
```

---

## Task 8: Preload bridge and renderer init

The renderer forwards events over IPC to the main process. If the main process did not initialize — because the user opted out — the IPC handlers do not exist and renderer events are dropped, which is the behaviour we want.

**Files:**
- Create: `packages/cooklang-telemetry/src/preload/cooklang-telemetry-preload.ts`
- Create: `packages/cooklang-telemetry/src/browser/cooklang-telemetry-frontend-module.ts`

- [ ] **Step 1: Write the preload bridge**

Create `packages/cooklang-telemetry/src/preload/cooklang-telemetry-preload.ts`:

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

// Theia runs the renderer with contextIsolation, so the renderer SDK cannot
// reach Electron IPC on its own. Importing this module installs Sentry's
// bridge on the isolated world. Theia's generated preload.js calls the
// exported `preload` function of every contributed preload module.
import '@sentry/electron/preload';

export function preload(): void {
    // The import above is the entire effect; this export exists because the
    // generated preload.js calls `preload()` on each contributed module.
}
```

- [ ] **Step 2: Write the renderer init**

Create `packages/cooklang-telemetry/src/browser/cooklang-telemetry-frontend-module.ts`:

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

import * as Sentry from '@sentry/electron/renderer';
import { ContainerModule } from '@theia/core/shared/inversify';

// No DSN and no consent check here on purpose: the renderer forwards events
// over IPC to the Electron main process, which holds the DSN and has already
// applied the consent decision. If main did not initialize, these events are
// dropped there.
Sentry.init({});

export default new ContainerModule(() => {
    // Preference binding is added in the next task.
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/cooklang-telemetry/src/preload packages/cooklang-telemetry/src/browser
git commit -m "feat(telemetry): report renderer errors via the preload IPC bridge"
```

---

## Task 9: The opt-out preference

**Files:**
- Create: `packages/cooklang-telemetry/src/browser/telemetry-preferences.ts`
- Create: `packages/cooklang-telemetry/src/browser/telemetry-consent-writer.ts`
- Modify: `packages/cooklang-telemetry/src/browser/cooklang-telemetry-frontend-module.ts`

- [ ] **Step 1: Write the preference schema**

Create `packages/cooklang-telemetry/src/browser/telemetry-preferences.ts`:

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

import { nls } from '@theia/core';
import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

export const ERROR_REPORTING_PREF = 'cooklang.telemetry.errorReporting.enabled';

export const TelemetryPreferencesSchema: PreferenceSchema = {
    properties: {
        [ERROR_REPORTING_PREF]: {
            type: 'boolean',
            title: nls.localize('theia/cooklang-telemetry/errorReporting/title', 'Send Error Reports'),
            description: nls.localize(
                'theia/cooklang-telemetry/errorReporting/description',
                'Send anonymous crash and error reports to help fix problems. '
                + 'Reports never include recipe content, chat messages, file contents or account details; '
                + 'file paths are stripped of your user name. Takes effect after restarting the application.'
            ),
            default: true
        }
    }
};
```

- [ ] **Step 2: Add the RPC contract**

The renderer cannot touch the filesystem, so it goes through a backend service.
Define the contract before the consumer that imports it.

Create `packages/cooklang-telemetry/src/common/telemetry-consent-server.ts`:

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

export const telemetryConsentPath = '/services/cooklang-telemetry-consent';

export const TelemetryConsentServer = Symbol('TelemetryConsentServer');
export interface TelemetryConsentServer {
    setErrorReportingEnabled(enabled: boolean): Promise<void>;
}
```

A symbol plus interface rather than a class: this is a remote service, which is
the documented exception to preferring classes.

- [ ] **Step 3: Write the consent writer service**

Create `packages/cooklang-telemetry/src/browser/telemetry-consent-writer.ts`:

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

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, PreferenceService } from '@theia/core/lib/browser';
import { TelemetryConsentServer } from '../common/telemetry-consent-server';
import { ERROR_REPORTING_PREF } from './telemetry-preferences';

/**
 * Mirrors the preference into the consent file, which is the copy the Electron
 * main and backend processes read at startup - they have no preference service.
 */
@injectable()
export class TelemetryConsentWriter implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(TelemetryConsentServer)
    protected readonly server: TelemetryConsentServer;

    @postConstruct()
    protected init(): void {
        this.preferences.ready.then(() => {
            this.write(this.preferences.get<boolean>(ERROR_REPORTING_PREF, true));
            this.preferences.onPreferenceChanged(event => {
                if (event.preferenceName === ERROR_REPORTING_PREF) {
                    this.write(!!event.newValue);
                }
            });
        });
    }

    protected write(enabled: boolean): void {
        this.server.setErrorReportingEnabled(enabled)
            .catch(error => console.warn('[Telemetry] Failed to persist the error reporting preference:', error));
    }
}
```

- [ ] **Step 4: Implement the backend side and bind both modules**

Create `packages/cooklang-telemetry/src/node/telemetry-consent-server-impl.ts`:

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

import { injectable } from '@theia/core/shared/inversify';
import { TelemetryConsentServer } from '../common/telemetry-consent-server';
import { writeErrorReportingConsent } from './telemetry-consent-file';

@injectable()
export class TelemetryConsentServerImpl implements TelemetryConsentServer {
    async setErrorReportingEnabled(enabled: boolean): Promise<void> {
        writeErrorReportingConsent(enabled);
    }
}
```

Replace the body of `packages/cooklang-telemetry/src/node/cooklang-telemetry-backend-module.ts`'s exported `ContainerModule` with:

```typescript
export default new ContainerModule(bind => {
    bind(TelemetryConsentServerImpl).toSelf().inSingletonScope();
    bind(TelemetryConsentServer).toService(TelemetryConsentServerImpl);
    bind(ConnectionHandler).toDynamicValue(context =>
        new RpcConnectionHandler(telemetryConsentPath, () => context.container.get(TelemetryConsentServer))
    ).inSingletonScope();
});
```

with these added imports at the top of that file:

```typescript
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { TelemetryConsentServer, telemetryConsentPath } from '../common/telemetry-consent-server';
import { TelemetryConsentServerImpl } from './telemetry-consent-server-impl';
```

Replace the exported `ContainerModule` in `packages/cooklang-telemetry/src/browser/cooklang-telemetry-frontend-module.ts` with:

```typescript
export default new ContainerModule(bind => {
    bind(PreferenceContribution).toConstantValue({ schema: TelemetryPreferencesSchema });
    bind(TelemetryConsentServer).toDynamicValue(context =>
        context.container.get(WebSocketConnectionProvider).createProxy<TelemetryConsentServer>(telemetryConsentPath)
    ).inSingletonScope();
    bind(TelemetryConsentWriter).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TelemetryConsentWriter);
});
```

with these added imports:

```typescript
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { TelemetryConsentServer, telemetryConsentPath } from '../common/telemetry-consent-server';
import { TelemetryConsentWriter } from './telemetry-consent-writer';
import { TelemetryPreferencesSchema } from './telemetry-preferences';
```

- [ ] **Step 5: Verify it compiles and lints**

Run: `npx lerna run compile --scope @theia/cooklang-telemetry && npx lerna run lint --scope @theia/cooklang-telemetry`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add packages/cooklang-telemetry/src
git commit -m "feat(telemetry): opt-out preference mirrored to the consent file"
```

---

## Task 10: Bundle, package, and verify for real

Dev-mode success proves nothing about the packaged app. This repo has shipped two bugs of exactly this shape (backend externals, `asarUnpack`), so the acceptance test is a packaged build.

**Files:**
- Modify: `app/webpack.config.js` (only if the bundle check below fails)
- Delete: `sentry` (the scratch file at the repo root)

`electron-builder.yml`'s `asarUnpack` is expected to need **no** change:
`@sentry/electron` declares `@sentry/node-native` as an *optional* peer
dependency, so no native binary is installed and there is nothing to unpack.
Confirm with `find node_modules/@sentry -name '*.node'` — if that prints
anything, the matching path must be added to `asarUnpack`.

- [ ] **Step 1: Remove the scratch file**

```bash
git rm --cached sentry 2>/dev/null || true
rm -f sentry
```

- [ ] **Step 2: Full compile and bundle**

Run: `npm run compile && cd app && npm run bundle && cd ..`
Expected: both succeed. `app/src-gen/frontend/preload.js` now contains a `require(...cooklang-telemetry-preload...)` line — confirm with:

Run: `grep telemetry app/src-gen/frontend/preload.js app/src-gen/backend/*.js`
Expected: the preload module appears in `preload.js`, and the backend module in the backend entry.

If either is missing, the `theiaExtensions` entries in Task 1 are wrong — most likely collapsed into a single entry.

- [ ] **Step 3: Check whether the backend bundle needs externals**

Run: `node -e "require('./app/lib/backend/main.js')" 2>&1 | head -5`
Expected: no `Cannot find module '@sentry/node'` and no error mentioning `require` of a missing file.

If it fails on a dynamic require, add to the `nodeConfig.config.externals` object in `app/webpack.config.js`:

```javascript
    '@sentry/node': 'commonjs @sentry/node',
```

then re-run Step 2 and this step.

- [ ] **Step 4: Verify in development first**

Run: `COOK_TELEMETRY_DEV=1 npm run start:electron`

In the running app, open the Cookbot chat and send a message with the backend unreachable (`COOKBOT_ADDRESS=127.0.0.1:1 COOK_TELEMETRY_DEV=1 npm run start:electron`) to force a backend error.
Expected: the error appears in Sentry under environment `development`, tagged `processType: backend`.

- [ ] **Step 5: Package and verify the release build — the decisive test**

Run: `cd app && npm run package && cd ..`
Install the built artifact from `app/dist/`, launch it, and trigger an error in each process.

Expected in Sentry, all three tagged by `processType`:
- `backend` — a Cookbot request failure
- `electron-main` — startup path
- `renderer` — a UI error

Confirm on at least one event that: no absolute path contains your user name, no `authToken` or bearer value appears, and `extra` contains only allowlisted keys.

- [ ] **Step 6: Verify the opt-out actually stops reporting**

In the packaged app, turn off **Send Error Reports**, quit, relaunch, and trigger the same backend error.
Expected: `~/.theia/cook-telemetry.json` contains `{"errorReportingEnabled": false}`, and no new event arrives in Sentry.

- [ ] **Step 7: Full test suite and lint**

Run: `npm run test:theia && npm run lint`
Expected: both pass. Requires Node >= 22.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(telemetry): wire Sentry into the packaged build"
```

---

## Done when

- Errors from all three processes arrive in Sentry from a **packaged** build.
- Turning the preference off and restarting stops reporting.
- No event contains a user name, credential, recipe content, or chat message.
- `npm run test:theia` and `npm run lint` pass.
