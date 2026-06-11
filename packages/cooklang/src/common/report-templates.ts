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

export namespace ReportTemplates {

    /** File extensions recognized as Jinja2 report templates. */
    export const FILE_EXTENSIONS: ReadonlyArray<string> = ['.jinja', '.j2', '.jinja2'];

    /**
     * Directory names (matched case-insensitively) scanned for report
     * templates, both at the workspace root and inside `config/`.
     */
    export const TEMPLATE_DIR_NAMES: ReadonlyArray<string> = ['reports', 'templates'];

    export function isTemplateFile(fileName: string): boolean {
        const lower = fileName.toLowerCase();
        return FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    export function isTemplateDirName(dirName: string): boolean {
        return TEMPLATE_DIR_NAMES.includes(dirName.toLowerCase());
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
