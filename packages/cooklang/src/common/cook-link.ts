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
 * The cross-platform `cook://` route table, shared with the iOS and Android apps
 * through `deeplinks.json`. Parsing is pure: it never touches the filesystem, so
 * `my` says nothing about whether the target is a recipe or a folder.
 *
 * `https://cook.md/my/<path>` (and `www.cook.md`) is the shareable form of
 * `cook://my/<path>`: same path rules, same `?mode=cooking&timer=<id>` query,
 * same traversal check after percent-decoding. `https://cook.md/shares/<token>`
 * remains a share link; everything else under an `https`/`http` URL is
 * `{ route: 'invalid', reason: 'not-a-share-link' }`.
 *
 * Contract: growth/docs/superpowers/specs/2026-09-18-unified-cook-url-scheme-design.md
 */
export type CookLink =
    | { route: 'my', path: string, mode?: 'cooking', timer?: string }
    /** An absent `id` means the timer screen itself. */
    | { route: 'timer', id?: string }
    /** Exactly one of `url` / `batch` is set. */
    | { route: 'clip', url?: string, batch?: string }
    | { route: 'share', token: string }
    /** A well-formed cook:// URL in a namespace this client does not implement. */
    | { route: 'unsupported', namespace: string }
    | { route: 'invalid', reason: string };

const OWN_SCHEMES = new Set(['cook', 'cooklang']);
const SHARE_HOSTS = new Set(['cook.md', 'www.cook.md']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCookLink(raw: string): CookLink {
    const schemeSeparator = raw.indexOf(':');
    if (schemeSeparator <= 0 || /\s/.test(raw.slice(0, schemeSeparator))) {
        return { route: 'invalid', reason: 'unparseable' };
    }

    const scheme = raw.slice(0, schemeSeparator).toLowerCase();
    let rest = raw.slice(schemeSeparator + 1);
    if (rest.startsWith('//')) {
        rest = rest.slice(2);
    }

    // A fragment is never part of the path or query; strip it before splitting either.
    const fragmentStart = rest.indexOf('#');
    if (fragmentStart >= 0) {
        rest = rest.slice(0, fragmentStart);
    }

    const queryStart = rest.indexOf('?');
    const beforeQuery = queryStart >= 0 ? rest.slice(0, queryStart) : rest;
    const query = parseQuery(queryStart >= 0 ? rest.slice(queryStart + 1) : '');

    const hostEnd = beforeQuery.indexOf('/');
    const host = (hostEnd >= 0 ? beforeQuery.slice(0, hostEnd) : beforeQuery).toLowerCase();
    const linkPath = hostEnd >= 0 ? beforeQuery.slice(hostEnd) : '';

    if (scheme === 'https' || scheme === 'http') {
        return parseWebLink(host, linkPath, query);
    }
    if (!OWN_SCHEMES.has(scheme)) {
        return { route: 'invalid', reason: 'foreign-scheme' };
    }
    if (!host) {
        return { route: 'invalid', reason: 'no-namespace' };
    }

    switch (host) {
        case 'my':
            return parseMy(linkPath, query);
        case 'timer':
            return { route: 'timer', id: asUuid(segments(linkPath)[0]) };
        case 'clip':
        case 'clip_images':
            return parseClip(query);
        case 'share': {
            const token = segments(linkPath)[0];
            return token ? { route: 'share', token } : { route: 'invalid', reason: 'share-without-token' };
        }
        case 'share_import': {
            // Legacy iOS route: the token rides inside a nested https URL.
            const nested = query.get('url');
            return nested ? parseCookLink(nested) : { route: 'invalid', reason: 'share-without-token' };
        }
        case 'screen':
            return parseLegacyScreen(linkPath, query);
        default:
            return { route: 'unsupported', namespace: host };
    }
}

function parseMy(linkPath: string, query: Map<string, string>): CookLink {
    const parts = segments(linkPath);
    if (parts.includes('..')) {
        return { route: 'invalid', reason: 'path-traversal' };
    }
    const mode = query.get('mode') === 'cooking' ? 'cooking' : undefined;
    const timer = query.get('timer') ?? query.get('timerId') ?? undefined;
    return { route: 'my', path: parts.join('/'), mode, timer };
}

function parseClip(query: Map<string, string>): CookLink {
    const url = query.get('url') || undefined;
    const batch = query.get('batch') || undefined;
    if (!url && !batch) {
        return { route: 'invalid', reason: 'clip-without-source' };
    }
    return { route: 'clip', url, batch };
}

/** Legacy Android routes, still parsed so links emitted before the unification survive. */
function parseLegacyScreen(linkPath: string, query: Map<string, string>): CookLink {
    const parts = segments(linkPath);
    switch (parts[0]) {
        case 'timer':
            return { route: 'timer', id: asUuid(parts[1]) };
        case 'cookingMode': {
            const recipe = parts.slice(1);
            if (recipe.includes('..')) {
                return { route: 'invalid', reason: 'path-traversal' };
            }
            return {
                route: 'my',
                path: recipe.join('/'),
                mode: 'cooking',
                timer: query.get('timerId') ?? query.get('timer') ?? undefined
            };
        }
        default:
            return { route: 'unsupported', namespace: 'screen' };
    }
}

/**
 * Routes `https`/`http` links. Only `cook.md`/`www.cook.md` are ours: `/my/<path>`
 * means exactly what `cook://my/<path>` means, `/shares/<token>` is a share link,
 * and anything else is `not-a-share-link`.
 */
function parseWebLink(host: string, linkPath: string, query: Map<string, string>): CookLink {
    if (!SHARE_HOSTS.has(host)) {
        return { route: 'invalid', reason: 'not-a-share-link' };
    }

    const myRemainder = matchMyPrefix(linkPath);
    if (myRemainder !== undefined) {
        return parseMy(myRemainder, query);
    }

    const parts = segments(linkPath);
    if (parts.length !== 2 || parts[0] !== 'shares' || !parts[1]) {
        return { route: 'invalid', reason: 'not-a-share-link' };
    }
    return { route: 'share', token: parts[1] };
}

/**
 * Returns the raw remainder after a leading `/my` path segment (kept un-decoded, as
 * `segments` expects), or `undefined` when `linkPath` is not `/my` or `/my/...`.
 * `/myfoo` must NOT match: only a whole `my` segment counts.
 */
function matchMyPrefix(linkPath: string): string | undefined {
    if (linkPath === '/my') {
        return '';
    }
    if (linkPath.startsWith('/my/')) {
        return linkPath.slice(3);
    }
    return undefined;
}

/**
 * Percent-decoded, empty segments dropped. A decoded `/` becomes a separator: no
 * supported filesystem allows one in a filename, and the legacy cookingMode links
 * encode the whole path as a single segment.
 */
function segments(linkPath: string): string[] {
    return linkPath.split('/')
        .filter(part => part.length > 0)
        .flatMap(part => decode(part).split('/'))
        .filter(part => part.length > 0);
}

function parseQuery(query: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const pair of query.split('&')) {
        if (!pair) {
            continue;
        }
        const separator = pair.indexOf('=');
        if (separator < 0) {
            continue;
        }
        result.set(decode(pair.slice(0, separator)), decode(pair.slice(separator + 1)));
    }
    return result;
}

function decode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function asUuid(segment: string | undefined): string | undefined {
    return segment && UUID_PATTERN.test(segment) ? segment : undefined;
}
