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
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AuthService } from '@theia/cooklang-account/lib/common/auth-protocol';
import { COOKLANG_LANGUAGE_ID, CooklangUri } from '../common';

const DEFAULT_NUTRITION_SERVICE_URL = 'https://nutrition.cook.md';

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

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(AuthService)
    protected readonly authService: AuthService;

    /**
     * Resolves the recipe URI from the focused widget, the current main-area
     * tab, or the active Cooklang text editor — in that order. `.cook` files
     * open in preview mode by default, and the preview widget never takes DOM
     * focus, so it is reported by `getCurrentWidget('main')` (tab selection)
     * but never by `shell.currentWidget` (focus tracker).
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
            if (CooklangUri.isCooklang(uri)) {
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
     * Resolves a file reference supplied as a tool argument (recipe or
     * template). Accepts a full URI string (e.g. `file:///…`), an absolute
     * filesystem path, or — preferred — a path relative to the workspace root
     * (e.g. `Baking/Napoleon.cook`, `config/reports/cost.jinja`). Relative
     * paths are resolved against the first workspace root; returns `undefined`
     * only when a relative path is given but no workspace is open.
     */
    resolveWorkspaceUri(pathOrUri: string): URI | undefined {
        if (this.hasScheme(pathOrUri) || pathOrUri.startsWith('/')) {
            return new URI(pathOrUri).normalizePath();
        }
        const root = this.workspaceService.tryGetRoots()[0];
        return root ? root.resource.resolve(pathOrUri).normalizePath() : undefined;
    }

    /** True when the string starts with a URI scheme like `file:`. */
    protected hasScheme(value: string): boolean {
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
    }

    /**
     * Builds the render config from workspace conventions. Paths are sent as
     * URI strings; the backend converts them to filesystem paths. Pass the
     * source `recipeUri` so `.menu` plans render through the plan expander
     * (recipe refs → `plan.*` context) instead of as a bare recipe.
     */
    async buildConfigJson(scale: number = 1, recipeUri?: URI): Promise<string> {
        const config: {
            scale: number;
            basePath?: string;
            aislePath?: string;
            pantryPath?: string;
            datastorePath?: string;
            nutritionApiUrl: string;
            nutritionToken: string;
            isMenu?: boolean;
        } = {
            scale,
            nutritionApiUrl: this.preferences.get<string>('cooklang.nutrition.serviceUrl', DEFAULT_NUTRITION_SERVICE_URL),
            nutritionToken: '',
        };
        if (recipeUri?.path.ext === '.menu') {
            config.isMenu = true;
        }
        try {
            config.nutritionToken = (await this.authService.getToken()) ?? '';
        } catch (err) {
            console.debug('[cooklang] nutrition token unavailable (logged out?):', err);
            config.nutritionToken = '';
        }
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
