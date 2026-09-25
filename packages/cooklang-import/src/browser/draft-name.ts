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
 * Naming helpers for imported drafts: title resolution, frontmatter
 * injection (parity with the iOS app's clipping flow), and safe,
 * collision-free file names.
 */
export namespace DraftName {

    const MAX_FILENAME_LENGTH = 120;
    const MAX_UNIQUE_NAME_ATTEMPTS = 1000;
    const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

    export function resolveTitle(cooklang: string, apiName: string | undefined): string | undefined {
        if (apiName && apiName.trim().length > 0) {
            return sanitizeTitleValue(apiName);
        }
        return frontmatterTitle(cooklang);
    }

    export function ensureTitleFrontmatter(cooklang: string, title: string): string {
        const titleLine = frontmatterLine('title', title);
        const split = splitFrontmatter(cooklang);
        if (split) {
            if (frontmatterTitle(cooklang) !== undefined) {
                return cooklang;
            }
            const { lines, start } = split;
            return [...lines.slice(0, start + 1), titleLine, ...lines.slice(start + 1)].join('\n');
        }
        return `---\n${titleLine}\n---\n\n${cooklang}`;
    }

    export function sanitizeFilename(title: string): string {
        let cleaned = title
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/^[. ]+|[. ]+$/g, '');
        if (cleaned.length > MAX_FILENAME_LENGTH) {
            cleaned = cleaned.substring(0, MAX_FILENAME_LENGTH).replace(/[. ]+$/g, '');
        }
        if (cleaned.length === 0) {
            return 'Imported Recipe';
        }
        if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
            return `${cleaned} Recipe`;
        }
        return cleaned;
    }

    export async function uniqueBaseName(base: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
        if (!await exists(base)) {
            return base;
        }
        for (let i = 2; i <= MAX_UNIQUE_NAME_ATTEMPTS; i++) {
            const candidate = `${base}-${i}`;
            if (!await exists(candidate)) {
                return candidate;
            }
        }
        return `${base}-${Date.now()}`;
    }

    /**
     * Whether `key` can be written as a plain top-level YAML frontmatter key:
     * a letter or underscore, then letters, digits, `_`, `-` or `.`.
     */
    export function isFrontmatterKey(key: string): boolean {
        return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
    }

    /**
     * Adds `entries` to the recipe's YAML frontmatter, creating the block when
     * there is none. Keys the frontmatter already has are left alone (the
     * recipe's own values always win), and keys that are not plain YAML keys
     * are skipped. Values become single-line YAML scalars, double-quoted when
     * YAML would otherwise misread them. Never writes the deprecated `>>`
     * metadata syntax. A document with fewer than two fences has no
     * frontmatter, matching cooklang-rs, so a fresh block is prepended ahead
     * of the whole (unmodified) original content.
     */
    export function mergeFrontmatter(cooklang: string, entries: Record<string, string>): string {
        const additions = Object.entries(entries).filter(([key]) => isFrontmatterKey(key));
        if (additions.length === 0) {
            return cooklang;
        }
        const split = splitFrontmatter(cooklang);
        if (!split) {
            return ['---', ...additions.map(([key, value]) => frontmatterLine(key, value)), '---', '', cooklang].join('\n');
        }
        const { lines, start, end } = split;
        const existing = new Set<string>();
        for (const line of lines.slice(start + 1, end)) {
            const match = line.match(/^([^\s#:][^:]*):/);
            if (match) {
                existing.add(unquote(match[1].trim()));
            }
        }
        const missing = additions.filter(([key]) => !existing.has(key));
        if (missing.length === 0) {
            return cooklang;
        }
        return [
            ...lines.slice(0, end),
            ...missing.map(([key, value]) => frontmatterLine(key, value)),
            ...lines.slice(end),
        ].join('\n');
    }

    function frontmatterLine(key: string, value: string): string {
        return `${key}: ${yamlScalar(value)}`;
    }

    /**
     * A single-line YAML scalar for `value`. Whitespace, newlines included,
     * collapses to single spaces, since a newline would start a new frontmatter
     * line. Anything YAML would read as another type, a comment or a mapping is
     * double-quoted; JSON string syntax is valid YAML double-quoted syntax.
     * A value starting with a digit is only left plain when it is a canonical
     * decimal integer (`2`, not `007`, `0x1F`, `1e3`, a date or a time), since
     * anything else would come back from YAML as a number, not this string.
     * A value containing control characters other than the whitespace already
     * collapsed above (`\t`, `\n`, `\r`, form feed, vertical tab) is always
     * quoted too — plain YAML scalars forbid them, and an unquoted one would
     * make cooklang-rs discard the whole frontmatter block. `JSON.stringify`
     * already escapes every character in that range (`\u0001`, etc.) the same
     * way YAML double-quoted scalars do.
     */
    function yamlScalar(value: string): string {
        const single = sanitizeTitleValue(value);
        // eslint-disable-next-line no-control-regex
        const hasControlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(single);
        const plain = !hasControlCharacters
            && /^[A-Za-z0-9_(][^#]*$/.test(single)
            && !/:(\s|$)/.test(single)
            && !/^(true|false|yes|no|on|off|y|n|null)$/i.test(single)
            && (!/^[0-9]/.test(single) || /^(0|[1-9][0-9]*)$/.test(single));
        return plain ? single : JSON.stringify(single);
    }

    /**
     * Collapses all whitespace — including newlines, which would otherwise
     * inject arbitrary frontmatter lines — into single spaces and trims.
     */
    function sanitizeTitleValue(title: string): string {
        return title.replace(/\s+/g, ' ').trim();
    }

    function frontmatterTitle(cooklang: string): string | undefined {
        const split = splitFrontmatter(cooklang);
        if (!split) {
            return undefined;
        }
        const { lines, start, end } = split;
        for (let i = start + 1; i < end; i++) {
            const match = lines[i].match(/^title:\s*(.+)$/);
            if (match) {
                return unquote(match[1].trim());
            }
        }
        return undefined;
    }

    /**
     * Locates the recipe's YAML frontmatter fences the way cooklang-rs does
     * (`cooklang` 0.17 `src/parser/frontmatter.rs`): a fence is any line whose
     * trailing whitespace is stripped and equals `---` — leading indentation
     * is significant, so an indented `---` inside a literal block scalar does
     * not count. The opening fence is simply the first such line, wherever it
     * falls — it may follow any content, blank or not. Both an opening and a
     * closing fence are required: a document with only one `---` line has no
     * frontmatter at all (it is not "unterminated", cooklang-rs does not
     * recognize it either), so this returns `undefined` in that case too.
     */
    function splitFrontmatter(cooklang: string): { lines: string[]; start: number; end: number } | undefined {
        const lines = cooklang.split(/\r?\n/);
        const start = lines.findIndex(line => line.trimEnd() === '---');
        if (start === -1) {
            return undefined;
        }
        const end = lines.findIndex((line, index) => index > start && line.trimEnd() === '---');
        if (end === -1) {
            return undefined;
        }
        return { lines, start, end };
    }

    /**
     * Strips one pair of matching surrounding YAML quotes, if present.
     */
    function unquote(value: string): string {
        return value
            .replace(/^"(.*)"$/, '$1')
            .replace(/^'(.*)'$/, '$1');
    }
}
