<div align="center">

<img src="https://raw.githubusercontent.com/cook-md/editor/main/.github/assets/splash.png" alt="Cook Editor — plain text recipe manager" width="720" />

# Cook Editor

**A desktop editor for [Cooklang](https://cooklang.org) recipes.**

[![Latest Release](https://img.shields.io/github/v/release/cook-md/editor?include_prereleases&label=release)](https://github.com/cook-md/editor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/cook-md/editor/total)](https://github.com/cook-md/editor/releases)

[Download](#download) · [Features](#features) · [Getting Started](#getting-started) · [Cooklang Spec](https://cooklang.org/docs/spec/)

</div>

---

## What is Cook Editor?

Cook Editor is a native desktop editor for recipes written in [Cooklang](https://cooklang.org) — a human-friendly markup language for cooking. Think of it as an IDE for your cookbook: syntax highlighting, autocomplete, AI assistance, shopping lists, and pantry tracking, all running locally on your machine.

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
| macOS (Apple Silicon) | `Cook-Editor-arm64.dmg` |
| macOS (Intel) | `Cook-Editor-x64.dmg` |
| Windows | `Cook-Editor-Setup.exe` |
| Linux (AppImage) | `Cook-Editor.AppImage` |
| Linux (Debian/Ubuntu) | `Cook-Editor.deb` |

### macOS

1. Download the `.dmg` matching your Mac (Apple Silicon or Intel)
2. Open it and drag **Cook Editor** into your Applications folder
3. On first launch, right-click → **Open** to approve the unsigned build

### Windows

Run `Cook-Editor-Setup.exe` and follow the installer prompts.

### Linux

- **AppImage:** `chmod +x Cook-Editor.AppImage && ./Cook-Editor.AppImage`
- **Debian/Ubuntu:** `sudo dpkg -i Cook-Editor.deb`

## Getting Started

1. Launch Cook Editor
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

Cook Editor registers the `cook://` URI scheme so recipe links from the web open directly in the app.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/cook-md/editor/issues/new).

## License and Attribution

Cook Editor is a derivative work of [Eclipse Theia](https://github.com/eclipse-theia/theia) (v1.70.0 baseline) and is distributed under the Eclipse Public License v. 2.0, with secondary licensing under GPL-2.0-only with Classpath-exception-2.0.

- [LICENSE-EPL](LICENSE-EPL)
- [LICENSE-GPL-2.0-ONLY-CLASSPATH-EXCEPTION](LICENSE-GPL-2.0-ONLY-CLASSPATH-EXCEPTION)
- [NOTICE.md](NOTICE.md) — modification notice, written offer for source code, and third-party attributions

Cooklang-specific additions authored by the Cooklang project (language support, AI integration, branding) are released under MIT.

Cook Editor is **not** an official Eclipse Foundation product and is **not** endorsed by the Eclipse Foundation. "Eclipse" and "Theia" are trademarks of the Eclipse Foundation.

### Source Code

The public Cook Editor source tree is not maintained in this repository. The EPL-2.0 / GPL-2.0-covered portions of Cook Editor are available upon written request for three (3) years from the date you received a given release. Email <alexey@cooklang.org> with subject "Cook Editor source code request" and include the version (shown in **Help → About Cook Editor**).

## Acknowledgements

- [Cooklang](https://cooklang.org) — the recipe markup language Cook Editor is built around
- [Eclipse Theia](https://theia-ide.org) — the editor framework powering Cook Editor
