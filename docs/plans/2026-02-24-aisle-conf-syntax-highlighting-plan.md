# aisle.conf Syntax Highlighting — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add TextMate syntax highlighting for `aisle.conf` files in the Cooklang editor.

**Architecture:** New TextMate grammar JSON file + register it as a second language in the existing `CooklangGrammarContribution` class. No new packages or DI bindings needed.

**Tech Stack:** TextMate grammar (JSON), Monaco language registration, TypeScript

---

### Task 1: Create the TextMate grammar file

**Files:**
- Create: `packages/cooklang/data/aisle-conf.tmLanguage.json`

**Step 1: Create the grammar file**

```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "name": "Aisle Config",
  "scopeName": "source.aisle-conf",
  "patterns": [
    { "include": "#comment" },
    { "include": "#section" },
    { "include": "#item-line" }
  ],
  "repository": {
    "comment": {
      "match": "^\\s*(#.*)$",
      "captures": {
        "1": { "name": "comment.line.number-sign.aisle-conf" }
      }
    },
    "section": {
      "match": "^\\s*(\\[)([^\\]]*)(\\])\\s*$",
      "captures": {
        "1": { "name": "punctuation.definition.section.begin.aisle-conf" },
        "2": { "name": "entity.name.section.aisle-conf" },
        "3": { "name": "punctuation.definition.section.end.aisle-conf" }
      }
    },
    "item-line": {
      "match": "^\\s*([^#\\[\\|\\s][^\\|]*?)(?:(\\|)(.*))?$",
      "captures": {
        "1": { "name": "entity.name.tag.aisle-conf" },
        "2": { "name": "punctuation.separator.aisle-conf" },
        "3": {
          "patterns": [{ "include": "#aliases" }]
        }
      }
    },
    "aliases": {
      "patterns": [
        {
          "match": "\\|",
          "name": "punctuation.separator.aisle-conf"
        },
        {
          "match": "[^\\|]+",
          "name": "string.unquoted.alias.aisle-conf"
        }
      ]
    }
  }
}
```

**Step 2: Commit**

```bash
git add packages/cooklang/data/aisle-conf.tmLanguage.json
git commit -m "feat(cooklang): add TextMate grammar for aisle.conf"
```

---

### Task 2: Register the aisle-conf language and grammar

**Files:**
- Modify: `packages/cooklang/src/common/index.ts:1-7`
- Modify: `packages/cooklang/src/browser/cooklang-grammar-contribution.ts:12-60`

**Step 1: Add constants to `packages/cooklang/src/common/index.ts`**

Add after line 5 (`export const COOKLANG_TEXTMATE_SCOPE = ...`):

```typescript
export const AISLE_CONF_LANGUAGE_ID = 'aisle-conf';
export const AISLE_CONF_TEXTMATE_SCOPE = 'source.aisle-conf';
```

**Step 2: Update the import in `cooklang-grammar-contribution.ts`**

Change the import on line 12 from:

```typescript
import { COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE } from '../common';
```

to:

```typescript
import { COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE, AISLE_CONF_LANGUAGE_ID, AISLE_CONF_TEXTMATE_SCOPE } from '../common';
```

**Step 3: Add aisle-conf language config property**

Add after the existing `config` property (after line 36):

```typescript
readonly aisleConfConfig: monaco.languages.LanguageConfiguration = {
    comments: {
        lineComment: '#'
    },
    brackets: [
        ['[', ']']
    ],
    autoClosingPairs: [
        { open: '[', close: ']' }
    ],
    surroundingPairs: [
        { open: '[', close: ']' }
    ]
};
```

**Step 4: Register aisle-conf in `registerTextmateLanguage` method**

Add at the end of `registerTextmateLanguage`, before the closing `}` (after line 59):

```typescript
// Aisle config
monaco.languages.register({
    id: AISLE_CONF_LANGUAGE_ID,
    aliases: ['Aisle Config', 'aisle-conf'],
    extensions: ['.conf'],
    filenames: ['aisle.conf']
});

monaco.languages.setLanguageConfiguration(AISLE_CONF_LANGUAGE_ID, this.aisleConfConfig);

const aisleConfGrammar = require('../../data/aisle-conf.tmLanguage.json');
const aisleConfGrammarProvider: GrammarDefinitionProvider = {
    getGrammarDefinition(): Promise<GrammarDefinition> {
        return Promise.resolve({
            format: 'json',
            content: aisleConfGrammar
        });
    }
};

registry.registerTextmateGrammarScope(AISLE_CONF_TEXTMATE_SCOPE, aisleConfGrammarProvider);
registry.mapLanguageIdToTextmateGrammar(AISLE_CONF_LANGUAGE_ID, AISLE_CONF_TEXTMATE_SCOPE);
```

**Step 5: Compile and verify**

Run: `npx lerna run compile --scope @theia/cooklang`
Expected: Clean compilation, no errors.

**Step 6: Commit**

```bash
git add packages/cooklang/src/common/index.ts packages/cooklang/src/browser/cooklang-grammar-contribution.ts
git commit -m "feat(cooklang): register aisle-conf language and grammar"
```

---

### Task 3: Manual verification

**Step 1: Bundle the electron app**

Run: `cd examples/electron && npm run bundle`

**Step 2: Start the app and test**

Run: `cd examples/electron && npm run start:electron`

Open an `aisle.conf` file and verify:
- Section headers `[fruit and veg]` are highlighted
- Primary items like `apples` are highlighted differently from aliases
- `|` separators are visible as punctuation
- `#` comments are highlighted as comments
- Blank lines don't cause issues
