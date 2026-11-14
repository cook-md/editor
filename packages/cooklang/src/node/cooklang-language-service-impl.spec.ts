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
import { CooklangLanguageServiceImpl, CooklangNativeLspServer } from './cooklang-language-service-impl';

interface LspTestMessage {
    id?: number;
    method: string;
    params?: {
        rootUri?: string | null;
        textDocument?: { uri: string; version?: number; text?: string };
    };
}

/** Stands in for the native language server: answers every request, and can be stopped like a crash would. */
class FakeLspServer implements CooklangNativeLspServer {

    readonly received: LspTestMessage[] = [];
    /** When false, requests other than `initialize` are left unanswered. */
    answering = true;
    private readonly output: (Buffer | Error | null)[] = [];
    private waiting: (() => void) | undefined;

    constructor(readonly name: string) { }

    get methods(): string[] {
        return this.received.map(message => message.method);
    }

    sendMessage(raw: string): void {
        const message = JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4)) as LspTestMessage;
        this.received.push(message);
        if (message.id === undefined) {
            return;
        }
        if (message.method === 'initialize') {
            this.emit({ jsonrpc: '2.0', id: message.id, result: { capabilities: { server: this.name } } });
        } else if (this.answering) {
            // eslint-disable-next-line no-null/no-null
            this.emit({ jsonrpc: '2.0', id: message.id, result: message.method === 'shutdown' ? null : { from: this.name, method: message.method } });
        }
    }

    async receiveMessage(): Promise<Buffer | null> {
        if (this.output.length === 0) {
            await new Promise<void>(resolve => this.waiting = resolve);
        }
        const next = this.output.shift()!;
        if (next instanceof Error) {
            throw next;
        }
        return next;
    }

    /** End the output stream, as when the server task dies. */
    stop(): void {
        // eslint-disable-next-line no-null/no-null
        this.push(null);
    }

    /** Make the next read fail, as when the addon cannot hand a chunk over. */
    fail(error: Error): void {
        this.push(error);
    }

    private emit(message: object): void {
        const body = Buffer.from(JSON.stringify(message), 'utf-8');
        this.push(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
    }

    private push(item: Buffer | Error | null): void {
        this.output.push(item);
        this.waiting?.();
        this.waiting = undefined;
    }
}

class TestLanguageService extends CooklangLanguageServiceImpl {

    readonly servers: FakeLspServer[] = [];
    readonly reported: Error[] = [];
    protected override readonly errorReporter = {
        reportUnexpected: (error: unknown) => { this.reported.push(error as Error); }
    };

    static create(): TestLanguageService {
        const service = new TestLanguageService();
        service.init();
        return service;
    }

    get server(): FakeLspServer {
        return this.servers[this.servers.length - 1];
    }

    protected override createNativeLspServer(): CooklangNativeLspServer {
        const server = new FakeLspServer(`server-${this.servers.length + 1}`);
        this.servers.push(server);
        return server;
    }
}

/** Let the reader loop and the connection's queued work run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

const RECIPE = 'file:///ws/Lamb%20K%C3%B6fte.cook';

describe('CooklangLanguageServiceImpl language server recovery', () => {

    it('restarts a stopped server, re-initializes it and reopens documents in their current state', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');
        service.didOpenTextDocument(RECIPE, 'cooklang', 1, 'Mix @lamb{500%g}.');
        service.didChangeTextDocument(RECIPE, 2, 'Mix @lamb{500%g} and @cumin{1%tsp}.');
        service.didOpenTextDocument('file:///ws/closed.cook', 'cooklang', 1, 'Boil @water{}.');
        service.didCloseTextDocument('file:///ws/closed.cook');
        await settle();

        service.server.stop();
        await settle();
        const symbols = await service.documentSymbol(RECIPE);

        expect(service.servers).to.have.length(2);
        expect(symbols).to.deep.equal({ from: 'server-2', method: 'textDocument/documentSymbol' });
        const restarted = service.servers[1];
        expect(restarted.methods).to.deep.equal(['initialize', 'initialized', 'textDocument/didOpen', 'textDocument/documentSymbol']);
        expect(restarted.received[0].params?.rootUri).to.equal('file:///ws');
        expect(restarted.received[2].params?.textDocument).to.deep.include({
            uri: RECIPE, version: 2, text: 'Mix @lamb{500%g} and @cumin{1%tsp}.'
        });
    });

    it('keeps an edit made while the server is down', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');
        service.didOpenTextDocument(RECIPE, 'cooklang', 1, 'old');
        await settle();
        service.server.stop();
        await settle();

        expect(() => service.didChangeTextDocument(RECIPE, 2, 'new')).not.to.throw();
        expect(() => service.didSaveTextDocument(RECIPE)).not.to.throw();
        await service.hover(RECIPE, 0, 0);

        const reopened = service.servers[1].received.filter(message => message.method === 'textDocument/didOpen');
        expect(reopened).to.have.length(1);
        expect(reopened[0].params?.textDocument?.text).to.equal('new');
    });

    it('shares one restart between concurrent requests', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');
        service.server.stop();
        await settle();

        await Promise.all([service.hover(RECIPE, 0, 0), service.documentSymbol(RECIPE), service.semanticTokensFull(RECIPE)]);

        expect(service.servers).to.have.length(2);
        expect(service.servers[1].methods.filter(method => method === 'initialize')).to.have.length(1);
    });

    it('resolves a request to null when the server stops before answering', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');
        service.server.answering = false;

        const pending = service.hover(RECIPE, 0, 0);
        await settle();
        service.server.stop();

        // eslint-disable-next-line no-null/no-null
        expect(await pending).to.equal(null);
    });

    it('reports an unexpected stop once, with the cause', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');

        service.server.fail(new Error('could not read server output'));
        await settle();
        await service.hover(RECIPE, 0, 0);
        await service.hover(RECIPE, 0, 0);

        expect(service.reported.map(error => error.message)).to.deep.equal([
            'Cooklang language server stopped unexpectedly: could not read server output'
        ]);
    });

    it('stops restarting a server that keeps stopping, and answers null instead of throwing', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');

        for (let i = 0; i < 3; i++) {
            service.server.stop();
            await settle();
            expect(await service.hover(RECIPE, 0, 0), `restart ${i + 1}`).to.deep.include({ method: 'textDocument/hover' });
        }
        service.server.stop();
        await settle();

        // eslint-disable-next-line no-null/no-null
        expect(await service.hover(RECIPE, 0, 0)).to.equal(null);
        // eslint-disable-next-line no-null/no-null
        expect(await service.completion(RECIPE, 0, 0)).to.equal(null);
        expect(() => service.didChangeTextDocument(RECIPE, 3, 'x')).not.to.throw();
        expect(service.servers).to.have.length(4);
    });

    it('starts a fresh server for the next window after a shutdown, without reporting a crash', async () => {
        const service = TestLanguageService.create();
        await service.initialize('file:///ws');

        await service.shutdown();
        await settle();
        const result = await service.initialize('file:///other');

        expect(result.capabilities).to.deep.equal({ server: 'server-2' });
        expect(service.servers[1].received[0].params?.rootUri).to.equal('file:///other');
        expect(service.reported).to.deep.equal([]);
    });

    it('reuses the first initialize for a second frontend and announces a changed root', async () => {
        const service = TestLanguageService.create();
        const first = await service.initialize('file:///ws');
        const second = await service.initialize('file:///other');
        await settle();

        expect(second).to.equal(first);
        expect(service.servers).to.have.length(1);
        expect(service.server.methods).to.deep.equal(['initialize', 'initialized', 'workspace/didChangeWorkspaceFolders']);
    });
});

describe('CooklangLanguageServiceImpl with the native language server', () => {

    it('survives responses full of multi-byte characters larger than one read', async function (): Promise<void> {
        // Real server on a large document; well past mocha's 2 s default on a cold CI runner.
        this.timeout(30_000);
        const reported: unknown[] = [];
        const service = new CooklangLanguageServiceImpl();
        (service as unknown as { errorReporter: object }).errorReporter = { reportUnexpected: (error: unknown) => reported.push(error) };
        service['init']();
        // eslint-disable-next-line no-null/no-null
        await service.initialize(null);
        // Each line is a symbol; together the response is far beyond the 8 KiB
        // the server writes at a time, so chunks end mid-character.
        const text = Array.from({ length: 1500 }, (_, i) => `Añadir @crème fraîche née ${i}{1%½ taza} à 180°C.`).join('\n\n');
        const uri = 'file:///tmp/cooklang-lsp-spec/K%C3%B6fte.cook';
        service.didOpenTextDocument(uri, 'cooklang', 1, text);

        for (let i = 0; i < 5; i++) {
            const symbols = await service.documentSymbol(uri);
            expect(JSON.stringify(symbols)).to.contain('crème fraîche née 1499');
            expect(await service.semanticTokensFull(uri)).to.have.property('data');
        }

        expect(reported).to.deep.equal([]);
        await service.shutdown();
    });

    it('starts a second native server after the first was shut down', async function (): Promise<void> {
        this.timeout(30_000);
        const reported: unknown[] = [];
        const service = new CooklangLanguageServiceImpl();
        (service as unknown as { errorReporter: object }).errorReporter = { reportUnexpected: (error: unknown) => reported.push(error) };
        service['init']();
        const uri = 'file:///tmp/cooklang-lsp-spec/restart.cook';
        // eslint-disable-next-line no-null/no-null
        await service.initialize(null);
        service.didOpenTextDocument(uri, 'cooklang', 1, 'Mix @flour{200%g} and @water{120%ml}.');
        const before = await service.documentSymbol(uri);
        expect(JSON.stringify(before)).to.contain('flour');

        await service.shutdown();
        // Nothing reopens the document here: the restart has to replay it.
        const after = await service.documentSymbol(uri);

        expect(after).to.deep.equal(before);
        expect(reported).to.deep.equal([]);
        await service.shutdown();
    });
});

describe('CooklangLanguageServiceImpl report config conversion', () => {

    it('converts URI entries to filesystem paths', () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = impl['convertReportConfigPaths'](JSON.stringify({
            scale: 1,
            basePath: 'file:///tmp/workspace',
            aislePath: 'file:///tmp/workspace/config/aisle.conf'
        }));
        const config = JSON.parse(result);
        expect(config.scale).to.equal(1);
        expect(config.basePath).to.equal('/tmp/workspace');
        expect(config.aislePath).to.equal('/tmp/workspace/config/aisle.conf');
    });

    it('converts stagedRecipes keys from URIs to filesystem paths', () => {
        const impl = new CooklangLanguageServiceImpl();
        const config = JSON.parse(impl['convertReportConfigPaths'](JSON.stringify({
            stagedRecipes: { 'file:///tmp/workspace/Main%20Dish/Teriyaki%20Steak.cook': 'Sear @steak{300%g}.' }
        })));
        expect(config.stagedRecipes).to.deep.equal({ '/tmp/workspace/Main Dish/Teriyaki Steak.cook': 'Sear @steak{300%g}.' });
    });

    it('leaves absent path entries absent', () => {
        const impl = new CooklangLanguageServiceImpl();
        const config = JSON.parse(impl['convertReportConfigPaths']('{"scale":2}'));
        expect(config).to.deep.equal({ scale: 2 });
    });

    it('returns the error contract for malformed config JSON', async () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = JSON.parse(await impl.renderReport('', '', 'not json'));
        expect(result.error).to.be.a('string').that.is.not.empty;
    });

    it('renders through the async native export', async () => {
        const impl = new CooklangLanguageServiceImpl();
        const result = JSON.parse(await impl.renderReport('Mix @eggs{2}.', '{% for i in ingredients %}{{ i.name }}{% endfor %}', '{}'));
        expect(result.output).to.equal('eggs');
    });
});
