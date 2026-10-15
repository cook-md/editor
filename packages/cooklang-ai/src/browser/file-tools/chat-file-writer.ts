// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChangeSetFileElement, ChangeSetFileElementFactory } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';

export const FileChangeSetTitleProvider = Symbol('FileChangeSetTitleProvider');
export interface FileChangeSetTitleProvider {
    getChangeSetTitle(ctx: ChatToolContext): string;
}

@injectable()
export class DefaultFileChangeSetTitleProvider implements FileChangeSetTitleProvider {
    getChangeSetTitle(_ctx: ChatToolContext): string {
        return nls.localize('theia/cooklang-ai/fileChangeSetTitle', 'Changes made');
    }
}

/** What a {@link ChatFileWriter.write} did to the file. */
export type ChatFileWriteResult = 'add' | 'modify' | 'delete' | 'unchanged';

/**
 * Writes AI file edits straight to disk while recording each one in the chat
 * session's change set, so the user can undo a file (or all of them) from the
 * chat instead of reviewing a staged proposal first.
 *
 * Repeated writes to the same file within a session keep the content from
 * before the chat first touched it, so undo always restores the pre-chat file.
 */
@injectable()
export class ChatFileWriter {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MonacoWorkspace)
    protected readonly monacoWorkspace: MonacoWorkspace;

    @inject(ChangeSetFileElementFactory)
    protected readonly fileChangeFactory: ChangeSetFileElementFactory;

    @inject(FileChangeSetTitleProvider)
    protected readonly fileChangeSetTitleProvider: FileChangeSetTitleProvider;

    /**
     * The file's current content: the open editor (including unsaved edits)
     * first, then disk. `undefined` when the file does not exist.
     */
    async readCurrentContent(uri: URI): Promise<string | undefined> {
        const openEditorValue = this.monacoWorkspace.getTextDocument(uri.toString())?.getText();
        if (openEditorValue !== undefined) {
            return openEditorValue;
        }
        try {
            return (await this.fileService.read(uri)).value.toString();
        } catch {
            return undefined;
        }
    }

    /**
     * Writes `content` to `uri` now (empty content deletes the file) and records
     * the change in the chat's change set for undo.
     */
    async write(ctx: ChatToolContext, uri: URI, content: string): Promise<ChatFileWriteResult> {
        const changeSet = ctx.request.session.changeSet;
        const previous = changeSet.getElementByURI(uri);
        const carried = previous instanceof ChangeSetFileElement && (previous.state === 'applied' || previous.state === 'stale')
            ? previous
            : undefined;
        const exists = await this.fileService.exists(uri);
        const existedBeforeChat = carried ? carried.type !== 'add' : exists;
        const originalState = carried ? (await carried.getOriginalContent()) ?? '' : undefined;

        if (exists && content !== '' && content === await this.readCurrentContent(uri)) {
            return 'unchanged';
        }
        if (content === '' && !existedBeforeChat) {
            // Deleting a file this chat created: nothing left to undo.
            if (exists) {
                await this.fileService.delete(uri);
            }
            changeSet.removeElements(uri);
            return 'delete';
        }
        if (content === '' && !exists) {
            return 'unchanged';
        }

        const type: ChatFileWriteResult = content === '' ? 'delete' : existedBeforeChat ? 'modify' : 'add';
        const element = this.fileChangeFactory({
            uri,
            type,
            state: 'pending',
            targetState: content,
            originalState,
            requestId: ctx.request.id,
            chatSessionId: ctx.request.session.id,
        });
        changeSet.addElements(element);
        changeSet.setTitle(this.fileChangeSetTitleProvider.getChangeSetTitle(ctx));
        await element.apply();
        return type;
    }
}
