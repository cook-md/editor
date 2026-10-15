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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import { URI } from '@theia/core';
import { ChangeSetFileElement } from '@theia/ai-chat/lib/browser/change-set-file-element';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { ChatFileWriter } from './chat-file-writer';

after(() => disableJSDOM());

interface ElementProps { uri: URI; type: string; targetState: string; originalState?: string; requestId: string }

/** A ChangeSetFileElement stand-in: real prototype (for `instanceof`), fake behaviour. */
function fakeElement(props: ElementProps, files: Map<string, string>): ChangeSetFileElement {
    const element = Object.create(ChangeSetFileElement.prototype);
    const original = props.originalState ?? files.get(props.uri.toString());
    let state = 'pending';
    Object.defineProperties(element, {
        uri: { get: () => props.uri },
        type: { get: () => props.type },
        targetState: { get: () => props.targetState },
        state: { get: () => state },
        props: { get: () => props },
    });
    element.getOriginalContent = async () => original;
    element.apply = async () => {
        files.set(props.uri.toString(), props.targetState);
        state = 'applied';
    };
    return element;
}

function createWriter(): { writer: ChatFileWriter; files: Map<string, string>; open: Map<string, string>; elements: Map<string, ChangeSetFileElement>; ctx: ChatToolContext } {
    const files = new Map<string, string>();
    const open = new Map<string, string>();
    const elements = new Map<string, ChangeSetFileElement>();
    const writer = new ChatFileWriter();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (writer as any).fileService = {
        exists: async (uri: URI) => files.has(uri.toString()),
        read: async (uri: URI) => {
            const value = files.get(uri.toString());
            if (value === undefined) { throw new Error('ENOENT'); }
            return { value: { toString: () => value } };
        },
        delete: async (uri: URI) => { files.delete(uri.toString()); },
    };
    (writer as any).monacoWorkspace = {
        getTextDocument: (uri: string) => open.has(uri) ? { getText: () => open.get(uri) } : undefined,
    };
    (writer as any).fileChangeFactory = (props: ElementProps) => fakeElement(props, files);
    (writer as any).fileChangeSetTitleProvider = { getChangeSetTitle: () => 'Changes made' };
    const ctx = {
        request: {
            id: 'req-1',
            session: {
                id: 'session-1',
                changeSet: {
                    getElementByURI: (uri: URI) => elements.get(uri.toString()),
                    addElements: (...added: ChangeSetFileElement[]) => { added.forEach(e => elements.set(e.uri.toString(), e)); },
                    removeElements: (...uris: URI[]) => { uris.forEach(u => elements.delete(u.toString())); },
                    setTitle: () => { },
                },
            },
        },
    } as unknown as ChatToolContext;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { writer, files, open, elements, ctx };
}

const RECIPE = new URI('file:///ws/Pasta.cook');

function propsOf(element: ChangeSetFileElement | undefined): ElementProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (element as any).props;
}

describe('ChatFileWriter', () => {

    it('creates a new file immediately and records it as an add', async () => {
        const { writer, files, elements, ctx } = createWriter();
        expect(await writer.write(ctx, RECIPE, 'NEW')).to.equal('add');
        expect(files.get(RECIPE.toString())).to.equal('NEW');
        const element = elements.get(RECIPE.toString());
        expect(element?.type).to.equal('add');
        expect(element?.state).to.equal('applied');
    });

    it('overwrites an existing file and records it as a modify', async () => {
        const { writer, files, elements, ctx } = createWriter();
        files.set(RECIPE.toString(), 'OLD');
        expect(await writer.write(ctx, RECIPE, 'NEW')).to.equal('modify');
        expect(files.get(RECIPE.toString())).to.equal('NEW');
        expect(propsOf(elements.get(RECIPE.toString())).originalState).to.equal(undefined);
    });

    it('keeps the pre-chat content as the undo target across repeated writes', async () => {
        const { writer, files, elements, ctx } = createWriter();
        files.set(RECIPE.toString(), 'ORIGINAL');
        await writer.write(ctx, RECIPE, 'FIRST');
        await writer.write(ctx, RECIPE, 'SECOND');
        expect(files.get(RECIPE.toString())).to.equal('SECOND');
        const props = propsOf(elements.get(RECIPE.toString()));
        expect(props.originalState).to.equal('ORIGINAL');
        expect(props.type).to.equal('modify');
    });

    it('keeps a chat-created file an add when it is written again', async () => {
        const { writer, elements, ctx } = createWriter();
        await writer.write(ctx, RECIPE, 'FIRST');
        expect(await writer.write(ctx, RECIPE, 'SECOND')).to.equal('add');
        expect(elements.get(RECIPE.toString())?.type).to.equal('add');
    });

    it('does nothing when the content already matches', async () => {
        const { writer, files, elements, ctx } = createWriter();
        files.set(RECIPE.toString(), 'SAME');
        expect(await writer.write(ctx, RECIPE, 'SAME')).to.equal('unchanged');
        expect(elements.size).to.equal(0);
    });

    it('deletes a chat-created file outright, leaving nothing to undo', async () => {
        const { writer, files, elements, ctx } = createWriter();
        await writer.write(ctx, RECIPE, 'NEW');
        expect(await writer.write(ctx, RECIPE, '')).to.equal('delete');
        expect(files.has(RECIPE.toString())).to.equal(false);
        expect(elements.size).to.equal(0);
    });

    it('records deleting a pre-existing file so it can be undone', async () => {
        const { writer, files, elements, ctx } = createWriter();
        files.set(RECIPE.toString(), 'OLD');
        expect(await writer.write(ctx, RECIPE, '')).to.equal('delete');
        expect(elements.get(RECIPE.toString())?.type).to.equal('delete');
    });

    it('reads the open editor (unsaved) content before disk', async () => {
        const { writer, files, open } = createWriter();
        files.set(RECIPE.toString(), 'DISK');
        open.set(RECIPE.toString(), 'EDITOR');
        expect(await writer.readCurrentContent(RECIPE)).to.equal('EDITOR');
        expect(await writer.readCurrentContent(new URI('file:///ws/Missing.cook'))).to.equal(undefined);
    });
});
