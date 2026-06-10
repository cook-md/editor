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
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { Markdown } from '@theia/core/lib/browser/markdown-rendering/markdown';
import { nls } from '@theia/core/lib/common/nls';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { CooklangLanguageService, COOKLANG_LANGUAGE_ID, ReportTemplates } from '../common';

import '../../src/browser/style/report.css';

// ---------------------------------------------------------------------------
// Public constants and helpers
// ---------------------------------------------------------------------------

export const REPORT_WIDGET_ID = 'cooklang-report-widget';

export interface ReportWidgetOptions {
    /** URI string of the source `.cook` file. */
    uri: string;
    /** Template id: `builtin:*` or `workspace:<template uri>`. */
    templateId: string;
    /** Human-readable template name for the tab title. */
    templateLabel: string;
    /** URI string of a workspace template file; unset for built-ins. */
    templateUri?: string;
    /** Render config (scale + URI-string paths), passed through to the RPC. */
    configJson: string;
}

/**
 * Constructs a unique widget ID for a report tab tied to a recipe + template.
 */
export function createReportWidgetId(uri: URI, templateId: string): string {
    return `${REPORT_WIDGET_ID}:${templateId}:${uri.toString()}`;
}

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

    protected uri: URI;
    protected options: ReportWidgetOptions;
    protected output: string | undefined;
    protected errorMessage: string | undefined;
    protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
    protected renderSequence = 0;

    @postConstruct()
    protected init(): void {
        this.addClass('cooklang-report');
        this.scrollOptions = {
            suppressScrollX: true,
            minScrollbarLength: 35,
        };
        this.toDispose.push(
            this.monacoWorkspace.onDidChangeTextDocument(event => {
                if (
                    event.model.languageId !== COOKLANG_LANGUAGE_ID ||
                    event.model.uri !== this.uri?.toString()
                ) {
                    return;
                }
                this.debouncedRender();
            })
        );
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
        if (this.options.templateUri) {
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
                <div className='cooklang-report-error'>
                    <strong>{nls.localize('theia/cooklang/reportError', 'Report rendering failed:')}</strong>
                    <pre>{this.errorMessage}</pre>
                </div>
            );
        }
        if (this.output === undefined) {
            return <div className='cooklang-report-loading'>{nls.localizeByDefault('Loading...')}</div>;
        }
        return (
            <Markdown
                markdown={this.output}
                markdownRenderer={this.markdownRenderer}
                className='cooklang-report-content'
            />
        );
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
