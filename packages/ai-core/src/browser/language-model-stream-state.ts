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

import { LanguageModelStreamResponsePart } from '../common';

/**
 * Buffers the tokens the backend pushes for a single streamed language model
 * response and hands them to a consumer as an async iterable.
 *
 * Tokens and failures are both recorded in the state rather than handed to a
 * pending promise directly, because the backend delivers them over RPC at
 * arbitrary points in time - possibly before the consumer starts iterating, or
 * while it is busy processing an earlier token. A failure that is only passed
 * to a currently pending `await` would be dropped in those cases, and since the
 * backend always terminates a failed stream with an end-of-stream token, the
 * stream would then end cleanly and the caller would see an empty response
 * instead of the error.
 */
export class LanguageModelStreamState {

    /** Buffered tokens; an `undefined` entry marks the end of the stream. */
    protected readonly tokens: (LanguageModelStreamResponsePart | undefined)[] = [];
    protected error: Error | undefined;
    protected notify: (() => void) | undefined;

    constructor(readonly id: string) { }

    /**
     * Append a token. `undefined` terminates the stream.
     */
    push(token: LanguageModelStreamResponsePart | undefined): void {
        this.tokens.push(token);
        this.wake();
    }

    /**
     * Record a failure. It is thrown by the iterable after all tokens that were
     * already buffered have been consumed. Only the first failure is kept.
     */
    reject(error: Error): void {
        if (!this.error) {
            this.error = error;
        }
        this.wake();
    }

    async *getIterable(): AsyncIterable<LanguageModelStreamResponsePart> {
        while (true) {
            if (this.tokens.length > 0) {
                const token = this.tokens.shift();
                if (token === undefined) {
                    // End of stream: report a recorded failure rather than ending silently.
                    if (this.error) {
                        throw this.error;
                    }
                    return;
                }
                yield token;
                continue;
            }
            if (this.error) {
                throw this.error;
            }
            await new Promise<void>(resolve => { this.notify = resolve; });
        }
    }

    protected wake(): void {
        const notify = this.notify;
        this.notify = undefined;
        notify?.();
    }
}
