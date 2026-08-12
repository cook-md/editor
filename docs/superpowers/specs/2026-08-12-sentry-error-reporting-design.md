# Sentry Error Reporting — Design

**Date:** 2026-08-12
**Status:** Approved by user (brainstorming session)

## Goal

Report unhandled errors from the packaged Cook Editor to Sentry, so that a user
report is diagnosable without the reporter having to reproduce the failure or a
maintainer having to read server source.

Reporting is **on by default** with a preference to disable it (opt-out).

## Background

- The editor currently has **no error reporting of any kind**: no Sentry, no crash
  reporter, no telemetry, and no persisted backend log. `~/.theia/logs/<timestamp>/`
  is created but never written to, and a Finder-launched app sends `console.error`
  to a stdout nobody captures (issue #88).
- This has already cost real diagnosis time. Issue #86 (`Cookbot is busy right now`)
  was only resolved by reading the cookbot server source in a sibling checkout to
  find the single `Status::resource_exhausted("quota_exhausted")` site.
- Every other component in the org already reports to Sentry: the cookbot server
  (`sentry = "0.46"`, non-optional), the cookbot TUI (optional feature), and the
  cook.md Rails app (`RAILS_SENTRY_DSN`). Sentry org `o4506865729404928`.
- Server-side Sentry would **not** have caught #86: a quota rejection is an expected
  business outcome returned as a `tonic::Status`, never an exception. The gap is
  specifically client-side.
- A Sentry project for the editor already exists, DSN:
  `https://0ab1ee49571b67c4c8fc0384f31d77ce@o4506865729404928.ingest.us.sentry.io/4511898607091712`

## Non-goals

Deliberately excluded (YAGNI):

- Performance tracing, session replay, profiling.
- Sending account identity (`Sentry.setUser`). See "User identity" below.
- Live toggling of the preference without a restart.
- Replacing the missing backend file log — issue #88 also proposes persisting logs,
  which solves a different half of the problem and is tracked separately.

## Architecture

The Electron app runs **three separate processes**, and they need different SDKs:

| Process | How it starts | SDK |
| --- | --- | --- |
| Electron main | `app/src-gen/backend/electron-main.js` | `@sentry/electron/main` |
| Renderer | `app/src-gen/frontend/index.js` | `@sentry/electron/renderer` |
| Backend | `fork()`ed by `ElectronMainApplication.startBackend()` (`electron-main-application.ts:738`) | **`@sentry/node`** |

The forked backend is a plain Node child process, not the Electron main process, so
`@sentry/electron` does not cover it. This is the process where `CookbotLanguageModel`
and every other backend service runs — the errors this work exists to capture.

Under Theia's `contextIsolation`, the renderer SDK needs Sentry's IPC bridge installed
in the preload script. `theiaExtensions` supports a `preload` entry
(`dev-packages/application-package/src/extension-package.ts:32`), composed into the
generated `app/src-gen/frontend/preload.js`.

### Package layout

New package `packages/cooklang-telemetry/` (`@theia/cooklang-telemetry`):

```
src/common/scrub.ts            # payload scrubbing, pure, unit-tested
src/common/telemetry-consent.ts # reads/writes the opt-out flag file
src/electron-main/…            # @sentry/electron/main init
src/preload/…                  # @sentry/electron/preload bridge
src/browser/…                  # @sentry/electron/renderer init + preference schema
src/node/…                     # @sentry/node init
```

`theiaExtensions` uses **one entry per target**:

```json
[
  { "electronMain": "lib/electron-main/cooklang-telemetry-electron-main-module" },
  { "preload": "lib/preload/cooklang-telemetry-preload" },
  { "frontend": "lib/browser/cooklang-telemetry-frontend-module" },
  { "backend": "lib/node/cooklang-telemetry-backend-module" }
]
```

Separate entries are required: targets declared in the *same* entry replace rather
than merge, which previously caused a silently dropped `frontend` module.

## Consent model

Opt-out. Preference `cooklang.telemetry.errorReporting.enabled`, default `true`,
declared with the usual `PreferenceContribution` schema (pattern:
`packages/cooklang-ai/src/browser/file-tools/workspace-preferences.ts`).

Sentry must initialise before the preference service exists, and two of the three
processes have no preference service at all. So the flag is mirrored to a file:

- `~/.theia/cook-telemetry.json`, matching the existing convention for
  `cookbot-auth.json` and `cookcloud-sync.json` (`auth-service.ts:327`).
- Contents: `{ "errorReportingEnabled": boolean }`.
- Each process reads it **synchronously** at init. A missing or unreadable file means
  enabled, consistent with opt-out.
- The frontend writes the file when the preference changes.

Because each process reads the file only at startup, a change takes effect **after a
restart**. The preference description says so explicitly. Propagating a live toggle
across three processes is not worth the machinery for v1.

## Scrubbing

The whole payload is filtered before it leaves the machine. This is a recipe editor
holding personal content, so the default posture is to send nothing that is not
demonstrably safe.

`Sentry.init` uses `sendDefaultPii: false` in every process, plus shared
`beforeSend` / `beforeBreadcrumb` hooks from `src/common/scrub.ts`:

1. **Home directory → `~`.** Absolute paths contain the OS username. Applied to
   exception values, breadcrumb messages, stack frame filenames, and string-valued
   `extra`.
2. **Redact secrets.** Keys matching `authToken`, `Authorization`, `sessionId`,
   `token`, `password`, and bearer-shaped values are replaced with `[redacted]`.
   `CookbotGrpcClient` holds a live auth token, so this is not hypothetical.
3. **Allowlist `extra` and `contexts`.** Anything not explicitly allowed is dropped,
   so recipe text, chat prompts, and file contents cannot ride along in a field
   nobody anticipated.
4. **No request bodies.**

`scrub.ts` is pure and has no Sentry dependency in its signature, so it is unit
tested directly against representative event shapes.

### User identity

`Sentry.setUser` is **not** called. Attaching the cook.md account id would allow
correlating an editor error with the server-side Sentry project, which is genuinely
useful — but it turns anonymous crash data into per-user records, which is a
different privacy commitment than "we collect errors". Revisit as its own decision.

## Configuration

- **DSN** hardcoded. Consistent with cook.md, whose compose file notes a DSN is
  write-only and not a secret.
- **release**: the app version from `app/package.json`.
- **environment**: `production` when packaged, `development` otherwise, using the
  same `resourcesPath`/`defaultApp` check `CookbotGrpcClient.connect()` already uses
  to pick its server address.
- Sentry is **not** initialised in development unless `COOK_TELEMETRY_DEV=1`, so
  local work does not pollute the project.

## Packaging

Two known hazards in this repo, both of which produce "works in dev, broken in the
`.dmg`":

- `app/webpack.config.js` externalises backend dependencies that use dynamic
  `require` (`@grpc/*`, `protobufjs`). Sentry's Node SDK is checked for the same need
  and externalised if required.
- `electron-builder.yml` `asarUnpack` must cover any native binary Sentry ships.

Neither can be confirmed by reasoning; see verification.

## Testing

- **Unit** (`src/common/scrub.spec.ts`): home-directory rewriting across each event
  field, secret redaction including nested objects, `extra` allowlisting, and that a
  realistic `CookbotGrpcClient` error carrying an `authToken` comes out clean.
- **Unit** (`src/common/telemetry-consent.spec.ts`): missing file means enabled,
  malformed file means enabled, explicit `false` means disabled.
- **Verification in a packaged build** — the decisive step. Build the `.dmg`, install
  it, trigger a deliberate error in each of the three processes, and confirm all three
  arrive in Sentry with scrubbed payloads. Dev-mode success proves nothing about the
  packaged bundle, per the packaging hazards above.

## Risks

- **The backend is the process most likely to break.** It is bundled by a separate
  webpack config and is where the externals hazard lives. If only one process can be
  made to work, this is the one that matters.
- **Scrubbing is the correctness-critical part.** A miss leaks user content to a third
  party, and unlike a normal bug it cannot be undone after the fact. Hence the
  allowlist rather than a denylist.
- **`@sentry/electron` and Theia's renderer.** Theia has a non-standard renderer boot
  (generated `index.js`, custom preload). If the preload bridge does not work, the
  renderer can fall back to `@sentry/browser` reporting over HTTP.
