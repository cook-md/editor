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

import { Command } from '@theia/core/lib/common/command';

/**
 * Commands contributed by the Timers panel. Kept in their own module so
 * other Cooklang browser code (like the alarm service) can reference them
 * without depending on the panel's implementation.
 */
export namespace TimersCommands {
    export const TOGGLE_VIEW: Command = {
        id: 'cooklang.toggleTimers',
        label: 'Cooklang: Toggle Timers',
    };
}
