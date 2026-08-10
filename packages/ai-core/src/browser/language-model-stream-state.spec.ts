// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH.
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

import { expect } from 'chai';
import { LanguageModelStreamResponsePart } from '../common';
import { LanguageModelStreamState } from './language-model-stream-state';

async function collect(state: LanguageModelStreamState): Promise<LanguageModelStreamResponsePart[]> {
    const parts: LanguageModelStreamResponsePart[] = [];
    for await (const part of state.getIterable()) {
        parts.push(part);
    }
    return parts;
}

async function collectError(state: LanguageModelStreamState): Promise<{ parts: LanguageModelStreamResponsePart[], error?: Error }> {
    const parts: LanguageModelStreamResponsePart[] = [];
    try {
        for await (const part of state.getIterable()) {
            parts.push(part);
        }
    } catch (error) {
        return { parts, error: error as Error };
    }
    return { parts };
}

describe('LanguageModelStreamState', () => {

    it('yields tokens pushed before the consumer starts iterating', async () => {
        const state = new LanguageModelStreamState('stream-1');
        state.push({ content: 'Hello' });
        state.push({ content: ' world' });
        state.push(undefined);

        expect(await collect(state)).to.deep.equal([{ content: 'Hello' }, { content: ' world' }]);
    });

    it('yields tokens pushed while the consumer is waiting', async () => {
        const state = new LanguageModelStreamState('stream-2');
        const collected = collect(state);

        await Promise.resolve();
        state.push({ content: 'Hello' });
        await Promise.resolve();
        state.push(undefined);

        expect(await collected).to.deep.equal([{ content: 'Hello' }]);
    });

    // The backend reports a stream failure with `error(...)` and then always
    // terminates the stream with `send(id, undefined)`. If the error is only
    // delivered to a currently pending `await`, it is lost whenever the
    // consumer is not suspended at that exact moment, and the terminator ends
    // the stream cleanly - which the chat UI renders as a blank assistant turn.
    it('throws an error reported before the consumer starts iterating', async () => {
        const state = new LanguageModelStreamState('stream-3');
        state.reject(new Error('backend exploded'));
        state.push(undefined);

        const { parts, error } = await collectError(state);

        expect(parts).to.be.empty;
        expect(error?.message).to.equal('backend exploded');
    });

    it('throws an error reported after tokens, once the buffered tokens are consumed', async () => {
        const state = new LanguageModelStreamState('stream-4');
        state.push({ content: 'partial' });
        state.reject(new Error('backend exploded'));
        state.push(undefined);

        const { parts, error } = await collectError(state);

        expect(parts).to.deep.equal([{ content: 'partial' }]);
        expect(error?.message).to.equal('backend exploded');
    });

    it('throws an error reported while the consumer is waiting', async () => {
        const state = new LanguageModelStreamState('stream-5');
        const collected = collectError(state);

        await Promise.resolve();
        state.reject(new Error('backend exploded'));
        state.push(undefined);

        const { error } = await collected;
        expect(error?.message).to.equal('backend exploded');
    });

    it('keeps the first error when several are reported', async () => {
        const state = new LanguageModelStreamState('stream-6');
        state.reject(new Error('first'));
        state.reject(new Error('second'));
        state.push(undefined);

        const { error } = await collectError(state);
        expect(error?.message).to.equal('first');
    });

    it('ends without error when the stream terminates normally', async () => {
        const state = new LanguageModelStreamState('stream-7');
        state.push({ content: 'done' });
        state.push(undefined);

        const { parts, error } = await collectError(state);
        expect(parts).to.deep.equal([{ content: 'done' }]);
        expect(error).to.be.undefined;
    });
});
