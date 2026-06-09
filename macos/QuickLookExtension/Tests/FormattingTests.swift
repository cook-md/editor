import XCTest
import CooklangParser

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
