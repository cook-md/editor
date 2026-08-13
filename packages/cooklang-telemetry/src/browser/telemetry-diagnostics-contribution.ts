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

import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TelemetryDiagnostics } from '../common/telemetry-diagnostics';

export const SendTestErrorFromRendererCommand = Command.toLocalizedCommand(
    {
        id: 'cooklang.telemetry.sendTestError.renderer',
        category: 'Cook Editor',
        label: 'Send Test Error to Sentry (Window)'
    },
    'theia/cooklang-telemetry/sendTestError/renderer'
);

export const SendTestErrorFromBackendCommand = Command.toLocalizedCommand(
    {
        id: 'cooklang.telemetry.sendTestError.backend',
        category: 'Cook Editor',
        label: 'Send Test Error to Sentry (Backend)'
    },
    'theia/cooklang-telemetry/sendTestError/backend'
);

/**
 * Deliberate errors for confirming that reporting works in a packaged build.
 *
 * These are the only practical way to verify the backend path: the obvious
 * lever from outside the app - an unreachable server - produces an expected
 * failure that is intentionally not reported.
 */
@injectable()
export class TelemetryDiagnosticsContribution implements CommandContribution {

    @inject(TelemetryDiagnostics)
    protected readonly diagnostics: TelemetryDiagnostics;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SendTestErrorFromRendererCommand, {
            execute: () => this.throwInRenderer()
        });
        registry.registerCommand(SendTestErrorFromBackendCommand, {
            execute: () => this.reportFromBackend()
        });
    }

    protected throwInRenderer(): void {
        this.messageService.info('Throwing a test error in this window. It should appear in Sentry shortly.');
        // Deferred so it becomes an unhandled error rather than being caught by
        // the command invocation, which is what the renderer SDK reports.
        setTimeout(() => {
            throw new Error('Cook Editor test error (renderer). Triggered deliberately to verify error reporting.');
        });
    }

    protected async reportFromBackend(): Promise<void> {
        await this.diagnostics.triggerTestError();
        this.messageService.info('Reported a test error from the backend. It should appear in Sentry shortly.');
    }
}
