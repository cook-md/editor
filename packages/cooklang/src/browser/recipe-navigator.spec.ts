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

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { RecipeNavigator } from './recipe-navigator';

/** Records what the navigator asked of each collaborator. */
class TestNavigator extends RecipeNavigator {

    opened: string[] = [];
    warnings: string[] = [];
    lookups: Array<{ baseDir: string; name: string }> = [];

    openError: Error | undefined;

    constructor(
        protected readonly resolveTo: (name: string) => string | undefined | Error,
        root: string | false = '/ws'
    ) {
        super();
        this.workspaceService = {
            tryGetRoots: () => root === false ? [] : [{ resource: new URI(root).withScheme('file') }]
        } as unknown as RecipeNavigator['workspaceService'];
        this.languageService = {
            findRecipePath: async (baseDir: string, name: string) => {
                this.lookups.push({ baseDir, name });
                const outcome = this.resolveTo(name);
                if (outcome instanceof Error) {
                    throw outcome;
                }
                return outcome;
            }
        } as unknown as RecipeNavigator['languageService'];
        this.messageService = {
            warn: (text: string) => { this.warnings.push(text); return Promise.resolve(undefined); }
        } as unknown as RecipeNavigator['messageService'];
    }

    protected override async openUri(uri: URI): Promise<void> {
        if (this.openError) {
            throw this.openError;
        }
        this.opened.push(uri.toString());
    }

    protected override async openInEditor(uri: URI): Promise<void> {
        if (this.openError) {
            throw this.openError;
        }
        this.opened.push(`editor:${uri.toString()}`);
    }
}

describe('RecipeNavigator', () => {

    it('opens the path cooklang-find resolved, not one rebuilt from the reference', async () => {
        const nav = new TestNavigator(() => '/ws/Dinner/Salmon Bowl.cook');

        await nav.navigate('Salmon Bowl');

        expect(nav.opened).to.have.length(1);
        expect(new URI(nav.opened[0]).path.fsPath()).to.equal('/ws/Dinner/Salmon Bowl.cook');
        expect(nav.warnings).to.be.empty;
    });

    it('passes the workspace root and the reference verbatim to the lookup', async () => {
        // No './' stripping, no '.cook' appended: cooklang-find owns those rules.
        const nav = new TestNavigator(() => '/ws/Pancakes.cook');

        await nav.navigate('./Pancakes');

        expect(nav.lookups).to.deep.equal([{ baseDir: '/ws', name: './Pancakes' }]);
    });

    it('opens a .menu target', async () => {
        const nav = new TestNavigator(() => '/ws/Week.menu');

        await nav.navigate('Week');

        expect(new URI(nav.opened[0]).path.fsPath()).to.equal('/ws/Week.menu');
    });

    it('tells the user when the reference resolves to nothing, and opens nothing', async () => {
        const nav = new TestNavigator(() => undefined);

        await nav.navigate('No Such Recipe');

        expect(nav.opened).to.be.empty;
        expect(nav.warnings).to.have.length(1);
        expect(nav.warnings[0]).to.contain('No Such Recipe');
    });

    it('reports a failing lookup instead of rejecting', async () => {
        const nav = new TestNavigator(() => new Error('native boom'));

        await nav.navigate('Pancakes');

        expect(nav.opened).to.be.empty;
        expect(nav.warnings).to.have.length(1);
    });

    it('reports a failing open instead of rejecting', async () => {
        // The Sentry signature: the file vanished between resolve and open.
        const nav = new TestNavigator(() => '/ws/Pancakes.cook');
        nav.openError = new Error("'file:///ws/Pancakes.cook' is invalid");

        await nav.navigate('Pancakes');

        expect(nav.opened).to.be.empty;
        expect(nav.warnings).to.have.length(1);
        expect(nav.warnings[0]).to.contain('Pancakes');
    });

    it('opens the source in an editor, not through the default opener', async () => {
        // The default opener for a .cook file is the preview this was invoked
        // from, so opening the source must bypass it.
        const nav = new TestNavigator(() => undefined);

        await nav.openSource(new URI('/ws/Pancakes.cook').withScheme('file'));

        expect(nav.opened).to.deep.equal(['editor:file:///ws/Pancakes.cook']);
    });

    it('reports a failing source open instead of rejecting', async () => {
        const nav = new TestNavigator(() => undefined);
        nav.openError = new Error("'file:///ws/Pancakes.cook' is invalid");

        await nav.openSource(new URI('/ws/Pancakes.cook').withScheme('file'));

        expect(nav.warnings).to.have.length(1);
        expect(nav.warnings[0]).to.contain('Pancakes.cook');
    });

    it('does nothing without a workspace', async () => {
        const nav = new TestNavigator(() => '/ws/Pancakes.cook', false);

        await nav.navigate('Pancakes');

        expect(nav.opened).to.be.empty;
        expect(nav.lookups).to.be.empty;
    });

});
