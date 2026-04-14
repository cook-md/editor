<div align="center">

<img src="https://raw.githubusercontent.com/cook-md/editor/main/.github/assets/logo.svg" alt="CookEd" width="200" />

# CookEd

**A desktop editor for [Cooklang](https://cooklang.org) recipes.**

[![Latest Release](https://img.shields.io/github/v/release/cook-md/editor?include_prereleases&label=release)](https://github.com/cook-md/editor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/cook-md/editor/total)](https://github.com/cook-md/editor/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

[Download](#download) · [Features](#features) · [Getting Started](#getting-started) · [Cooklang Spec](https://cooklang.org/docs/spec/)

</div>

---

## What is CookEd?

CookEd is a native desktop editor for recipes written in [Cooklang](https://cooklang.org) — a human-friendly markup language for cooking. Think of it as an IDE for your cookbook: syntax highlighting, autocomplete, AI assistance, shopping lists, and pantry tracking, all running locally on your machine.

## Features

- **Syntax highlighting & autocomplete** for ingredients, cookware, and recipe metadata
- **AI recipe assistant** — scale, convert, rewrite, and draft recipes with an LLM
- **Shopping list generation** from one or many recipes
- **Pantry tracking** and ingredient inventory
- **Full-text search** across your recipe library
- **Cross-platform** — macOS (Apple Silicon + Intel), Windows, and Linux
- **Offline-first** — your recipes stay on your machine; optional cloud sync available

## Download

Grab the latest build for your platform from the [Releases page](https://github.com/cook-md/editor/releases/latest):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `CookEd.dmg` (arm64) |
| macOS (Intel) | `CookEd.dmg` (x64) |
| Windows | `CookEdSetup.exe` |
| Linux (AppImage) | `CookEd.AppImage` |
| Linux (Debian/Ubuntu) | `CookEd.deb` |

### macOS

1. Download the `.dmg` matching your Mac (Apple Silicon or Intel)
2. Open it and drag **CookEd** into your Applications folder
3. On first launch, right-click → **Open** to approve the unsigned build

### Windows

Run `CookEdSetup.exe` and follow the installer prompts.

### Linux

- **AppImage:** `chmod +x CookEd.AppImage && ./CookEd.AppImage`
- **Debian/Ubuntu:** `sudo dpkg -i CookEd.deb`

## Getting Started

1. Launch CookEd
2. Open a folder containing your `.cook` files (or start a new one)
3. Create `my-recipe.cook` and try:

   ```cook
   ---
   servings: 4
   tags: [weeknight, pasta]
   ---

   Boil a pot of water with @salt{1%tbsp}.
   Cook @spaghetti{400%g} in the #pot until al dente.
   Toss with @olive oil{2%tbsp} and serve.
   ```

4. Open the command palette (`Cmd/Ctrl + Shift + P`) to explore shopping lists, AI assistance, and more.

Learn the language at **[cooklang.org/docs/spec](https://cooklang.org/docs/spec/)**.

## URI Scheme

CookEd registers the `cook://` URI scheme so recipe links from the web open directly in the app.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/cook-md/editor/issues/new).

## License

CookEd is released under the [MIT License](LICENSE). Built on top of [Eclipse Theia](https://theia-ide.org) (EPL-2.0 / GPL-2.0 with Classpath exception).

## Acknowledgements

- [Cooklang](https://cooklang.org) — the recipe markup language CookEd is built around
- [Eclipse Theia](https://theia-ide.org) — the editor framework powering CookEd
