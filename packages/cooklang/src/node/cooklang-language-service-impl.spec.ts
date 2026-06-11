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
import { CooklangLanguageServiceImpl } from './cooklang-language-service-impl';

describe('CooklangLanguageServiceImpl report config conversion', () => {

    it('converts URI entries to filesystem paths', () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = impl['convertReportConfigPaths'](JSON.stringify({
            scale: 1,
            basePath: 'file:///tmp/workspace',
            aislePath: 'file:///tmp/workspace/config/aisle.conf'
        }));
        const config = JSON.parse(result);
        expect(config.scale).to.equal(1);
        expect(config.basePath).to.equal('/tmp/workspace');
        expect(config.aislePath).to.equal('/tmp/workspace/config/aisle.conf');
    });

    it('leaves absent path entries absent', () => {
        const impl = new CooklangLanguageServiceImpl();
        const config = JSON.parse(impl['convertReportConfigPaths']('{"scale":2}'));
        expect(config).to.deep.equal({ scale: 2 });
    });

    it('returns the error contract for malformed config JSON', async () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = JSON.parse(await impl.renderReport('', '', 'not json'));
        expect(result.error).to.be.a('string').that.is.not.empty;
    });
});
