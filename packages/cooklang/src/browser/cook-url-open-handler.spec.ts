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

// The handler injects `FileService` and `WorkspaceService`, whose modules evaluate
// browser globals at require time. Same jsdom preamble as the sibling specs; jsdom
// stays up for the whole run (tearing it down would break specs loaded alongside).
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { CookUrlOpenHandler } from './cook-url-open-handler';

const ROOT = new URI('file:///Users/alex/Recipes');
const INVALID = 'This Cook link could not be opened.';
const MOBILE_ONLY = 'This link opens in the Cook mobile app.';

function underRoot(path: string): string {
    return ROOT.resolve(path).toString();
}

interface HandlerFixture {
    handler: CookUrlOpenHandler;
    opened: string[];
    messages: string[];
}

function handlerWith(files: string[], roots: URI[] = [ROOT]): HandlerFixture {
    const opened: string[] = [];
    const messages: string[] = [];

    const handler = new CookUrlOpenHandler();
    Object.assign(handler, {
        workspaceService: { roots: Promise.resolve(roots.map(resource => ({ resource }))) },
        fileService: { exists: async (uri: URI) => files.includes(uri.toString()) },
        openerService: {
            getOpener: async () => ({ open: async (target: URI) => { opened.push(target.toString()); return undefined; } })
        },
        messageService: { info: (text: string) => { messages.push(text); return Promise.resolve(undefined); } }
    });
    return { handler, opened, messages };
}

/** Exactly what `ElectronUriHandlerContribution` does with the raw OS string. */
async function follow(handler: CookUrlOpenHandler, raw: string): Promise<void> {
    const uri = new URI(raw);
    expect(handler.canHandle(uri), raw).to.be.greaterThan(0);
    await handler.open(uri);
}

describe('CookUrlOpenHandler', () => {

    it('claims cook: and cooklang: URLs', () => {
        const { handler } = handlerWith([]);
        expect(handler.canHandle(new URI('cook://my/Pancakes.cook'))).to.be.greaterThan(0);
        expect(handler.canHandle(new URI('cooklang://my/Pancakes.cook'))).to.be.greaterThan(0);
    });

    it('ignores file: URLs, which belong to the editor', () => {
        const { handler } = handlerWith([]);
        expect(handler.canHandle(new URI('file:///tmp/Pancakes.cook'))).to.equal(0);
        expect(handler.canHandle(new URI('https://cook.md/my/Pancakes.cook'))).to.equal(0);
    });

    it('opens a recipe under the workspace root', async () => {
        const target = underRoot('Breakfast/Pancakes.cook');
        const { handler, opened } = handlerWith([target]);
        await follow(handler, 'cook://my/Breakfast/Pancakes.cook');
        expect(opened).to.deep.equal([target]);
    });

    it('opens a recipe through the cooklang: scheme too', async () => {
        const target = underRoot('Breakfast/Pancakes.cook');
        const { handler, opened } = handlerWith([target]);
        await follow(handler, 'cooklang://my/Breakfast/Pancakes.cook');
        expect(opened).to.deep.equal([target]);
    });

    it('decodes percent-encoded names exactly once', async () => {
        const target = underRoot('Sides & Drinks/Water Crackers.cook');
        const { handler, opened } = handlerWith([target]);
        await follow(handler, 'cook://my/Sides%20%26%20Drinks/Water%20Crackers.cook');
        expect(opened).to.deep.equal([target]);
    });

    it('keeps a literal percent sign in a name', async () => {
        const target = underRoot('100% Rye.cook');
        const { handler, opened } = handlerWith([target]);
        await follow(handler, 'cook://my/100%25%20Rye.cook');
        expect(opened).to.deep.equal([target]);
    });

    it('still opens the recipe when the link carries cooking mode and a timer', async () => {
        const target = underRoot('Breakfast/Pancakes.cook');
        const { handler, opened, messages } = handlerWith([target]);
        await follow(handler, 'cook://my/Breakfast/Pancakes.cook?mode=cooking&timer=42');
        expect(opened).to.deep.equal([target]);
        expect(messages).to.be.empty;
    });

    it('appends .cook when the path carries no extension', async () => {
        const target = underRoot('Pancakes.cook');
        const { handler, opened } = handlerWith([target]);
        await follow(handler, 'cook://my/Pancakes');
        expect(opened).to.deep.equal([target]);
    });

    it('says so when the recipe is not here', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://my/Breakfast/Nope.cook');
        expect(opened).to.be.empty;
        expect(messages.join(' ')).to.contain('Nope.cook');
    });

    it('asks for a folder when none is open', async () => {
        const { handler, opened, messages } = handlerWith([], []);
        await follow(handler, 'cook://my/Breakfast/Pancakes.cook');
        expect(opened).to.be.empty;
        expect(messages).to.have.length(1);
    });

    it('does nothing for the bare collection root', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://my');
        expect(opened).to.be.empty;
        expect(messages).to.be.empty;
    });

    it('refuses to walk out of the workspace root', async () => {
        const { handler, opened, messages } = handlerWith(['file:///Users/alex/secret.txt']);
        await follow(handler, 'cook://my/../secret.txt');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([INVALID]);
    });

    it('refuses a percent-encoded traversal without echoing the path', async () => {
        const { handler, opened, messages } = handlerWith(['file:///Users/etc/passwd', 'file:///etc/passwd']);
        await follow(handler, 'cook://my/Breakfast/%2E%2E/%2E%2E/etc/passwd');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([INVALID]);
    });

    it('refuses backslash separators, which Windows would treat as traversal', async () => {
        const { handler, opened, messages } = handlerWith(['file:///Users/alex/secret.txt']);
        await follow(handler, 'cook://my/a%5C..%5C..%5Csecret.txt');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([INVALID]);
    });

    it('keeps the containment check even if the parser let a traversal through', async () => {
        // Second layer: call past the parser to prove the root check stands on its own.
        const { handler, opened, messages } = handlerWith(['file:///Users/alex/secret.txt']);
        await (handler as unknown as { openRecipe(path: string): Promise<void> }).openRecipe('a/../../secret.txt');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([INVALID]);
    });

    it('claims timer links and points at the mobile app, opening nothing', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://timer/123e4567-e89b-12d3-a456-426614174000');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([MOBILE_ONLY]);
    });

    it('claims unknown namespaces and points at the mobile app', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://pantry/items');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([MOBILE_ONLY]);
    });

    it('points share and clip links at the import feature', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://share/abc123');
        await follow(handler, 'cook://clip?url=https%3A%2F%2Fexample.com%2Fpancakes');
        expect(opened).to.be.empty;
        expect(messages).to.have.length(2);
        for (const message of messages) {
            expect(message).to.contain('Import Recipe');
        }
    });

    it('says a malformed link could not be opened', async () => {
        const { handler, opened, messages } = handlerWith([]);
        await follow(handler, 'cook://share');
        expect(opened).to.be.empty;
        expect(messages).to.deep.equal([INVALID]);
    });
});
