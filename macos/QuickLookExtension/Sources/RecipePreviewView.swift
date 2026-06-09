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
        // Quick Look hosts the view in a translucent panel; give it an opaque
        // document background (adapts to light/dark) so the text is readable
        // instead of showing through to the desktop/panel behind it.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
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
