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

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common/command';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ReportWidget } from './report-widget';
import { ReportExportService, ReportExportResult } from '../common/report-export-protocol';

export namespace CooklangReportExportCommands {
    export const PRINT: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.print',
        label: 'Cooklang: Print Report',
        iconClass: 'codicon codicon-printer'
    }, 'theia/cooklang/printReport');
    export const EXPORT_PDF: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.exportPdf',
        label: 'Cooklang: Export Report as PDF',
        iconClass: 'codicon codicon-file-pdf'
    }, 'theia/cooklang/exportReportPdf');
    export const EXPORT_PNG: Command = Command.toLocalizedCommand({
        id: 'cooklang.report.exportPng',
        label: 'Cooklang: Export Report as PNG',
        iconClass: 'codicon codicon-device-camera'
    }, 'theia/cooklang/exportReportPng');
}

@injectable()
export class ReportExportContribution implements CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(ReportExportService)
    protected readonly exportService: ReportExportService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportExportCommands.PRINT, {
            execute: (arg?: unknown) => this.print(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
        commands.registerCommand(CooklangReportExportCommands.EXPORT_PDF, {
            execute: (arg?: unknown) => this.exportPdf(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
        commands.registerCommand(CooklangReportExportCommands.EXPORT_PNG, {
            execute: (arg?: unknown) => this.exportPng(arg),
            isEnabled: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
            isVisible: (arg?: unknown) => this.getReportWidget(arg) !== undefined,
        });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({
            id: CooklangReportExportCommands.PRINT.id + '.toolbar',
            command: CooklangReportExportCommands.PRINT.id,
            tooltip: nls.localize('theia/cooklang/printReport', 'Print Report'),
            isVisible: widget => widget instanceof ReportWidget,
        });
        toolbar.registerItem({
            id: CooklangReportExportCommands.EXPORT_PDF.id + '.toolbar',
            command: CooklangReportExportCommands.EXPORT_PDF.id,
            tooltip: nls.localize('theia/cooklang/exportReportPdf', 'Export Report as PDF'),
            isVisible: widget => widget instanceof ReportWidget,
        });
        toolbar.registerItem({
            id: CooklangReportExportCommands.EXPORT_PNG.id + '.toolbar',
            command: CooklangReportExportCommands.EXPORT_PNG.id,
            tooltip: nls.localize('theia/cooklang/exportReportPng', 'Export Report as PNG'),
            isVisible: widget => widget instanceof ReportWidget,
        });
    }

    protected getReportWidget(arg?: unknown): ReportWidget | undefined {
        if (arg instanceof ReportWidget) {
            return arg;
        }
        const current: Widget | undefined = this.shell.getCurrentWidget('main');
        return current instanceof ReportWidget ? current : undefined;
    }

    protected async print(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        try {
            await this.exportService.print(document.html);
        } catch (error) {
            this.showError(error);
        }
    }

    protected async exportPdf(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        this.report(await this.exportService.exportPdf(document.html, document.defaultFileName));
    }

    protected async exportPng(arg?: unknown): Promise<void> {
        const document = this.getReportWidget(arg)?.getExportDocument();
        if (!document) {
            return;
        }
        this.report(await this.exportService.exportPng(document.html, document.defaultFileName));
    }

    protected report(result: ReportExportResult): void {
        if (result.error) {
            this.messageService.error(
                nls.localize('theia/cooklang/exportReportFailed', 'Report export failed: {0}', result.error)
            );
        }
    }

    protected showError(error: unknown): void {
        this.messageService.error(
            nls.localize('theia/cooklang/exportReportFailed', 'Report export failed: {0}',
                error instanceof Error ? error.message : String(error))
        );
    }
}
