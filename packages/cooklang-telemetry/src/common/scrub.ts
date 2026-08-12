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

/** Replacement for any value that must not leave the machine. */
export const REDACTED = '[redacted]';

/**
 * Keys allowed to survive in `extra`. An allowlist rather than a denylist:
 * a field nobody anticipated must default to being dropped, because a leak of
 * recipe content or credentials cannot be undone after the fact.
 */
export const ALLOWED_EXTRA_KEYS: ReadonlySet<string> = new Set([
    'grpcStatus',
    'grpcCode',
    'processType',
    'theiaVersion'
]);

/** Contexts allowed to survive. These are SDK-populated and carry no user content. */
export const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
    'os',
    'device',
    'runtime',
    'app',
    'browser',
    'trace'
]);

const SECRET_ASSIGNMENT = /\b(authToken|token|password|secret|apiKey|sessionId|Authorization)\b(\s*[:=]\s*)(\S+)/gi;
const BEARER_TOKEN = /\bBearer\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export interface ScrubOptions {
    /** Absolute path to the user's home directory. */
    homeDir: string;
}

export interface ScrubbableFrame {
    filename?: string;
    abs_path?: string;
}

export interface ScrubbableException {
    value?: string;
    stacktrace?: { frames?: ScrubbableFrame[] };
}

export interface ScrubbableBreadcrumb {
    message?: string;
    data?: Record<string, unknown>;
}

/**
 * Structural subset of a Sentry event. Deliberately not Sentry's own type, so
 * this module stays dependency-free and directly testable.
 */
export interface ScrubbableEvent {
    message?: string;
    exception?: { values?: ScrubbableException[] };
    breadcrumbs?: ScrubbableBreadcrumb[];
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    request?: unknown;
}

/** Remove the home directory and any secret-shaped substring from a string. */
export function scrubString(value: string, options: ScrubOptions): string {
    let result = value;
    if (options.homeDir) {
        result = result.split(options.homeDir).join('~');
    }
    result = result.replace(SECRET_ASSIGNMENT, (_match, key, separator) => `${key}${separator}${REDACTED}`);
    result = result.replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
    result = result.replace(JWT, REDACTED);
    return result;
}

function scrubUnknown(value: unknown, options: ScrubOptions): unknown {
    if (typeof value === 'string') {
        return scrubString(value, options);
    }
    if (Array.isArray(value)) {
        return value.map(item => scrubUnknown(item, options));
    }
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            result[key] = scrubUnknown(nested, options);
        }
        return result;
    }
    return value;
}

/** Scrub a breadcrumb, returning a new object rather than modifying the input. */
export function scrubBreadcrumb(breadcrumb: ScrubbableBreadcrumb, options: ScrubOptions): ScrubbableBreadcrumb {
    return {
        ...breadcrumb,
        message: breadcrumb.message === undefined ? undefined : scrubString(breadcrumb.message, options),
        data: breadcrumb.data === undefined ? undefined : scrubUnknown(breadcrumb.data, options) as Record<string, unknown>
    };
}

/**
 * Strip everything from an event that could carry personal content or
 * credentials. Returns a new event; the input is not modified.
 */
export function scrubEvent(event: ScrubbableEvent, options: ScrubOptions): ScrubbableEvent {
    const result: ScrubbableEvent = { ...event };

    if (result.message !== undefined) {
        result.message = scrubString(result.message, options);
    }

    if (result.exception?.values) {
        result.exception = {
            values: result.exception.values.map(value => ({
                ...value,
                value: value.value === undefined ? undefined : scrubString(value.value, options),
                stacktrace: value.stacktrace && {
                    frames: value.stacktrace.frames?.map(frame => ({
                        ...frame,
                        filename: frame.filename === undefined ? undefined : scrubString(frame.filename, options),
                        abs_path: frame.abs_path === undefined ? undefined : scrubString(frame.abs_path, options)
                    }))
                }
            }))
        };
    }

    if (result.breadcrumbs) {
        result.breadcrumbs = result.breadcrumbs.map(breadcrumb => scrubBreadcrumb(breadcrumb, options));
    }

    if (result.extra) {
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result.extra)) {
            if (ALLOWED_EXTRA_KEYS.has(key)) {
                extra[key] = scrubUnknown(value, options);
            }
        }
        result.extra = extra;
    }

    if (result.contexts) {
        const contexts: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result.contexts)) {
            if (ALLOWED_CONTEXT_KEYS.has(key)) {
                contexts[key] = scrubUnknown(value, options);
            }
        }
        result.contexts = contexts;
    }

    // Request bodies can contain anything; never send them.
    result.request = undefined;

    return result;
}
