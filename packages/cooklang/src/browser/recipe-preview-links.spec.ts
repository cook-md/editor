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

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetadataPills, LinkedText } from './recipe-preview-components';

describe('LinkedText', () => {

    it('renders plain text unchanged', () => {
        const markup = renderToStaticMarkup(React.createElement(LinkedText, { text: 'Simmer gently.' }));
        expect(markup).to.equal('Simmer gently.');
    });

    it('renders an anchor for a url in step text', () => {
        const markup = renderToStaticMarkup(
            React.createElement(LinkedText, { text: 'Method from https://cook.md/x here' })
        );
        expect(markup).to.contain('<a class="recipe-link" href="https://cook.md/x">https://cook.md/x</a>');
        expect(markup).to.contain('Method from ');
        expect(markup).to.contain(' here');
    });
});

describe('MetadataPills', () => {

    it('links a url in a metadata value', () => {
        const markup = renderToStaticMarkup(
            React.createElement(MetadataPills, { meta: { source: 'https://cook.md/recipes/soup' } })
        );
        expect(markup).to.contain('href="https://cook.md/recipes/soup"');
    });

    it('leaves a non-url metadata value alone', () => {
        const markup = renderToStaticMarkup(
            React.createElement(MetadataPills, { meta: { servings: '4' } })
        );
        expect(markup).to.not.contain('<a');
        expect(markup).to.contain('4');
    });
});
