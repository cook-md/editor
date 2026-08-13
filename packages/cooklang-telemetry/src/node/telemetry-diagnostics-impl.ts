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

import { inject, injectable } from '@theia/core/shared/inversify';
import { ErrorReporter } from '../common/error-reporter';
import { TelemetryDiagnostics } from '../common/telemetry-diagnostics';

@injectable()
export class TelemetryDiagnosticsImpl implements TelemetryDiagnostics {

    @inject(ErrorReporter)
    protected readonly errorReporter: ErrorReporter;

    async triggerTestError(): Promise<void> {
        // Reported rather than thrown, so this exercises the explicit-capture
        // path that real caught failures use - the one that would otherwise
        // never be verified.
        this.errorReporter.reportUnexpected(
            new Error('Cook Editor test error (backend). Triggered deliberately to verify error reporting.'),
            { component: 'telemetry-diagnostics', testError: 'true' }
        );
    }
}
