import Foundation
import CooklangParser

/// One inline run of rendered step text.
enum StepSegment: Equatable {
    case text(String)
    case ingredient(String)
    case cookware(String)
    case timer(String)
    case recipeRef(String)
}

/// An ingredient referenced by a single step (for the per-step summary line).
struct StepIngredient: Equatable {
    let name: String
    let amount: String?
}

enum StepModel: Equatable {
    case step(segments: [StepSegment], ingredients: [StepIngredient])
    case note(String)
}

/// A "label: value" metadata pill (servings, time, and any custom keys).
struct MetadataPill: Equatable {
    let label: String
    let value: String
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
    let metadata: [MetadataPill]
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
                        var segments: [StepSegment] = []
                        var stepIngredients: [StepIngredient] = []
                        for item in step.items {
                            switch item {
                            case .text(let value):
                                segments.append(.text(value))
                            case .ingredientRef(let index):
                                if let ing = element(at: index, in: ingredients) {
                                    if ing.reference != nil {
                                        // A recipe reference (@./other{}) — link, not a quantified ingredient.
                                        segments.append(.recipeRef(ing.name))
                                    } else {
                                        segments.append(.ingredient(ing.name))
                                        stepIngredients.append(StepIngredient(
                                            name: ing.name,
                                            amount: ing.amount.flatMap(Formatting.amount)
                                        ))
                                    }
                                }
                            case .cookwareRef(let index):
                                segments.append(.cookware(element(at: index, in: cookware)?.name ?? ""))
                            case .timerRef(let index):
                                segments.append(.timer(timerLabel(at: index, in: timers) ?? ""))
                            }
                        }
                        return .step(segments: segments, ingredients: stepIngredients)
                    case .noteBlock(let note):
                        return .note(note.text)
                    }
                }
            )
        }

        return RecipePreviewModel(
            title: metadataTitle(recipe: recipe) ?? fallbackTitle,
            description: metadataDescription(recipe: recipe),
            metadata: metadataPills(recipe: recipe),
            tags: metadataTags(recipe: recipe) ?? [],
            ingredients: ingredientLines,
            cookware: cookware.map { $0.name },
            sections: sections
        )
    }

    /// Servings + time + any custom metadata keys, as "label: value" pills (matches the editor).
    private static func metadataPills(recipe: CooklangRecipe) -> [MetadataPill] {
        var pills: [MetadataPill] = []
        if let servings = metadataServings(recipe: recipe) {
            pills.append(MetadataPill(label: "Servings", value: Formatting.servings(servings)))
        }
        if let time = metadataTime(recipe: recipe) {
            pills.append(MetadataPill(label: "Time", value: Formatting.time(time)))
        }
        for key in metadataCustomKeys(recipe: recipe) {
            if let value = metadataGet(recipe: recipe, key: key), !value.isEmpty {
                pills.append(MetadataPill(label: key, value: value))
            }
        }
        return pills
    }

    private static func element(at index: UInt32, in list: [Ingredient]) -> Ingredient? {
        let i = Int(index)
        return list.indices.contains(i) ? list[i] : nil
    }
    private static func element(at index: UInt32, in list: [Cookware]) -> Cookware? {
        let i = Int(index)
        return list.indices.contains(i) ? list[i] : nil
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
