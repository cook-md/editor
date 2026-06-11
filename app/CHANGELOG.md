# Changelog

## [0.1.0-alpha.23](https://github.com/cook-md/editor/compare/v0.1.0-alpha.22...v0.1.0-alpha.23) (2026-06-11)


### Features

* **cooklang-native:** add renderReport via cooklang-reports crate ([99fa1f5](https://github.com/cook-md/editor/commit/99fa1f5780f8adb0378b880cac1f6e4d46ad34b1))
* **cooklang:** add built-in report templates and template-file helpers ([2d6dbc8](https://github.com/cook-md/editor/commit/2d6dbc8047633f7c66079b05036d0b977fc7c636))
* **cooklang:** add Render Report command with template QuickPick ([47f6a65](https://github.com/cook-md/editor/commit/47f6a6574de8835d3309f3818012b124f8bef22f))
* **cooklang:** add renderReport RPC to CooklangLanguageService ([cc937b1](https://github.com/cook-md/editor/commit/cc937b1392d9251fe080be46e4ed5ae0da310ab2))
* **cooklang:** add ReportWidget rendering report output as markdown ([749d240](https://github.com/cook-md/editor/commit/749d24000f870881b3ebc4fbae7023ab575e6f45))
* **cooklang:** discover report templates in reports/ and templates/ dirs ([1982575](https://github.com/cook-md/editor/commit/19825758737614315df73ca380b93769fcba2dfc))
* **cooklang:** make preview/report widgets focusable, fix stale-parse races, live template re-render ([c3fd421](https://github.com/cook-md/editor/commit/c3fd4215d3d1a69b3bbcfc42b5bc64b467348a7a))
* **cooklang:** Render Report command — Jinja2 reports for recipes ([3349bc1](https://github.com/cook-md/editor/commit/3349bc17917741b5694d7f8a800e7ea8ca70056c))
* **cooklang:** render report output as markdown, HTML, or text by template extension ([af8fd8e](https://github.com/cook-md/editor/commit/af8fd8e948a44e4b0ea165f53c78fadc2131ee60))
* **cooklang:** render reports for .menu files ([496ee01](https://github.com/cook-md/editor/commit/496ee01177480ee482824b6693ab75f9e65680c0))
* **cooklang:** search whole workspace for report templates via ripgrep ([1c31f4f](https://github.com/cook-md/editor/commit/1c31f4fc006b62c8a267f8a856e7557ee4e8d358))
* **cooklang:** wire up report widget factory and contribution ([c032a1d](https://github.com/cook-md/editor/commit/c032a1d1cd0378289b69c9d2f8906132aec43f17))


### Bug Fixes

* **cooklang-native:** surface detailed template errors ([afb8555](https://github.com/cook-md/editor/commit/afb85558e4bc730d87cca3f4ec9b55d9c33437d2))
* **cooklang:** enable Render Report from preview widgets, not only text editors ([c432cb5](https://github.com/cook-md/editor/commit/c432cb509b9e2c22f3d3900868c6503b212eab4b))
* **cooklang:** guard ReportWidget against stale and post-dispose renders ([00a5bbd](https://github.com/cook-md/editor/commit/00a5bbdc1e1d7edb2633933ae1e36bfd81ef5381))
* **cooklang:** resolve report target from current main-area tab ([2ff0fc9](https://github.com/cook-md/editor/commit/2ff0fc9e412d6415f064f41f86404804855c4a8d))
* **cooklang:** reuse report widget by widget id, not factory cache ([fc603d4](https://github.com/cook-md/editor/commit/fc603d434258c7e2f59ca7e16adbeeb2a4f09808))

## [0.1.0-alpha.22](https://github.com/cook-md/editor/compare/v0.1.0-alpha.21...v0.1.0-alpha.22) (2026-06-10)


### Features

* **branding:** default VSX registry to plugins.cook.md ([a57157e](https://github.com/cook-md/editor/commit/a57157e803777a149d015a6b7467e841b306f9f8))
* **branding:** default VSX registry to plugins.cook.md ([748041d](https://github.com/cook-md/editor/commit/748041d1a73533a0e4a12eae5e5a2321a6d9d998))
