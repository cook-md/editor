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

import { ThemeType } from '@theia/core/lib/common/theme';

/** The subset of mermaid built-in themes this feature uses. */
export type MermaidTheme = 'default' | 'dark';

/** CSS selector for a mermaid code fence produced by the markdown renderer. */
export const MERMAID_CODE_SELECTOR = 'code.language-mermaid';

/** Map a Theia theme type to the mermaid theme used for live rendering. */
export function themeTypeToMermaidTheme(type: ThemeType): MermaidTheme {
    return (type === 'dark' || type === 'hc') ? 'dark' : 'default';
}

/**
 * Find the `<pre>` blocks inside `container` that wrap a mermaid code fence.
 * Returns the enclosing `<pre>` elements (the nodes we replace with an SVG).
 */
export function findMermaidBlocks(container: HTMLElement): HTMLElement[] {
    const blocks: HTMLElement[] = [];
    container.querySelectorAll(MERMAID_CODE_SELECTOR).forEach(code => {
        const pre = code.closest('pre');
        if (pre instanceof HTMLElement) {
            blocks.push(pre);
        }
    });
    return blocks;
}

/** Extract the raw diagram source from a mermaid `<pre>` block. */
export function extractMermaidSource(block: HTMLElement): string {
    const code = block.querySelector(MERMAID_CODE_SELECTOR);
    return (code?.textContent ?? block.textContent ?? '').trim();
}
