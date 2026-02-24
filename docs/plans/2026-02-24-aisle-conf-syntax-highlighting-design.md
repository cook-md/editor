# aisle.conf Syntax Highlighting

## Overview

Add TextMate syntax highlighting for `aisle.conf` files — Cooklang's aisle configuration format that maps ingredients to store sections.

## Syntax

```
# comment
[section name]
primary item | alias 1 | alias 2
```

- `#` line comments
- `[section]` headers defining store aisles/categories
- Item lines with a primary name and optional `|`-separated aliases
- Blank lines as separators

## Approach

Add a separate TextMate grammar within the existing `packages/cooklang` extension. No new package needed.

## Files

### New
- `packages/cooklang/data/aisle-conf.tmLanguage.json` — TextMate grammar

### Modified
- `packages/cooklang/src/browser/cooklang-grammar-contribution.ts` — register new language + grammar

## Grammar Scopes

| Element | TextMate Scope |
|---------|---------------|
| `# comment` | `comment.line.number-sign.aisle-conf` |
| `[section]` | `entity.name.section.aisle-conf` |
| `[ ]` brackets | `punctuation.definition.section.aisle-conf` |
| Primary item | `entity.name.tag.aisle-conf` |
| `\|` separator | `punctuation.separator.aisle-conf` |
| Alias | `string.unquoted.alias.aisle-conf` |

## Language Registration

- Language ID: `aisle-conf`
- TextMate scope: `source.aisle-conf`
- File extension: `.conf`
- Filenames: `aisle.conf`
