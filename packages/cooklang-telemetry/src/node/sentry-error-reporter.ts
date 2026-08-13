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

import * as Sentry from '@sentry/node';
import { injectable } from '@theia/core/shared/inversify';
import { ErrorReporter } from '../common/error-reporter';

@injectable()
export class SentryErrorReporter implements ErrorReporter {

    reportUnexpected(error: unknown, tags?: Record<string, string>): void {
        // No client means the user opted out, or this is an unpackaged build.
        // Nothing to do, and nothing to warn about.
        if (!Sentry.getClient()) {
            return;
        }
        Sentry.captureException(error, tags ? { tags } : undefined);
    }
}
