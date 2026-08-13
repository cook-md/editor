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
import { TelemetryDiagnosticsImpl } from './telemetry-diagnostics-impl';

class RecordingErrorReporter {
    readonly reported: Array<{ error: unknown, tags?: Record<string, string> }> = [];
    reportUnexpected(error: unknown, tags?: Record<string, string>): void {
        this.reported.push({ error, tags });
    }
}

function createDiagnostics(reporter: RecordingErrorReporter): TelemetryDiagnosticsImpl {
    const diagnostics = new TelemetryDiagnosticsImpl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (diagnostics as any).errorReporter = reporter;
    return diagnostics;
}

describe('TelemetryDiagnosticsImpl', () => {

    // The point of this command is to exercise the same path real caught
    // failures take, so a broken reporting pipeline shows up here.
    it('reports through the error reporter', async () => {
        const reporter = new RecordingErrorReporter();
        await createDiagnostics(reporter).triggerTestError();

        expect(reporter.reported).to.have.lengthOf(1);
        expect((reporter.reported[0].error as Error).message).to.contain('test error');
    });

    // So a maintainer can tell a verification event apart from a real one.
    it('tags the event as a deliberate test', async () => {
        const reporter = new RecordingErrorReporter();
        await createDiagnostics(reporter).triggerTestError();

        expect(reporter.reported[0].tags).to.include({ testError: 'true' });
    });

    it('does not throw, so the command reports success to the user', async () => {
        const reporter = new RecordingErrorReporter();
        await createDiagnostics(reporter).triggerTestError();
        expect(reporter.reported).to.have.lengthOf(1);
    });
});
