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
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { ReportPresenter } from './report-presenter';
import { ReportWidgetOptions, REPORT_WIDGET_ID, createReportWidgetId } from './report-widget-types';
import { ReportWidget } from './report-widget';

@injectable()
export class ReportWidgetPresenter implements ReportPresenter {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    async show(options: ReportWidgetOptions): Promise<void> {
        const widget = await this.getOrCreateReport(options);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    /**
     * Returns an existing report widget for (uri, template) — looked up by its
     * widget id — otherwise creates one via the widget factory. A fresh
     * `setOptions` re-render is triggered on reuse so the report reflects the
     * latest config/template.
     */
    protected async getOrCreateReport(options: ReportWidgetOptions): Promise<ReportWidget> {
        const widgetId = createReportWidgetId(new URI(options.uri), options.templateId);
        const existing = this.widgetManager.getWidgets(REPORT_WIDGET_ID)
            .find((widget): widget is ReportWidget => widget.id === widgetId);
        if (existing) {
            existing.setOptions(options);
            return existing;
        }
        return this.widgetManager.getOrCreateWidget<ReportWidget>(REPORT_WIDGET_ID, options);
    }
}
