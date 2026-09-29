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
import { proOfferCopy } from './pro-offer-copy';

describe('proOfferCopy', () => {
    it('offers the free trial to eligible accounts, and is honest about the card', () => {
        const copy = proOfferCopy(true);
        expect(copy.button).to.equal('Start your 7-day free trial of Cook Pro');
        expect(copy.note).to.equal('Card required, cancel anytime before day 7 and you won\'t be charged.');
        expect(copy.action).to.equal('trial');
    });

    it('offers a plain upgrade once the trial is used', () => {
        const copy = proOfferCopy(false);
        expect(copy.button).to.equal('Upgrade to Cook Pro');
        expect(copy.note).to.equal('Opens cook.md in your browser');
        expect(copy.action).to.equal('upgrade');
    });

    it('never names a price (the founding price lives on /pricing)', () => {
        for (const eligible of [true, false]) {
            const copy = proOfferCopy(eligible);
            expect(`${copy.headline} ${copy.body} ${copy.button} ${copy.note}`).not.to.match(/€|\d+\.\d\d/);
        }
    });
});
