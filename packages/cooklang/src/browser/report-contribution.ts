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
import { ApplicationShell, Widget, WidgetManager } from '@theia/core/lib/browser';
import { QuickPickService, QuickPickItem, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
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
    /** Workspace-relative directory the template came from, shown in the QuickPick. */
    description?: string;
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
            isEnabled: () => this.getActiveCooklangUri() !== undefined,
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
        const uri = this.getActiveCooklangUri();
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
     * Resolves the recipe URI from the focused widget, the current main-area
     * tab, or the active Cooklang text editor — in that order. `.cook` files
     * open in preview mode by default, and the preview widget never takes DOM
     * focus, so it is reported by `getCurrentWidget('main')` (tab selection)
     * but never by `shell.currentWidget` (focus tracker).
     */
    protected getActiveCooklangUri(): URI | undefined {
        return this.getCooklangResourceUri(this.shell.currentWidget)
            ?? this.getCooklangResourceUri(this.shell.getCurrentWidget('main'))
            ?? this.getActiveCooklangEditorUri();
    }

    /**
     * Returns the widget's resource URI when it is a navigatable showing a
     * `.cook` or `.menu` resource (text editor, recipe preview, report tab).
     */
    protected getCooklangResourceUri(widget: Widget | undefined): URI | undefined {
        if (NavigatableWidget.is(widget)) {
            const uri = widget.getResourceUri();
            if (uri && (uri.path.ext === '.cook' || uri.path.ext === '.menu')) {
                return uri;
            }
        }
        return undefined;
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

    /**
     * Lists template files found in the workspace's template directories
     * (`reports`/`templates` in any case, at the root and under `config/`).
     */
    protected async findWorkspaceTemplates(): Promise<ReportTemplatePick[]> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return [];
        }
        const picks: ReportTemplatePick[] = [];
        for (const dir of await this.resolveTemplateDirectories(root.resource)) {
            const relative = root.resource.relative(dir)?.toString() ?? dir.path.base;
            try {
                const stat = await this.fileService.resolve(dir);
                for (const child of stat.children ?? []) {
                    if (!child.isDirectory && ReportTemplates.isTemplateFile(child.name)) {
                        picks.push({
                            id: `workspace:${child.resource.toString()}`,
                            label: child.name,
                            uri: child.resource.toString(),
                            description: relative,
                        });
                    }
                }
            } catch {
                // Unreadable directory — skip it.
            }
        }
        return picks.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Resolves the directories scanned for templates: children of the
     * workspace root and of `config/` whose name matches a template
     * directory name (case-insensitive).
     */
    protected async resolveTemplateDirectories(root: URI): Promise<URI[]> {
        const directories: URI[] = [];
        const scan = async (parent: URI): Promise<void> => {
            try {
                const stat = await this.fileService.resolve(parent);
                for (const child of stat.children ?? []) {
                    if (child.isDirectory && ReportTemplates.isTemplateDirName(child.name)) {
                        directories.push(child.resource);
                    }
                }
            } catch {
                // Missing directory — nothing to scan.
            }
        };
        await Promise.all([scan(root), scan(root.resolve('config'))]);
        return directories;
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
            const pantry = root.resource.resolve('config/pantry.conf');
            const datastores = [root.resource.resolve('db'), root.resource.resolve('config/db')];
            const [hasAisle, hasPantry, ...hasDatastores] = await Promise.all([
                this.fileService.exists(aisle),
                this.fileService.exists(pantry),
                ...datastores.map(candidate => this.fileService.exists(candidate)),
            ]);
            if (hasAisle) {
                config.aislePath = aisle.toString();
            }
            if (hasPantry) {
                config.pantryPath = pantry.toString();
            }
            const datastore = datastores.find((candidate, index) => hasDatastores[index]);
            if (datastore) {
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
