<div align="center">
  <img src="app/resources/icon-256.png" alt="Cook Editor" width="128" height="128" />
  <h1>Cook Editor</h1>
  <p><strong>An Obsidian-style desktop editor for <a href="https://cooklang.org/">Cooklang</a> recipes.</strong></p>
</div>

Cook Editor is a desktop application for writing, organizing, and cooking from
recipes written in [Cooklang](https://cooklang.org/) — a plain-text markup
language for recipes. It gives you syntax highlighting, ingredient and cookware
autocomplete, a recipe view, shopping lists generated straight from your
menus, pantry tracking, and AI assistance for drafting and editing recipes.

It's built on [Eclipse Theia](https://theia-ide.org/), which means it inherits
a familiar, VS Code-like editing experience and a battle-tested extension
system.

## Downloads

Pre-built binaries for each release are published on the
[Releases page](https://github.com/cook-md/editor/releases).

| Platform | Artifact | Notes |
| --- | --- | --- |
| macOS (Apple silicon) | `Cook-Editor-arm64.dmg` | Signed & notarized |
| macOS (Intel) | `Cook-Editor-x64.dmg` | Signed & notarized |
| Windows | `Cook-Editor-Setup.exe` | NSIS installer |
| Windows (portable) | `Cook-Editor-*.zip` | Extract anywhere, no install required |
| Debian / Ubuntu | `Cook-Editor.deb` | Recommended on Debian-based distros |
| Fedora / RHEL / SUSE | `Cook-Editor.rpm` | Recommended on RPM-based distros |
| Linux (any distro) | `Cook-Editor.AppImage` | See sandbox note below |
| Linux (portable) | `Cook-Editor.tar.gz` | Extract anywhere, no install required |

### Linux — AppImage and the Chromium sandbox

If you launch the AppImage and see:

```
FATAL: The SUID sandbox helper binary was found, but is not configured correctly.
```

…you've hit a structural limitation of the AppImage format on modern kernels
(Ubuntu 24.04+, Debian 12+, Fedora 40+): AppImages mount with `nosuid`, which
strips the SUID bit Chromium needs for its sandbox.

Pick whichever workaround fits:

1. **Install via `.deb` or `.rpm` instead** — the package installer sets
   `chrome-sandbox` permissions correctly. This is the recommended path on
   supported distros.
2. **Enable unprivileged user namespaces** (system-wide):
   ```bash
   sudo sysctl kernel.unprivileged_userns_clone=1
   ```
3. **Run with `--no-sandbox`** (reduces security):
   ```bash
   ./Cook-Editor.AppImage --no-sandbox
   ```

## Build from source

```bash
git clone https://github.com/cook-md/editor.git
cd editor
npm install
cd app && npm run bundle
cd .. && npm run start:electron
```

For development workflow, watch mode, and package layout, see
[doc/Developing.md](doc/Developing.md). For coding conventions and how the
monorepo is organized, see [CLAUDE.md](CLAUDE.md) and
[doc/coding-guidelines.md](doc/coding-guidelines.md).

Requires Node.js ≥18.17.0, <21. Building the native Cooklang addon requires a
working Rust toolchain.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, feature ideas, and pull
requests are all welcome — please open an issue first for non-trivial changes.

## License

Cook Editor is released under the [Eclipse Public License 2.0](LICENSE-EPL),
with portions under the [GPL-2.0 with Classpath Exception](LICENSE-GPL-2.0-ONLY-CLASSPATH-EXCEPTION)
as documented in [NOTICE.md](NOTICE.md).

This project is a fork of [Eclipse Theia](https://github.com/eclipse-theia/theia),
also licensed under EPL-2.0. See [NOTICE.md](NOTICE.md) for upstream
attribution and the source-code offer required by the EPL.

"Eclipse Theia" is a trademark of the Eclipse Foundation. Cook Editor is not
affiliated with or endorsed by the Eclipse Foundation.
