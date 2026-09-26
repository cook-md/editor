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

/**
 * Result of `cooklang.api.renderReport`: a plugin-supplied template rendered
 * by the Reports engine. Plain JSON: it crosses the plugin host.
 * `template` covers syntax errors, unknown functions and errors raised by
 * template functions that are not auth, plan, network or server problems.
 */
export type PluginReportFailureReason = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: PluginReportFailureReason; message: string };
