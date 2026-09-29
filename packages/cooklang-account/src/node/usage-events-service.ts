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
import { UsageEvent, UsageEventContext, UsageEventsService } from '../common/usage-events-protocol';
import { buildEventsBody, buildVisitBody } from '../common/usage-events-payload';

/** Same folder as cookbot-auth.json and the telemetry consent file. */
export function usageFilePath(): string {
    return path.join(os.homedir(), '.theia', 'cook-usage.json');
}

/** A random ID for this install, created once. Not tied to the account. */
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ visitorToken }, undefined, 2), 'utf-8');
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

    /** One visit per app launch. */
    private readonly visitToken = crypto.randomUUID();
    private visitorToken: string | undefined;
    private visitPosted: Promise<void> | undefined;

    async track(event: UsageEvent, context: UsageEventContext): Promise<void> {
        try {
            this.visitorToken ??= loadOrCreateVisitorToken(usageFilePath());
            this.visitPosted ??= this.post('/ahoy/visits', buildVisitBody(this.visitToken, this.visitorToken, context.appVersion), context);
            await this.visitPosted;
            await this.post('/ahoy/events', buildEventsBody(this.visitToken, this.visitorToken, [event]), context);
        } catch (err) {
            console.debug('[usage-events] not sent:', err instanceof Error ? err.message : err);
        }
    }

    private async post(pathname: string, body: unknown, context: UsageEventContext): Promise<void> {
        const url = new URL(pathname, process.env.WEB_BASE_URL || 'https://cook.md');
        const token = await this.authService.getToken();
        const payload = JSON.stringify(body);
        const headers: Record<string, string | number> = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': context.userAgent,
            'Ahoy-Visit': this.visitToken,
            'Ahoy-Visitor': this.visitorToken ?? '',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const lib = url.protocol === 'https:' ? https : http;
        await new Promise<void>((resolve, reject) => {
            const req = lib.request(url, { method: 'POST', headers, timeout: 10_000 }, res => {
                res.resume();
                res.on('end', () => (res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`status ${res.statusCode}`))));
            });
            req.on('timeout', () => req.destroy(new Error('timeout')));
            req.on('error', reject);
            req.end(payload);
        });
    }
}
