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
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { UsageEventsServiceImpl } from './usage-events-service';
import { UsageEvent, UsageEventContext } from '../common/usage-events-protocol';

interface Seen { url: string; headers: http.IncomingHttpHeaders; body: string }

class TestService extends UsageEventsServiceImpl {
    constructor(private readonly file: string, token: string | undefined, timeoutMs = 10_000) {
        super();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).authService = { getToken: async () => token };
        this.requestTimeoutMs = timeoutMs;
    }
    protected override usageFile(): string { return this.file; }
}

const context: UsageEventContext = { userAgent: 'Mozilla/5.0 (Macintosh) Electron/37', appVersion: '0.1.0' };
const event: UsageEvent = { name: 'cookbot_gate_shown', properties: { surface: 'editor' }, time: '2026-10-01T10:00:00Z' };

describe('UsageEventsServiceImpl', () => {
    let dir: string;
    let server: http.Server;
    let seen: Seen[];
    let handler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;
    let savedEnv: string | undefined;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-usage-svc-'));
        seen = [];
        handler = (_req, res) => { res.statusCode = 200; res.end('{}'); };
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                seen.push({ url: req.url ?? '', headers: req.headers, body });
                handler(req, res, seen.length);
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        savedEnv = process.env.WEB_BASE_URL;
        process.env.WEB_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        if (savedEnv === undefined) {
            delete process.env.WEB_BASE_URL;
        } else {
            process.env.WEB_BASE_URL = savedEnv;
        }
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const file = () => path.join(dir, 'cook-usage.json');

    it('posts the visit before the event, with Ahoy and user-agent headers', async () => {
        await new TestService(file(), undefined).track(event, context);
        expect(seen.map(s => s.url)).to.deep.equal(['/ahoy/visits', '/ahoy/events']);
        const visitor = JSON.parse(fs.readFileSync(file(), 'utf-8')).visitorToken;
        for (const s of seen) {
            expect(s.headers['user-agent']).to.equal(context.userAgent);
            expect(s.headers['ahoy-visit']).to.match(/^[0-9a-f-]{36}$/);
            expect(s.headers['ahoy-visitor']).to.equal(visitor);
        }
        expect(seen[0].headers['ahoy-visit']).to.equal(seen[1].headers['ahoy-visit']);
    });

    it('sends Authorization only when a token exists', async () => {
        await new TestService(file(), undefined).track(event, context);
        expect(seen.every(s => s.headers.authorization === undefined)).to.equal(true);
        seen = [];
        await new TestService(file(), 'tok123').track(event, context);
        expect(seen.every(s => s.headers.authorization === 'Bearer tok123')).to.equal(true);
    });

    it('does not send the token over plain http to a non-local host', async () => {
        process.env.WEB_BASE_URL = 'http://example.invalid';
        const svc = new TestService(file(), 'tok123', 500);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((svc as any).shouldSendToken(new URL('http://example.invalid/x'))).to.equal(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((svc as any).shouldSendToken(new URL('https://cook.md/x'))).to.equal(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((svc as any).shouldSendToken(new URL('http://localhost:3000/x'))).to.equal(true);
    });

    it('retries the visit on the next track after a 500', async () => {
        handler = (_req, res, n) => { res.statusCode = n === 1 ? 500 : 200; res.end('{}'); };
        const svc = new TestService(file(), undefined);
        await svc.track(event, context);
        expect(seen.map(s => s.url)).to.deep.equal(['/ahoy/visits']);
        await svc.track(event, context);
        expect(seen.map(s => s.url)).to.deep.equal(['/ahoy/visits', '/ahoy/visits', '/ahoy/events']);
    });

    it('does not hang when the server never responds', async () => {
        handler = () => { /* never respond */ };
        const started = Date.now();
        await new TestService(file(), undefined, 200).track(event, context);
        expect(Date.now() - started).to.be.lessThan(2000);
    });

    it('drops unknown event names', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await new TestService(file(), undefined).track({ ...event, name: 'made_up' as any }, context);
        expect(seen).to.have.length(0);
    });
});
