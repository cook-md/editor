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

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID, RecipeFrontmatter } from '../common';

/**
 * Promotes Obsidian-style Markdown recipes to the Cooklang language.
 *
 * Monaco associates `.md` with Markdown by extension. Obsidian's Cooklang
 * plugin instead treats a Markdown file as a recipe when its YAML frontmatter
 * contains `recipe: true`. This contribution watches Markdown models and
 * reassigns their language id to `cooklang` (or back to `markdown`) so TextMate
 * highlighting, the LSP client, and language-gated commands all apply without
 * registering `.md` as Cooklang globally.
 *
 * Changing the Monaco language id fires MonacoWorkspace's close/open cycle, so
 * the Cooklang LSP picks the document up automatically.
 */
@injectable()
export class MarkdownRecipeLanguageContribution implements FrontendApplicationContribution {

    protected readonly toDispose = new DisposableCollection();
    protected readonly modelListeners = new Map<string, DisposableCollection>();

    onStart(): void {
        for (const model of monaco.editor.getModels()) {
            this.watchModel(model);
        }
        this.toDispose.push(monaco.editor.onDidCreateModel(model => this.watchModel(model)));
    }

    onStop(): void {
        this.toDispose.dispose();
        for (const listeners of this.modelListeners.values()) {
            listeners.dispose();
        }
        this.modelListeners.clear();
    }

    protected watchModel(model: monaco.editor.ITextModel): void {
        const key = model.uri.toString();
        if (this.modelListeners.has(key)) {
            return;
        }
        const listeners = new DisposableCollection();
        listeners.push(model.onDidChangeContent(() => this.syncLanguage(model)));
        listeners.push(model.onWillDispose(() => {
            listeners.dispose();
            this.modelListeners.delete(key);
        }));
        this.modelListeners.set(key, listeners);
        this.syncLanguage(model);
    }

    protected syncLanguage(model: monaco.editor.ITextModel): void {
        if (!this.isMarkdownPath(model.uri.path)) {
            return;
        }
        const wantCooklang = RecipeFrontmatter.hasRecipeFlag(model.getValue());
        const current = model.getLanguageId();
        if (wantCooklang && current !== COOKLANG_LANGUAGE_ID) {
            monaco.editor.setModelLanguage(model, COOKLANG_LANGUAGE_ID);
        } else if (!wantCooklang && current === COOKLANG_LANGUAGE_ID) {
            monaco.editor.setModelLanguage(model, 'markdown');
        }
    }

    protected isMarkdownPath(path: string): boolean {
        return path.toLowerCase().endsWith('.md');
    }
}
