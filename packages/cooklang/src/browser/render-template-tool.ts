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
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { CooklangLanguageService, ReportOutputFormat } from '../common';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';

interface RenderTemplateArgs {
    templateContent?: string;
    recipeUri?: string;
    show?: boolean;
    outputFormat?: ReportOutputFormat;
    scale?: number;
}

/**
 * AI tool that renders a Jinja2 report template against a `.cook`/`.menu` file
 * and returns `{ output }` or `{ error }`. Rendering is read-only, so the tool
 * auto-executes (no changeset/approval). Saving templates is handled separately
 * by the user-reviewed `suggestFileContent` tool.
 *
 * Kept free of `@theia/monaco` imports (recipe reads go through `FileService`;
 * the report tab goes through `ReportPresenter`) so it is unit-testable.
 */
@injectable()
export class RenderTemplateTool implements ToolProvider {

    static ID = 'renderTemplate';

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(ReportPresenter)
    protected readonly reportPresenter: ReportPresenter;

    getTool(): ToolRequest {
        return {
            id: RenderTemplateTool.ID,
            name: RenderTemplateTool.ID,
            displayName: 'Render Template',
            description: 'Render a Cooklang Jinja2 report template against a recipe (.cook) or menu (.menu) file and '
                + 'return the rendered output. Use it to compute values (cost, nutrition, ingredient counts), to validate '
                + 'a template you are authoring (inspect the error and fix it), or to present a finished report to the '
                + 'user (set show=true). Available template context: `ingredients` (each with `.name`, `.quantity`), '
                + '`metadata` (incl. `metadata.title`), and `scale`; filters include `aisled()`, `db()`, '
                + '`excluding_pantry()`, `sort`, `titleize`, `default`. To save a template for reuse, write it as a '
                + '`.jinja` file with the suggestFileContent tool (convention: config/reports/).',
            parameters: {
                type: 'object',
                properties: {
                    templateContent: {
                        type: 'string',
                        description: 'The Jinja2 template source to render.',
                    },
                    recipeUri: {
                        type: 'string',
                        description: 'URI of the .cook or .menu file to render against. Defaults to the active recipe in the editor. '
                            + 'Renders the file\'s saved content on disk (unsaved editor edits are not included).',
                    },
                    show: {
                        type: 'boolean',
                        description: 'When true, open or refresh a Report tab showing the output. Default false (headless; output only returned to you).',
                    },
                    outputFormat: {
                        type: 'string',
                        enum: ['markdown', 'html', 'text'],
                        description: "Display format when show is true: 'markdown', 'html', or 'text'. Default 'markdown'.",
                    },
                    scale: {
                        type: 'number',
                        description: 'Recipe scale factor. Default 1.',
                    },
                },
                required: ['templateContent'],
            },
            handler: async (argString: string) => this.execute(argString),
        };
    }

    protected async execute(argString: string): Promise<string> {
        let args: RenderTemplateArgs;
        try {
            args = JSON.parse(argString);
        } catch {
            return this.fail('Invalid arguments: expected a JSON object.');
        }
        if (!args.templateContent) {
            return this.fail('templateContent is required.');
        }
        const recipeUri = args.recipeUri
            ? new URI(args.recipeUri)
            : this.reportConfigService.getActiveCooklangUri();
        if (!recipeUri) {
            return this.fail('No recipe specified and no active .cook or .menu file. Pass recipeUri.');
        }
        if (recipeUri.path.ext !== '.cook' && recipeUri.path.ext !== '.menu') {
            return this.fail(`recipeUri must be a .cook or .menu file, got: ${recipeUri.path.base}`);
        }
        let recipeContent: string;
        try {
            recipeContent = (await this.fileService.read(recipeUri)).value;
        } catch (e) {
            return this.fail(`Could not read recipe ${recipeUri.toString()}: ${this.message(e)}`);
        }
        const configJson = await this.reportConfigService.buildConfigJson(args.scale ?? 1);
        let resultJson: string;
        try {
            resultJson = await this.languageService.renderReport(recipeContent, args.templateContent, configJson);
        } catch (e) {
            return this.fail(`Render failed: ${this.message(e)}`);
        }
        if (args.show) {
            const result = this.tryParse(resultJson);
            if (result && result.output !== undefined) {
                try {
                    await this.reportPresenter.show({
                        uri: recipeUri.toString(),
                        templateId: 'inline:renderTemplate',
                        templateLabel: 'AI Template',
                        inlineTemplateContent: args.templateContent,
                        outputFormat: args.outputFormat ?? 'markdown',
                        configJson,
                    });
                } catch (e) {
                    console.warn('[cooklang] renderTemplate: failed to show report tab:', e);
                }
            }
        }
        // renderReport already returns `{ output }` | `{ error }`; pass through.
        return resultJson;
    }

    protected fail(message: string): string {
        return JSON.stringify({ error: message });
    }

    protected message(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    protected tryParse(json: string): { output?: string; error?: string } | undefined {
        try {
            return JSON.parse(json);
        } catch {
            return undefined;
        }
    }
}
