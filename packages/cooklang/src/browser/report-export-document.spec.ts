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
import { buildReportExportDocument, REPORT_EXPORT_CSS } from './report-export-document';

describe('buildReportExportDocument', () => {
    it('emits a standalone HTML document with a doctype', () => {
        const doc = buildReportExportDocument({ contentHtml: '<p>hi</p>', title: 'Pancakes' });
        expect(doc.trimStart().toLowerCase()).to.match(/^<!doctype html>/);
    });

    it('inlines the export stylesheet', () => {
        const doc = buildReportExportDocument({ contentHtml: '<p>hi</p>', title: 'Pancakes' });
        expect(doc).to.include('<style>');
        expect(doc).to.include(REPORT_EXPORT_CSS);
    });

    it('embeds the supplied content verbatim', () => {
        // The widget passes content already wrapped in `.theia-cooklang-report-content`;
        // the builder embeds it as-is.
        const doc = buildReportExportDocument({
            contentHtml: '<div class="theia-cooklang-report-content"><p>hi</p></div>',
            title: 'Pancakes'
        });
        expect(doc).to.include('theia-cooklang-report-content');
        expect(doc).to.include('<p>hi</p>');
    });

    it('escapes the title to avoid breaking out of the title element', () => {
        const doc = buildReportExportDocument({ contentHtml: '', title: 'A & B <x>' });
        expect(doc).to.include('<title>A &amp; B &lt;x&gt;</title>');
        expect(doc).to.not.include('<title>A & B <x></title>');
    });
});
