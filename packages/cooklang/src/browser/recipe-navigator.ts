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
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { CooklangLanguageService } from '../common';
import { CooklangUri } from '../common/cooklang-uri';

/**
 * Opens the recipe a preview link points at.
 *
 * Both previews used to rebuild the target path themselves
 * (`workspaceRoot.resolve(reference + '.cook')`), which is wrong twice over: it
 * can only ever reach `.cook` files in the shape the caller guessed, and the two
 * previews did not even guess alike - the menu preview stripped a leading `./`
 * and the recipe preview did not. `cooklang-find` owns the lookup rules, so ask
 * it for the path and open exactly what it returns.
 *
 * Failures are reported to the user rather than thrown: these calls sit in React
 * click handlers, so a rejected promise is a silent no-op for the user and an
 * unhandled rejection in telemetry.
 */
@injectable()
export class RecipeNavigator {

    @inject(CooklangLanguageService)
    protected languageService: CooklangLanguageService;

    @inject(WorkspaceService)
    protected workspaceService: WorkspaceService;

    @inject(OpenerService)
    protected openerService: OpenerService;

    @inject(EditorManager)
    protected editorManager: EditorManager;

    @inject(MessageService)
    protected messageService: MessageService;

    /**
     * Resolve `referencePath` against the workspace and open it. Never rejects.
     */
    async navigate(referencePath: string): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) {
            return;
        }
        const baseDir = root.resource.path.fsPath();
        let resolved: string | undefined;
        try {
            resolved = await this.languageService.findRecipePath(baseDir, referencePath);
        } catch (e) {
            console.warn(`[cooklang] findRecipePath failed for ${referencePath}:`, e);
            this.warnNotOpened(referencePath);
            return;
        }
        if (resolved === undefined) {
            this.messageService.warn(
                nls.localize('theia/cooklang/recipeNotFound', 'Recipe not found: {0}', referencePath)
            );
            return;
        }
        try {
            await this.openUri(CooklangUri.fromNativePath(resolved));
        } catch (e) {
            console.warn(`[cooklang] failed to open ${resolved}:`, e);
            this.warnNotOpened(referencePath);
        }
    }

    /**
     * Open `uri` in the text editor, reporting failures. Deliberately not the
     * default opener: for a `.cook` file that is the preview this was invoked
     * from, so `open()` here would reopen the preview instead of the source.
     */
    async openSource(uri: URI): Promise<void> {
        try {
            await this.openInEditor(uri);
        } catch (e) {
            console.warn(`[cooklang] failed to open ${uri.toString()} in an editor:`, e);
            this.warnNotOpened(uri.path.base);
        }
    }

    protected async openInEditor(uri: URI): Promise<void> {
        await this.editorManager.open(uri);
    }

    protected warnNotOpened(referencePath: string): void {
        this.messageService.warn(
            nls.localize('theia/cooklang/recipeNotOpened', 'Could not open recipe: {0}', referencePath)
        );
    }

    protected async openUri(uri: URI): Promise<void> {
        await open(this.openerService, uri);
    }
}
