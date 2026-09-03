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
import { CooklangLanguageService, CooklangUri, ReportOutputFormat, ReportTemplates } from '../common';
import { ReportConfigService } from './report-config-service';
import { ReportPresenter } from './report-presenter';
import { MAX_BATCH_ITEMS, parseBatchArg } from './batch-args';

interface RenderTemplateArgs {
    templateContent?: string;
    templateUri?: string;
    recipeUri?: string;
    recipeUris?: string[];
    show?: boolean;
    outputFormat?: ReportOutputFormat;
    scale?: number;
}

/** One recipe's outcome in a batched render. */
interface BatchEntry {
    recipeUri: string;
    output?: string;
    error?: string;
}

/**
 * A template resolved from the tool arguments: its source plus the identity a
 * Report tab needs to stay bound to it (workspace file, built-in, or inline).
 */
interface ResolvedTemplate {
    content: string;
    templateId: string;
    templateLabel: string;
    templateUri?: string;
    inlineTemplateContent?: string;
    /** Format to force on the tab; undefined lets the widget infer it from the file name. */
    defaultOutputFormat?: ReportOutputFormat;
}

const BUILT_IN_PREFIX = 'builtin:';

/**
 * AI tool that renders a Jinja2 report template against a `.cook`/`.menu` file
 * and returns `{ output }` or `{ error }`. The template is either inline
 * (`templateContent`) or a reference (`templateUri`: a workspace `.jinja` file
 * or a `builtin:*` id). Rendering is read-only, so the tool auto-executes (no
 * changeset/approval). Saving templates is handled separately by the
 * user-reviewed `suggestFileContent` tool.
 *
 * Kept free of `@theia/monaco` imports (file reads go through `FileService`;
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
                + 'return the rendered output. Pass EXACTLY ONE of templateUri (a saved workspace template such as '
                + '"config/reports/nutrition.md.jinja", or a built-in id like "builtin:shopping-list" — see '
                + 'listReportTemplates) or templateContent (inline source while authoring or for a one-off report). '
                + 'Prefer templateUri whenever a suitable template already exists: the Report tab then stays bound to '
                + 'the file (re-renders on edit) and the file name decides markdown/html/text output. Use it to compute '
                + 'values (cost, nutrition, ingredient counts), to validate a template you are authoring (inspect the '
                + 'error and fix it), or to present a finished report to the user (set show=true). Available template '
                + 'context: `ingredients` (each with `.name`, `.quantity`), `metadata` (incl. `metadata.title`), and '
                + '`scale`; filters include `aisled()`, `db()`, `excluding_pantry()`, `sort`, `titleize`, `default`. '
                + 'To save a template for reuse, write it as a `.jinja` file with the suggestFileContent tool '
                + '(convention: config/reports/), then render it by templateUri once the user has applied it.',
            parameters: {
                type: 'object',
                properties: {
                    templateContent: {
                        type: 'string',
                        description: 'Inline Jinja2 template source. Mutually exclusive with templateUri.',
                    },
                    templateUri: {
                        type: 'string',
                        description: 'A saved template to render: a workspace-relative path to a .jinja/.j2/.jinja2 file '
                            + '(e.g. "config/reports/cost.jinja"; absolute path or file:// URI also works), or a built-in id '
                            + '("builtin:ingredients", "builtin:shopping-list"). Renders the file\'s saved content on disk (unsaved editor edits are not included). '
                            + 'Mutually exclusive with templateContent.',
                    },
                    recipeUri: {
                        type: 'string',
                        description: 'The .cook or .menu file to render against — preferably a path relative to the workspace '
                            + 'root (e.g. "Baking/Napoleon.cook"); an absolute path or file:// URI also works. Defaults to the '
                            + 'active recipe in the editor. Renders the file\'s saved content on disk (unsaved editor edits are not included).',
                    },
                    recipeUris: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `Render the SAME template against several recipes in one call (max ${MAX_BATCH_ITEMS}). `
                            + 'Use this whenever you are screening a shortlist — "which of these are over 35% protein?" — instead of '
                            + 'one call per recipe: the template is sent once rather than retyped for every candidate. '
                            + 'Returns { results: [{ recipeUri, output } | { recipeUri, error }] } in the order given; a recipe that '
                            + 'fails to read or render reports its error in its own entry and the rest still come back. '
                            + 'Mutually exclusive with recipeUri, and cannot be combined with show (a batch is headless).',
                    },
                    show: {
                        type: 'boolean',
                        description: 'When true, open or refresh a Report tab showing the output. Default false (headless; output only returned to you).',
                    },
                    outputFormat: {
                        type: 'string',
                        enum: ['markdown', 'html', 'text'],
                        description: "Display format when show is true: 'markdown', 'html', or 'text'. Defaults to 'markdown' for "
                            + 'templateContent, and to the format implied by the file name for templateUri.',
                    },
                    scale: {
                        type: 'number',
                        description: 'Recipe scale factor. Default 1.',
                    },
                },
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
        const hasContent = !!args.templateContent;
        const hasUri = !!args.templateUri;
        if (hasContent === hasUri) {
            return this.fail('Pass exactly one of templateContent or templateUri.');
        }
        const template = args.templateContent
            ? this.inlineTemplate(args.templateContent)
            : await this.resolveTemplate(args.templateUri ?? '');
        if ('error' in template) {
            return this.fail(template.error);
        }
        if (args.recipeUris !== undefined) {
            return this.executeBatch(args, template);
        }
        let recipeUri: URI | undefined;
        if (args.recipeUri) {
            recipeUri = this.reportConfigService.resolveWorkspaceUri(args.recipeUri);
            if (!recipeUri) {
                return this.fail(`Could not resolve recipeUri '${args.recipeUri}': it is a relative path but no workspace is open. `
                    + 'Pass a workspace-relative path, an absolute path, or a file:// URI.');
            }
        } else {
            recipeUri = this.reportConfigService.getActiveCooklangUri();
            if (!recipeUri) {
                return this.fail('No recipe specified and no active .cook or .menu file. Pass recipeUri.');
            }
        }
        if (!CooklangUri.isCooklang(recipeUri)) {
            return this.fail(`recipeUri must be a .cook or .menu file, got: ${recipeUri.path.base}`);
        }
        let recipeContent: string;
        try {
            recipeContent = (await this.fileService.read(recipeUri)).value;
        } catch (e) {
            return this.fail(`Could not read recipe ${recipeUri.toString()}: ${this.message(e)}`);
        }
        const configJson = await this.reportConfigService.buildConfigJson(args.scale ?? 1, recipeUri);
        let resultJson: string;
        try {
            resultJson = await this.languageService.renderReport(recipeContent, template.content, configJson);
        } catch (e) {
            return this.fail(`Render failed: ${this.message(e)}`);
        }
        if (args.show) {
            const result = this.tryParse(resultJson);
            if (result && result.output !== undefined) {
                try {
                    await this.reportPresenter.show({
                        uri: recipeUri.toString(),
                        templateId: template.templateId,
                        templateLabel: template.templateLabel,
                        templateUri: template.templateUri,
                        inlineTemplateContent: template.inlineTemplateContent,
                        outputFormat: args.outputFormat ?? template.defaultOutputFormat,
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

    /**
     * Renders one already-resolved template against several recipes.
     *
     * The point of the batch is that the template is resolved and transmitted
     * once. A screening pass used to re-send the same inline Jinja source with
     * every candidate — in one observed session, 28 calls averaging 457 bytes
     * of arguments, almost all of it the same template retyped.
     *
     * A recipe that cannot be read or rendered fails **in its own slot**; the
     * others still come back. One bad candidate costing a retry of the whole
     * shortlist would give the waste straight back.
     */
    protected async executeBatch(args: RenderTemplateArgs, template: ResolvedTemplate): Promise<string> {
        if (args.recipeUri) {
            return this.fail('Pass either recipeUri or recipeUris, not both.');
        }
        if (args.show) {
            return this.fail('show renders a single recipe into the Report tab; a batch is headless. '
                + 'Screen with recipeUris, then render the one you want to present with recipeUri and show:true.');
        }
        const refs = parseBatchArg(args.recipeUris, 'recipeUris');
        if ('error' in refs) {
            return this.fail(refs.error);
        }
        const results: BatchEntry[] = [];
        for (const ref of refs) {
            results.push(await this.renderOne(ref, template, args.scale ?? 1));
        }
        return JSON.stringify({ results });
    }

    /** Renders one recipe reference, mapping every failure into the entry itself. */
    protected async renderOne(ref: string, template: ResolvedTemplate, scale: number): Promise<BatchEntry> {
        const recipeUri = this.reportConfigService.resolveWorkspaceUri(ref);
        if (!recipeUri) {
            return {
                recipeUri: ref,
                error: `Could not resolve '${ref}': it is a relative path but no workspace is open.`,
            };
        }
        if (!CooklangUri.isCooklang(recipeUri)) {
            return { recipeUri: ref, error: `Must be a .cook or .menu file, got: ${recipeUri.path.base}` };
        }
        let recipeContent: string;
        try {
            recipeContent = (await this.fileService.read(recipeUri)).value;
        } catch (e) {
            return { recipeUri: ref, error: `Could not read recipe: ${this.message(e)}` };
        }
        try {
            const configJson = await this.reportConfigService.buildConfigJson(scale, recipeUri);
            const resultJson = await this.languageService.renderReport(recipeContent, template.content, configJson);
            const parsed = this.tryParse(resultJson);
            if (!parsed) {
                return { recipeUri: ref, error: 'Render returned an unreadable result.' };
            }
            return parsed.error !== undefined
                ? { recipeUri: ref, error: parsed.error }
                : { recipeUri: ref, output: parsed.output };
        } catch (e) {
            return { recipeUri: ref, error: `Render failed: ${this.message(e)}` };
        }
    }

    protected inlineTemplate(content: string): ResolvedTemplate {
        return {
            content,
            templateId: 'inline:renderTemplate',
            templateLabel: 'AI Template',
            inlineTemplateContent: content,
            defaultOutputFormat: 'markdown',
        };
    }

    /**
     * Resolves `templateUri`: a `builtin:*` id, or a workspace-relative path /
     * absolute path / file URI of a `.jinja|.j2|.jinja2` file read from disk.
     */
    protected async resolveTemplate(ref: string): Promise<ResolvedTemplate | { error: string }> {
        if (ref.startsWith(BUILT_IN_PREFIX)) {
            const builtIn = ReportTemplates.byId(ref);
            if (!builtIn) {
                const known = ReportTemplates.BUILT_IN.map(template => template.id).join(', ');
                return { error: `Unknown built-in template '${ref}'. Known built-ins: ${known}.` };
            }
            return { content: builtIn.content, templateId: builtIn.id, templateLabel: builtIn.label };
        }
        const uri = this.reportConfigService.resolveWorkspaceUri(ref);
        if (!uri) {
            return {
                error: `Could not resolve templateUri '${ref}': it is a relative path but no workspace is open. `
                    + 'Pass a workspace-relative path, an absolute path, a file:// URI, or a builtin: id.',
            };
        }
        if (!ReportTemplates.isTemplateFile(uri.path.base)) {
            return { error: `templateUri must be a ${ReportTemplates.FILE_EXTENSIONS.join('/')} file, got: ${uri.path.base}` };
        }
        try {
            const content = (await this.fileService.read(uri)).value;
            return {
                content,
                templateId: `workspace:${uri.toString()}`,
                templateLabel: uri.path.base,
                templateUri: uri.toString(),
            };
        } catch (e) {
            return { error: `Could not read template ${uri.toString()}: ${this.message(e)}` };
        }
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
