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

## License & Developer Certificate of Origin

Cook Editor is a mixed-licensed codebase. See [NOTICE.md](NOTICE.md) for the
full breakdown, but in short:

- Code in `packages/cooklang*/` (the Cook Editor extensions) is licensed
  under [AGPL-3.0-only](LICENSE-AGPL) **WITH** the
  [cooklang-theia-linking-exception](LICENSES/cooklang-theia-linking-exception.txt).
- Code inherited from Eclipse Theia stays under
  [EPL-2.0](LICENSE-EPL) OR
  [GPL-2.0-only WITH Classpath-exception-2.0](LICENSE-GPL-2.0-ONLY-CLASSPATH-EXCEPTION).

When you contribute, your contribution is licensed under the same license as
the file(s) you're modifying. New files in `packages/cooklang*/` are licensed
under AGPL-3.0 with the linking exception.

### You retain copyright

You keep ownership of your contribution. We are not asking you to assign
copyright.

### Developer Certificate of Origin (DCO)

By submitting a pull request, you certify the [Developer Certificate of
Origin 1.1](https://developercertificate.org/) — i.e. you wrote the
contribution yourself (or have the right to submit it) and you're licensing
it under the project's license as described above.

Sign your commits with `git commit -s` to add a `Signed-off-by` trailer
indicating you agree to the DCO.

### License-back to cook.md

In addition to licensing your contribution under the project's open source
license, you grant cook.md a perpetual, worldwide, non-exclusive, royalty-free
license to use, reproduce, modify, distribute, and sublicense your
contribution under any license terms cook.md chooses.

This lets cook.md continue to use the cooklang-* code in our closed-source
server (cookbot, sync) without the AGPL's network-use clause forcing us to
open-source it. It does **not** affect your ability to use, modify, or
redistribute your own contribution under the AGPL.

If this is unacceptable for your contribution, please say so in the PR and we
can discuss whether the change can be accepted under different terms.
