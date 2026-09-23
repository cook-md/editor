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
 * Included verbatim in `openRecipeFolder`'s result once it has actually
 * called `workspaceService.open()` and the window is on its way down for the
 * reload. The node-side tool loop (`CookbotLanguageModel`) looks for this
 * marker with `.includes(...)` to end the turn immediately instead of
 * spending another model round talking to a window that is about to die.
 *
 * Only the success path (a folder was picked and `open()` was called)
 * includes it - "already open", "dismissed" and picker-error results must
 * not, since those leave the window (and the chat) alive.
 */
export const RECIPE_FOLDER_RELOADING = 'The editor is reloading onto the chosen recipe folder.';
