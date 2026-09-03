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

import { ScrubbableEvent } from './scrub';

/**
 * A write to a stdout/stderr pipe nothing is reading any more.
 *
 * Sentry wraps `console.*`, so once the pipe is gone every console call throws
 * and is captured as an error - which is why these arrive attributed to
 * `console.error` / `console.debug` inside Sentry's own bundle rather than to
 * any code of ours. A packaged app whose launching terminal has closed produces
 * them in bursts and there is nothing to fix in response.
 *
 * Anchored deliberately: this is the exact text Node gives a failed stream
 * write. A real file-write failure reads `EIO: i/o error, write '<path>'` and
 * must still be reported.
 */
const BROKEN_PIPE_WRITE = /^write E(IO|PIPE)$/;

/**
 * Whether `event` describes something no change to the app could prevent, and
 * so should never reach Sentry.
 *
 * Keep this list short and each entry anchored. A filter that is too broad
 * hides real regressions, and nothing tells you it happened.
 */
export function isUnactionableError(event: ScrubbableEvent): boolean {
    const values = event.exception?.values;
    if (!values) {
        return false;
    }
    return values.some(({ value }) => value !== undefined && BROKEN_PIPE_WRITE.test(value));
}
