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

import * as React from '@theia/core/shared/react';
import { MarkdownRenderer, MarkdownRenderResult } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering/markdown-string';
import { MermaidRenderer, MermaidTheme } from './mermaid-renderer';

export interface MermaidMarkdownProps {
    /** The markdown source to render. */
    markdown: string;
    /** The shared markdown renderer (Monaco-backed). */
    markdownRenderer: MarkdownRenderer;
    /** The mermaid renderer used for ` ```mermaid ` code blocks. */
    mermaidRenderer: MermaidRenderer;
    /** Mermaid theme to render diagrams with; re-renders when it changes. */
    theme: MermaidTheme;
    /** CSS class for the container element. */
    className?: string;
}

/**
 * Renders report markdown and turns fenced ` ```mermaid ` code blocks into
 * rendered diagrams.
 *
 * Theia's Monaco-backed markdown renderer surfaces code blocks through a
 * `codeBlockRenderer(languageId, value)` callback rather than emitting
 * `<code class="language-*">` nodes, so we render imperatively here (the core
 * `Markdown` component does not forward that option) and supply a renderer that
 * delegates mermaid blocks to {@link MermaidRenderer} and falls back to a plain
 * `<pre><code>` for every other language.
 */
export const MermaidMarkdown: React.FC<MermaidMarkdownProps> = ({
    markdown,
    markdownRenderer,
    mermaidRenderer,
    theme,
    className
}) => {
    // eslint-disable-next-line no-null/no-null
    const containerRef = React.useRef<HTMLDivElement>(null);
    const resultRef = React.useRef<MarkdownRenderResult | undefined>();

    React.useEffect(() => {
        resultRef.current?.dispose();
        resultRef.current = undefined;
        const container = containerRef.current;
        if (!container) {
            return;
        }
        if (!markdown || markdown.trim() === '') {
            container.replaceChildren();
            return;
        }
        const rendered = markdownRenderer.render(new MarkdownStringImpl(markdown), {
            codeBlockRenderer: async (languageId: string, value: string): Promise<HTMLElement> => {
                if (languageId === 'mermaid') {
                    return mermaidRenderer.renderDiagram(value, theme);
                }
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                if (languageId) {
                    code.className = `language-${languageId}`;
                }
                code.textContent = value;
                pre.appendChild(code);
                return pre;
            }
        });
        resultRef.current = rendered;
        container.replaceChildren(rendered.element);
        return () => {
            resultRef.current?.dispose();
            resultRef.current = undefined;
        };
    }, [markdown, markdownRenderer, mermaidRenderer, theme]);

    return <div className={className} ref={containerRef} />;
};
MermaidMarkdown.displayName = 'MermaidMarkdown';
