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

import { nls } from '@theia/core/lib/common/nls';

export interface ProOfferCopy {
    headline: string;
    body: string;
    button: string;
    note: string;
    /** What the button does, for the cookbot_gate_clicked event. */
    action: 'trial' | 'upgrade';
}

/** The Cook Pro offer, worded the same in the CookBot gate and the Account panel. */
export function proOfferCopy(trialEligible: boolean): ProOfferCopy {
    const headline = nls.localize('theia/cooklang-account/offer/headline', 'CookBot plans your week from your recipes');
    const body = nls.localize('theia/cooklang-account/offer/body',
        'Ask for a week of dinners, a shopping list, or to hit a protein target. It reads and edits your .cook files.');
    if (trialEligible) {
        return {
            headline, body, action: 'trial',
            button: nls.localize('theia/cooklang-account/offer/trialButton', 'Start your 7-day free trial of Cook Pro'),
            note: nls.localize('theia/cooklang-account/offer/trialNote',
                'Card required, cancel anytime before day 7 and you won\'t be charged.'),
        };
    }
    return {
        headline, body, action: 'upgrade',
        button: nls.localize('theia/cooklang-account/offer/upgradeButton', 'Upgrade to Cook Pro'),
        note: nls.localize('theia/cooklang-account/offer/upgradeNote', 'Opens cook.md in your browser'),
    };
}
