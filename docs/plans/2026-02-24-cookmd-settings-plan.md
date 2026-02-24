# CookMD Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `cooklang.openInPreviewMode` preference (default `true`) that makes `.cook` files open directly in the recipe preview widget instead of the source editor.

**Architecture:** Standard Theia preferences pattern — schema + typed proxy in `common/`, DI bindings in the frontend module, and an `OpenHandler` implementation on `RecipePreviewContribution` that checks the preference value. The preview handler returns priority `200`, beating the editor's default `100` but not overriding an explicit default-handler preference (`100_000`).

**Tech Stack:** InversifyJS DI, Theia PreferenceService/PreferenceProxy, OpenHandler interface

---

### Task 1: Create the preference schema and proxy

**Files:**
- Create: `packages/cooklang/src/common/cooklang-preferences.ts`
- Modify: `packages/cooklang/src/common/index.ts`

**Step 1: Create `cooklang-preferences.ts`**

```typescript
// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { interfaces } from '@theia/core/shared/inversify';
import {
    createPreferenceProxy,
    PreferenceContribution,
    PreferenceProxy,
    PreferenceSchema,
    PreferenceService,
} from '@theia/core/lib/common/preferences';

export const cooklangPreferencesSchema: PreferenceSchema = {
    properties: {
        'cooklang.openInPreviewMode': {
            type: 'boolean',
            description: 'When enabled, .cook files open in recipe preview mode instead of the source editor.',
            default: true
        }
    }
};

export interface CooklangConfiguration {
    'cooklang.openInPreviewMode': boolean;
}

export const CooklangPreferenceContribution = Symbol('CooklangPreferenceContribution');
export const CooklangPreferences = Symbol('CooklangPreferences');
export type CooklangPreferences = PreferenceProxy<CooklangConfiguration>;

export function createCooklangPreferences(
    preferences: PreferenceService,
    schema: PreferenceSchema = cooklangPreferencesSchema
): CooklangPreferences {
    return createPreferenceProxy(preferences, schema);
}

export function bindCooklangPreferences(bind: interfaces.Bind): void {
    bind(CooklangPreferences).toDynamicValue(ctx => {
        const preferences = ctx.container.get<PreferenceService>(PreferenceService);
        const contribution = ctx.container.get<PreferenceContribution>(CooklangPreferenceContribution);
        return createCooklangPreferences(preferences, contribution.schema);
    }).inSingletonScope();
    bind(CooklangPreferenceContribution).toConstantValue({ schema: cooklangPreferencesSchema });
    bind(PreferenceContribution).toService(CooklangPreferenceContribution);
}
```

**Step 2: Re-export from `common/index.ts`**

Add to `packages/cooklang/src/common/index.ts`:

```typescript
export { CooklangPreferences, bindCooklangPreferences } from './cooklang-preferences';
```

**Step 3: Compile and verify no errors**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: BUILD SUCCESS, no errors

**Step 4: Commit**

```bash
git add packages/cooklang/src/common/cooklang-preferences.ts packages/cooklang/src/common/index.ts
git commit -m "feat(cooklang): add preference schema for openInPreviewMode"
```

---

### Task 2: Bind preferences in the frontend module

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Add preference bindings**

Add import at top:

```typescript
import { bindCooklangPreferences } from '../common';
```

Add inside the `ContainerModule` callback, after the existing bindings:

```typescript
    // Cooklang preferences
    bindCooklangPreferences(bind);
```

**Step 2: Compile and verify no errors**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): bind CookMD preferences in frontend module"
```

---

### Task 3: Implement OpenHandler on RecipePreviewContribution

**Files:**
- Modify: `packages/cooklang/src/browser/recipe-preview-contribution.ts`
- Modify: `packages/cooklang/src/browser/cooklang-frontend-module.ts`

**Step 1: Add OpenHandler implementation to `RecipePreviewContribution`**

The class currently implements `CommandContribution, KeybindingContribution`. We add `OpenHandler`.

New imports needed at top of `recipe-preview-contribution.ts`:

```typescript
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
import { MaybePromise } from '@theia/core/lib/common';
import { CooklangPreferences } from '../common';
```

Update class declaration:

```typescript
export class RecipePreviewContribution implements CommandContribution, KeybindingContribution, OpenHandler {
```

Add to the class body (after the existing `@inject` properties):

```typescript
    @inject(CooklangPreferences)
    protected readonly preferences: CooklangPreferences;

    readonly id = 'cooklang-preview-open-handler';
    readonly label = 'Cooklang: Recipe Preview';

    canHandle(uri: URI): number {
        if (uri.path.ext === '.cook' && this.preferences['cooklang.openInPreviewMode']) {
            return 200;
        }
        return 0;
    }

    async open(uri: URI): Promise<RecipePreviewWidget> {
        const preview = await this.getOrCreatePreview(uri);
        if (!preview.isAttached) {
            await this.shell.addWidget(preview, { area: 'main' });
        }
        this.shell.activateWidget(preview.id);
        return preview;
    }
```

**Step 2: Bind OpenHandler in `cooklang-frontend-module.ts`**

Add import:

```typescript
import { OpenHandler } from '@theia/core/lib/browser/opener-service';
```

Add after the existing `KeybindingContribution` binding:

```typescript
    bind(OpenHandler).toService(RecipePreviewContribution);
```

**Step 3: Compile and verify no errors**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add packages/cooklang/src/browser/recipe-preview-contribution.ts packages/cooklang/src/browser/cooklang-frontend-module.ts
git commit -m "feat(cooklang): open .cook files in preview mode via OpenHandler"
```

---

### Task 4: Manual smoke test

**Step 1: Build the Electron app**

Run: `cd examples/electron && npm run bundle`

**Step 2: Start the Electron app**

Run: `cd examples/electron && npm run start:electron`

**Step 3: Verify default behavior (preview mode ON)**

1. Open a `.cook` file — it should open as the recipe preview widget
2. Press Ctrl+Shift+V — it should toggle to the source editor
3. Press Ctrl+Shift+V again — it should toggle back to preview

**Step 4: Verify setting OFF**

1. Open Settings (Ctrl+,), search for "cooklang"
2. Uncheck "Open In Preview Mode"
3. Open a different `.cook` file — it should open as the source editor
4. Press Ctrl+Shift+V — preview should open

**Step 5: Commit (no code changes, just verify)**

Done.
