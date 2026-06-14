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

import URI from '@theia/core/lib/common/uri';
import { ReportOutputFormat } from '../common';

export const REPORT_WIDGET_ID = 'cooklang-report-widget';

export interface ReportWidgetOptions {
    /** URI string of the source `.cook` or `.menu` file. */
    uri: string;
    /** Template id: `builtin:*`, `workspace:<template uri>`, or `inline:*`. */
    templateId: string;
    /** Human-readable template name for the tab title. */
    templateLabel: string;
    /** URI string of a workspace template file; unset for built-ins/inline. */
    templateUri?: string;
    /**
     * Inline template content. When set, the widget renders this string
     * directly instead of reading a file or built-in (used by AI-authored
     * ephemeral templates).
     */
    inlineTemplateContent?: string;
    /**
     * Explicit output format. When set, overrides filename-based detection
     * (inline templates have no filename to infer from).
     */
    outputFormat?: ReportOutputFormat;
    /** Render config (scale + URI-string paths), passed through to the RPC. */
    configJson: string;
}

/**
 * Constructs a unique widget ID for a report tab tied to a recipe + template.
 */
export function createReportWidgetId(uri: URI, templateId: string): string {
    return `${REPORT_WIDGET_ID}:${templateId}:${uri.toString()}`;
}
