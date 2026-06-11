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
import { ReportTemplates } from './report-templates';

describe('ReportTemplates', () => {

    it('recognizes template files by extension, case-insensitively', () => {
        expect(ReportTemplates.isTemplateFile('cost.jinja')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.md.jinja')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.J2')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.jinja2')).to.equal(true);
        expect(ReportTemplates.isTemplateFile('cost.txt')).to.equal(false);
        expect(ReportTemplates.isTemplateFile('recipe.cook')).to.equal(false);
    });

    it('derives the output format from the inner extension', () => {
        expect(ReportTemplates.outputFormat('cost.jinja')).to.equal('markdown');
        expect(ReportTemplates.outputFormat('cost.md.jinja')).to.equal('markdown');
        expect(ReportTemplates.outputFormat('report.HTML.j2')).to.equal('html');
        expect(ReportTemplates.outputFormat('page.htm.jinja2')).to.equal('html');
        expect(ReportTemplates.outputFormat('shopping-list.yaml.jinja')).to.equal('text');
        expect(ReportTemplates.outputFormat('data.json.jinja')).to.equal('text');
        expect(ReportTemplates.outputFormat('notes.txt.j2')).to.equal('text');
    });

    it('resolves built-in templates by id', () => {
        for (const template of ReportTemplates.BUILT_IN) {
            expect(ReportTemplates.byId(template.id)).to.equal(template);
            expect(template.content.length).to.be.greaterThan(0);
        }
        expect(ReportTemplates.byId('nope')).to.equal(undefined);
    });
});
