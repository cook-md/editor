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

import { injectable } from '@theia/core/shared/inversify';
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

type MermaidModule = typeof import('mermaid');

/**
 * Renders mermaid diagrams that appear as fenced code blocks in rendered
 * markdown reports. The `mermaid` library is imported lazily the first time a
 * diagram is encountered, so reports without diagrams pay no cost.
 */
@injectable()
export class MermaidRenderer {

    protected mermaidPromise: Promise<MermaidModule> | undefined;
    protected idCounter = 0;

    /** Lazily import and memoize the mermaid module. */
    protected load(): Promise<MermaidModule> {
        if (!this.mermaidPromise) {
            this.mermaidPromise = import('mermaid');
        }
        return this.mermaidPromise;
    }

    protected nextId(): string {
        return `cooklang-mermaid-${++this.idCounter}`;
    }

    /**
     * Replace every mermaid code block in `container` with a rendered SVG.
     * Each block is rendered independently: a failing diagram is replaced with
     * an inline error node and does not abort the remaining diagrams. If the
     * mermaid module fails to load, the raw code blocks are left untouched.
     */
    async renderInto(container: HTMLElement, theme: MermaidTheme): Promise<void> {
        const blocks = findMermaidBlocks(container);
        if (blocks.length === 0) {
            return;
        }
        let mermaid: MermaidModule['default'];
        try {
            mermaid = (await this.load()).default;
        } catch (error) {
            console.error('Failed to load mermaid; leaving diagram source as-is.', error);
            return;
        }
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
        for (const block of blocks) {
            const source = extractMermaidSource(block);
            const wrapper = container.ownerDocument.createElement('div');
            wrapper.className = 'theia-cooklang-mermaid';
            wrapper.setAttribute('data-mermaid-src', source);
            try {
                const { svg } = await mermaid.render(this.nextId(), source);
                wrapper.innerHTML = svg;
            } catch (error) {
                wrapper.classList.add('theia-cooklang-mermaid-error');
                wrapper.textContent = String(error instanceof Error ? error.message : error);
            }
            block.replaceWith(wrapper);
        }
    }

    /**
     * Re-render diagrams in a (cloned) export container using the given theme.
     * Operates on `.theia-cooklang-mermaid[data-mermaid-src]` wrappers produced
     * by {@link renderInto}, so already-rendered live diagrams can be recolored
     * for print without re-reading the markdown.
     */
    async renderExport(container: HTMLElement, theme: MermaidTheme): Promise<void> {
        const wrappers = Array.from(
            container.querySelectorAll<HTMLElement>('.theia-cooklang-mermaid[data-mermaid-src]')
        );
        if (wrappers.length === 0) {
            return;
        }
        let mermaid: MermaidModule['default'];
        try {
            mermaid = (await this.load()).default;
        } catch (error) {
            console.error('Failed to load mermaid for export.', error);
            return;
        }
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
        for (const wrapper of wrappers) {
            const source = wrapper.getAttribute('data-mermaid-src') ?? '';
            try {
                const { svg } = await mermaid.render(this.nextId(), source);
                wrapper.innerHTML = svg;
                wrapper.classList.remove('theia-cooklang-mermaid-error');
            } catch {
                // Keep whatever was already rendered for this block.
            }
        }
    }
}
