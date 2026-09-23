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

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DraftSaver } from './draft-saver';

/**
 * A recipe opened from Downloads, a Git checkout or an email attachment is a real
 * file in a real editor — the desktop app should not gate that behind a modal the
 * way the phone does. It offers, once per file, to copy it into the collection.
 */
@injectable()
export class ExternalRecipeContribution implements FrontendApplicationContribution {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(DraftSaver)
    protected readonly draftSaver: DraftSaver;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    /** Files already offered, so switching tabs or reopening does not re-ask. */
    protected readonly offered = new Set<string>();

    onStart(): void {
        // App-lifetime singleton: the subscription lives as long as the editor manager.
        this.editorManager.onCreated(widget => {
            this.offerIfExternal(widget.editor.uri).catch(error =>
                console.error('Failed to offer saving the external recipe to Drafts:', error)
            );
        });
    }

    protected async offerIfExternal(uri: URI): Promise<void> {
        // Case-insensitive: `.COOK` files are recipes too (issue #50).
        if (uri.scheme !== 'file' || uri.path.ext.toLowerCase() !== '.cook') {
            return;
        }
        const key = uri.toString();
        if (this.offered.has(key)) {
            return;
        }
        // Marked before the await: two `onCreated` events for one file would otherwise
        // both get past the check above. A file inside the collection stays marked.
        this.offered.add(key);
        const roots = await this.workspaceService.roots;
        if (roots.length === 0) {
            // Nothing to compare against yet; offer again once a folder is open.
            this.offered.delete(key);
            return;
        }
        if (roots.some(root => root.resource.isEqualOrParent(uri))) {
            return;
        }

        const saveAction = nls.localize('theia/cooklang-import/saveToDrafts', 'Save to Drafts');
        const answer = await this.messageService.info(
            nls.localize('theia/cooklang-import/externalRecipe', '{0} is not in your collection.', this.escapeMarkdown(uri.path.base)),
            saveAction
        );
        if (answer !== saveAction) {
            return;
        }
        const content = await this.fileService.read(uri);
        await this.draftSaver.saveRaw(content.value, uri.path.name);
    }

    /**
     * Notifications render their text as inline markdown, and a `command:` link in it
     * runs that command when clicked. A file name must therefore stay literal text:
     * every markdown-significant character is backslash-escaped. `<` covers autolinks;
     * `:` is escaped too, although linkify is off in the notification renderer.
     * (`escapeMarkdownSyntaxTokens` from core misses `<`, `>`, `~`, `|` and `&`.)
     */
    protected escapeMarkdown(text: string): string {
        return text.replace(/[\\`*_{}[\]()#+\-.!|<>~:&]/g, '\\$&');
    }
}
