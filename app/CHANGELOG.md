# Changelog

## [0.1.0-alpha.31](https://github.com/cook-md/editor/compare/v0.1.0-alpha.30...v0.1.0-alpha.31) (2026-07-04)


### Bug Fixes

* **electron:** actually ship + resolve bundled plugins in the release ([#66](https://github.com/cook-md/editor/issues/66)) ([21e9121](https://github.com/cook-md/editor/commit/21e9121b42713e05172b2b989c5888118a3ac21a))

## [0.1.0-alpha.30](https://github.com/cook-md/editor/compare/v0.1.0-alpha.29...v0.1.0-alpha.30) (2026-07-04)


### Bug Fixes

* **electron:** load bundled VS Code plugins in packaged app ([#64](https://github.com/cook-md/editor/issues/64)) ([4621c9b](https://github.com/cook-md/editor/commit/4621c9b0892601626a743696af856fc0d63fd9e2))

## [0.1.0-alpha.29](https://github.com/cook-md/editor/compare/v0.1.0-alpha.28...v0.1.0-alpha.29) (2026-07-02)


### Bug Fixes

* **electron:** point bundled rgPath at app.asar.unpacked ([#62](https://github.com/cook-md/editor/issues/62)) ([60c6e70](https://github.com/cook-md/editor/commit/60c6e70a9140d60cc0e6a17876cf8b538220db22))

## [0.1.0-alpha.28](https://github.com/cook-md/editor/compare/v0.1.0-alpha.27...v0.1.0-alpha.28) (2026-07-02)


### Bug Fixes

* **electron:** unpack native executables from asar ([#60](https://github.com/cook-md/editor/issues/60)) ([79205f0](https://github.com/cook-md/editor/commit/79205f06f129b350004c2bb71c09efb51f997426))

## [0.1.0-alpha.27](https://github.com/cook-md/editor/compare/v0.1.0-alpha.26...v0.1.0-alpha.27) (2026-07-01)


### Bug Fixes

* **macos:** vendor cooklang-rs xcframework via curl to dodge flaky CI download ([#58](https://github.com/cook-md/editor/issues/58)) ([d440c60](https://github.com/cook-md/editor/commit/d440c60541da215f938b153c8b2c3ce7522b1190))

## [0.1.0-alpha.26](https://github.com/cook-md/editor/compare/v0.1.0-alpha.25...v0.1.0-alpha.26) (2026-07-01)


### Bug Fixes

* **macos:** stop Quick Look build hanging on SwiftPM artifact download ([#56](https://github.com/cook-md/editor/issues/56)) ([0711ffe](https://github.com/cook-md/editor/commit/0711ffedc4f14bad4d70b1afaa3160635373e9ae))

## [0.1.0-alpha.25](https://github.com/cook-md/editor/compare/v0.1.0-alpha.24...v0.1.0-alpha.25) (2026-06-30)


### Features

* **cooklang-native:** register nutrition extension when feature + url present ([75693f5](https://github.com/cook-md/editor/commit/75693f526b333b0c16824b1a73452f7fb4f773bc))
* **cooklang:** add cooklang.nutrition.serviceUrl preference ([467f3fe](https://github.com/cook-md/editor/commit/467f3fe8f982e2b01d9d635aaa94c561da08bf8c))
* **cooklang:** add electron-main report export service ([6ef9764](https://github.com/cook-md/editor/commit/6ef9764d5ee1beff45a9cd5271c8c7b804e5374c))
* **cooklang:** add report export RPC protocol ([3de4e06](https://github.com/cook-md/editor/commit/3de4e06f61eae8a7a16585698fe983534f844618))
* **cooklang:** add report print/export commands and toolbar ([3b96589](https://github.com/cook-md/editor/commit/3b965896ca971149c6dc7ff4605be8fa059c2aec))
* **cooklang:** add standalone report export document builder ([eefa92b](https://github.com/cook-md/editor/commit/eefa92bc94d3c8f49bb275a14fd8e7687f9dcc47))
* **cooklang:** bind report export service proxy ([a8a59ab](https://github.com/cook-md/editor/commit/a8a59ab4a9b6d04a4bd62b83e52749dcd4e43bf0))
* **cooklang:** expose export document from report widget ([61fc26d](https://github.com/cook-md/editor/commit/61fc26d8e07142246f55d0f1119512c4c34acf23))
* **cooklang:** inject nutrition service URL + cook.md token into report config ([f627cd8](https://github.com/cook-md/editor/commit/f627cd8f5d178bb018d9cba96ffd2f6161534a9a))
* **cooklang:** register report export contribution ([193ebdd](https://github.com/cook-md/editor/commit/193ebdd365bfb30b9c37e419ede5d4a2d4406fbf))
* **cooklang:** register report export RPC handler ([15d9c9b](https://github.com/cook-md/editor/commit/15d9c9bc20772ef8c3368d15c910499cc66ea5a1))
* **cooklang:** render mermaid diagrams in jinja reports ([#55](https://github.com/cook-md/editor/issues/55)) ([f959407](https://github.com/cook-md/editor/commit/f959407598402d96dfb0e30d40a3cd7e382810ee))
* nutrition reports for Cook Pro users ([cc9dcca](https://github.com/cook-md/editor/commit/cc9dccabbfa6b2c16bebaf4ab418ced85433b1d1))
* **reports:** bundle jinjahtml for jinja report-template syntax highlighting ([43edd71](https://github.com/cook-md/editor/commit/43edd710c677b0157aa83c546784240c887d4da6))
* **reports:** print, export PDF, and export PNG for rendered reports ([efe7f33](https://github.com/cook-md/editor/commit/efe7f333799d79b224ad2ff1f2734cf4ffca3b6a))
* **report:** typographic treatment + page margins for rendered reports ([6ae5625](https://github.com/cook-md/editor/commit/6ae5625b2234cbca13a2bbd907cd53e0731da534))


### Bug Fixes

* **cooklang:** harden report export per review ([9f29039](https://github.com/cook-md/editor/commit/9f290392211d132140181643533132ca6c64344f))
* **cooklang:** match recipe/menu file extensions case-insensitively ([#50](https://github.com/cook-md/editor/issues/50)) ([#51](https://github.com/cook-md/editor/issues/51)) ([5c933e5](https://github.com/cook-md/editor/commit/5c933e584b3aa061eef695d41930b1a314bdc0ae))
* **cooklang:** render printer toolbar icon via themed SVG mask ([5379139](https://github.com/cook-md/editor/commit/537913904dd1546e10b91fded2f7305f208d7852))
* **cooklang:** treat print dialog cancel as quiet success ([8d82d36](https://github.com/cook-md/editor/commit/8d82d3658f9faa7331e9fe92a25eb1057b2778b6))
* **cooklang:** use distinct nls keys for export toolbar tooltips ([0d42070](https://github.com/cook-md/editor/commit/0d420708d794d1a3a013a437e5423906fc7d0439))
* **cooklang:** use valid codicon-print for print toolbar icon ([75bb46f](https://github.com/cook-md/editor/commit/75bb46f9a06bb5efe534e96c062214a6be1c1037))

## [0.1.0-alpha.24](https://github.com/cook-md/editor/compare/v0.1.0-alpha.23...v0.1.0-alpha.24) (2026-06-14)


### Features

* AI-authored template rendering (renderTemplate tool) ([#46](https://github.com/cook-md/editor/issues/46)) ([35ae807](https://github.com/cook-md/editor/commit/35ae807de42975138fc3afafcede96de0e96ba4e))


### Bug Fixes

* **ai-chat-ui:** add trailing space after inserted #file mention ([#48](https://github.com/cook-md/editor/issues/48)) ([35700fd](https://github.com/cook-md/editor/commit/35700fd0824318b8a54e5824741f6c1a8e606dd9))

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
