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
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { QuickPickService, QuickPickItem, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { EditorManager, EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID, ReportTemplates, BuiltInReportTemplate } from '../common';
import { ReportWidget, ReportWidgetOptions, REPORT_WIDGET_ID, createReportWidgetId } from './report-widget';

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
}

// ---------------------------------------------------------------------------
// ReportContribution
// ---------------------------------------------------------------------------

@injectable()
export class ReportContribution implements CommandContribution, MenuContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    // --- CommandContribution ---

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CooklangReportCommands.RENDER_REPORT, {
            execute: () => this.renderReport(),
            isEnabled: () => this.getActiveCooklangEditorUri() !== undefined,
        });
    }

    // --- MenuContribution ---

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...EDITOR_CONTEXT_MENU, 'navigation'], {
            commandId: CooklangReportCommands.RENDER_REPORT.id,
            when: 'resourceExtname == .cook',
        });
    }

    // --- Command execution ---

    protected async renderReport(): Promise<void> {
        const uri = this.getActiveCooklangEditorUri();
        if (!uri) {
            return;
        }
        if (uri.path.ext === '.menu') {
            this.messageService.info(
                nls.localize('theia/cooklang/reportMenuUnsupported', 'Reports are not supported for menu files yet.')
            );
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
            configJson: await this.buildConfigJson(),
        };
        const widget = await this.getOrCreateReport(options);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    /**
     * Returns the URI of the active editor when its language is Cooklang,
     * or `undefined` otherwise.
     */
    protected getActiveCooklangEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const { languageId, uri } = editorWidget.editor.document;
        if (languageId !== COOKLANG_LANGUAGE_ID) {
            return undefined;
        }
        return new URI(uri);
    }

    /**
     * Shows a QuickPick of workspace templates (config/reports/*.jinja|j2|jinja2)
     * followed by the built-in templates.
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
                items.push({ label: template.label, description: ReportTemplates.WORKSPACE_TEMPLATE_DIR, template });
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
        switch (template.id) {
            case 'builtin:ingredients':
                return nls.localize('theia/cooklang/templateIngredients', 'Ingredients List (built-in)');
            case 'builtin:shopping-list':
                return nls.localize('theia/cooklang/templateShoppingList', 'Shopping List (built-in)');
            default:
                return template.label;
        }
    }

    /**
     * Lists template files in `config/reports/` of the first workspace root.
     */
    protected async findWorkspaceTemplates(): Promise<ReportTemplatePick[]> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return [];
        }
        const dir = root.resource.resolve(ReportTemplates.WORKSPACE_TEMPLATE_DIR);
        try {
            const stat = await this.fileService.resolve(dir);
            if (!stat.isDirectory || !stat.children) {
                return [];
            }
            return stat.children
                .filter(child => !child.isDirectory && ReportTemplates.isTemplateFile(child.name))
                .map(child => ({
                    id: `workspace:${child.resource.toString()}`,
                    label: child.name,
                    uri: child.resource.toString(),
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
            // Directory does not exist — no workspace templates.
            return [];
        }
    }

    /**
     * Builds the render config from workspace conventions. Paths are sent as
     * URI strings; the backend converts them to filesystem paths.
     */
    protected async buildConfigJson(): Promise<string> {
        const config: {
            scale: number;
            basePath?: string;
            aislePath?: string;
            pantryPath?: string;
            datastorePath?: string;
        } = { scale: 1 };
        const root = this.workspaceService.tryGetRoots()[0];
        if (root) {
            config.basePath = root.resource.toString();
            const aisle = root.resource.resolve('config/aisle.conf');
            if (await this.fileService.exists(aisle)) {
                config.aislePath = aisle.toString();
            }
            const pantry = root.resource.resolve('config/pantry.conf');
            if (await this.fileService.exists(pantry)) {
                config.pantryPath = pantry.toString();
            }
            const datastore = root.resource.resolve('db');
            if (await this.fileService.exists(datastore)) {
                config.datastorePath = datastore.toString();
            }
        }
        return JSON.stringify(config);
    }

    /**
     * Returns an existing report widget for (uri, template) — looked up by its
     * widget id among the widgets created by the report factory — otherwise
     * creates one via the widget factory. A fresh `setOptions` re-render is
     * triggered on reuse so the report reflects the latest config.
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
