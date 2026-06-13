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

import { ReportWidgetOptions } from './report-widget-types';

export const ReportPresenter = Symbol('ReportPresenter');

/**
 * Opens or refreshes a report tab for the given options and activates it.
 * Abstracted behind a symbol so consumers (e.g. the `renderTemplate` tool) can
 * depend on it without importing the monaco-backed report widget.
 */
export interface ReportPresenter {
    show(options: ReportWidgetOptions): Promise<void>;
}
