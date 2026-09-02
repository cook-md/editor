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

/** A run of plain, non-link text. */
export interface TextToken {
    type: 'text';
    value: string;
}

/** A run of text that should be rendered as a clickable link. */
export interface LinkToken {
    type: 'link';
    /** The text as written in the recipe. */
    value: string;
    /** The absolute URL to open. */
    href: string;
}

/** One token produced by {@link linkify}: either plain text or a link. */
export type LinkifyToken = TextToken | LinkToken;

/**
 * Matches, in order: an explicit http(s) URL, a bare `www.` host, an explicit
 * `mailto:`, and a bare email address. Deliberately greedy up to whitespace or
 * a quote/angle bracket; trailing punctuation is trimmed afterwards.
 *
 * Two adjacent links with no separating whitespace collapse into a single
 * token (e.g. the greedy `https?://` alternative swallows a `www.` host that
 * immediately follows it). That is a known and accepted ambiguity, not an
 * oversight.
 *
 * The `(?<!...)` lookbehind on the bare-email alternative is purely a
 * performance guard, not a semantic requirement: without it, a long run of
 * local-part characters with no `@` (a hash, a base64 paste, a run-on word)
 * makes the engine retry the greedy character class from every offset inside
 * the run, which is quadratic in the run's length. The lookbehind stops a
 * match attempt from starting partway through such a run, so only the run's
 * first offset does real backtracking work.
 */
const LINK_PATTERN = new RegExp([
    'https?://[^\\s<>"\']+',
    'www\\.[^\\s<>"\']+',
    'mailto:[^\\s<>"\']+',
    '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
].join('|'), 'g');

const TRAILING_PUNCTUATION = '.,;:!?';

function count(text: string, character: string): number {
    let total = 0;
    for (const c of text) {
        if (c === character) {
            total++;
        }
    }
    return total;
}

/**
 * Drop characters a writer meant as prose rather than as part of the URL: a
 * full stop that ends the sentence, or a closing bracket that was never opened
 * inside the URL itself. Counts brackets once up front and adjusts
 * incrementally rather than rescanning the shrinking value on every
 * character, which keeps this linear in the length of `match`.
 */
function trimTrailing(match: string): string {
    let end = match.length;
    const openParens = count(match, '(');
    let closeParens = count(match, ')');
    const openBrackets = count(match, '[');
    let closeBrackets = count(match, ']');
    while (end > 0) {
        const last = match.charAt(end - 1);
        if (TRAILING_PUNCTUATION.includes(last)) {
            end--;
            continue;
        }
        if (last === ')' && closeParens > openParens) {
            closeParens--;
            end--;
            continue;
        }
        if (last === ']' && closeBrackets > openBrackets) {
            closeBrackets--;
            end--;
            continue;
        }
        break;
    }
    return match.substring(0, end);
}

function hrefFor(value: string): string {
    if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) {
        return value;
    }
    if (/^www\./i.test(value)) {
        return `https://${value}`;
    }
    return `mailto:${value}`;
}

/**
 * Whether a match still looks like a link after {@link trimTrailing} has had
 * its way with it. Trimming can eat a scheme down to nothing meaningful —
 * `mailto:.` becomes `mailto`, `www..` becomes `www` — and those must render
 * as plain text rather than as an anchor pointing somewhere nonsensical.
 */
function isUsableLink(value: string): boolean {
    if (/^https?:\/\//i.test(value)) {
        return value.replace(/^https?:\/\//i, '').length > 0;
    }
    if (/^www\./i.test(value)) {
        return value.length > 'www.'.length;
    }
    const address = /^mailto:/i.test(value) ? value.substring('mailto:'.length) : value;
    return /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(address);
}

/**
 * Split `text` into plain runs and links. Text with no links yields a single
 * text token; empty text yields no tokens at all.
 */
export function linkify(text: string): LinkifyToken[] {
    if (text.length === 0) {
        return [];
    }
    const tokens: LinkifyToken[] = [];
    let cursor = 0;
    LINK_PATTERN.lastIndex = 0;
    let match = LINK_PATTERN.exec(text);
    while (match) {
        const start = match.index;
        const value = trimTrailing(match[0]);
        if (isUsableLink(value)) {
            if (start > cursor) {
                tokens.push({ type: 'text', value: text.substring(cursor, start) });
            }
            tokens.push({ type: 'link', value, href: hrefFor(value) });
            cursor = start + value.length;
            LINK_PATTERN.lastIndex = cursor;
        }
        match = LINK_PATTERN.exec(text);
    }
    if (cursor < text.length) {
        tokens.push({ type: 'text', value: text.substring(cursor) });
    }
    return tokens;
}
