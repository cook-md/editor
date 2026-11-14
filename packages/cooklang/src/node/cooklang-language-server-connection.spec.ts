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

/* eslint-disable no-null/no-null */

import { expect } from 'chai';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Message } from 'vscode-languageserver-protocol/node';
import { NativeMessageReader } from './cooklang-language-server-connection';

function frame(message: object): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf-8');
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Feed the reader the given chunks, then end the stream; resolves with what it delivered. */
async function read(chunks: Buffer[]): Promise<{ messages: Message[], errors: Error[] }> {
    const pending: (Buffer | null)[] = [...chunks, null];
    const reader = new NativeMessageReader(async () => pending.shift() ?? null);
    const messages: Message[] = [];
    const errors: Error[] = [];
    reader.onError(error => errors.push(error));
    const closed = new Promise<void>(resolve => reader.onClose(resolve));
    reader.listen(message => messages.push(message));
    await closed;
    return { messages, errors };
}

describe('NativeMessageReader', () => {

    it('delivers a message whose multi-byte character is split across chunks', async () => {
        const message = { jsonrpc: '2.0', id: 1, result: { name: 'crème fraîche, 180°C, ½ cup' } };
        const bytes = frame(message);
        // Cut inside the two-byte 'è'.
        const cut = bytes.indexOf(Buffer.from('è', 'utf-8')) + 1;
        const { messages, errors } = await read([bytes.subarray(0, cut), bytes.subarray(cut)]);
        expect(errors).to.deep.equal([]);
        expect(messages).to.deep.equal([message]);
    });

    it('delivers messages split at every possible byte boundary', async () => {
        const message = { jsonrpc: '2.0', id: 7, result: ['Köfte', '½', '日本語'] };
        const bytes = frame(message);
        for (let cut = 1; cut < bytes.length; cut++) {
            const { messages, errors } = await read([bytes.subarray(0, cut), bytes.subarray(cut)]);
            expect(errors, `cut at ${cut}`).to.deep.equal([]);
            expect(messages, `cut at ${cut}`).to.deep.equal([message]);
        }
    });

    it('delivers several messages arriving in one chunk', async () => {
        const first = { jsonrpc: '2.0', id: 1, result: 'a' };
        const second = { jsonrpc: '2.0', id: 2, result: 'b' };
        const { messages } = await read([Buffer.concat([frame(first), frame(second)])]);
        expect(messages).to.deep.equal([first, second]);
    });
});
