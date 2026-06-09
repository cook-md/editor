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
    private static func timerLabel(at index: UInt32, in list: [CooklangParser.Timer]) -> String? {
        let i = Int(index)
        guard list.indices.contains(i) else { return nil }
        let timer = list[i]
        if let amount = timer.amount, let formatted = Formatting.amount(amount) {
            return formatted
        }
        return timer.name
    }
}
