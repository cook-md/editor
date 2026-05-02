# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **fork of Eclipse Theia** used to build a full-fledged **Cooklang editor** — a desktop application similar to Obsidian but focused on recipe management using the [Cooklang](https://cooklang.org/) markup language.

**Main goals:**
- Syntax highlighting for Cooklang (.cook files)
- Autocomplete for ingredients, cookware, and recipe metadata
- AI assistance for recipe writing and editing
- Shopping list generation from recipes
- Pantry management
- Reports and analytics (cost, nutrition, meal planning)

## Target Platform

This is an **Electron-only** application. There is no browser target. Only `app/` is used.

## Development Commands

**Essential commands:**
- `npm install` - Install dependencies, create workspace symlinks, run post-install hooks
- `npm run compile` - Compile TypeScript packages only
- `npm run lint` - Run ESLint across all packages
- `npm run test` - Run all tests

**Electron application:**
- `cd app && npm run bundle` - Build/rebuild the Electron app (regenerates src-gen/ files)
- `npm run start:electron` - Start electron application
- `npm run watch` - Watch mode for development

**Cooklang-specific:**
- `npx lerna run compile --scope @theia/cooklang` - Compile the Cooklang extension
- `cd packages/cooklang-native && cargo build` - Build the NAPI-RS native addon (Rust)
- `cd packages/cooklang-native && npm run build` - Build native addon for Node.js (requires @napi-rs/cli)

**Package-specific (using lerna):**
- `npx lerna run compile --scope @theia/package-name` - Build specific package
- `npx lerna run test --scope @theia/package-name` - Test specific package
- `npx lerna run watch --scope @theia/package-name --include-filtered-dependencies --parallel` - Watch package with dependencies

## Architecture

**Monorepo Structure:**
- Lerna-managed monorepo with 80+ packages
- `/packages/` - Runtime packages (core + extensions)
- `/dev-packages/` - Development tooling
- `/app/` - The Cook Editor Electron application (only runtime target)

**Platform-specific code organization:**
- `package-name/src/common/*` - Basic JavaScript APIs, runs everywhere
- `package-name/src/browser/*` - Browser/DOM APIs
- `package-name/src/node/*` - Node.js APIs  
- `package-name/src/electron-browser/*` - Electron renderer process
- `package-name/src/electron-main/*` - Electron main process

**Extension System:**
- Dependency Injection via InversifyJS (property injection preferred)
- Contribution Points pattern for extensibility
- Three extension types: Theia extensions (build-time), VS Code extensions (runtime), Theia plugins (runtime)
- `theiaExtensions` in package.json defines module entry points

## Key Patterns

For more information also look at:
- @doc/coding-guidelines.md
- @doc/Testing.md
- @doc/Plugin-API.md (VS Code extension plugin API)

**Code Style:**
- 4 spaces indentation, single quotes, undefined over null
- PascalCase for types/enums, camelCase for functions/variables
- Arrow functions preferred, explicit return types required
- Property injection over constructor injection

**File Naming:**
- kebab-case for files (e.g., `document-provider.ts`)
- File name matches main exported type
- Platform folders follow strict dependency rules

**Architecture Patterns:**
- Main-Ext pattern for plugin API (browser Main ↔ plugin host Ext)
- Services as classes with DI, avoid exported functions
- ContributionProvider instead of @multiInject
- URI strings for cross-platform file paths, never raw paths

**Testing:**
- Unit tests: `*.spec.ts`
- UI tests: `*.ui-spec.ts`
- Slow tests: `*.slow-spec.ts`

## Technical Requirements

- Node.js ≥18.17.0, <21
- TypeScript ~5.4.5 with strict settings
- React 18.2.0 for UI components
- Monaco Editor for code editing

**Key Technologies:**
- Express.js for backend HTTP server
- InversifyJS for dependency injection
- Lerna for monorepo management
- Webpack for application bundling
- NAPI-RS for Rust native Node.js addons

## Cooklang Packages

- `packages/cooklang/` - Theia extension providing Cooklang language support (TextMate grammar + LSP client)
- `packages/cooklang-native/` - NAPI-RS crate wrapping Rust cooklang parser and language server

**Adding a new package to the monorepo:**
1. Create `packages/foo/package.json` with `theiaExtensions`
2. Create `packages/foo/tsconfig.json` with project references
3. Add `"@theia/foo": "1.70.0"` to `app/package.json` dependencies
4. Add `{ "path": "../packages/foo" }` to `app/tsconfig.json` references
5. Run `npm install` to create workspace symlink
6. Run `cd app && npm run bundle` to regenerate `src-gen/` files
