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

export type CookbotGate = 'open' | 'signed_out' | 'trial' | 'upgrade';

export interface CookbotGateInput {
    loggedIn: boolean;
    hasAi: boolean;
    trialEligible: boolean;
}

export function computeCookbotGate({ loggedIn, hasAi, trialEligible }: CookbotGateInput): CookbotGate {
    if (!loggedIn) {
        return 'signed_out';
    }
    if (hasAi) {
        return 'open';
    }
    return trialEligible ? 'trial' : 'upgrade';
}
