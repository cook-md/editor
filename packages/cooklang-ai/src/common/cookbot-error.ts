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

import { nls } from '@theia/core/lib/common/nls';

/**
 * The subset of gRPC status codes the Cookbot client reacts to.
 * Mirrors `grpc.status` from `@grpc/grpc-js`.
 */
export enum CookbotGrpcStatus {
    PermissionDenied = 7,
    ResourceExhausted = 8,
    Unavailable = 14,
    Unauthenticated = 16,
}

/**
 * Classification of the errors the Cookbot backend can produce, and their
 * translation into messages that make sense to the user.
 *
 * Only the Node side can classify a failure: gRPC status codes live on the
 * error object and do not survive the RPC hop to the frontend, where only the
 * message is preserved.
 */
export namespace CookbotError {

    /** The gRPC status code of an error, if it carries one. */
    export function statusCode(error: unknown): number | undefined {
        if (error && typeof error === 'object' && 'code' in error) {
            const code = (error as { code?: unknown }).code;
            if (typeof code === 'number') {
                return code;
            }
        }
        return undefined;
    }

    function messageOf(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return typeof error === 'string' ? error : '';
    }

    /**
     * The server's own explanation, with the `8 RESOURCE_EXHAUSTED: ` style
     * prefix that @grpc/grpc-js prepends stripped off.
     */
    export function detailOf(error: unknown): string {
        return messageOf(error).replace(/^\d+\s+[A-Z_]+:\s*/, '').trim();
    }

    /**
     * Compose user-facing guidance with the server's explanation. Guidance
     * alone is not enough for statuses that encode a server *decision*: the
     * detail is the only thing that says which decision it was, and without it
     * a report is undiagnosable.
     */
    function withDetail(guidance: string, error: unknown): Error {
        const detail = detailOf(error);
        return new Error(detail ? `${guidance} (${detail})` : guidance);
    }

    /**
     * gRPC rejects messages over `max_receive_message_length` with
     * RESOURCE_EXHAUSTED, the same status used for quota limits. The remedies
     * are completely different, so they must not be reported alike.
     */
    export function isMessageTooLarge(error: unknown): boolean {
        return statusCode(error) === CookbotGrpcStatus.ResourceExhausted
            && /larger than max|message.*too large|exceeds maximum/i.test(messageOf(error));
    }

    /**
     * Machine-readable reasons the Cookbot server sends as the status message.
     * They are the server's contract, not free text, so they can be matched
     * exactly and turned into guidance that is actually correct.
     */
    export namespace ServerReason {
        /** Token allowance for the current billing cycle is used up. */
        export const QUOTA_EXHAUSTED = 'quota_exhausted';
        /** The account's plan does not include Cookbot AI at all. */
        export const AI_FEATURE_NOT_AVAILABLE = 'ai_feature_not_available';
        /** The server could not read usage and refused rather than risk a quota bypass. */
        export const QUOTA_CHECK_FAILED = 'quota_check_failed';
    }

    function hasReason(error: unknown, reason: string): boolean {
        return detailOf(error) === reason;
    }

    /** The server invalidates idle sessions; the next call then fails with UNAUTHENTICATED. */
    export function isSessionExpired(error: unknown): boolean {
        return statusCode(error) === CookbotGrpcStatus.Unauthenticated;
    }

    /**
     * A dropped connection rather than a real failure: idle gRPC connections
     * get closed upstream and the next call fails with UNAVAILABLE (typically
     * `read ECONNRESET`). Retrying on a fresh channel usually succeeds.
     */
    export function isTransientConnection(error: unknown): boolean {
        return statusCode(error) === CookbotGrpcStatus.Unavailable;
    }

    /**
     * The conversation no longer fits into the model's context window, so
     * resending it cannot help - the user has to start a new chat.
     */
    export function isConversationTooLong(error: unknown): boolean {
        const message = messageOf(error);
        return /prompt is too long/i.test(message)
            || /context[ _-]?(length|window)/i.test(message)
            || /maximum context/i.test(message)
            || /(conversation|input|history)\s+(is\s+|has\s+become\s+)?too long/i.test(message);
    }

    /**
     * Translate a backend failure into an error the user can act on.
     *
     * Only pure transport noise is replaced outright - a raw
     * `14 UNAVAILABLE: read ECONNRESET` tells the user nothing, and the
     * remedy does not depend on which socket died. Every status that reflects
     * a decision by the server keeps the server's explanation appended:
     * dropping it leaves a report that cannot be diagnosed afterwards, and
     * invites guidance that guesses at the wrong cause.
     */
    export function toUserFacing(error: unknown): Error {
        if (isConversationTooLong(error)) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/conversationTooLong',
                'This conversation has grown too long for Cookbot to continue. Please start a new chat.'
            ));
        }
        if (isMessageTooLarge(error)) {
            return withDetail(nls.localize(
                'theia/cooklang-ai/error/messageTooLarge',
                'This conversation is too large to send to Cookbot. Please start a new chat.'
            ), error);
        }
        // Reasons the server states outright. Retrying never helps for these,
        // so the guidance must not suggest it.
        if (hasReason(error, ServerReason.QUOTA_EXHAUSTED)) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/quotaExhausted',
                'You have used all the Cookbot AI credits included in your plan for this billing cycle. '
                + 'They reset at the start of the next cycle - see Account for the date, or upgrade your plan for a larger allowance.'
            ));
        }
        if (hasReason(error, ServerReason.AI_FEATURE_NOT_AVAILABLE)) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/aiNotAvailable',
                'Your plan does not include Cookbot AI. Upgrade your plan in Account to use it.'
            ));
        }
        if (hasReason(error, ServerReason.QUOTA_CHECK_FAILED)) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/quotaCheckFailed',
                'Cookbot could not verify your remaining AI credits, so it declined the request. Please try again in a moment.'
            ));
        }
        switch (statusCode(error)) {
            case CookbotGrpcStatus.Unavailable:
                return new Error(nls.localize(
                    'theia/cooklang-ai/error/connectionLost',
                    'Lost the connection to Cookbot. Please check your internet connection and try again.'
                ));
            case CookbotGrpcStatus.Unauthenticated:
                return new Error(nls.localize(
                    'theia/cooklang-ai/error/sessionExpired',
                    'Your Cookbot session has expired. Please try again, and sign in again if the problem persists.'
                ));
            case CookbotGrpcStatus.ResourceExhausted:
                return withDetail(nls.localize(
                    'theia/cooklang-ai/error/resourceExhausted',
                    'Cookbot declined the request because a limit was reached. Check your remaining AI credits in Account.'
                ), error);
            case CookbotGrpcStatus.PermissionDenied:
                return withDetail(nls.localize(
                    'theia/cooklang-ai/error/permissionDenied',
                    'Cookbot declined the request. Please make sure you are signed in with an active subscription.'
                ), error);
        }
        if (statusCode(error) !== undefined) {
            return withDetail(nls.localize(
                'theia/cooklang-ai/error/requestFailed',
                'Cookbot could not complete the request. Please try again.'
            ), error);
        }
        return error instanceof Error ? error : new Error(messageOf(error) || 'Unknown Cookbot error');
    }

    /** Shown when a response stream completes without producing any content. */
    export function emptyResponse(): Error {
        return new Error(nls.localize(
            'theia/cooklang-ai/error/emptyResponse',
            'Cookbot returned an empty response. Please try again, or start a new chat if this keeps happening.'
        ));
    }
}
