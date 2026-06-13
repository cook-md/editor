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
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { COOKLANG_LANGUAGE_ID } from '../common';

/**
 * Resolves the active recipe/menu URI and assembles the render config from
 * workspace conventions. Shared by the "Render Report" command and the
 * `renderTemplate` AI tool. Deliberately free of `@theia/monaco` imports so it
 * can be unit-tested under the repo's mocha harness.
 */
@injectable()
export class ReportConfigService {

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    /**
     * Resolves the recipe URI from the focused widget, the current main-area
     * tab, or the active Cooklang text editor — in that order.
     */
    getActiveCooklangUri(): URI | undefined {
        return this.getCooklangResourceUri(this.shell.currentWidget)
            ?? this.getCooklangResourceUri(this.shell.getCurrentWidget('main'))
            ?? this.getActiveCooklangEditorUri();
    }

    /**
     * Returns the widget's resource URI when it is a navigatable showing a
     * `.cook` or `.menu` resource (text editor, recipe preview, report tab).
     */
    protected getCooklangResourceUri(widget: Widget | undefined): URI | undefined {
        if (NavigatableWidget.is(widget)) {
            const uri = widget.getResourceUri();
            if (uri && (uri.path.ext === '.cook' || uri.path.ext === '.menu')) {
                return uri;
            }
        }
        return undefined;
    }

    /**
     * Returns the URI of the active editor when its language is Cooklang,
     * or `undefined` otherwise.
     */
    protected getActiveCooklangEditorUri(): URI | undefined {
        const editorWidget = this.editorManager.currentEditor;
        if (!editorWidget) {
            return undefined;
        }
        const { languageId, uri } = editorWidget.editor.document;
        if (languageId !== COOKLANG_LANGUAGE_ID) {
            return undefined;
        }
        return new URI(uri);
    }

    /**
     * Builds the render config from workspace conventions. Paths are sent as
     * URI strings; the backend converts them to filesystem paths.
     */
    async buildConfigJson(scale: number = 1): Promise<string> {
        const config: {
            scale: number;
            basePath?: string;
            aislePath?: string;
            pantryPath?: string;
            datastorePath?: string;
        } = { scale };
        const root = this.workspaceService.tryGetRoots()[0];
        if (root) {
            config.basePath = root.resource.toString();
            const aisle = root.resource.resolve('config/aisle.conf');
            const pantry = root.resource.resolve('config/pantry.conf');
            const datastores = [root.resource.resolve('db'), root.resource.resolve('config/db')];
            const [hasAisle, hasPantry, ...hasDatastores] = await Promise.all([
                this.fileService.exists(aisle),
                this.fileService.exists(pantry),
                ...datastores.map(candidate => this.fileService.exists(candidate)),
            ]);
            if (hasAisle) {
                config.aislePath = aisle.toString();
            }
            if (hasPantry) {
                config.pantryPath = pantry.toString();
            }
            const datastore = datastores.find((candidate, index) => hasDatastores[index]);
            if (datastore) {
                config.datastorePath = datastore.toString();
            }
        }
        return JSON.stringify(config);
    }
}
