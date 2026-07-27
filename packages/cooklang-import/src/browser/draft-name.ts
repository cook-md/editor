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
        const safeTitle = sanitizeTitleValue(title);
        const lines = cooklang.split(/\r?\n/);
        if (lines[0]?.trim() === '---') {
            if (frontmatterTitle(cooklang) !== undefined) {
                return cooklang;
            }
            return [lines[0], `title: ${safeTitle}`, ...lines.slice(1)].join('\n');
        }
        return `---\ntitle: ${safeTitle}\n---\n\n${cooklang}`;
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
     * Collapses all whitespace — including newlines, which would otherwise
     * inject arbitrary frontmatter lines — into single spaces and trims.
     */
    function sanitizeTitleValue(title: string): string {
        return title.replace(/\s+/g, ' ').trim();
    }

    function frontmatterTitle(cooklang: string): string | undefined {
        const lines = cooklang.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                return undefined;
            }
            const match = lines[i].match(/^title:\s*(.+)$/);
            if (match) {
                return unquote(match[1].trim());
            }
        }
        return undefined;
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
