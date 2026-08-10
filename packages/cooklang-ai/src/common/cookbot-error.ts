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
     * Translate a backend failure into an error the user can act on. Transport
     * level failures are replaced entirely - a raw gRPC status line such as
     * `14 UNAVAILABLE: read ECONNRESET` means nothing to the user. Errors that
     * carry a message from the model or the server are kept as they are.
     */
    export function toUserFacing(error: unknown): Error {
        if (isConversationTooLong(error)) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/conversationTooLong',
                'This conversation has grown too long for Cookbot to continue. Please start a new chat.'
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
                return new Error(nls.localize(
                    'theia/cooklang-ai/error/rateLimited',
                    'Cookbot is busy right now. Please wait a moment and try again.'
                ));
            case CookbotGrpcStatus.PermissionDenied:
                return new Error(nls.localize(
                    'theia/cooklang-ai/error/permissionDenied',
                    'Cookbot declined the request. Please make sure you are signed in with an active subscription.'
                ));
        }
        if (statusCode(error) !== undefined) {
            return new Error(nls.localize(
                'theia/cooklang-ai/error/requestFailed',
                'Cookbot could not complete the request. Please try again.'
            ));
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
