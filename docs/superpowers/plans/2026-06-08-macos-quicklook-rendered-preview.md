# macOS Quick Look Rendered Preview Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native macOS Quick Look Preview Extension (`.appex`) that renders `.cook`/`.menu` files as formatted recipes (title, metadata, ingredients, cookware, steps) on spacebar, embedded in the Cook Editor app bundle and signed/notarized with it.

**Architecture:** A sandboxed `QLPreviewingController` appex parses the file with `CooklangParser` (the `cooklang-rs` UniFFI Swift bindings — same Rust parser as the editor/iOS), maps the parse result into a flat, testable view-model, and renders it with a self-contained macOS SwiftUI view. The appex is declared via XcodeGen, built with `xcodebuild`, embedded into `Contents/PlugIns/` by the existing electron-builder `afterPack` hook, and registered against the UTIs already on `main` (`md.cook.editor.cook`/`.menu`).

**Tech Stack:** Swift 5.9, SwiftUI (macOS 12+), AppKit (`NSHostingView`), Quick Look (`QLPreviewingController`), XcodeGen, `cooklang-rs` UniFFI xcframework, electron-builder, `@electron/osx-sign`.

**Spec:** `docs/superpowers/specs/2026-06-08-macos-quicklook-rendered-preview-design.md`

**Reference (read-only, do not modify):** the sibling iOS app `../mobile-app-ios` shows how `CooklangParser` is consumed; the parser sources are at `../mobile-app-ios/Packages/RecipeClipping/.build/checkouts/cooklang-rs/swift/Sources/CooklangParser/CooklangParser.swift`.

### Parser model reference (verified from CooklangParser.swift)

```
parseRecipe(input: String, scalingFactor: Double) -> CooklangRecipe   // NON-throwing
CooklangRecipe: ingredients() -> [Ingredient], cookware() -> [Cookware], sections() -> [Section], timers() -> [Timer]
Section { title: String?, blocks: [Block], ingredientRefs/cookwareRefs/timerRefs: [UInt32] }
Block: .stepBlock(Step) | .noteBlock(BlockNote)
Step  { items: [Item], ... };  BlockNote { text: String }
Item: .text(value: String) | .ingredientRef(index: UInt32) | .cookwareRef(index: UInt32) | .timerRef(index: UInt32)
Ingredient { name: String, amount: Amount?, descriptor: String?, reference: RecipeReference? }
Cookware   { name: String, amount: Amount? };  Timer { name: String?, amount: Amount? }
Amount { quantity: Value, units: String? };  Value: .number(Double) | .range(start,end) | .text(String) | .empty
RecipeReference { name: String, components: [String] }
// metadata free functions:
metadataTitle(recipe:) -> String?;  metadataDescription(recipe:) -> String?
metadataServings(recipe:) -> Servings?  // .number(UInt32) | .text(String)
metadataTime(recipe:) -> RecipeTime?    // .total(minutes: UInt32) | .composed(prepTime: UInt32?, cookTime: UInt32?)
metadataTags(recipe:) -> [String]?
```

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `macos/QuickLookExtension/project.yml` | XcodeGen spec: app-host + appex targets, SPM dep, signing config. |
| `macos/QuickLookExtension/Sources/Formatting.swift` | Pure formatters: `Amount`/`Servings`/`RecipeTime` → display strings. |
| `macos/QuickLookExtension/Sources/RecipePreviewModel.swift` | Flat view-model types + `RecipePreviewModel.from(recipe:)` mapping. |
| `macos/QuickLookExtension/Sources/RecipePreviewView.swift` | SwiftUI rendering of the view-model. |
| `macos/QuickLookExtension/Sources/PreviewViewController.swift` | `QLPreviewingController`; read file, parse, host view, text fallback. |
| `macos/QuickLookExtension/Sources/Info.plist` | `NSExtension` + `QLSupportedContentTypes`. |
| `macos/QuickLookExtension/Tests/FormattingTests.swift` | Unit tests for formatters. |
| `macos/QuickLookExtension/Tests/RecipePreviewModelTests.swift` | Unit tests for the mapping layer. |
| `macos/QuickLookExtension/Tests/Fixtures/*.cook,*.menu` | Test fixtures (YAML frontmatter, never `>>` metadata). |
| `build/entitlements.quicklook.plist` | App-sandbox entitlement for the appex. |
| `macos/scripts/build-quicklook.sh` | `xcodebuild` the universal, signed `.appex`. |
| `app/scripts/after-pack.js` (modify) | Embed `CookQuickLook.appex` into `Contents/PlugIns/` on macOS. |
| `../cooklang-rs/bindings/build-swift.sh` (modify, sibling repo) | Add macOS slices to the published xcframework. |
| `.github/workflows/*` (modify) | Add Xcode appex build step before electron-builder on macOS. |

---

## Task 1: Add macOS slices to the `cooklang-rs` Swift binding (sibling repo)

**Files:**
- Modify: `../cooklang-rs/bindings/build-swift.sh`
- Modify: `../cooklang-rs/Package.swift`

This unblocks consuming `CooklangParser` on macOS. Done in the `../cooklang-rs` repo; published as a release.

- [ ] **Step 1: Add macOS Rust targets and a macOS framework slice to `build-swift.sh`**

In `../cooklang-rs/bindings/build-swift.sh`, extend the `targets` array and add a universal macOS framework. After the existing iOS framework prep, add:

```sh
# --- macOS (added for Quick Look / desktop consumers) ---
AARCH64_APPLE_DARWIN_PATH="../target/aarch64-apple-darwin/release"
X86_64_APPLE_DARWIN_PATH="../target/x86_64-apple-darwin/release"

for target in "aarch64-apple-darwin" "x86_64-apple-darwin"; do
  echo "Building for $target..."
  rustup target add $target
  cargo build --release --target $target
done

mkdir -p $OUT_PATH/frameworks/macos
cp -r $OUT_PATH/$FRAMEWORK_NAME $OUT_PATH/frameworks/macos/
# Fat macOS binary: arm64 + x86_64
lipo -create \
  $AARCH64_APPLE_DARWIN_PATH/$LIBRARY_NAME \
  $X86_64_APPLE_DARWIN_PATH/$LIBRARY_NAME \
  -output $OUT_PATH/frameworks/macos/$FRAMEWORK_NAME/$FRAMEWORK_LIBRARY_NAME
```

Then add the macOS framework to the `xcodebuild -create-xcframework` call:

```sh
xcodebuild -create-xcframework \
    -framework $OUT_PATH/frameworks/sim/$FRAMEWORK_NAME \
    -framework $OUT_PATH/frameworks/ios/$FRAMEWORK_NAME \
    -framework $OUT_PATH/frameworks/macos/$FRAMEWORK_NAME \
    -output $OUT_PATH/$XC_FRAMEWORK_NAME
```

- [ ] **Step 2: Add `.macOS(.v12)` to `Package.swift` platforms**

In `../cooklang-rs/Package.swift`, change:

```swift
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
```

- [ ] **Step 3: Build the multi-platform xcframework**

Run: `cd ../cooklang-rs/bindings && ./build-swift.sh <next-version>`
Expected: `out/CooklangParserFFI.xcframework` now contains `macos-arm64_x86_64` alongside the iOS slices; the script prints a new SHA256 and rewrites the `url:`/`checksum:` in `Package.swift`.

- [ ] **Step 4: Verify the macOS slice exists**

Run: `ls ../cooklang-rs/bindings/out/CooklangParserFFI.xcframework`
Expected: a directory named like `macos-arm64_x86_64` is present.

- [ ] **Step 5: Publish the release and record the version**

Publish the GitHub release for `cooklang-rs` `<next-version>` (uploads `CooklangParserFFI.xcframework.zip`). Note the exact version string — Task 2 pins it.

- [ ] **Step 6: Commit (in the cooklang-rs repo)**

```bash
cd ../cooklang-rs && git add bindings/build-swift.sh Package.swift && \
  git commit -m "feat(swift): publish macOS slices in CooklangParserFFI xcframework"
```

---

## Task 2: Scaffold the appex with XcodeGen + parser dependency

**Files:**
- Create: `macos/QuickLookExtension/project.yml`
- Create: `macos/QuickLookExtension/Sources/Info.plist`
- Create: `macos/QuickLookExtension/Sources/PreviewViewController.swift` (placeholder, replaced in Task 6)
- Create: `build/entitlements.quicklook.plist`

- [ ] **Step 1: Write the appex sandbox entitlements**

Create `build/entitlements.quicklook.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 2: Write the appex Info.plist**

Create `macos/QuickLookExtension/Sources/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Cook Editor Quick Look</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.quicklook.preview</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).PreviewViewController</string>
        <key>NSExtensionAttributes</key>
        <dict>
            <key>QLSupportedContentTypes</key>
            <array>
                <string>md.cook.editor.cook</string>
                <string>md.cook.editor.menu</string>
            </array>
            <key>QLSupportsSearchableItems</key>
            <false/>
        </dict>
    </dict>
</dict>
</plist>
```

- [ ] **Step 3: Write a minimal placeholder principal class so the project compiles**

Create `macos/QuickLookExtension/Sources/PreviewViewController.swift`:

```swift
import Cocoa
import Quartz

final class PreviewViewController: NSViewController, QLPreviewingController {
    override func loadView() {
        view = NSView()
    }

    func preparePreviewOfFile(at url: URL) async throws {
        // Replaced in Task 6.
    }
}
```

- [ ] **Step 4: Write the XcodeGen project spec**

Create `macos/QuickLookExtension/project.yml`. Replace `<cooklang-rs-version>` with the version published in Task 1, and `<TEAM_ID>` is supplied via env in CI (left blank for local unsigned builds):

```yaml
name: CookQuickLook
options:
  bundleIdPrefix: md.cook.editor
  deploymentTarget:
    macOS: "12.0"
  createIntermediateGroups: true

packages:
  CooklangParser:
    url: https://github.com/cooklang/cooklang-rs
    exactVersion: <cooklang-rs-version>

targets:
  CookQuickLook:
    type: app-extension
    platform: macOS
    sources:
      - path: Sources
    info:
      path: Sources/Info.plist
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: md.cook.editor.quicklook
        PRODUCT_NAME: CookQuickLook
        GENERATE_INFOPLIST_FILE: NO
        CODE_SIGN_ENTITLEMENTS: ../../build/entitlements.quicklook.plist
        ENABLE_HARDENED_RUNTIME: YES
        SWIFT_VERSION: "5.9"
    dependencies:
      - package: CooklangParser
        product: CooklangParser

  CookQuickLookTests:
    type: bundle.unit-test
    platform: macOS
    sources:
      - path: Tests
    dependencies:
      - target: CookQuickLook
      - package: CooklangParser
        product: CooklangParser
    settings:
      base:
        SWIFT_VERSION: "5.9"
        BUNDLE_LOADER: "$(TEST_HOST)"
```

> Note: an app-extension cannot be launched as a unit-test host directly. If `bundle.unit-test` against the app-extension proves awkward in CI, move `Formatting.swift` + `RecipePreviewModel.swift` into a thin `CookPreviewCore` static-library target and have both `CookQuickLook` and `CookQuickLookTests` depend on it. Prefer the library split if the test target fails to link in Step 6.

- [ ] **Step 5: Generate and build the project**

Run:
```bash
brew list xcodegen >/dev/null 2>&1 || brew install xcodegen
cd macos/QuickLookExtension && xcodegen generate
xcodebuild -project CookQuickLook.xcodeproj -scheme CookQuickLook \
  -destination 'platform=macOS' -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build
```
Expected: `BUILD SUCCEEDED`. (CooklangParser resolves and links on macOS — this validates Task 1.)

- [ ] **Step 6: Add `.gitignore` entries for generated artifacts**

Append to `macos/QuickLookExtension/.gitignore`:

```
CookQuickLook.xcodeproj/
*.xcframework/
.build/
DerivedData/
```

- [ ] **Step 7: Commit**

```bash
git add macos/QuickLookExtension/project.yml macos/QuickLookExtension/Sources/Info.plist \
  macos/QuickLookExtension/Sources/PreviewViewController.swift \
  macos/QuickLookExtension/.gitignore build/entitlements.quicklook.plist
git commit -m "feat(macos): scaffold Quick Look appex (XcodeGen + CooklangParser)"
```

---

## Task 3: Formatting helpers (TDD)

**Files:**
- Create: `macos/QuickLookExtension/Sources/Formatting.swift`
- Test: `macos/QuickLookExtension/Tests/FormattingTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `macos/QuickLookExtension/Tests/FormattingTests.swift`:

```swift
import XCTest
import CooklangParser
@testable import CookQuickLook

final class FormattingTests: XCTestCase {
    func testAmountNumberWithUnits() {
        let a = Amount(quantity: .number(value: 200), units: "g")
        XCTAssertEqual(Formatting.amount(a), "200 g")
    }

    func testAmountTrimsTrailingZero() {
        let a = Amount(quantity: .number(value: 1.0), units: nil)
        XCTAssertEqual(Formatting.amount(a), "1")
    }

    func testAmountRange() {
        let a = Amount(quantity: .range(start: 2, end: 3), units: "cups")
        XCTAssertEqual(Formatting.amount(a), "2–3 cups")
    }

    func testAmountTextAndEmpty() {
        XCTAssertEqual(Formatting.amount(Amount(quantity: .text(value: "a pinch"), units: nil)), "a pinch")
        XCTAssertNil(Formatting.amount(Amount(quantity: .empty, units: nil)))
    }

    func testServings() {
        XCTAssertEqual(Formatting.servings(.number(value: 4)), "4")
        XCTAssertEqual(Formatting.servings(.text(value: "a crowd")), "a crowd")
    }

    func testTimeTotalAndComposed() {
        XCTAssertEqual(Formatting.time(.total(minutes: 90)), "1 hr 30 min")
        XCTAssertEqual(Formatting.time(.composed(prepTime: 10, cookTime: 20)), "Prep 10 min · Cook 20 min")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd macos/QuickLookExtension && xcodegen generate && xcodebuild test -project CookQuickLook.xcodeproj -scheme CookQuickLookTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`
Expected: FAIL — `Formatting` is undefined.

- [ ] **Step 3: Implement the formatters**

Create `macos/QuickLookExtension/Sources/Formatting.swift`:

```swift
import Foundation
import CooklangParser

enum Formatting {
    static func number(_ value: Double) -> String {
        if value == value.rounded() {
            return String(Int(value))
        }
        return String(format: "%g", value)
    }

    /// Returns nil for an empty amount so callers can omit it entirely.
    static func amount(_ amount: Amount) -> String? {
        let qty: String?
        switch amount.quantity {
        case .number(let v): qty = number(v)
        case .range(let s, let e): qty = "\(number(s))–\(number(e))"
        case .text(let t): qty = t.isEmpty ? nil : t
        case .empty: qty = nil
        }
        switch (qty, amount.units) {
        case let (q?, u?) where !u.isEmpty: return "\(q) \(u)"
        case let (q?, _): return q
        case let (nil, u?) where !u.isEmpty: return u
        default: return nil
        }
    }

    static func servings(_ servings: Servings) -> String {
        switch servings {
        case .number(let v): return String(v)
        case .text(let t): return t
        }
    }

    static func time(_ time: RecipeTime) -> String {
        switch time {
        case .total(let minutes):
            return duration(Int(minutes))
        case .composed(let prep, let cook):
            var parts: [String] = []
            if let p = prep { parts.append("Prep \(duration(Int(p)))") }
            if let c = cook { parts.append("Cook \(duration(Int(c)))") }
            return parts.joined(separator: " · ")
        }
    }

    private static func duration(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        switch (h, m) {
        case (0, _): return "\(m) min"
        case (_, 0): return "\(h) hr"
        default: return "\(h) hr \(m) min"
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd macos/QuickLookExtension && xcodebuild test -project CookQuickLook.xcodeproj -scheme CookQuickLookTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`
Expected: PASS (all `FormattingTests`).

- [ ] **Step 5: Commit**

```bash
git add macos/QuickLookExtension/Sources/Formatting.swift macos/QuickLookExtension/Tests/FormattingTests.swift
git commit -m "feat(macos): recipe formatting helpers for Quick Look preview"
```

---

## Task 4: View-model mapping layer (TDD)

**Files:**
- Create: `macos/QuickLookExtension/Sources/RecipePreviewModel.swift`
- Test: `macos/QuickLookExtension/Tests/RecipePreviewModelTests.swift`
- Test fixtures: `macos/QuickLookExtension/Tests/Fixtures/simple.cook`, `Fixtures/menu-ref.menu`

- [ ] **Step 1: Create test fixtures**

Create `macos/QuickLookExtension/Tests/Fixtures/simple.cook` (YAML frontmatter — never the deprecated `>>` syntax):

```
---
title: Pancakes
servings: 4
time: 20 min
tags: [breakfast, quick]
---
Mix @flour{200%g} and @milk{300%ml} in a #bowl{}.

Cook on a ~{5%min} until golden.
```

Create `macos/QuickLookExtension/Tests/Fixtures/menu-ref.menu`:

```
---
title: Sunday Lunch
---
Serve @./roast-chicken{} with @./gravy{}.
```

- [ ] **Step 2: Write the failing tests**

Create `macos/QuickLookExtension/Tests/RecipePreviewModelTests.swift`:

```swift
import XCTest
import CooklangParser
@testable import CookQuickLook

final class RecipePreviewModelTests: XCTestCase {
    private func loadFixture(_ name: String) throws -> String {
        let url = Bundle(for: type(of: self)).url(forResource: name, withExtension: nil)!
        return try String(contentsOf: url, encoding: .utf8)
    }

    func testSimpleRecipeMapsHeaderAndMetadata() throws {
        let source = try loadFixture("simple.cook")
        let model = RecipePreviewModel.from(source: source, fallbackTitle: "simple")
        XCTAssertEqual(model.title, "Pancakes")
        XCTAssertEqual(model.servings, "4")
        XCTAssertTrue(model.tags.contains("breakfast"))
        XCTAssertTrue(model.ingredients.contains { $0.name == "flour" && $0.amount == "200 g" })
        XCTAssertTrue(model.cookware.contains("bowl"))
    }

    func testStepsResolveIngredientSegments() throws {
        let source = try loadFixture("simple.cook")
        let model = RecipePreviewModel.from(source: source, fallbackTitle: "simple")
        let firstStep = model.sections.first!.steps.first!
        guard case .step(let segments) = firstStep else { return XCTFail("expected a step") }
        XCTAssertTrue(segments.contains(.ingredient("flour")))
        XCTAssertTrue(segments.contains(.cookware("bowl")))
    }

    func testMenuReferenceFlagged() throws {
        let source = try loadFixture("menu-ref.menu")
        let model = RecipePreviewModel.from(source: source, fallbackTitle: "menu-ref")
        XCTAssertTrue(model.ingredients.contains { $0.name == "roast-chicken" && $0.isRecipeReference })
    }

    func testFallbackTitleWhenNoMetadataTitle() {
        let model = RecipePreviewModel.from(source: "Just stir it.", fallbackTitle: "untitled")
        XCTAssertEqual(model.title, "untitled")
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd macos/QuickLookExtension && xcodegen generate && xcodebuild test -project CookQuickLook.xcodeproj -scheme CookQuickLookTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`
Expected: FAIL — `RecipePreviewModel` is undefined. (XcodeGen must pick up the new `Fixtures/` resources; if not bundled, add `- path: Tests/Fixtures` `buildPhase: resources` under the test target in `project.yml`.)

- [ ] **Step 4: Implement the view-model and mapping**

Create `macos/QuickLookExtension/Sources/RecipePreviewModel.swift`:

```swift
import Foundation
import CooklangParser

enum StepSegment: Equatable {
    case text(String)
    case ingredient(String)
    case cookware(String)
    case timer(String)
}

enum StepModel: Equatable {
    case step([StepSegment])
    case note(String)
}

struct IngredientLine: Equatable {
    let name: String
    let amount: String?
    let isRecipeReference: Bool
}

struct SectionModel: Equatable {
    let title: String?
    let steps: [StepModel]
}

struct RecipePreviewModel: Equatable {
    let title: String
    let description: String?
    let servings: String?
    let time: String?
    let tags: [String]
    let ingredients: [IngredientLine]
    let cookware: [String]
    let sections: [SectionModel]

    static func from(source: String, fallbackTitle: String) -> RecipePreviewModel {
        let recipe = parseRecipe(input: source, scalingFactor: 1.0)

        let ingredients = recipe.ingredients()
        let cookware = recipe.cookware()
        let timers = recipe.timers()

        let ingredientLines = ingredients.map { ing in
            IngredientLine(
                name: ing.name,
                amount: ing.amount.flatMap(Formatting.amount),
                isRecipeReference: ing.reference != nil
            )
        }

        let sections = recipe.sections().map { section in
            SectionModel(
                title: section.title,
                steps: section.blocks.map { block in
                    switch block {
                    case .stepBlock(let step):
                        return .step(step.items.map { item in
                            switch item {
                            case .text(let value):
                                return .text(value)
                            case .ingredientRef(let index):
                                return .ingredient(name(at: index, in: ingredients) ?? "")
                            case .cookwareRef(let index):
                                return .cookware(cookwareName(at: index, in: cookware) ?? "")
                            case .timerRef(let index):
                                return .timer(timerLabel(at: index, in: timers) ?? "")
                            }
                        })
                    case .noteBlock(let note):
                        return .note(note.text)
                    }
                }
            )
        }

        return RecipePreviewModel(
            title: metadataTitle(recipe: recipe) ?? fallbackTitle,
            description: metadataDescription(recipe: recipe),
            servings: metadataServings(recipe: recipe).map(Formatting.servings),
            time: metadataTime(recipe: recipe).map(Formatting.time),
            tags: metadataTags(recipe: recipe) ?? [],
            ingredients: ingredientLines,
            cookware: cookware.map { $0.name },
            sections: sections
        )
    }

    private static func name(at index: UInt32, in list: [Ingredient]) -> String? {
        let i = Int(index)
        return list.indices.contains(i) ? list[i].name : nil
    }
    private static func cookwareName(at index: UInt32, in list: [Cookware]) -> String? {
        let i = Int(index)
        return list.indices.contains(i) ? list[i].name : nil
    }
    private static func timerLabel(at index: UInt32, in list: [Timer]) -> String? {
        let i = Int(index)
        guard list.indices.contains(i) else { return nil }
        let timer = list[i]
        if let amount = timer.amount, let formatted = Formatting.amount(amount) {
            return formatted
        }
        return timer.name
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd macos/QuickLookExtension && xcodebuild test -project CookQuickLook.xcodeproj -scheme CookQuickLookTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`
Expected: PASS (all `RecipePreviewModelTests`). If `testMenuReferenceFlagged` fails because the parser models `@./x{}` as a plain ingredient rather than setting `reference`, adjust the assertion to match observed behavior and note it in the spec's `.menu` caveat — do not force a false expectation.

- [ ] **Step 6: Commit**

```bash
git add macos/QuickLookExtension/Sources/RecipePreviewModel.swift \
  macos/QuickLookExtension/Tests/RecipePreviewModelTests.swift \
  macos/QuickLookExtension/Tests/Fixtures
git commit -m "feat(macos): map CooklangRecipe to a testable preview view-model"
```

---

## Task 5: SwiftUI rendering view

**Files:**
- Create: `macos/QuickLookExtension/Sources/RecipePreviewView.swift`

Rendering is verified visually (Task 8), not unit-tested. Keep it a pure function of `RecipePreviewModel`.

- [ ] **Step 1: Implement the view**

Create `macos/QuickLookExtension/Sources/RecipePreviewView.swift`:

```swift
import SwiftUI

struct RecipePreviewView: View {
    let model: RecipePreviewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if !metadataChips.isEmpty {
                    chips(metadataChips)
                }
                if let description = model.description, !description.isEmpty {
                    Text(description).font(.body).foregroundStyle(.secondary)
                }
                if !model.ingredients.isEmpty {
                    section("Ingredients") {
                        ForEach(Array(model.ingredients.enumerated()), id: \.offset) { _, line in
                            ingredientRow(line)
                        }
                    }
                }
                if !model.cookware.isEmpty {
                    section("Cookware") {
                        Text(model.cookware.joined(separator: ", "))
                            .font(.body).foregroundStyle(.secondary)
                    }
                }
                stepsView
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        Text(model.title).font(.largeTitle.bold())
    }

    private var metadataChips: [String] {
        var chips: [String] = []
        if let s = model.servings { chips.append("Serves \(s)") }
        if let t = model.time { chips.append(t) }
        chips.append(contentsOf: model.tags.map { "#\($0)" })
        return chips
    }

    private func chips(_ values: [String]) -> some View {
        HStack(spacing: 8) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                Text(value)
                    .font(.caption).padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Color.accentColor.opacity(0.15))
                    .clipShape(Capsule())
            }
        }
    }

    private func ingredientRow(_ line: IngredientLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: line.isRecipeReference ? "arrow.right.circle" : "circle.fill")
                .font(.system(size: line.isRecipeReference ? 11 : 5))
                .foregroundStyle(line.isRecipeReference ? Color.accentColor : .secondary)
            Text(line.name).fontWeight(line.isRecipeReference ? .semibold : .regular)
            if let amount = line.amount {
                Spacer(minLength: 8)
                Text(amount).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var stepsView: some View {
        ForEach(Array(model.sections.enumerated()), id: \.offset) { _, section in
            VStack(alignment: .leading, spacing: 10) {
                if let title = section.title, !title.isEmpty {
                    Text(title).font(.title3.bold())
                }
                ForEach(Array(section.steps.enumerated()), id: \.offset) { index, step in
                    stepRow(index: index, step: step)
                }
            }
        }
    }

    @ViewBuilder
    private func stepRow(index: Int, step: StepModel) -> some View {
        switch step {
        case .note(let text):
            Text(text).italic().foregroundStyle(.secondary)
                .padding(.leading, 8).overlay(alignment: .leading) {
                    Rectangle().frame(width: 3).foregroundStyle(Color.accentColor.opacity(0.4))
                }
        case .step(let segments):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(index + 1).").font(.body.monospacedDigit()).foregroundStyle(.secondary)
                stepText(segments)
            }
        }
    }

    private func stepText(_ segments: [StepSegment]) -> Text {
        segments.reduce(Text("")) { acc, segment in
            switch segment {
            case .text(let s): return acc + Text(s)
            case .ingredient(let s): return acc + Text(s).foregroundColor(.accentColor).bold()
            case .cookware(let s): return acc + Text(s).bold()
            case .timer(let s): return acc + Text(s).foregroundColor(.orange).bold()
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.bold())
            content()
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd macos/QuickLookExtension && xcodegen generate && xcodebuild -project CookQuickLook.xcodeproj -scheme CookQuickLook -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Commit**

```bash
git add macos/QuickLookExtension/Sources/RecipePreviewView.swift
git commit -m "feat(macos): SwiftUI recipe preview view for Quick Look"
```

---

## Task 6: Wire the preview controller with text fallback

**Files:**
- Modify: `macos/QuickLookExtension/Sources/PreviewViewController.swift`

- [ ] **Step 1: Implement the controller**

Replace `macos/QuickLookExtension/Sources/PreviewViewController.swift`:

```swift
import Cocoa
import SwiftUI
import Quartz

final class PreviewViewController: NSViewController, QLPreviewingController {
    private static let maxBytes = 512 * 1024 // cap for Quick Look's time budget

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 800))
    }

    func preparePreviewOfFile(at url: URL) async throws {
        let source = try readCapped(url)
        let host: NSView
        if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            host = textFallback(source)
        } else {
            let model = RecipePreviewModel.from(
                source: source,
                fallbackTitle: url.deletingPathExtension().lastPathComponent
            )
            host = NSHostingView(rootView: RecipePreviewView(model: model))
        }
        embed(host)
    }

    private func readCapped(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = handle.readData(ofLength: Self.maxBytes)
        return String(decoding: data, as: UTF8.self)
    }

    private func textFallback(_ source: String) -> NSView {
        let scroll = NSTextView.scrollableTextView()
        if let textView = scroll.documentView as? NSTextView {
            textView.string = source
            textView.isEditable = false
            textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        }
        return scroll
    }

    private func embed(_ host: NSView) {
        host.translatesAutoresizingMaskIntoConstraints = false
        view.subviews.forEach { $0.removeFromSuperview() }
        view.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.topAnchor.constraint(equalTo: view.topAnchor),
            host.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd macos/QuickLookExtension && xcodegen generate && xcodebuild -project CookQuickLook.xcodeproj -scheme CookQuickLook -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Smoke-test the preview with qlmanage**

Run (unsigned debug build is fine for `qlmanage`):
```bash
APPEX=$(find ~/Library/Developer/Xcode/DerivedData -name 'CookQuickLook.appex' -path '*Debug*' | head -1)
qlmanage -p macos/QuickLookExtension/Tests/Fixtures/simple.cook -g "$APPEX" 2>&1 | tail -5
```
Expected: a Quick Look window renders the formatted Pancakes recipe (not raw text). Close the window to continue.

- [ ] **Step 4: Commit**

```bash
git add macos/QuickLookExtension/Sources/PreviewViewController.swift
git commit -m "feat(macos): preview controller with parse + text fallback"
```

---

## Task 7: Build script + bundle embedding + signing

**Files:**
- Create: `macos/scripts/build-quicklook.sh`
- Modify: `app/scripts/after-pack.js`

- [ ] **Step 1: Write the appex build script (universal, signed)**

Create `macos/scripts/build-quicklook.sh`:

```bash
#!/usr/bin/env bash
# Builds CookQuickLook.appex (universal arm64+x86_64), optionally code-signed.
# Output: macos/QuickLookExtension/build/CookQuickLook.appex
set -euo pipefail

cd "$(dirname "$0")/../QuickLookExtension"

command -v xcodegen >/dev/null 2>&1 || brew install xcodegen
xcodegen generate

DERIVED="build/DerivedData"
SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO)
# In CI, CSC_NAME / signing identity + team are provided; sign with hardened runtime.
if [[ -n "${QUICKLOOK_SIGN_IDENTITY:-}" ]]; then
  SIGN_ARGS=(
    CODE_SIGNING_ALLOWED=YES
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=${QUICKLOOK_SIGN_IDENTITY}"
    "DEVELOPMENT_TEAM=${QUICKLOOK_TEAM_ID:-}"
    OTHER_CODE_SIGN_FLAGS=--timestamp
  )
fi

xcodebuild \
  -project CookQuickLook.xcodeproj \
  -scheme CookQuickLook \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  "${SIGN_ARGS[@]}" \
  build

SRC=$(find "$DERIVED/Build/Products/Release" -name 'CookQuickLook.appex' | head -1)
mkdir -p build
rm -rf build/CookQuickLook.appex
cp -R "$SRC" build/CookQuickLook.appex
echo "Built: $(pwd)/build/CookQuickLook.appex"
lipo -info "build/CookQuickLook.appex/Contents/MacOS/CookQuickLook" || true
```

- [ ] **Step 2: Make it executable and run it locally (unsigned)**

Run:
```bash
chmod +x macos/scripts/build-quicklook.sh
./macos/scripts/build-quicklook.sh
```
Expected: prints `Built: .../build/CookQuickLook.appex` and `lipo -info` shows `arm64 x86_64`.

- [ ] **Step 3: Embed the appex in the electron-builder afterPack hook**

In `app/scripts/after-pack.js`, add — inside `exports.default`, after the source-map cleanup and before the final `console.log` — the macOS embed step:

```javascript
    // macOS only: embed the Quick Look preview extension into Contents/PlugIns
    // so electron-builder's mac signing step seals it and notarization covers it.
    if (context.electronPlatformName === 'darwin') {
        const appexSrc = path.resolve(
            context.appDir, '..', 'macos', 'QuickLookExtension', 'build', 'CookQuickLook.appex'
        );
        if (fs.existsSync(appexSrc)) {
            const appName = `${context.packager.appInfo.productFilename}.app`;
            const plugins = path.join(context.appOutDir, appName, 'Contents', 'PlugIns');
            fs.mkdirSync(plugins, { recursive: true });
            const dest = path.join(plugins, 'CookQuickLook.appex');
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(appexSrc, dest, { recursive: true });
            console.log(`after-pack: embedded Quick Look appex at ${dest}`);
        } else {
            console.warn(`after-pack: CookQuickLook.appex not found at ${appexSrc}; skipping (run macos/scripts/build-quicklook.sh first)`);
        }
    }
```

> `context.appDir` is `<repo>/app`; `path.resolve(context.appDir, '..', 'macos', ...)` reaches the repo-root `macos/`. Verify `context.packager.appInfo.productFilename` resolves to `Cook Editor` (the productName); if electron-builder's API differs in the installed version, fall back to reading the single `*.app` under `context.appOutDir`.

- [ ] **Step 4: Configure signing so the pre-signed appex is not re-signed**

In `app/electron-builder.yml`, under `mac:`, add the appex to `signIgnore` (it is pre-signed by `build-quicklook.sh` in CI; electron-builder then signs the enclosing app, sealing it):

```yaml
  signIgnore:
    - "Contents/PlugIns/CookQuickLook.appex"
```

> Rationale: code must be signed inner-most first. The appex is signed by `xcodebuild` (hardened runtime + sandbox entitlements), embedded in afterPack, then the outer `.app` is signed by electron-builder. Re-signing the nested appex with the app's (non-sandbox) entitlements would break it, so it is ignored. Notarization still scans and covers nested code. If `signIgnore` does not accept a nested path in the installed electron-builder version, instead leave the appex for electron-builder to sign and pass per-file entitlements via `mac.entitlementsLoginHelper`-style config — verify empirically in Task 8.

- [ ] **Step 5: Commit**

```bash
git add macos/scripts/build-quicklook.sh app/scripts/after-pack.js app/electron-builder.yml
git commit -m "build(macos): build + embed + sign Quick Look appex in app bundle"
```

---

## Task 8: CI integration and end-to-end verification

**Files:**
- Modify: the macOS release workflow under `.github/workflows/` (the job that runs `electron-builder` for mac).

- [ ] **Step 1: Identify the macOS build job**

Run: `grep -rl -E "electron-builder|--mac|npm run .*package" .github/workflows/`
Open the file and locate the macOS job's step that builds the app (before `electron-builder` runs).

- [ ] **Step 2: Add the appex build step before electron-builder**

In the macOS job, immediately before the packaging step, add (YAML — adapt indentation to the file):

```yaml
      - name: Build Quick Look extension
        env:
          QUICKLOOK_SIGN_IDENTITY: ${{ secrets.CSC_NAME }}
          QUICKLOOK_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: ./macos/scripts/build-quicklook.sh
```

> Uses the same signing identity the macOS release already provisions. If `CSC_NAME` is not a defined secret, set `QUICKLOOK_SIGN_IDENTITY` to the existing `Developer ID Application: ...` identity name used by electron-builder.

- [ ] **Step 3: Build a signed package locally (or via CI) and verify signing**

Run (on a signing-capable mac, with the same env the release uses):
```bash
./macos/scripts/build-quicklook.sh
cd app && npm run package
APP=$(find dist -maxdepth 2 -name '*.app' | head -1)
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - "$APP/Contents/PlugIns/CookQuickLook.appex" | grep -i sandbox
```
Expected: `--verify --deep` reports valid on disk; the appex entitlements include `com.apple.security.app-sandbox`.

- [ ] **Step 4: End-to-end manual verification on the packaged build**

Install/launch the packaged `.app` once (registers with LaunchServices), then:
```bash
qlmanage -r            # reset Quick Look
qlmanage -m | grep -i cook   # confirm the generator is registered (optional)
```
In Finder:
1. Select `app/Christmas Dinner/`-style `.cook` file, press Space → formatted recipe renders.
2. Select a `.menu` file, press Space → menu-aware render (referenced recipes highlighted).
3. Select a deliberately malformed/empty `.cook`, press Space → raw-text fallback, never a blank panel.

Expected: all three behave as described. If previews do not appear, force registration:
`/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$APP"` then `qlmanage -r` and retry.

- [ ] **Step 5: Confirm notarization covers the nested appex**

After the release `electron-builder` run completes notarization, run:
```bash
spctl -a -vvv -t install "$APP"
stapler validate "$APP"
```
Expected: `accepted`, source `Notarized Developer ID`; `stapler validate` → `The validate action worked!`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows
git commit -m "ci(macos): build Quick Look appex before packaging"
```

---

## Final verification

- [ ] All Swift unit tests pass: `cd macos/QuickLookExtension && xcodebuild test -project CookQuickLook.xcodeproj -scheme CookQuickLookTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`
- [ ] `qlmanage -p` renders `.cook` and `.menu` fixtures formatted.
- [ ] Packaged app passes `codesign --verify --deep --strict` and the embedded appex retains its sandbox entitlement.
- [ ] Notarization accepted and stapled (`spctl`, `stapler validate`).
- [ ] Manual Finder spacebar preview works for `.cook`, `.menu`, and the malformed/text-fallback case.
- [ ] No regression to Windows/Linux builds (unchanged config paths).
