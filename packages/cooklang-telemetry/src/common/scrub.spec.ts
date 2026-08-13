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
import { REDACTED, ScrubbableEvent, scrubEvent } from './scrub';

const HOME = '/Users/jane';

function scrub(event: ScrubbableEvent): ScrubbableEvent {
    return scrubEvent(event, { homeDir: HOME });
}

describe('scrubEvent', () => {

    describe('home directory removal', () => {

        // Absolute paths carry the OS username, which is personal data we have
        // no need for.
        it('rewrites the home directory in an exception value', () => {
            const event = scrub({
                exception: { values: [{ value: `ENOENT: open '${HOME}/Recipes/dinner.cook'` }] }
            });
            expect(event.exception!.values![0].value).to.equal("ENOENT: open '~/Recipes/dinner.cook'");
        });

        it('rewrites the home directory in stack frames', () => {
            const event = scrub({
                exception: {
                    values: [{
                        stacktrace: { frames: [{ filename: `${HOME}/app/lib/x.js`, abs_path: `${HOME}/app/lib/x.js` }] }
                    }]
                }
            });
            const frame = event.exception!.values![0].stacktrace!.frames![0];
            expect(frame.filename).to.equal('~/app/lib/x.js');
            expect(frame.abs_path).to.equal('~/app/lib/x.js');
        });

        it('rewrites the home directory in a breadcrumb message', () => {
            const event = scrub({ breadcrumbs: [{ message: `read ${HOME}/notes.md` }] });
            expect(event.breadcrumbs![0].message).to.equal('read ~/notes.md');
        });

        it('rewrites every occurrence, not just the first', () => {
            const event = scrub({
                exception: { values: [{ value: `copy ${HOME}/a.cook to ${HOME}/b.cook` }] }
            });
            expect(event.exception!.values![0].value).to.equal('copy ~/a.cook to ~/b.cook');
        });
    });

    describe('secret redaction', () => {

        // CookbotGrpcClient holds a live auth token, so this is not hypothetical.
        it('redacts a token in an allowlisted extra field', () => {
            const event = scrub({ extra: { grpcStatus: 'authToken=eyJhbGciOiJIUzI1NiJ9.abc.def' } });
            expect(event.extra!.grpcStatus).to.equal(`authToken=${REDACTED}`);
        });

        it('redacts a bearer token wherever it appears', () => {
            const event = scrub({
                exception: { values: [{ value: 'request failed: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' }] }
            });
            expect(event.exception!.values![0].value).to.contain(REDACTED);
            expect(event.exception!.values![0].value).to.not.contain('eyJhbGciOiJIUzI1NiJ9');
        });
    });

    describe('allowlisting', () => {

        it('drops extra fields that are not allowlisted', () => {
            const event = scrub({ extra: { recipeContent: 'Add @salt{1%tsp}', grpcStatus: 'UNAVAILABLE' } });
            expect(event.extra).to.not.have.property('recipeContent');
            expect(event.extra!.grpcStatus).to.equal('UNAVAILABLE');
        });

        it('drops contexts that are not allowlisted', () => {
            const event = scrub({ contexts: { chatPrompt: { text: 'my secret recipe' }, os: { name: 'macOS' } } });
            expect(event.contexts).to.not.have.property('chatPrompt');
            expect(event.contexts).to.have.property('os');
        });

        it('drops the request entirely', () => {
            const event = scrub({ request: { data: 'Add @salt{1%tsp}' } });
            expect(event.request).to.be.undefined;
        });
    });

    it('leaves an event with nothing sensitive untouched', () => {
        const event = scrub({ exception: { values: [{ value: 'Cannot read properties of undefined' }] } });
        expect(event.exception!.values![0].value).to.equal('Cannot read properties of undefined');
    });

    it('does not modify the event it was given', () => {
        const original: ScrubbableEvent = {
            exception: { values: [{ value: `open ${HOME}/x.cook` }] },
            extra: { recipeContent: 'Add @salt{}' }
        };
        scrub(original);
        expect(original.exception!.values![0].value).to.equal(`open ${HOME}/x.cook`);
        expect(original.extra).to.have.property('recipeContent');
    });
});
