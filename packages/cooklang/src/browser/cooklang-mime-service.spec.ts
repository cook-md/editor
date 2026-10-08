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
import { MimeAssociation } from '@theia/core/lib/browser/mime-service';
import { CooklangMimeService } from './cooklang-mime-service';

// jsdom lacks `CSS.escape` and `matchMedia`, which Monaco's standalone theme
// service needs when `MonacoMimeService` resolves `ILanguageService` in its constructor.
const globalWithCss = globalThis as { CSS?: { escape: (value: string) => string } };
if (!globalWithCss.CSS) {
    globalWithCss.CSS = { escape: (value: string): string => value };
}

const jsdomWindow = window as unknown as { matchMedia?: unknown };
if (!jsdomWindow.matchMedia) {
    jsdomWindow.matchMedia = (): unknown => ({
        matches: false, addEventListener: (): void => undefined, removeEventListener: (): void => undefined,
        addListener: (): void => undefined, removeListener: (): void => undefined
    });
}

describe('CooklangMimeService', () => {

    function create(): { service: CooklangMimeService; associations: () => MimeAssociation[] } {
        const service = new CooklangMimeService();
        return { service, associations: () => (service as unknown as { associations: MimeAssociation[] }).associations };
    }

    it('starts with the built-in associations', () => {
        const { associations } = create();
        expect(associations()).to.deep.equal(CooklangMimeService.BUILT_IN);
    });

    it('appends user associations after the built-ins so they win', () => {
        const { service, associations } = create();
        service.setAssociations([{ id: 'yaml', filepattern: '*.menu' }]);
        expect(associations()).to.deep.equal([...CooklangMimeService.BUILT_IN, { id: 'yaml', filepattern: '*.menu' }]);
    });

    it('restores exactly the built-ins when the user list is emptied', () => {
        const { service, associations } = create();
        service.setAssociations([{ id: 'yaml', filepattern: '*.menu' }]);
        service.setAssociations([]);
        expect(associations()).to.deep.equal(CooklangMimeService.BUILT_IN);
    });
});
