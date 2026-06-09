import SwiftUI

// MARK: - Palette (mirrors the editor's recipe-preview.css)

private extension Color {
    /// Cook Editor brand orange — the `badge.background` (#e15a29) used for step
    /// numbers, tags, and menu day-headers.
    static let cookBrand = Color(red: 0xE1 / 255, green: 0x5A / 255, blue: 0x29 / 255)
    /// Subtle inline-code style fill for ingredient/cookware tags.
    static let cookChipFill = Color.primary.opacity(0.06)
    static let cookChipStroke = Color.primary.opacity(0.18)
}

private extension NSColor {
    static let cookBrand = NSColor(srgbRed: 0xE1 / 255, green: 0x5A / 255, blue: 0x29 / 255, alpha: 1)
    static let cookTagFill = NSColor(white: 0.5, alpha: 0.16)
    static let cookTimerFill = NSColor(srgbRed: 0xE1 / 255, green: 0x5A / 255, blue: 0x29 / 255, alpha: 0.16)
}

struct RecipePreviewView: View {
    let model: RecipePreviewModel
    var isMenu: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if !model.tags.isEmpty {
                    WrapHStack(model.tags.map { AnyView(tagPill($0)) })
                }
                if let description = model.description, !description.isEmpty {
                    blockquote(description)
                }
                if !model.metadata.isEmpty {
                    WrapHStack(model.metadata.map { AnyView(metadataPill($0)) })
                }
                if isMenu {
                    menuBody
                } else {
                    recipeBody
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.title).font(.system(size: 30, weight: .semibold))
            Divider()
        }
    }

    // MARK: Recipe layout (two columns: ingredients | instructions)

    private var recipeBody: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 0) {
                sidebarTitle("Ingredients")
                ForEach(Array(model.ingredients.enumerated()), id: \.offset) { _, line in
                    ingredientRow(line)
                }
                if !model.cookware.isEmpty {
                    sidebarTitle("Cookware")
                        .padding(.top, 16)
                    ForEach(Array(model.cookware.enumerated()), id: \.offset) { _, name in
                        Text(name).fontWeight(.medium).padding(.vertical, 4)
                    }
                }
            }
            .frame(width: 220, alignment: .leading)

            Divider()

            VStack(alignment: .leading, spacing: 0) {
                sidebarTitle("Instructions")
                    .padding(.bottom, 8)
                stepsView(model.sections)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func ingredientRow(_ line: IngredientLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if line.isRecipeReference {
                Image(systemName: "arrow.right.circle").font(.system(size: 11)).foregroundColor(.cookBrand)
            }
            Text(line.name)
                .foregroundColor(line.isRecipeReference ? .cookBrand : .primary)
                .fontWeight(line.isRecipeReference ? .semibold : .regular)
            if let amount = line.amount {
                Spacer(minLength: 8)
                Text(amount).foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func stepsView(_ sections: [SectionModel]) -> some View {
        ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
            if let title = section.title, !title.isEmpty {
                Text(title).font(.system(size: 17, weight: .semibold))
                    .padding(.top, 16).padding(.bottom, 4)
            }
            ForEach(Array(numberedSteps(section.steps).enumerated()), id: \.offset) { _, entry in
                stepRow(number: entry.number, step: entry.step)
            }
        }
    }

    @ViewBuilder
    private func stepRow(number: Int?, step: StepModel) -> some View {
        switch step {
        case .note(let text):
            blockquote(text)
                .padding(.vertical, 4)
        case .step(let segments, let ingredients):
            HStack(alignment: .top, spacing: 12) {
                stepBadge(number ?? 0)
                VStack(alignment: .leading, spacing: 6) {
                    Text(stepAttributed(segments)).lineSpacing(4)
                    if !ingredients.isEmpty {
                        stepIngredientsSummary(ingredients)
                    }
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func stepBadge(_ n: Int) -> some View {
        Text("\(n)")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(.white)
            .frame(width: 24, height: 24)
            .background(RoundedRectangle(cornerRadius: 3).fill(Color.cookBrand))
    }

    private func stepIngredientsSummary(_ ingredients: [StepIngredient]) -> some View {
        let parts = ingredients.map { ing -> String in
            if let a = ing.amount { return "\(ing.name): \(a)" }
            return ing.name
        }
        return Text(parts.joined(separator: " · "))
            .font(.system(size: 11))
            .foregroundColor(.secondary)
            .padding(.leading, 10)
            .overlay(alignment: .leading) {
                Rectangle().frame(width: 2).foregroundColor(.primary.opacity(0.2))
            }
    }

    // MARK: Menu layout (day cards)

    @ViewBuilder
    private var menuBody: some View {
        ForEach(Array(model.sections.enumerated()), id: \.offset) { _, section in
            VStack(alignment: .leading, spacing: 0) {
                Text(section.title?.isEmpty == false ? section.title! : "Menu")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.cookBrand)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(section.steps.enumerated()), id: \.offset) { _, step in
                        menuLine(step)
                    }
                }
                .padding(16)
            }
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.primary.opacity(0.15)))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }

    @ViewBuilder
    private func menuLine(_ step: StepModel) -> some View {
        switch step {
        case .note(let text):
            blockquote(text)
        case .step(let segments, _):
            // A lone "Breakfast:" text line is a meal header.
            if segments.count == 1, case .text(let t) = segments[0], t.trimmingCharacters(in: .whitespaces).hasSuffix(":") {
                Text(t.trimmingCharacters(in: .whitespaces))
                    .font(.system(size: 14, weight: .semibold))
                    .padding(.top, 4)
            } else {
                Text(stepAttributed(segments)).lineSpacing(3)
            }
        }
    }

    // MARK: Shared pieces

    private func sidebarTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundColor(.secondary)
            .padding(.bottom, 8)
    }

    private func tagPill(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 8).padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 3).fill(Color.cookBrand))
    }

    private func metadataPill(_ pill: MetadataPill) -> some View {
        HStack(spacing: 4) {
            Text("\(pill.label):").fontWeight(.semibold)
            Text(pill.value)
        }
        .font(.system(size: 12))
        .padding(.horizontal, 10).padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: 3).fill(Color.cookChipFill))
        .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.cookChipStroke))
    }

    private func blockquote(_ text: String) -> some View {
        Text(text)
            .italic()
            .foregroundColor(.primary)
            .padding(.leading, 12).padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                Rectangle().frame(width: 3).foregroundColor(.cookBrand.opacity(0.6))
            }
    }

    /// Inline step text with ingredient/cookware/timer/recipe-ref runs highlighted
    /// (AttributedString background runs, the closest wrapping-inline analogue of the
    /// editor's bordered chips).
    private func stepAttributed(_ segments: [StepSegment]) -> AttributedString {
        var result = AttributedString()
        for segment in segments {
            switch segment {
            case .text(let s):
                result += AttributedString(s)
            case .ingredient(let s):
                result += chip(s, fill: .cookTagFill)
            case .cookware(let s):
                var a = chip(s, fill: .cookTagFill)
                a.font = .system(size: NSFont.systemFontSize).italic()
                result += a
            case .timer(let s):
                var a = chip(s, fill: .cookTimerFill)
                a.foregroundColor = .cookBrand
                a.font = .system(size: NSFont.systemFontSize, weight: .semibold)
                result += a
            case .recipeRef(let s):
                var a = AttributedString(s)
                a.foregroundColor = .cookBrand
                a.font = .system(size: NSFont.systemFontSize, weight: .semibold)
                result += a
            }
        }
        return result
    }

    private func chip(_ s: String, fill: NSColor) -> AttributedString {
        var a = AttributedString("\u{2009}\(s)\u{2009}") // thin spaces give the highlight a little padding
        a.backgroundColor = fill
        return a
    }

    /// Number steps within a section (notes don't consume a number).
    private func numberedSteps(_ steps: [StepModel]) -> [(number: Int?, step: StepModel)] {
        var n = 0
        return steps.map { step in
            if case .step = step { n += 1; return (n, step) }
            return (nil, step)
        }
    }
}

// MARK: - Wrapping horizontal stack (macOS 12 has no Layout/Grid flow)

/// Lays the given views left-to-right, wrapping to new rows by available width.
struct WrapHStack: View {
    let views: [AnyView]
    var hSpacing: CGFloat = 8
    var vSpacing: CGFloat = 8

    @State private var totalHeight: CGFloat = .zero

    init(_ views: [AnyView], hSpacing: CGFloat = 8, vSpacing: CGFloat = 8) {
        self.views = views
        self.hSpacing = hSpacing
        self.vSpacing = vSpacing
    }

    var body: some View {
        GeometryReader { geo in
            content(in: geo)
        }
        .frame(height: totalHeight)
    }

    private func content(in geo: GeometryProxy) -> some View {
        var x = CGFloat.zero
        var y = CGFloat.zero
        return ZStack(alignment: .topLeading) {
            ForEach(views.indices, id: \.self) { i in
                views[i]
                    .alignmentGuide(.leading) { d in
                        if abs(x - d.width) > geo.size.width {
                            x = 0
                            y -= d.height + vSpacing
                        }
                        let result = x
                        if i == views.count - 1 { x = 0 } else { x -= d.width + hSpacing }
                        return result
                    }
                    .alignmentGuide(.top) { _ in
                        let result = y
                        if i == views.count - 1 { y = 0 }
                        return result
                    }
            }
        }
        .background(heightReader($totalHeight))
    }

    private func heightReader(_ binding: Binding<CGFloat>) -> some View {
        GeometryReader { geo -> Color in
            DispatchQueue.main.async { binding.wrappedValue = geo.size.height }
            return Color.clear
        }
    }
}
