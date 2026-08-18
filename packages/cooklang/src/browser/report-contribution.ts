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
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common/menu';
import { QuickPickService, QuickPickItem, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { nls } from '@theia/core/lib/common/nls';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser';
import { ReportTemplates, BuiltInReportTemplate } from '../common';
import { ReportWidgetOptions } from './report-widget-types';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';
import { ReportTemplateFinder } from './report-template-finder';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export namespace CooklangReportCommands {
    export const RENDER_REPORT: Command = Command.toLocalizedCommand({
        id: 'cooklang.renderReport',
        label: 'Cooklang: Render Report...',
        iconClass: 'codicon codicon-output'
    }, 'theia/cooklang/renderReport');
}

/** A template choice offered in the QuickPick. */
interface ReportTemplatePick {
    id: string;
    label: string;
    uri?: string;
    /** Workspace-relative directory the template came from, shown in the QuickPick. */
    description?: string;
}

// ---------------------------------------------------------------------------
// ReportContribution
// ---------------------------------------------------------------------------

@injectable()
export class ReportContribution implements CommandContribution, MenuContribution {

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(ReportTemplateFinder)
    protected readonly templateFinder: ReportTemplateFinder;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(ReportPresenter)
    protected readonly reportPresenter: ReportPresenter;

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportCommands.RENDER_REPORT, {
            execute: () => this.renderReport(),
            isEnabled: () => this.reportConfigService.getActiveCooklangUri() !== undefined,
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...EDITOR_CONTEXT_MENU, 'navigation'], {
            commandId: CooklangReportCommands.RENDER_REPORT.id,
            when: 'resourceExtname == .cook || resourceExtname == .menu',
        });
    }

    // --- Command execution ---

    protected async renderReport(): Promise<void> {
        const uri = this.reportConfigService.getActiveCooklangUri();
        if (!uri) {
            return;
        }
        const template = await this.pickTemplate();
        if (!template) {
            return;
        }
        const options: ReportWidgetOptions = {
            uri: uri.toString(),
            templateId: template.id,
            templateLabel: template.label,
            templateUri: template.uri,
            configJson: await this.reportConfigService.buildConfigJson(1, uri),
        };
        await this.reportPresenter.show(options);
    }

    /**
     * Shows a QuickPick of workspace templates (*.jinja|j2|jinja2 in template
     * directories) followed by the built-in templates.
     */
    protected async pickTemplate(): Promise<ReportTemplatePick | undefined> {
        const workspaceTemplates = await this.findWorkspaceTemplates();
        const items: Array<(QuickPickItem & { template: ReportTemplatePick }) | QuickPickSeparator> = [];
        if (workspaceTemplates.length > 0) {
            items.push({
                type: 'separator',
                label: nls.localize('theia/cooklang/workspaceTemplates', 'Workspace Templates'),
            });
            for (const template of workspaceTemplates) {
                items.push({ label: template.label, description: template.description, template });
            }
        }
        items.push({
            type: 'separator',
            label: nls.localize('theia/cooklang/builtInTemplates', 'Built-in Templates'),
        });
        for (const builtIn of ReportTemplates.BUILT_IN) {
            const label = this.localizeBuiltInLabel(builtIn);
            items.push({ label, template: { id: builtIn.id, label } });
        }
        const picked = await this.quickPickService.show(items, {
            placeholder: nls.localize('theia/cooklang/pickReportTemplate', 'Select a report template'),
        });
        return picked && 'template' in picked ? picked.template : undefined;
    }

    /**
     * Built-in template labels are user-facing; localize them at the display
     * point (the stored labels double as stable fallbacks).
     */
    protected localizeBuiltInLabel(template: BuiltInReportTemplate): string {
        return template.localizationKey
            ? nls.localize(template.localizationKey, template.label)
            : template.label;
    }

    /** Workspace templates as QuickPick entries; the finder does the searching. */
    protected async findWorkspaceTemplates(): Promise<ReportTemplatePick[]> {
        const templates = await this.templateFinder.findWorkspaceTemplates();
        return templates.map(template => ({
            id: template.id,
            label: template.label,
            uri: template.uri,
            description: template.directory,
        }));
    }
}
