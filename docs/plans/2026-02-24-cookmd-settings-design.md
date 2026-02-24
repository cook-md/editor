# CookMD Settings — Design

## Goal

Introduce a preferences system for the Cooklang extension ("CookMD settings"). The first setting controls whether `.cook` files open in preview mode by default.

## Setting

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cooklang.openInPreviewMode` | `boolean` | `true` | When enabled, opening a `.cook` file shows the recipe preview widget instead of the source editor. Users can toggle back to the source editor with Ctrl+Shift+V. |

## Architecture

Follows the standard Theia preferences pattern (see `notification-preferences.ts` for reference):

1. **Schema + proxy** in `packages/cooklang/src/common/cooklang-preferences.ts`
2. **DI bindings** in `packages/cooklang/src/browser/cooklang-frontend-module.ts`
3. **OpenHandler** on `RecipePreviewContribution` to intercept `.cook` file opens

## Behavior

- **Setting ON (default):** User opens `recipe.cook` → preview widget opens in the tab. Ctrl+Shift+V toggles to source editor.
- **Setting OFF:** User opens `recipe.cook` → source editor opens as usual. Ctrl+Shift+V opens preview.
- The toggle command (Ctrl+Shift+V) works regardless of the setting value.

## Implementation

### New file: `packages/cooklang/src/common/cooklang-preferences.ts`

- Define `CooklangConfigSchema: PreferenceSchema` with `cooklang.openInPreviewMode`
- Define `CooklangConfiguration` interface
- Export `CooklangPreferences` symbol and type (`PreferenceProxy<CooklangConfiguration>`)
- Export `createCooklangPreferences()` and `bindCooklangPreferences()` functions

### Modified: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

- Import and call `bindCooklangPreferences(bind)`
- Bind `OpenHandler` to `RecipePreviewContribution`

### Modified: `packages/cooklang/src/browser/recipe-preview-contribution.ts`

- Implement `OpenHandler` interface
- Inject `CooklangPreferences`
- `canHandle(uri)`: return a positive priority when the URI ends with `.cook` and the preference is `true`, otherwise return `0`
- `open(uri)`: create/reveal the `RecipePreviewWidget` for that URI

## Files Changed

| File | Action |
|------|--------|
| `packages/cooklang/src/common/cooklang-preferences.ts` | Create |
| `packages/cooklang/src/browser/cooklang-frontend-module.ts` | Modify |
| `packages/cooklang/src/browser/recipe-preview-contribution.ts` | Modify |
