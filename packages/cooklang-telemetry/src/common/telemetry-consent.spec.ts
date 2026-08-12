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
import { parseErrorReportingConsent } from './telemetry-consent';

describe('parseErrorReportingConsent', () => {

    // Opt-out: the absence of a stored choice means the user has not opted out.
    it('is enabled when the file is missing', () => {
        expect(parseErrorReportingConsent(undefined)).to.be.true;
    });

    it('is enabled when the file is empty', () => {
        expect(parseErrorReportingConsent('')).to.be.true;
    });

    it('is enabled when the file is not valid JSON', () => {
        expect(parseErrorReportingConsent('{ not json')).to.be.true;
    });

    it('is enabled when the flag is absent from an otherwise valid file', () => {
        expect(parseErrorReportingConsent('{"somethingElse": true}')).to.be.true;
    });

    it('is disabled only on an explicit false', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": false}')).to.be.false;
    });

    it('is enabled on an explicit true', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": true}')).to.be.true;
    });

    // A non-boolean must not be coerced: `"false"` is truthy in JS, and silently
    // enabling reporting because of a malformed value is the wrong direction to fail.
    it('is disabled when the flag is the string "false"', () => {
        expect(parseErrorReportingConsent('{"errorReportingEnabled": "false"}')).to.be.false;
    });
});
