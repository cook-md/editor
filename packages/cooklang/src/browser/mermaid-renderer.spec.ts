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

// The DOM helpers need `document`; set up jsdom before importing the module.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { themeTypeToMermaidTheme, findMermaidBlocks, extractMermaidSource } from './mermaid-renderer';

after(() => disableJSDOM());

describe('mermaid-renderer helpers', () => {

    it('maps theme types to mermaid themes', () => {
        expect(themeTypeToMermaidTheme('dark')).to.equal('dark');
        expect(themeTypeToMermaidTheme('hc')).to.equal('dark');
        expect(themeTypeToMermaidTheme('light')).to.equal('default');
        expect(themeTypeToMermaidTheme('hcLight')).to.equal('default');
    });

    function container(html: string): HTMLElement {
        const node = document.createElement('div');
        node.innerHTML = html;
        return node;
    }

    it('finds <pre> blocks that wrap a mermaid code fence', () => {
        const node = container(
            '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>' +
            '<pre><code class="language-js">const x = 1;</code></pre>' +
            '<p>text</p>'
        );
        const blocks = findMermaidBlocks(node);
        expect(blocks).to.have.lengthOf(1);
        expect(blocks[0].tagName).to.equal('PRE');
    });

    it('returns an empty array when there are no mermaid blocks', () => {
        const node = container('<pre><code class="language-js">x</code></pre><p>none</p>');
        expect(findMermaidBlocks(node)).to.have.lengthOf(0);
    });

    it('extracts the diagram source text from a block', () => {
        const node = container('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
        const [block] = findMermaidBlocks(node);
        expect(extractMermaidSource(block)).to.equal('graph TD; A-->B;');
    });
});
