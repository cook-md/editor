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

import { ScrubbableBreadcrumb, ScrubbableEvent, scrubBreadcrumb, scrubEvent } from './scrub';
import { isUnactionableError } from './unactionable-errors';

/**
 * Sentry DSN for the Cook Editor project. A DSN is write-only and not a
 * secret; cook.md treats its own the same way.
 */
export const SENTRY_DSN = 'https://0ab1ee49571b67c4c8fc0384f31d77ce@o4506865729404928.ingest.us.sentry.io/4511898607091712';

/** Set this to `1` to report from a development build. */
export const DEV_OVERRIDE_ENV_VAR = 'COOK_TELEMETRY_DEV';

export interface InitDecision {
    consented: boolean;
    packaged: boolean;
    devOverride: boolean;
}

/**
 * Whether to initialize Sentry at all. Development builds stay silent unless
 * explicitly overridden, so local work does not pollute the project. The
 * override never overrules the user's choice.
 */
export function shouldInitialize(decision: InitDecision): boolean {
    if (!decision.consented) {
        return false;
    }
    return decision.packaged || decision.devOverride;
}

export interface BuildOptionsArgs {
    release: string;
    packaged: boolean;
    homeDir: string;
}

export interface TelemetryOptions {
    dsn: string;
    release: string;
    environment: string;
    sendDefaultPii: false;
    /** Returns `undefined` to drop the event rather than report it. */
    beforeSend(event: ScrubbableEvent): ScrubbableEvent | undefined;
    beforeBreadcrumb(breadcrumb: ScrubbableBreadcrumb): ScrubbableBreadcrumb;
}

/** Options shared by every process, so the three cannot drift apart. */
export function buildOptions(args: BuildOptionsArgs): TelemetryOptions {
    const scrubOptions = { homeDir: args.homeDir };
    return {
        dsn: SENTRY_DSN,
        release: args.release,
        environment: args.packaged ? 'production' : 'development',
        sendDefaultPii: false,
        beforeSend: event => isUnactionableError(event) ? undefined : scrubEvent(event, scrubOptions),
        beforeBreadcrumb: breadcrumb => scrubBreadcrumb(breadcrumb, scrubOptions)
    };
}
