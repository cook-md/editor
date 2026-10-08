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

import { injectable } from '@theia/core/shared/inversify';
import { ShellLayoutRestorer, WidgetDescription } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { REPORT_WIDGET_ID } from './report-widget-types';

/**
 * Report tabs once stored their render config (with the nutrition token) in
 * their construction options. The field is gone, but a layout saved before
 * that still carries it, and a widget restored with it would write it back on
 * every layout save. Strip it before the widget is created.
 */
@injectable()
export class CooklangShellLayoutRestorer extends ShellLayoutRestorer {

    protected override convertToWidget(desc: WidgetDescription, context: ShellLayoutRestorer.InflateContext): Promise<Widget | undefined> {
        return super.convertToWidget(CooklangShellLayoutRestorer.sanitize(desc), context);
    }

    /** A copy of `desc` without `constructionOptions.options.configJson` for report widgets; `desc` itself otherwise. */
    static sanitize(desc: WidgetDescription): WidgetDescription {
        const { factoryId, options } = desc.constructionOptions;
        if (factoryId !== REPORT_WIDGET_ID || !options || typeof options !== 'object' || !('configJson' in options)) {
            return desc;
        }
        const { configJson: _configJson, ...rest } = options as Record<string, unknown>;
        return { ...desc, constructionOptions: { ...desc.constructionOptions, options: rest } };
    }
}
