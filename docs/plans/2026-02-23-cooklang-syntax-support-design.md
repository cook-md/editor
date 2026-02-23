# Built-in Cooklang Syntax & Language Support

**Date:** 2026-02-23
**Status:** Approved

## Goal

Add built-in Cooklang language support to the Theia-based Cooklang editor. Everything ships pre-bundled — no external `cook` CLI dependency for users.

## Architecture

Two new packages:

### `packages/cooklang-native` (NAPI-RS crate)

Rust native Node.js addon using NAPI-RS. Wraps:
- `cooklang` crate — parser, exposing `parse(text) -> Recipe`
- `cooklang-language-server` crate — in-process LSP server via `tower-lsp` on a tokio runtime, communicating over stdio pipes

```
Cargo.toml
src/lib.rs
package.json
```

### `packages/cooklang` (Theia extension)

TypeScript Theia extension providing:
- TextMate grammar for syntax highlighting (from existing cookvscode extension)
- Language configuration (comments, brackets)
- Language server client connecting to the in-process LSP from cooklang-native

```
data/
  cooklang.tmLanguage.json
  language-configuration.json
src/
  browser/                              # Electron renderer
    cooklang-frontend-module.ts
    cooklang-grammar-contribution.ts
  node/                                 # Electron backend
    cooklang-backend-module.ts
    cooklang-language-client.ts
  common/
    index.ts
package.json
tsconfig.json
```

## LSP Flow

All in-process, no external binary:

```
Electron Renderer (browser/)
  Monaco editor opens .cook file
    Language client sends requests via Theia RPC to backend

Electron Backend (node/)
  cooklang-language-client.ts
    calls cooklang-native.startLspServer()
      tokio runtime + tower-lsp on stdio pipes
        completions, diagnostics, hover, symbols, semantic tokens
```

## NAPI-RS API Surface

```rust
#[napi]
fn parse(text: String) -> Result<JsRecipe>;

#[napi]
fn start_lsp_server() -> Result<LspHandle>;
```

The parser is exposed separately for non-editor features (shopping lists, pantry management, etc.).

## Registered Contributions

| Item | Value |
|------|-------|
| Language ID | `cooklang` |
| File extensions | `.cook`, `.menu` |
| TextMate scope | `source.cooklang` |
| Line comment | `--` |
| Block comment | `[- -]` |
| LSP features | completions, diagnostics, hover, document symbols, semantic tokens |

## Build & Distribution

- Electron-only (no browser application target)
- NAPI-RS builds native addon for host platform during `npm install`
- Cross-compilation for distribution via NAPI-RS toolchain
- TextMate grammar and language configuration copied from `../cookvscode`

## Source Material

- `../cookvscode` — VS Code extension with TextMate grammar, language config
- `../cooklang-language-server` — Rust LSP implementation (tower-lsp + cooklang crate)
