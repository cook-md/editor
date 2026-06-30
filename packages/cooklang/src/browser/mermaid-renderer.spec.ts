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

// `renderDiagram` builds DOM, so set up jsdom before importing the module.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    themeTypeToMermaidTheme,
    MermaidRenderer,
    MERMAID_WRAPPER_CLASS,
    MERMAID_ERROR_CLASS
} from './mermaid-renderer';

after(() => disableJSDOM());

describe('mermaid-renderer helpers', () => {

    it('maps theme types to mermaid themes', () => {
        expect(themeTypeToMermaidTheme('dark')).to.equal('dark');
        expect(themeTypeToMermaidTheme('hc')).to.equal('dark');
        expect(themeTypeToMermaidTheme('light')).to.equal('default');
        expect(themeTypeToMermaidTheme('hcLight')).to.equal('default');
    });
});

// A stand-in for the mermaid module's default export. `render` either returns
// an SVG string or throws, depending on `shouldThrow`, so the spec can exercise
// the success/error branches without the real (browser-only) mermaid runtime.
function mockMermaid(options: { shouldThrow?: boolean } = {}): import('mermaid').Mermaid {
    return {
        initialize: () => { /* no-op */ },
        render: async (id: string, source: string) => {
            if (options.shouldThrow) {
                throw new Error(`Parse error: ${source}`);
            }
            return { svg: `<svg data-id="${id}">${source}</svg>` };
        }
    } as unknown as import('mermaid').Mermaid;
}

describe('MermaidRenderer.renderDiagram', () => {

    // Subclass that forces the mermaid module to fail to load, exercising the
    // graceful-degradation branch without depending on the real (browser-only)
    // mermaid runtime.
    class FailingMermaidRenderer extends MermaidRenderer {
        protected override load(): Promise<typeof import('mermaid')> {
            return Promise.reject(new Error('boom'));
        }
    }

    // Subclass backed by a mock mermaid module so the success/error render
    // branches can be tested in jsdom.
    class MockMermaidRenderer extends MermaidRenderer {
        constructor(protected readonly mermaid: import('mermaid').Mermaid) {
            super();
        }
        protected override load(): Promise<typeof import('mermaid')> {
            return Promise.resolve({ default: this.mermaid } as typeof import('mermaid'));
        }
    }

    it('falls back to the raw source when mermaid fails to load', async () => {
        const renderer = new FailingMermaidRenderer();
        const source = 'graph TD; A-->B;';
        const wrapper = await renderer.renderDiagram(source, 'default');
        expect(wrapper.classList.contains(MERMAID_WRAPPER_CLASS)).to.equal(true);
        expect(wrapper.classList.contains(MERMAID_ERROR_CLASS)).to.equal(false);
        expect(wrapper.getAttribute('data-mermaid-src')).to.equal(source);
        expect(wrapper.textContent).to.equal(source);
    });

    it('wraps a successful render as an SVG with the source recorded', async () => {
        const module = mockMermaid();
        const renderer = new MockMermaidRenderer(module);
        const wrapper = await renderer.renderDiagram('graph TD; A-->B;', 'default');
        expect(wrapper.classList.contains(MERMAID_WRAPPER_CLASS)).to.equal(true);
        expect(wrapper.classList.contains(MERMAID_ERROR_CLASS)).to.equal(false);
        expect(wrapper.getAttribute('data-mermaid-src')).to.equal('graph TD; A-->B;');
        expect(wrapper.querySelector('svg')).to.exist;
    });

    it('shows an inline error block when a diagram fails to parse', async () => {
        const module = mockMermaid({ shouldThrow: true });
        const renderer = new MockMermaidRenderer(module);
        const wrapper = await renderer.renderDiagram('graph TD; A--(', 'default');
        expect(wrapper.classList.contains(MERMAID_ERROR_CLASS)).to.equal(true);
        expect(wrapper.getAttribute('data-mermaid-src')).to.equal('graph TD; A--(');
        expect(wrapper.textContent).to.contain('Parse error');
    });

    it('initializes mermaid only once across diagrams sharing a theme', async () => {
        let initializeCalls = 0;
        const module = {
            initialize: () => { initializeCalls++; },
            render: async (id: string, source: string) => ({ svg: `<svg>${source}</svg>` })
        } as unknown as import('mermaid').Mermaid;
        const renderer = new MockMermaidRenderer(module);
        await renderer.renderDiagram('graph TD; A-->B;', 'default');
        await renderer.renderDiagram('graph TD; C-->D;', 'default');
        expect(initializeCalls).to.equal(1);
        await renderer.renderDiagram('graph TD; E-->F;', 'dark');
        expect(initializeCalls).to.equal(2);
    });
});

describe('MermaidRenderer.renderExport', () => {

    class MockMermaidRenderer extends MermaidRenderer {
        constructor(protected readonly mermaid: import('mermaid').Mermaid) {
            super();
        }
        protected override load(): Promise<typeof import('mermaid')> {
            return Promise.resolve({ default: this.mermaid } as typeof import('mermaid'));
        }
    }

    it('re-renders wrappers from their recorded source', async () => {
        const rendered: string[] = [];
        const module = {
            initialize: () => { /* no-op */ },
            render: async (id: string, source: string) => {
                rendered.push(source);
                return { svg: `<svg data-export="1">${source}</svg>` };
            }
        } as unknown as import('mermaid').Mermaid;

        const container = document.createElement('div');
        container.innerHTML =
            '<div class="theia-cooklang-mermaid theia-cooklang-mermaid-error" data-mermaid-src="graph TD; A-->B;">old</div>' +
            '<div class="theia-cooklang-mermaid" data-mermaid-src="graph TD; C-->D;"><svg>old</svg></div>' +
            '<p>not a diagram</p>';

        await new MockMermaidRenderer(module).renderExport(container, 'default');

        expect(rendered).to.deep.equal(['graph TD; A-->B;', 'graph TD; C-->D;']);
        const wrappers = container.querySelectorAll('.theia-cooklang-mermaid');
        expect(wrappers[0].querySelector('svg[data-export="1"]')).to.exist;
        // The stale error class is cleared once the diagram renders successfully.
        expect(wrappers[0].classList.contains(MERMAID_ERROR_CLASS)).to.equal(false);
    });
});
