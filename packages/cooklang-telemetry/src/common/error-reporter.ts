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

export const ErrorReporter = Symbol('ErrorReporter');

/**
 * Reports a caught error that would otherwise be invisible to error tracking.
 *
 * Sentry only captures unhandled exceptions and unhandled rejections on its
 * own. Anything caught and turned into a message for the user - which is most
 * of what a user actually reports - has to be handed over explicitly.
 *
 * This interface deliberately carries no policy: deciding which failures are
 * worth reporting belongs to the code that understands them.
 */
export interface ErrorReporter {
    reportUnexpected(error: unknown, tags?: Record<string, string>): void;
}
