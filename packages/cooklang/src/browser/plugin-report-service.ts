// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import { CooklangLanguageService } from '../common/cooklang-language-service';
import { PluginReportFailureReason, PluginReportResult } from '../common/plugin-report-types';
import { ReportConfigService } from './report-config-service';

/**
 * Renders a plugin's Jinja template against a recipe or menu with the same
 * configuration as the Reports feature (login token, nutrition service,
 * pantry, aisle, datastore, scale), so plugins can build on report functions
 * such as `aggregate_nutrition` without ever seeing the token. Backs
 * `cooklang.api.renderReport`.
 */
@injectable()
export class PluginReportService {

    static readonly CACHE_SIZE = 20;

    @inject(CooklangLanguageService)
    protected readonly languageService: CooklangLanguageService;

    @inject(ReportConfigService)
    protected readonly reportConfigService: ReportConfigService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(FileService)
    protected readonly fileService: FileService;

    /** Successful results only, least recently used first. */
    protected readonly cache = new Map<string, PluginReportResult>();

    async render(uri: URI, template: string, scale: number): Promise<PluginReportResult> {
        const text = await this.readText(uri);
        const key = JSON.stringify([uri.toString(), text, template, scale]);
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }
        const result = await this.renderUncached(uri, text, template, scale);
        if (result.ok) {
            this.cache.set(key, result);
            if (this.cache.size > PluginReportService.CACHE_SIZE) {
                this.cache.delete(this.cache.keys().next().value!);
            }
        }
        return result;
    }

    /** Unsaved edits count: the open editor model wins over the file on disk. */
    protected async readText(uri: URI): Promise<string> {
        const model = this.monacoWorkspace.getTextDocument(uri.toString());
        return model ? model.getText() : (await this.fileService.read(uri)).value;
    }

    protected async renderUncached(uri: URI, text: string, template: string, scale: number): Promise<PluginReportResult> {
        const config = await this.reportConfigService.buildConfigJson(scale, uri);
        const raw = await this.languageService.renderReport(text, template, config);
        let parsed: { output?: unknown; error?: unknown };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { ok: false, reason: 'template', message: 'Unexpected response from the report engine.' };
        }
        if (typeof parsed.error === 'string') {
            const message = parsed.error.replace(/^Error: /, '').split('\n')[0];
            return { ok: false, reason: this.reason(message), message };
        }
        if (typeof parsed.output !== 'string') {
            return { ok: false, reason: 'template', message: 'Unexpected response from the report engine.' };
        }
        return { ok: true, output: parsed.output };
    }

    protected reason(message: string): PluginReportFailureReason {
        if (/authentication required|unauthori[sz]ed/i.test(message)) {
            return 'unauthenticated';
        }
        if (/subscription|payment required|forbidden|\b40[23]\b/i.test(message)) {
            return 'forbidden';
        }
        if (/transport error|unavailable/i.test(message)) {
            return 'network';
        }
        if (/server error/i.test(message)) {
            return 'server';
        }
        return 'template';
    }
}
