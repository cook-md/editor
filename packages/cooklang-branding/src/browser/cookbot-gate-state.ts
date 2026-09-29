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

export type CookbotGate = 'open' | 'signed_out' | 'loading' | 'trial' | 'upgrade';

export interface CookbotGateInput {
    loggedIn: boolean;
    hasAi: boolean;
    /** `undefined` while the subscription hasn't loaded yet. */
    trialEligible: boolean | undefined;
}

export function computeCookbotGate({ loggedIn, hasAi, trialEligible }: CookbotGateInput): CookbotGate {
    if (!loggedIn) {
        return 'signed_out';
    }
    if (hasAi) {
        return 'open';
    }
    if (trialEligible === undefined) {
        return 'loading';
    }
    return trialEligible ? 'trial' : 'upgrade';
}

/** How long "Start 7-day free trial" keeps waiting for the browser login to finish. */
export const TRIAL_CONTINUATION_TTL_MS = 10 * 60 * 1000;

export function isTrialRequestPending(requestedAt: number | undefined, now: number, ttlMs = TRIAL_CONTINUATION_TTL_MS): boolean {
    return requestedAt !== undefined && now - requestedAt < ttlMs;
}

export type TrialContinuation = 'none' | 'wait' | 'start' | 'drop';

export interface TrialContinuationInput {
    /** When the signed-out user chose "Start 7-day free trial", if they did. */
    requestedAt: number | undefined;
    now: number;
    loggedIn: boolean;
    hasAi: boolean;
    /** `undefined` while the subscription hasn't loaded yet. */
    trialEligible: boolean | undefined;
}

/**
 * What to do with a "trial after login" request. `start` and `drop` both
 * consume the request; `wait` keeps it for the next auth or subscription change.
 * A used-up trial drops the request: the upgrade gate shows instead of
 * opening checkout under trial wording.
 */
export function decideTrialContinuation({ requestedAt, now, loggedIn, hasAi, trialEligible }: TrialContinuationInput): TrialContinuation {
    if (!isTrialRequestPending(requestedAt, now)) {
        return 'none';
    }
    if (!loggedIn || (!hasAi && trialEligible === undefined)) {
        return 'wait';
    }
    return !hasAi && trialEligible === true ? 'start' : 'drop';
}
