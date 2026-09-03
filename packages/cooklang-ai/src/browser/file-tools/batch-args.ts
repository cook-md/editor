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
 * The most items one batched tool call may carry.
 *
 * A screening pass over a recipe library is the case these batches exist for,
 * and it is a shortlist by construction. The cap is a guard against a model
 * that asks for the whole workspace in one call and gets back a result too
 * large to be useful — not a performance limit.
 */
export const MAX_BATCH_ITEMS = 25;

/**
 * Validates the array form of a batched tool argument.
 *
 * Returns the trimmed values, or a message explaining what is wrong in terms
 * the model can act on. Duplicates are collapsed: rendering or reading the same
 * path twice in one call is always waste, and silently returning it twice would
 * teach the model that it worked.
 *
 * (`packages/cooklang` carries its own copy: the two packages do not depend
 * on each other, and a shared dependency for twenty lines is not worth the
 * coupling.)
 */
export function parseBatchArg(value: unknown, name: string): string[] | { error: string } {
    if (!Array.isArray(value)) {
        return { error: `${name} must be an array of strings.` };
    }
    if (value.length === 0) {
        return { error: `${name} must not be empty.` };
    }
    if (value.length > MAX_BATCH_ITEMS) {
        return {
            error: `${name} accepts at most ${MAX_BATCH_ITEMS} items, got ${value.length}. `
                + 'Narrow the shortlist first, then batch a second call if you still need more.',
        };
    }
    const items: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string' || !entry.trim()) {
            return { error: `${name} must contain only non-empty strings.` };
        }
        const trimmed = entry.trim();
        if (!items.includes(trimmed)) {
            items.push(trimmed);
        }
    }
    return items;
}
