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
 * The user asked to open a binary or oversized file, was asked whether to open
 * it as text anyway, and said no. `FileResource` rethrows the original read
 * error so the editor open fails, and because tree and drop opens are
 * fire-and-forget it surfaces as an unhandled rejection. The user already saw
 * the prompt; there is nothing further to report.
 */
const DECLINED_OPEN_AS_TEXT = [
    /^File seems to be binary and cannot be opened as text$/,
    /^Unable to read file '[^']*' \(Error: Unable to read file '[^']*' that is too large to open\)$/,
];

/**
 * A Monaco/VS Code `CancellationError` that nobody caught. VS Code's own
 * unexpected-error handler ignores these; they mean an operation was
 * superseded, not that it failed.
 */
const isCancellation = (type: string | undefined, value: string | undefined): boolean =>
    type === 'Canceled' && value === 'Canceled';

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
    return values.some(({ type, value }) => value !== undefined && (
        BROKEN_PIPE_WRITE.test(value)
        || DECLINED_OPEN_AS_TEXT.some(pattern => pattern.test(value))
        || isCancellation(type, value)
    ));
}
