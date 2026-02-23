# Cooklang Built-in Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in Cooklang syntax highlighting and language server support to the Electron-only Theia app, with no external dependencies for users.

**Architecture:** Two new packages: `packages/cooklang` (Theia extension with TextMate grammar + LSP client) and `packages/cooklang-native` (NAPI-RS crate wrapping the cooklang parser and language server). Phase 1 delivers syntax highlighting, Phase 2 the native addon, Phase 3 wires them together.

**Tech Stack:** TypeScript, InversifyJS (DI), TextMate grammars, NAPI-RS, Rust (cooklang + tower-lsp crates)

**Design doc:** `docs/plans/2026-02-23-cooklang-syntax-support-design.md`

---

## Phase 1: Syntax Highlighting (packages/cooklang)

### Task 1: Create package scaffolding

**Files:**
- Create: `packages/cooklang/package.json`
- Create: `packages/cooklang/tsconfig.json`
- Create: `packages/cooklang/src/common/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@theia/cooklang",
  "version": "1.68.0",
  "description": "Theia - Cooklang Language Support",
  "dependencies": {
    "@theia/core": "1.68.0",
    "@theia/monaco": "1.68.0",
    "@theia/monaco-editor-core": "1.96.302",
    "tslib": "^2.6.2"
  },
  "main": "lib/common",
  "theiaExtensions": [
    {
      "frontend": "lib/browser/cooklang-frontend-module"
    }
  ],
  "keywords": [
    "theia-extension"
  ],
  "license": "MIT",
  "files": [
    "data",
    "lib",
    "src"
  ],
  "scripts": {
    "build": "theiaext build",
    "clean": "theiaext clean",
    "compile": "theiaext compile",
    "lint": "theiaext lint",
    "test": "theiaext test",
    "watch": "theiaext watch"
  },
  "devDependencies": {
    "@theia/ext-scripts": "1.68.0"
  }
}
```

**Step 2: Create tsconfig.json**

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
    { "path": "../monaco" }
  ]
}
```

**Step 3: Create src/common/index.ts**

```typescript
export const COOKLANG_LANGUAGE_ID = 'cooklang';
export const COOKLANG_TEXTMATE_SCOPE = 'source.cooklang';
```

**Step 4: Commit**

```bash
git add packages/cooklang/
git commit -m "feat(cooklang): scaffold cooklang extension package"
```

---

### Task 2: Copy grammar and language configuration from cookvscode

**Files:**
- Create: `packages/cooklang/data/cooklang.tmLanguage.json` (copy from `../cookvscode/syntaxes/cooklang.tmLanguage.json`)
- Create: `packages/cooklang/data/language-configuration.json` (copy from `../cookvscode/language-configuration.json`)

**Step 1: Copy the TextMate grammar**

Copy `../cookvscode/syntaxes/cooklang.tmLanguage.json` to `packages/cooklang/data/cooklang.tmLanguage.json`. No modifications needed.

**Step 2: Copy the language configuration**

Copy `../cookvscode/language-configuration.json` to `packages/cooklang/data/language-configuration.json`. No modifications needed.

**Step 3: Commit**

```bash
git add packages/cooklang/data/
git commit -m "feat(cooklang): add TextMate grammar and language configuration"
```

---

### Task 3: Create grammar contribution class

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-grammar-contribution.ts`

**Step 1: Write the grammar contribution**

Follow the pattern from `packages/ai-core/src/browser/prompttemplate-contribution.ts`:

```typescript
import { injectable } from '@theia/core/shared/inversify';
import {
    GrammarDefinition,
    GrammarDefinitionProvider,
    LanguageGrammarDefinitionContribution,
    TextmateRegistry
} from '@theia/monaco/lib/browser/textmate';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE } from '../common';

@injectable()
export class CooklangGrammarContribution implements LanguageGrammarDefinitionContribution {

    readonly config: monaco.languages.LanguageConfiguration = {
        comments: {
            lineComment: '--'
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' }
        ]
    };

    registerTextmateLanguage(registry: TextmateRegistry): void {
        monaco.languages.register({
            id: COOKLANG_LANGUAGE_ID,
            aliases: ['Cooklang', 'cooklang'],
            extensions: ['.cook', '.menu'],
            filenames: []
        });

        monaco.languages.setLanguageConfiguration(COOKLANG_LANGUAGE_ID, this.config);

        const grammar = require('../../data/cooklang.tmLanguage.json');
        const grammarDefinitionProvider: GrammarDefinitionProvider = {
            getGrammarDefinition(): Promise<GrammarDefinition> {
                return Promise.resolve({
                    format: 'json',
                    content: grammar
                });
            }
        };

        registry.registerTextmateGrammarScope(COOKLANG_TEXTMATE_SCOPE, grammarDefinitionProvider);
        registry.mapLanguageIdToTextmateGrammar(COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE);
    }
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-grammar-contribution.ts
git commit -m "feat(cooklang): add grammar contribution for syntax highlighting"
```

---

### Task 4: Create frontend DI module

**Files:**
- Create: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Write the frontend module**

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';

export default new ContainerModule(bind => {
    bind(CooklangGrammarContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(CooklangGrammarContribution);
});
```

**Step 2: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): add frontend DI module"
```

---

### Task 5: Register in Electron example app

**Files:**
- Modify: `examples/electron/package.json` — add `"@theia/cooklang": "1.68.0"` to dependencies

**Step 1: Add dependency**

Add `"@theia/cooklang": "1.68.0"` to the `dependencies` object in `examples/electron/package.json`.

**Step 2: Commit**

```bash
git add examples/electron/package.json
git commit -m "feat(cooklang): register cooklang extension in electron app"
```

---

### Task 6: Build and verify syntax highlighting

**Step 1: Install dependencies**

```bash
npm install
```

**Step 2: Compile the cooklang package**

```bash
npx lerna run compile --scope @theia/cooklang
```

Expected: Compiles without errors.

**Step 3: Build the electron app**

```bash
cd examples/electron && npm run build
```

Expected: Builds successfully with the cooklang extension included.

**Step 4: Start and verify**

```bash
cd examples/electron && npm run start
```

Open a `.cook` file. Verify syntax highlighting works for ingredients (`@`), equipment (`#`), timers (`~`), comments (`--`, `[- -]`), metadata (`>>`), sections (`=`).

**Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(cooklang): fix build issues from integration"
```

---

## Phase 2: NAPI-RS Native Addon (packages/cooklang-native)

### Task 7: Initialize NAPI-RS project

**Files:**
- Create: `packages/cooklang-native/Cargo.toml`
- Create: `packages/cooklang-native/src/lib.rs`
- Create: `packages/cooklang-native/package.json`
- Create: `packages/cooklang-native/build.rs` (if needed by napi-rs)
- Create: `packages/cooklang-native/.cargo/config.toml` (if needed)

**Step 1: Initialize using napi-rs CLI**

```bash
cd packages && npx @napi-rs/cli new cooklang-native --platform
```

Select targets: darwin-arm64, darwin-x64, linux-x64-gnu (adjust for your needs).

If the CLI doesn't work well inside the monorepo, manually create the files:

**Step 2: Create Cargo.toml**

```toml
[package]
name = "cooklang-native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["full"] }
napi-derive = "2"
cooklang = "0.17"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
```

**Step 3: Create build.rs**

```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```

**Step 4: Create src/lib.rs with parser binding**

```rust
use napi_derive::napi;

#[napi]
pub fn parse(input: String) -> napi::Result<String> {
    let result = cooklang::parse(&input);
    serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}
```

Note: The exact API of the `cooklang` crate v0.17 will determine the precise implementation. Check `cooklang-language-server/Cargo.toml` for the version and `cooklang-language-server/src/document.rs` for usage patterns.

**Step 5: Create package.json**

```json
{
  "name": "@theia/cooklang-native",
  "version": "1.68.0",
  "description": "Cooklang native bindings via NAPI-RS",
  "main": "index.js",
  "napi": {
    "name": "cooklang-native",
    "triples": {}
  },
  "license": "MIT",
  "scripts": {
    "build": "napi build --release",
    "build:debug": "napi build"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2.18.0"
  }
}
```

**Step 6: Build and verify**

```bash
cd packages/cooklang-native && npm run build
```

Expected: Produces a `.node` native addon file.

**Step 7: Commit**

```bash
git add packages/cooklang-native/
git commit -m "feat(cooklang-native): initialize NAPI-RS crate with parser binding"
```

---

### Task 8: Add LSP server binding to NAPI-RS

**Files:**
- Modify: `packages/cooklang-native/Cargo.toml` — add tower-lsp, tokio, cooklang-language-server deps
- Modify: `packages/cooklang-native/src/lib.rs` — add `start_lsp_server()` function

**Step 1: Add dependencies to Cargo.toml**

Add to `[dependencies]`:
```toml
tower-lsp = "0.20"
tokio = { version = "1", features = ["full"] }
cooklang-language-server = { path = "../../../cooklang-language-server" }
```

**Step 2: Implement start_lsp_server**

The LSP server needs to communicate via streams that Node.js can read/write. Use tokio channels piped to Node.js readable/writable streams, or spawn a thread that runs the tower-lsp server on in-memory pipes.

```rust
use std::thread;
use std::process::{Command, Stdio};

#[napi(object)]
pub struct LspHandle {
    // The approach here depends on how we bridge tokio stdio with Node.js streams.
    // Option A: Use OS pipes (simplest)
    // Option B: Use napi ThreadsafeFunction for callbacks
}

#[napi]
pub fn start_lsp_server() -> napi::Result<LspHandle> {
    // Implementation will depend on the bridging approach chosen.
    // See Phase 3 Task 9 for the integration pattern.
    todo!()
}
```

Note: The exact implementation of the Node.js <-> Rust stream bridge will need experimentation. The simplest approach may be to create OS pipes and pass the file descriptors to Node.js.

**Step 3: Build and verify**

```bash
cd packages/cooklang-native && npm run build
```

**Step 4: Commit**

```bash
git add packages/cooklang-native/
git commit -m "feat(cooklang-native): add LSP server binding"
```

---

## Phase 3: LSP Integration

### Task 9: Create backend module with language client

**Files:**
- Create: `packages/cooklang/src/node/cooklang-backend-module.ts`
- Create: `packages/cooklang/src/node/cooklang-language-client.ts`
- Modify: `packages/cooklang/package.json` — add backend module to theiaExtensions, add cooklang-native dependency

**Step 1: Update package.json**

Add `"@theia/cooklang-native": "1.68.0"` to dependencies. Update theiaExtensions:

```json
"theiaExtensions": [
    {
        "frontend": "lib/browser/cooklang-frontend-module",
        "backend": "lib/node/cooklang-backend-module"
    }
]
```

**Step 2: Create cooklang-language-client.ts**

This service starts the in-process LSP server from the native addon and creates a language client connection. The exact implementation depends on Theia's language client infrastructure and how the NAPI-RS LSP bridge works (from Task 8).

Reference: Check how Theia's existing language clients work in `packages/plugin-ext/src/main/browser/languages-main.ts` and the `vscode-languageclient` patterns.

**Step 3: Create cooklang-backend-module.ts**

```typescript
import { ContainerModule } from '@theia/core/shared/inversify';
// Bind the language client service

export default new ContainerModule(bind => {
    // Bindings for the LSP client will go here
});
```

**Step 4: Build and verify**

```bash
npx lerna run compile --scope @theia/cooklang
```

**Step 5: Commit**

```bash
git add packages/cooklang/
git commit -m "feat(cooklang): add backend module with LSP client integration"
```

---

### Task 10: End-to-end verification

**Step 1: Full rebuild**

```bash
npm install && npm run compile
cd examples/electron && npm run build
```

**Step 2: Verify all features**

Start the Electron app and open a `.cook` file. Verify:
- Syntax highlighting works (colors for `@ingredients`, `#equipment`, `~timers`, comments, metadata, sections)
- Completions appear when typing `@`, `#`, `~`
- Diagnostics show for syntax errors
- Hover shows ingredient/equipment details
- Document outline shows recipe structure

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(cooklang): complete built-in Cooklang support with syntax highlighting and LSP"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update to reflect Electron-only target**

Update the Development Commands section to remove browser references and add:
- Clarify this is an Electron-only application
- Add cooklang-specific build commands
- Note the NAPI-RS native addon build requirement

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Electron-only target and Cooklang packages"
```
