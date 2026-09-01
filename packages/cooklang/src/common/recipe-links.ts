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

export interface TextToken {
    type: 'text';
    value: string;
}

export interface LinkToken {
    type: 'link';
    /** The text as written in the recipe. */
    value: string;
    /** The absolute URL to open. */
    href: string;
}

export type LinkifyToken = TextToken | LinkToken;

/**
 * Matches, in order: an explicit http(s) URL, a bare `www.` host, an explicit
 * `mailto:`, and a bare email address. Deliberately greedy up to whitespace or
 * a quote/angle bracket; trailing punctuation is trimmed afterwards.
 */
const LINK_PATTERN = new RegExp([
    'https?://[^\\s<>"\']+',
    'www\\.[^\\s<>"\']+',
    'mailto:[^\\s<>"\']+',
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
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
 * inside the URL itself.
 */
function trimTrailing(match: string): string {
    let value = match;
    for (;;) {
        const last = value.charAt(value.length - 1);
        if (last === '') {
            break;
        }
        if (TRAILING_PUNCTUATION.includes(last)) {
            value = value.slice(0, -1);
            continue;
        }
        if (last === ')' && count(value, ')') > count(value, '(')) {
            value = value.slice(0, -1);
            continue;
        }
        if (last === ']' && count(value, ']') > count(value, '[')) {
            value = value.slice(0, -1);
            continue;
        }
        break;
    }
    return value;
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
        if (value.length > 0) {
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
