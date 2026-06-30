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
import { themeTypeToMermaidTheme } from './mermaid-renderer';

describe('mermaid-renderer helpers', () => {

    it('maps theme types to mermaid themes', () => {
        expect(themeTypeToMermaidTheme('dark')).to.equal('dark');
        expect(themeTypeToMermaidTheme('hc')).to.equal('dark');
        expect(themeTypeToMermaidTheme('light')).to.equal('default');
        expect(themeTypeToMermaidTheme('hcLight')).to.equal('default');
    });
});
