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

// Theia runs the renderer with contextIsolation, so the renderer SDK cannot
// reach Electron IPC on its own. Importing this installs Sentry's bridge on
// the isolated world.
import '@sentry/electron/preload';

/**
 * Theia's generated `preload.js` calls the exported `preload` function of every
 * contributed preload module. The import above is the entire effect.
 */
export function preload(): void {
}
