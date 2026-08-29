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

import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolProvider, ToolRequest } from '@theia/ai-core/lib/common';
import { FileDialogService, OpenFileDialogProps } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';

/**
 * Lets Cookbot offer the folder picker when the user has no recipe folder open.
 *
 * Without a folder every file tool fails, so the assistant otherwise has no way
 * to move the user forward — it can only report the failure after the fact. The
 * native picker also lets the user create a folder, which covers first-run.
 */
@injectable()
export class OpenRecipeFolder implements ToolProvider {
    static ID = 'openRecipeFolder';

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogService: FileDialogService;

    getTool(): ToolRequest {
        return {
            id: OpenRecipeFolder.ID,
            name: OpenRecipeFolder.ID,
            displayName: 'Open Recipe Folder',
            description: 'Ask the user to choose (or create) a recipe folder to work in. '
                + 'Use this only when no recipe folder is open — without one, every file tool fails '
                + 'and nothing can be saved. The editor reloads with the chosen folder, which ends '
                + 'the current chat, so call it instead of starting work rather than in the middle of it.',
            parameters: {
                type: 'object',
                properties: {},
            },
            handler: async () => this.execute(),
        };
    }

    private async execute(): Promise<string> {
        if (this.workspaceService.opened) {
            const root = this.workspaceService.tryGetRoots()[0];
            return `A recipe folder is already open${root ? ` at ${root.resource.path.fsPath()}` : ''}. `
                + 'No need to ask the user to pick one.';
        }

        const props: OpenFileDialogProps = {
            title: 'Choose a recipe folder',
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
        };

        let selected;
        try {
            selected = await this.fileDialogService.showOpenDialog(props);
        } catch (e) {
            return `Could not open the folder picker: ${e instanceof Error ? e.message : String(e)}. `
                + 'Ask the user to open a folder from the File menu instead.';
        }

        if (!selected) {
            return 'The user dismissed the folder picker without choosing one. '
                + 'Do not ask again unless they bring it up — answer what you can without files.';
        }

        // preserveWindow reloads this window onto the chosen folder. Without it
        // Theia opens a second window and leaves the user staring at the empty
        // one they just tried to fix.
        this.workspaceService.open(selected, { preserveWindow: true });

        return `Opening ${selected.path.fsPath()} as the recipe folder. The editor is reloading, `
            + 'so this chat ends here — the user will start a new one with the folder in place. '
            + 'Do not attempt any further tool calls.';
    }
}
