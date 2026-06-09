import XCTest
import CooklangParser

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
