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

    export function resolveTitle(cooklang: string, apiName: string | undefined): string | undefined {
        if (apiName && apiName.trim().length > 0) {
            return apiName.trim();
        }
        return frontmatterTitle(cooklang);
    }

    export function ensureTitleFrontmatter(cooklang: string, title: string): string {
        const lines = cooklang.split('\n');
        if (lines[0]?.trim() === '---') {
            if (frontmatterTitle(cooklang) !== undefined) {
                return cooklang;
            }
            return [lines[0], `title: ${title}`, ...lines.slice(1)].join('\n');
        }
        return `---\ntitle: ${title}\n---\n\n${cooklang}`;
    }

    export function sanitizeFilename(title: string): string {
        const cleaned = title
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/^[. ]+|[. ]+$/g, '');
        return cleaned.length > 0 ? cleaned : 'Imported Recipe';
    }

    export async function uniqueBaseName(base: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
        if (!await exists(base)) {
            return base;
        }
        for (let i = 2; ; i++) {
            const candidate = `${base}-${i}`;
            if (!await exists(candidate)) {
                return candidate;
            }
        }
    }

    function frontmatterTitle(cooklang: string): string | undefined {
        const lines = cooklang.split('\n');
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                return undefined;
            }
            const match = lines[i].match(/^title:\s*(.+)$/);
            if (match) {
                return match[1].trim();
            }
        }
        return undefined;
    }
}
