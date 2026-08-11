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
import { CookbotError } from './cookbot-error';

/** Builds an error the way @grpc/grpc-js surfaces one. */
function grpcError(code: number, status: string, detail: string): Error {
    return Object.assign(new Error(`${code} ${status}: ${detail}`), { code });
}

describe('CookbotError', () => {

    describe('detail preservation', () => {

        // Replacing the server's explanation with generic guidance makes a
        // user report undiagnosable - the packaged app persists no log to
        // recover it from.
        it('keeps the server explanation for a usage limit', () => {
            const error = CookbotError.toUserFacing(
                grpcError(8, 'RESOURCE_EXHAUSTED', 'monthly AI credit allowance exhausted')
            );
            expect(error.message).to.contain('monthly AI credit allowance exhausted');
        });

        it('keeps the server explanation for a declined request', () => {
            const error = CookbotError.toUserFacing(
                grpcError(7, 'PERMISSION_DENIED', 'subscription inactive')
            );
            expect(error.message).to.contain('subscription inactive');
        });

        it('keeps the server explanation for an unclassified status', () => {
            const error = CookbotError.toUserFacing(
                grpcError(13, 'INTERNAL', 'upstream model returned 500')
            );
            expect(error.message).to.contain('upstream model returned 500');
        });

        it('strips the redundant gRPC status prefix from the detail', () => {
            const error = CookbotError.toUserFacing(
                grpcError(8, 'RESOURCE_EXHAUSTED', 'quota exceeded')
            );
            expect(error.message).to.not.contain('RESOURCE_EXHAUSTED');
            expect(error.message).to.not.match(/\b8 /);
            expect(error.message).to.contain('quota exceeded');
        });

        // A dropped socket is pure transport noise: the remedy does not depend
        // on which one died, so the raw text is dropped on purpose.
        it('drops the raw text for a dropped connection', () => {
            const error = CookbotError.toUserFacing(grpcError(14, 'UNAVAILABLE', 'read ECONNRESET'));
            expect(error.message).to.not.contain('ECONNRESET');
            expect(error.message).to.contain('connection');
        });
    });

    describe('RESOURCE_EXHAUSTED disambiguation', () => {

        // gRPC reuses RESOURCE_EXHAUSTED for the message size limit. "Wait a
        // moment and try again" is wrong there - waiting never helps, because
        // every retry resends the same oversized conversation.
        it('recognises the message size limit', () => {
            const error = grpcError(8, 'RESOURCE_EXHAUSTED', 'Received message larger than max (5242880 vs. 4194304)');
            expect(CookbotError.isMessageTooLarge(error)).to.be.true;

            const message = CookbotError.toUserFacing(error).message;
            expect(message).to.contain('too large');
            expect(message).to.contain('new chat');
            expect(message).to.not.contain('wait a moment');
        });

        it('does not treat a usage limit as a size limit', () => {
            const error = grpcError(8, 'RESOURCE_EXHAUSTED', 'some unrecognised limit');
            expect(CookbotError.isMessageTooLarge(error)).to.be.false;
            expect(CookbotError.toUserFacing(error).message).to.contain('limit was reached');
        });
    });

    // The server states these outright; they are its contract, not free text.
    // Retrying never helps for any of them, so the guidance must not ask for it.
    describe('server-stated reasons', () => {

        it('explains an exhausted billing-cycle quota without suggesting a retry', () => {
            const message = CookbotError.toUserFacing(
                grpcError(8, 'RESOURCE_EXHAUSTED', CookbotError.ServerReason.QUOTA_EXHAUSTED)
            ).message;

            expect(message).to.contain('credits');
            expect(message).to.contain('billing cycle');
            expect(message).to.not.match(/try again|wait a moment/i);
            // The raw token is not something to show a user.
            expect(message).to.not.contain('quota_exhausted');
        });

        it('explains a plan without AI rather than blaming sign-in', () => {
            const message = CookbotError.toUserFacing(
                grpcError(7, 'PERMISSION_DENIED', CookbotError.ServerReason.AI_FEATURE_NOT_AVAILABLE)
            ).message;

            expect(message).to.contain('does not include');
            expect(message).to.not.contain('ai_feature_not_available');
        });

        it('explains a failed quota check, which is reported as UNAVAILABLE', () => {
            const message = CookbotError.toUserFacing(
                grpcError(14, 'UNAVAILABLE', CookbotError.ServerReason.QUOTA_CHECK_FAILED)
            ).message;

            // Must not be mistaken for the generic dropped-connection message.
            expect(message).to.contain('credits');
            expect(message).to.not.contain('internet connection');
        });
    });

    describe('classification', () => {

        it('treats only UNAVAILABLE as retryable transport failure', () => {
            expect(CookbotError.isTransientConnection(grpcError(14, 'UNAVAILABLE', 'read ECONNRESET'))).to.be.true;
            expect(CookbotError.isTransientConnection(grpcError(8, 'RESOURCE_EXHAUSTED', 'quota'))).to.be.false;
            expect(CookbotError.isTransientConnection(new Error('plain failure'))).to.be.false;
        });

        it('recognises an expired session', () => {
            expect(CookbotError.isSessionExpired(grpcError(16, 'UNAUTHENTICATED', 'expired session'))).to.be.true;
            expect(CookbotError.isSessionExpired(grpcError(14, 'UNAVAILABLE', 'nope'))).to.be.false;
        });

        it('recognises a context window overflow but not an output token cap', () => {
            expect(CookbotError.isConversationTooLong(new Error('prompt is too long: 210000 tokens > 200000 maximum'))).to.be.true;
            expect(CookbotError.isConversationTooLong(
                new Error('The response was stopped because it exceeded the max token limit of 8192.')
            )).to.be.false;
        });

        it('passes a server-sent error through untouched', () => {
            const error = new Error('the recipe service exploded');
            expect(CookbotError.toUserFacing(error).message).to.equal('the recipe service exploded');
        });
    });
});
