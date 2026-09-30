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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AuthServiceBackend } from './auth-service';
import { USAGE_EVENT_NAMES, UsageEvent, UsageEventContext, UsageEventsService } from '../common/usage-events-protocol';
import { buildEventsBody, buildVisitBody } from '../common/usage-events-payload';

/** Same folder as cookbot-auth.json and the telemetry consent file. */
export function usageFilePath(): string {
    return path.join(os.homedir(), '.theia', 'cook-usage.json');
}

/**
 * A random ID for this install, created once. It is not derived from the
 * account. If the file can't be read or written (read-only home), a fresh
 * in-memory UUID is returned; callers should cache it for the session.
 */
export function loadOrCreateVisitorToken(file: string): string {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (typeof parsed.visitorToken === 'string' && parsed.visitorToken.length > 0) {
            return parsed.visitorToken;
        }
    } catch {
        // missing or unreadable: fall through and create one
    }
    const visitorToken = crypto.randomUUID();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ visitorToken }, undefined, 2), 'utf-8');
    } catch (err) {
        console.debug('[usage-events] could not persist visitor token:', err instanceof Error ? err.message : err);
    }
    return visitorToken;
}

/**
 * Posts editor usage events to cook.md's Ahoy endpoint. Sent from Node, not
 * the renderer: a renderer request would need CORS on /ahoy/*, and this side
 * already holds the auth token. Failures are swallowed; analytics must never
 * break the editor.
 */
@injectable()
export class UsageEventsServiceImpl implements UsageEventsService {

    @inject(AuthServiceBackend)
    protected readonly authService: AuthServiceBackend;

    /** Overall deadline per request, independent of socket idle time. Overridable for tests. */
    protected requestTimeoutMs = 10_000;

    /** One visit per app launch. */
    protected readonly visitToken = crypto.randomUUID();
    protected visitorToken: string | undefined;
    protected visitPosted: Promise<void> | undefined;

    /** Overridable so tests don't touch the real home directory. */
    protected usageFile(): string {
        return usageFilePath();
    }

    async track(event: UsageEvent, context: UsageEventContext): Promise<void> {
        if (!(USAGE_EVENT_NAMES as readonly string[]).includes(event?.name)) {
            return;
        }
        try {
            const visitorToken = this.visitorToken ??= loadOrCreateVisitorToken(this.usageFile());
            if (!this.visitPosted) {
                const posted = this.post('/ahoy/visits', buildVisitBody(this.visitToken, visitorToken, context.appVersion), context, visitorToken);
                this.visitPosted = posted;
                // A failed visit must not be cached for the whole launch: let the next track() retry.
                posted.catch(() => {
                    if (this.visitPosted === posted) {
                        this.visitPosted = undefined;
                    }
                });
            }
            await this.visitPosted;
            await this.post('/ahoy/events', buildEventsBody(this.visitToken, visitorToken, [event]), context, visitorToken);
        } catch (err) {
            console.debug('[usage-events] not sent:', err instanceof Error ? err.message : err);
        }
    }

    /** Only https (or local dev) gets the bearer token. */
    protected shouldSendToken(url: URL): boolean {
        return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    }

    protected async post(pathname: string, body: unknown, context: UsageEventContext, visitorToken: string): Promise<void> {
        const url = new URL(pathname, process.env.WEB_BASE_URL || 'https://cook.md');
        const token = this.shouldSendToken(url) ? await this.authService.getToken() : undefined;
        const payload = JSON.stringify(body);
        const headers: Record<string, string | number> = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': context.userAgent,
            'Ahoy-Visit': this.visitToken,
            'Ahoy-Visitor': visitorToken,
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const lib = url.protocol === 'https:' ? https : http;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (err?: Error): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            };
            const req = lib.request(url, { method: 'POST', headers }, res => {
                res.on('error', finish);
                res.on('aborted', () => finish(new Error('aborted')));
                res.resume();
                finish(res.statusCode && res.statusCode < 300 ? undefined : new Error(`status ${res.statusCode}`));
            });
            // Declared after `req` so a synchronous throw from lib.request leaves no timer behind.
            // `finish` reads it only from request callbacks, which Node never calls synchronously.
            const timer = setTimeout(() => {
                finish(new Error('timeout'));
                req.destroy();
            }, this.requestTimeoutMs);
            req.on('error', finish);
            req.end(payload);
        });
    }
}
