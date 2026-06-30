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

describe('MermaidRenderer.renderDiagram', () => {

    // Subclass that forces the mermaid module to fail to load, exercising the
    // graceful-degradation branch without depending on the real (browser-only)
    // mermaid runtime.
    class FailingMermaidRenderer extends MermaidRenderer {
        protected override load(): Promise<typeof import('mermaid')> {
            return Promise.reject(new Error('boom'));
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
});
