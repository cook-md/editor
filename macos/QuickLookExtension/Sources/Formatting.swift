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
