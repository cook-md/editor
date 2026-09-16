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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
enableJSDOM();
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
// Other specs in the same mocha run may have set it already.
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Command, CommandHandler, CommandRegistry } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { RecipeNavigator } from './recipe-navigator';
import { RecipePreviewContribution } from './recipe-preview-contribution';
import { RecipePreviewWidget } from './recipe-preview-widget';

const MISSING = new URI('file:///ws/Pancakes.cook');

/** A navigator over a stubbed editor, recording what it opened and what it told the user. */
class TestNavigator extends RecipeNavigator {
    warnings: string[] = [];
    opened: string[] = [];

    constructor(protected readonly openError?: Error) {
        super();
        (this as unknown as { messageService: unknown }).messageService = {
            warn: (message: string) => { this.warnings.push(message); return Promise.resolve(undefined); }
        };
    }

    protected override async openInEditor(uri: URI): Promise<void> {
        if (this.openError) {
            throw this.openError;
        }
        this.opened.push(uri.toString());
    }
}

interface Internals {
    togglePreview(args: unknown[]): Promise<void>;
}

function contributionWith(navigator: RecipeNavigator): RecipePreviewContribution & Internals {
    const contribution = new RecipePreviewContribution();
    Object.assign(contribution, {
        recipeNavigator: navigator,
        // The Sentry EDITOR-E signature: the file vanished, the model is invalid.
        editorManager: { open: () => Promise.reject(new Error(`'${MISSING.toString()}' is invalid`)) },
        shell: { currentWidget: undefined },
    });
    return contribution as RecipePreviewContribution & Internals;
}

/** Enough of a preview widget for the contribution: it only asks for the resource URI. */
function previewOf(uri: URI): RecipePreviewWidget {
    const widget = Object.create(RecipePreviewWidget.prototype);
    widget.getResourceUri = () => uri;
    return widget;
}

function commandHandlers(contribution: RecipePreviewContribution): Map<string, CommandHandler> {
    const handlers = new Map<string, CommandHandler>();
    contribution.registerCommands({
        registerCommand: (command: Command, handler: CommandHandler) => { handlers.set(command.id, handler); return Disposable.NULL; }
    } as unknown as CommandRegistry);
    return handlers;
}

describe('RecipePreviewContribution', () => {

    it('toggling from a preview opens its source in an editor', async () => {
        const navigator = new TestNavigator();
        const contribution = contributionWith(navigator);

        await contribution.togglePreview([previewOf(MISSING)]);

        expect(navigator.opened).to.deep.equal([MISSING.toString()]);
    });

    it('toggling from a preview whose source cannot be opened warns instead of rejecting', async () => {
        const navigator = new TestNavigator(new Error(`'${MISSING.toString()}' is invalid`));
        const contribution = contributionWith(navigator);

        await contribution.togglePreview([previewOf(MISSING)]);

        expect(navigator.warnings).to.have.length(1);
        expect(navigator.warnings[0]).to.contain('Pancakes.cook');
    });

    it('Open Source on a recipe that cannot be opened warns instead of rejecting', async () => {
        const navigator = new TestNavigator(new Error(`'${MISSING.toString()}' is invalid`));
        const contribution = contributionWith(navigator);

        await commandHandlers(contribution).get('cooklang.openSource')!.execute(MISSING);

        expect(navigator.warnings).to.have.length(1);
        expect(navigator.warnings[0]).to.contain('Pancakes.cook');
    });
});
