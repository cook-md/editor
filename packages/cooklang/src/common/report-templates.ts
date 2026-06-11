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

/**
 * A report template bundled with the editor, available even when the
 * workspace has no template directories.
 */
export interface BuiltInReportTemplate {
    id: string;
    label: string;
    /** nls key used to localize `label` at display points. */
    localizationKey?: string;
    content: string;
}

/** How rendered report output should be displayed. */
export type ReportOutputFormat = 'markdown' | 'html' | 'text';

export namespace ReportTemplates {

    /** File extensions recognized as Jinja2 report templates. */
    export const FILE_EXTENSIONS: ReadonlyArray<string> = ['.jinja', '.j2', '.jinja2'];

    export function isTemplateFile(fileName: string): boolean {
        const lower = fileName.toLowerCase();
        return FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    /**
     * Derives how report output should be displayed from the template file
     * name's inner extension: `report.html.jinja` renders as HTML,
     * `report.md.jinja` (or no inner extension, like the built-ins) as
     * markdown, and anything else (`.yaml`, `.json`, `.txt`, …) as
     * preformatted text.
     */
    export function outputFormat(fileName: string): ReportOutputFormat {
        const lower = fileName.toLowerCase();
        const templateExt = FILE_EXTENSIONS.find(ext => lower.endsWith(ext));
        const inner = templateExt ? lower.slice(0, -templateExt.length) : lower;
        if (inner.endsWith('.html') || inner.endsWith('.htm')) {
            return 'html';
        }
        if (inner.endsWith('.md') || inner.endsWith('.markdown') || !inner.includes('.')) {
            return 'markdown';
        }
        return 'text';
    }

    export const BUILT_IN: ReadonlyArray<BuiltInReportTemplate> = [
        {
            id: 'builtin:ingredients',
            label: 'Ingredients List (built-in)',
            localizationKey: 'theia/cooklang/templateIngredients',
            content: `# {{ metadata.title | default("Ingredients") }}

{% for ingredient in ingredients | sort(attribute='name') -%}
- {{ ingredient.name }}{% if ingredient.quantity %}: {{ ingredient.quantity }}{% endif %}
{% endfor %}`
        },
        {
            id: 'builtin:shopping-list',
            label: 'Shopping List (built-in)',
            localizationKey: 'theia/cooklang/templateShoppingList',
            content: `# Shopping List

{% for (aisle, items) in aisled(ingredients) | items -%}
## {{ aisle | titleize }}

{% for ingredient in items -%}
- [ ] {{ ingredient.name }}{% if ingredient.quantity %}: {{ ingredient.quantity }}{% endif %}
{% endfor %}
{% endfor %}`
        }
    ];

    export function byId(id: string): BuiltInReportTemplate | undefined {
        return BUILT_IN.find(template => template.id === id);
    }
}
