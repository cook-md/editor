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

import { injectable, inject, postConstruct, interfaces } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { Markdown } from '@theia/core/lib/browser/markdown-rendering/markdown';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { nls } from '@theia/core/lib/common/nls';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import * as DOMPurify from '@theia/core/shared/dompurify';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID, ReportOutputFormat, ReportTemplates } from '../common';
import { ReportWidgetOptions, createReportWidgetId } from './report-widget-types';
import { buildReportExportDocument } from './report-export-document';
import { MermaidRenderer, themeTypeToMermaidTheme } from './mermaid-renderer';

import '../../src/browser/style/report.css';

// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export { REPORT_WIDGET_ID, createReportWidgetId } from './report-widget-types';
export type { ReportWidgetOptions } from './report-widget-types';

// ---------------------------------------------------------------------------
// ReportWidget
// ---------------------------------------------------------------------------

@injectable()
export class ReportWidget extends ReactWidget implements Navigatable {

    @inject(CooklangLanguageService)
    protected readonly service: CooklangLanguageService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MarkdownRenderer)
    protected readonly markdownRenderer: MarkdownRenderer;

    @inject(MermaidRenderer)
    protected readonly mermaidRenderer: MermaidRenderer;

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    protected uri: URI;
    protected options: ReportWidgetOptions;
    protected output: string | undefined;
    protected errorMessage: string | undefined;
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected renderSequence = 0;

    @postConstruct()
    protected init(): void {
        this.addClass('theia-cooklang-report');
        this.node.tabIndex = 0;
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.toDispose.push(
            this.monacoWorkspace.onDidChangeTextDocument(event => {
                const changedUri = event.model.uri;
                const isRecipeChange = changedUri === this.uri?.toString()
                    && event.model.languageId === COOKLANG_LANGUAGE_ID;
                const isTemplateChange = !!this.options?.templateUri
                    && changedUri === this.options.templateUri;
                if (isRecipeChange || isTemplateChange) {
                    this.debouncedRender();
                }
            })
        );
        this.toDispose.push(
            this.themeService.onDidColorThemeChange(() => this.update())
        );
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    /**
     * Bind this widget to a recipe + template and trigger the first render.
     */
    setOptions(options: ReportWidgetOptions): void {
        this.options = options;
        this.uri = new URI(options.uri);
        this.id = createReportWidgetId(this.uri, options.templateId);
        this.title.label = nls.localize('theia/cooklang/reportTabTitle', 'Report: {0} ({1})', this.uri.path.base, options.templateLabel);
        this.title.caption = this.title.label;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-output';
        this.renderReport();
    }

    // --- Navigatable ---

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    // --- Export ---

    /**
     * Build a self-contained, print-friendly HTML document from the currently
     * rendered report, plus a sensible default file name. Mermaid diagrams are
     * re-rendered in the light theme so they stay legible on white paper.
     * Resolves to `undefined` while the report is still loading or in an error
     * state.
     */
    async getExportDocument(): Promise<{ html: string; defaultFileName: string } | undefined> {
        if (this.errorMessage !== undefined || this.output === undefined) {
            return undefined;
        }
        const contentNode = this.node.querySelector(
            '.theia-cooklang-report-content, .theia-cooklang-report-text'
        );
        if (!contentNode) {
            return undefined;
        }
        const clone = contentNode.cloneNode(true) as HTMLElement;
        // Re-render diagrams in the light theme so they print legibly on white.
        await this.mermaidRenderer.renderExport(clone, 'default');
        const html = buildReportExportDocument({
            contentHtml: clone.outerHTML,
            title: this.title.label,
        });
        const defaultFileName = `${this.uri.path.name} - ${this.options.templateLabel}`;
        return { html, defaultFileName };
    }

    // --- Report rendering ---

    protected debouncedRender(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.renderReport();
        }, 300);
    }

    protected async renderReport(): Promise<void> {
        const sequence = ++this.renderSequence;
        let output: string | undefined;
        let errorMessage: string | undefined;
        try {
            const recipe = await this.readRecipeContent();
            const template = await this.readTemplateContent();
            const resultJson = await this.service.renderReport(recipe, template, this.options.configJson);
            const result = JSON.parse(resultJson) as { output?: string; error?: string };
            output = result.output;
            errorMessage = result.error;
            if (output === undefined && errorMessage === undefined) {
                errorMessage = nls.localize('theia/cooklang/reportEmptyResponse', 'Report rendering returned no output.');
            }
        } catch (error) {
            errorMessage = String(error);
        }
        if (this.isDisposed || sequence !== this.renderSequence) {
            return;
        }
        this.output = output;
        this.errorMessage = errorMessage;
        this.update();
    }

    protected async readRecipeContent(): Promise<string> {
        const model = this.monacoWorkspace.getTextDocument(this.uri.toString());
        if (model) {
            return model.getText();
        }
        const content = await this.fileService.read(this.uri);
        return content.value;
    }

    protected async readTemplateContent(): Promise<string> {
        if (this.options.inlineTemplateContent !== undefined) {
            return this.options.inlineTemplateContent;
        }
        if (this.options.templateUri) {
            const model = this.monacoWorkspace.getTextDocument(this.options.templateUri);
            if (model) {
                return model.getText();
            }
            const content = await this.fileService.read(new URI(this.options.templateUri));
            return content.value;
        }
        const builtIn = ReportTemplates.byId(this.options.templateId);
        if (!builtIn) {
            throw new Error(`Unknown built-in report template: ${this.options.templateId}`);
        }
        return builtIn.content;
    }

    // --- Rendering ---

    protected render(): React.ReactNode {
        if (this.errorMessage) {
            return (
                <div className='theia-cooklang-report-error'>
                    <strong>{nls.localize('theia/cooklang/reportError', 'Report rendering failed:')}</strong>
                    <pre>{this.errorMessage}</pre>
                </div>
            );
        }
        if (this.output === undefined) {
            return <div className='theia-cooklang-report-loading'>{nls.localizeByDefault('Loading...')}</div>;
        }
        switch (this.getOutputFormat()) {
            case 'html':
                return (
                    <div
                        className='theia-cooklang-report-content'
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(this.output) }}
                    />
                );
            case 'text':
                return <pre className='theia-cooklang-report-text'>{this.output}</pre>;
            default:
                return (
                    <Markdown
                        markdown={this.output}
                        markdownRenderer={this.markdownRenderer}
                        className='theia-cooklang-report-content'
                        onRender={this.onMarkdownRendered}
                    />
                );
        }
    }

    protected onMarkdownRendered = (element: HTMLElement | undefined): void => {
        if (!element) {
            return;
        }
        const theme = themeTypeToMermaidTheme(this.themeService.getCurrentTheme().type);
        // Fire-and-forget: a stale render is harmless because the next update
        // re-runs this against fresh DOM.
        this.mermaidRenderer.renderInto(element, theme).catch(error =>
            console.error('Mermaid rendering failed', error)
        );
    };

    /**
     * Workspace templates declare their output format via the inner file
     * extension (e.g. `shopping-list.yaml.jinja`); built-ins are markdown.
     */
    protected getOutputFormat(): ReportOutputFormat {
        if (this.options.outputFormat !== undefined) {
            return this.options.outputFormat;
        }
        if (this.options.templateUri) {
            return ReportTemplates.outputFormat(new URI(this.options.templateUri).path.base);
        }
        return 'markdown';
    }

    // --- Disposal ---

    override dispose(): void {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        super.dispose();
    }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a fully initialised {@link ReportWidget} bound to `options`.
 *
 * Uses a child container so each report tab gets its own widget instance
 * while inheriting all parent bindings.
 */
export function createReportWidget(
    container: interfaces.Container,
    options: ReportWidgetOptions
): ReportWidget {
    const child = container.createChild();
    child.bind(ReportWidget).toSelf().inTransientScope();
    const widget = child.get(ReportWidget);
    widget.setOptions(options);
    return widget;
}
