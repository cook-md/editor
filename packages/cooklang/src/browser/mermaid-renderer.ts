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

/** Class on the wrapper element produced for each rendered diagram. */
export const MERMAID_WRAPPER_CLASS = 'theia-cooklang-mermaid';

/** Class added to a wrapper whose diagram failed to render. */
export const MERMAID_ERROR_CLASS = 'theia-cooklang-mermaid-error';

/** Map a Theia theme type to the mermaid theme used for live rendering. */
export function themeTypeToMermaidTheme(type: ThemeType): MermaidTheme {
    return (type === 'dark' || type === 'hc') ? 'dark' : 'default';
}

type MermaidModule = typeof import('mermaid');

/**
 * Renders mermaid diagrams for fenced ` ```mermaid ` code blocks in markdown
 * reports. The markdown renderer surfaces code blocks through a
 * `codeBlockRenderer(languageId, value)` callback (it does not emit
 * `<code class="language-*">` nodes), so this service produces a ready-to-mount
 * element per block rather than scanning the rendered DOM. The `mermaid`
 * library is imported lazily the first time a diagram is rendered, so reports
 * without diagrams pay no cost.
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
     * Render a single mermaid `source` to a wrapper element containing the SVG.
     * The wrapper carries the original source in `data-mermaid-src` so it can be
     * re-themed later (see {@link renderExport}). On a diagram error the wrapper
     * shows the error message; if the mermaid module fails to load entirely, the
     * wrapper falls back to the raw source text.
     */
    async renderDiagram(source: string, theme: MermaidTheme): Promise<HTMLElement> {
        const wrapper = document.createElement('div');
        wrapper.className = MERMAID_WRAPPER_CLASS;
        wrapper.setAttribute('data-mermaid-src', source);
        let mermaid: MermaidModule['default'];
        try {
            mermaid = (await this.load()).default;
        } catch (error) {
            console.error('Failed to load mermaid; showing diagram source as-is.', error);
            wrapper.textContent = source;
            return wrapper;
        }
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
        try {
            const { svg } = await mermaid.render(this.nextId(), source);
            wrapper.innerHTML = svg;
        } catch (error) {
            wrapper.classList.add(MERMAID_ERROR_CLASS);
            wrapper.textContent = String(error instanceof Error ? error.message : error);
        }
        return wrapper;
    }

    /**
     * Re-render diagrams in a (cloned) export container using the given theme.
     * Operates on `.theia-cooklang-mermaid[data-mermaid-src]` wrappers produced
     * by {@link renderDiagram}, so already-rendered live diagrams can be
     * recolored for print without re-reading the markdown.
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
