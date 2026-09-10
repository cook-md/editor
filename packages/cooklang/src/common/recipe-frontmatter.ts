// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

/**
 * Obsidian Cooklang compatibility: Markdown files with YAML frontmatter
 * `recipe: true` are treated as Cooklang recipes.
 *
 * @see https://cooklang.org/blog/15-cooklang-obsidian-guide/
 */
export namespace RecipeFrontmatter {

    /**
     * YAML boolean values accepted for the Obsidian `recipe` flag.
     * Matches the common YAML 1.1 truthy set (case-insensitive).
     */
    const TRUTHY = new Set(['true', 'yes', 'on', 'y', '1']);

    /**
     * Whether `content` begins with a YAML frontmatter block that sets
     * `recipe` to a truthy value (e.g. `recipe: true`).
     *
     * Only the first frontmatter block is inspected. Nested mappings and
     * multi-line values are not supported — Obsidian's convention is a
     * single boolean scalar on its own line.
     */
    export function hasRecipeFlag(content: string): boolean {
        const lines = content.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return false;
        }
        for (let i = 1; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '---') {
                return false;
            }
            const match = trimmed.match(/^recipe:\s*(.*?)\s*$/i);
            if (match) {
                return isTruthyYamlBoolean(match[1]);
            }
        }
        return false;
    }

    function isTruthyYamlBoolean(raw: string): boolean {
        const unquoted = raw
            .replace(/^"(.*)"$/, '$1')
            .replace(/^'(.*)'$/, '$1')
            .trim();
        return TRUTHY.has(unquoted.toLowerCase());
    }
}
