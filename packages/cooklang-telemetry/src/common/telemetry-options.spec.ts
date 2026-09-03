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
import { shouldInitialize, buildOptions } from './telemetry-options';

describe('shouldInitialize', () => {

    it('does not initialize when the user opted out, even when packaged', () => {
        expect(shouldInitialize({ consented: false, packaged: true, devOverride: false })).to.be.false;
    });

    // Local development must not pollute the project with errors from work in progress.
    it('does not initialize in development by default', () => {
        expect(shouldInitialize({ consented: true, packaged: false, devOverride: false })).to.be.false;
    });

    it('initializes in development when explicitly overridden', () => {
        expect(shouldInitialize({ consented: true, packaged: false, devOverride: true })).to.be.true;
    });

    // The override is a developer convenience, not a way around the user's choice.
    it('does not initialize on the dev override when the user opted out', () => {
        expect(shouldInitialize({ consented: false, packaged: false, devOverride: true })).to.be.false;
    });

    it('initializes when packaged and consented', () => {
        expect(shouldInitialize({ consented: true, packaged: true, devOverride: false })).to.be.true;
    });
});

describe('buildOptions', () => {

    it('tags the release and environment', () => {
        const options = buildOptions({ release: '0.1.0-alpha.36', packaged: true, homeDir: '/Users/jane' });
        expect(options.release).to.equal('0.1.0-alpha.36');
        expect(options.environment).to.equal('production');
        expect(options.dsn).to.contain('ingest.us.sentry.io');
    });

    it('marks a non-packaged build as development', () => {
        const options = buildOptions({ release: '0.0.0', packaged: false, homeDir: '/Users/jane' });
        expect(options.environment).to.equal('development');
    });

    it('never sends default PII', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        expect(options.sendDefaultPii).to.be.false;
    });

    it('scrubs events through beforeSend', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        const scrubbed = options.beforeSend({
            exception: { values: [{ value: 'failed at /Users/jane/Recipes/x.cook' }] },
            extra: { recipeContent: 'Add @salt{}' }
        });
        expect(scrubbed!.exception!.values![0].value).to.equal('failed at ~/Recipes/x.cook');
        expect(scrubbed!.extra).to.not.have.property('recipeContent');
    });

    it('drops unactionable events instead of reporting them', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        const dropped = options.beforeSend({ exception: { values: [{ value: 'write EIO' }] } });
        expect(dropped).to.be.undefined;
    });

    it('scrubs breadcrumbs through beforeBreadcrumb', () => {
        const options = buildOptions({ release: '0.0.0', packaged: true, homeDir: '/Users/jane' });
        const scrubbed = options.beforeBreadcrumb({ message: 'opened /Users/jane/a.cook' });
        expect(scrubbed.message).to.equal('opened ~/a.cook');
    });
});
