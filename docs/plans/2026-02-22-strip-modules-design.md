# Cooklang Editor - Module Stripping Design

## Goal

Strip the Theia monorepo (77 packages) down to ~28 packages to create a focused
Cooklang editor. The editor targets Electron desktop deployment with a custom plugin
system (themes, commands, language features, Cooklang-specific APIs) and its own
marketplace.

## Decisions

- **Deployment**: Electron desktop app only (remove browser-only examples)
- **Plugin system**: Keep Theia plugin infrastructure, strip VS Code API surface
  (no debug, terminal, SCM, task, test, notebook APIs). Custom Cooklang API to be
  added later.
- **AI**: Keep ai-core, ai-core-ui, ai-chat, ai-chat-ui. Remove all provider packages.
- **Marketplace**: Keep vsx-registry infrastructure, repoint to own registry later.
- **No VS Code extension compat requirement**: Users publish Cooklang-specific plugins
  to a separate marketplace.

## Packages to Keep (~28)

### Core Infrastructure
- `core` - Application framework, DI, widget system, theming
- `monaco` - Monaco editor integration
- `editor` - Editor abstraction layer
- `editor-preview` - Preview editor tabs
- `filesystem` - File system access
- `workspace` - Workspace management
- `process` - Process spawning (needed by plugin host)
- `electron` - Electron shell integration

### UI
- `navigator` - File explorer
- `outline-view` - Document outline
- `messages` - Notifications/dialogs
- `preferences` - Settings UI
- `keymaps` - Keyboard shortcut management
- `markers` - Problems/diagnostics panel
- `search-in-workspace` - Full-text search
- `file-search` - Quick file open
- `getting-started` - Welcome page (to be customized)
- `output` - Output panel (needed by AI core)
- `toolbar` - Toolbar customization
- `secondary-window` - Multi-window support

### Plugin System
- `plugin` - Plugin API type declarations
- `plugin-ext` - Plugin host + API implementation (to be stripped)
- `plugin-ext-vscode` - VS Code compat layer (to be stripped)
- `plugin-ext-headless` - Headless plugin support

### AI
- `ai-core` - AI agent framework
- `ai-core-ui` - AI settings UI
- `ai-chat` - Chat infrastructure
- `ai-chat-ui` - Chat widget

### Marketplace & Support
- `vsx-registry` - Extension marketplace UI (repoint later)
- `userstorage` - User settings persistence
- `variable-resolver` - Variable substitution (needed by AI core)
- `property-view` - Property inspector

### Dev Packages (all kept - build tooling)
- `application-manager`, `application-package`, `cli`
- `ffmpeg`, `localization-manager`, `native-webpack-plugin`
- `ovsx-client`, `private-eslint-plugin`, `private-ext-scripts`
- `private-re-exports`, `private-test-setup`, `request`

## Packages to Remove (~49)

### Phase 1: Safe Removals (~30 packages, no code changes)

Only requires removing dependencies from the example app and lerna config.

**AI Providers (19):**
- ai-anthropic, ai-claude-code, ai-code-completion, ai-codex, ai-copilot
- ai-editor, ai-google, ai-history, ai-hugging-face, ai-ide
- ai-llamafile, ai-mcp, ai-mcp-server, ai-mcp-ui, ai-ollama
- ai-openai, ai-scanoss, ai-terminal, ai-vercel-ai

**Git/SCM (3):**
- git, scm-extra, timeline

**Dev/Meta (9):**
- collaboration, remote, remote-wsl, dev-container
- plugin-dev, plugin-metrics, metrics, memory-inspector, scanoss

**Examples (4):**
- api-samples, api-provider-sample, browser-only, playwright

### Phase 2: Requires Decoupling from plugin-ext (~19 packages)

These packages are currently dependencies of `plugin-ext`. Removing them requires
modifying plugin-ext to make these dependencies optional or removing the
corresponding API surface.

**Debug/Console (2):** debug, console
**Terminal (3):** terminal, terminal-manager, external-terminal
**Task (1):** task
**Test (1):** test
**Notebook (1):** notebook
**SCM (1):** scm
**Code Navigation (2):** callhierarchy, typehierarchy
**Other (4):** bulk-edit, mini-browser, preview

For each removed API surface in plugin-ext:
- Remove the `*Main` implementation
- Remove the `*Ext` implementation or stub it with no-ops
- Remove the proxy identifiers from plugin-api-rpc.ts
- Remove exports from plugin-context.ts API factory

### Phase 3: Create Cooklang Electron App

- Replace `examples/browser` with `examples/cooklang-editor` (Electron-based)
- Minimal dependency set referencing only kept packages
- Custom branding and welcome page

## Risks

- **plugin-ext decoupling (Phase 2)**: This is the riskiest part. The API surfaces
  are intertwined. Careful incremental removal with testing at each step.
- **Upstream merge difficulty**: After these changes, merging upstream Theia updates
  becomes harder. This is acceptable since this is a closed-source fork.
- **Hidden dependencies**: Some packages may have runtime dependencies not declared
  in package.json (e.g. via dynamic imports or contribution points).
