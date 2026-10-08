// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { WidgetDescription } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { CooklangShellLayoutRestorer } from './cooklang-shell-layout-restorer';
import { REPORT_WIDGET_ID } from './report-widget-types';

describe('CooklangShellLayoutRestorer.sanitize', () => {

    const descriptionOf = (factoryId: string, options: object): WidgetDescription => ({ constructionOptions: { factoryId, options } });

    it('drops configJson from a report description without mutating the input', () => {
        const input = descriptionOf(REPORT_WIDGET_ID, { uri: 'file:///a.cook', configJson: '{"nutritionToken":"secret"}' });
        const result = CooklangShellLayoutRestorer.sanitize(input);
        expect(result).to.not.equal(input);
        expect(result.constructionOptions.options).to.deep.equal({ uri: 'file:///a.cook' });
        expect((input.constructionOptions.options as { configJson?: string }).configJson).to.equal('{"nutritionToken":"secret"}');
    });

    it('returns the same object when a report description has no configJson', () => {
        const input = descriptionOf(REPORT_WIDGET_ID, { uri: 'file:///a.cook' });
        expect(CooklangShellLayoutRestorer.sanitize(input)).to.equal(input);
    });

    it('leaves non-report factories untouched', () => {
        const input = descriptionOf('other-widget', { configJson: 'x' });
        expect(CooklangShellLayoutRestorer.sanitize(input)).to.equal(input);
    });
});
