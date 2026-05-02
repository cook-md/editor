# Contributing to Cook Editor

Thanks for your interest in Cook Editor. This is a small project — bug reports,
small fixes, and well-scoped feature ideas are all welcome.

## Ways to contribute

### Reporting bugs

[Open an issue](https://github.com/cook-md/editor/issues/new) describing what
you expected to happen and what actually happened. Please include:

- Cook Editor version (Help → About)
- Operating system and version
- A minimal recipe or steps that reproduce the issue
- Any errors visible in **Help → Toggle Developer Tools** → Console

### Requesting features

Open an issue describing the use case. Concrete scenarios ("I want to track
nutrition per recipe so I can plan meals around a calorie target") are much
easier to act on than abstract requests ("add nutrition support").

### Pull requests

For non-trivial changes, please open an issue first to discuss the approach
before investing time in code. This avoids the situation where a PR sits
unmerged because the design conflicts with where the project is heading.

For small fixes — typos, obvious bugs, dependency bumps — feel free to send a
PR directly.

## Development setup

```bash
git clone https://github.com/cook-md/editor.git
cd editor
npm install
cd app && npm run bundle
cd .. && npm run start:electron
```

See [doc/Developing.md](doc/Developing.md) for watch mode, package layout, and
full development workflow. See [CLAUDE.md](CLAUDE.md) for an architectural
overview of the monorepo.

## Coding guidelines

Cook Editor inherits Eclipse Theia's coding conventions:

- See [doc/coding-guidelines.md](doc/coding-guidelines.md) for naming, types,
  imports, dependency injection, and React conventions.
- See [doc/Testing.md](doc/Testing.md) for the test layout and how to run
  tests for individual packages.

A few project-specific points worth calling out:

- Cooklang recipes use **YAML frontmatter** for metadata, not the deprecated
  `>>` syntax. New code that emits or parses metadata must follow this.
- Cook Editor is **Electron-only**. There is no browser target.
- The native Cooklang parser lives in `packages/cooklang-native/` (NAPI-RS,
  Rust). Touching it requires a Rust toolchain.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing to Cook Editor you agree that your contributions will be
licensed under the [Eclipse Public License 2.0](LICENSE-EPL), the same
license as the rest of the project.

You retain copyright on your contributions; the EPL grants the project the
right to distribute and modify them. You're affirming that you wrote the
contribution yourself (or have the right to license it), and that you're
licensing it under EPL-2.0.
