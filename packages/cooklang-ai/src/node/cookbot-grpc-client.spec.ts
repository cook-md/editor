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

/* eslint-disable @typescript-eslint/no-explicit-any, no-null/no-null */

import { expect } from 'chai';
import { CookbotGrpcClient } from './cookbot-grpc-client';
import { CookbotServerToolsServiceImpl } from './cookbot-server-tools-service';
import { CookbotCatalogRecipe } from '../common/cookbot-server-tools-protocol';

type UnaryCallback = (err: Error | null, response?: any) => void;

/**
 * Stand-in for the proto-loaded service object: records the request of each
 * unary call and answers with a canned response (or error).
 */
class FakeService {
    calls: Array<{ method: string; request: any }> = [];
    responses: Record<string, any> = {};
    errors: Record<string, Error> = {};

    SearchRecipeCatalog = (request: any, cb: UnaryCallback) => this.answer('SearchRecipeCatalog', request, cb);
    GetCatalogRecipe = (request: any, cb: UnaryCallback) => this.answer('GetCatalogRecipe', request, cb);

    private answer(method: string, request: any, cb: UnaryCallback): void {
        this.calls.push({ method, request });
        const error = this.errors[method];
        if (error) {
            cb(error);
            return;
        }
        cb(null, this.responses[method]);
    }
}

function createClient(options: { sessionId?: string } = { sessionId: 'sess-1' }): { client: CookbotGrpcClient; service: FakeService } {
    // Constructed directly (not through inversify) so @postConstruct connect() never runs.
    const client = new CookbotGrpcClient();
    const service = new FakeService();
    (client as any).service = service;
    (client as any).sessionId = options.sessionId;
    return { client, service };
}

describe('CookbotGrpcClient catalog RPCs', () => {

    describe('searchRecipeCatalog', () => {
        it('sends the session id and criteria JSON, returns results_json verbatim', async () => {
            const { client, service } = createClient();
            const body = '{"recipes":[{"id":"abc","title":"Dal"}],"hint":null}';
            service.responses.SearchRecipeCatalog = { resultsJson: body };

            const result = await client.searchRecipeCatalog('{"query":"lentils","limit":3}');

            expect(result).to.equal(body);
            expect(service.calls).to.deep.equal([{
                method: 'SearchRecipeCatalog',
                request: { sessionId: 'sess-1', criteriaJson: '{"query":"lentils","limit":3}' },
            }]);
        });

        it('sends an empty session id before Initialize', async () => {
            const { client, service } = createClient({});
            service.responses.SearchRecipeCatalog = { resultsJson: '{}' };

            await client.searchRecipeCatalog('{}');

            expect(service.calls[0].request.sessionId).to.equal('');
        });

        it('rejects with the gRPC error untouched', async () => {
            const { client, service } = createClient();
            const grpcError = Object.assign(new Error('3 INVALID_ARGUMENT: limit must be an integer'), { code: 3 });
            service.errors.SearchRecipeCatalog = grpcError;

            let caught: unknown;
            try {
                await client.searchRecipeCatalog('{"limit":"x"}');
            } catch (error) {
                caught = error;
            }
            expect(caught).to.equal(grpcError);
        });
    });

    describe('getCatalogRecipe', () => {
        it('sends the session id and recipe id, maps the CatalogRecipe fields', async () => {
            const { client, service } = createClient();
            service.responses.GetCatalogRecipe = {
                id: 'r-1',
                title: 'Spaghetti Carbonara',
                mealType: 'dinner',
                course: 'main',
                content: '---\ntitle: Spaghetti Carbonara\n---\n\nBoil @pasta{200%g}.',
                suggestedPath: 'Dinner/Spaghetti Carbonara.cook',
            };

            const recipe = await client.getCatalogRecipe('r-1');

            expect(service.calls).to.deep.equal([{
                method: 'GetCatalogRecipe',
                request: { sessionId: 'sess-1', recipeId: 'r-1' },
            }]);
            expect(recipe).to.deep.equal({
                id: 'r-1',
                title: 'Spaghetti Carbonara',
                mealType: 'dinner',
                course: 'main',
                content: '---\ntitle: Spaghetti Carbonara\n---\n\nBoil @pasta{200%g}.',
                suggestedPath: 'Dinner/Spaghetti Carbonara.cook',
            });
        });

        it('rejects with the gRPC error untouched', async () => {
            const { client, service } = createClient();
            const grpcError = Object.assign(new Error('5 NOT_FOUND: recipe not found'), { code: 5 });
            service.errors.GetCatalogRecipe = grpcError;

            let caught: unknown;
            try {
                await client.getCatalogRecipe('missing');
            } catch (error) {
                caught = error;
            }
            expect(caught).to.equal(grpcError);
        });
    });
});

describe('CookbotServerToolsServiceImpl catalog forwarding', () => {

    function createService(): { service: CookbotServerToolsServiceImpl; grpc: any } {
        const grpc = {
            searchCalls: [] as string[],
            getCalls: [] as string[],
            resultsJson: '{"recipes":[],"hint":null}',
            async searchRecipeCatalog(criteriaJson: string): Promise<string> {
                this.searchCalls.push(criteriaJson);
                return this.resultsJson;
            },
            async getCatalogRecipe(id: string): Promise<CookbotCatalogRecipe> {
                this.getCalls.push(id);
                return { id, title: 't', mealType: 'm', course: 'c', content: 'x', suggestedPath: 'p' };
            },
        };
        const service = new CookbotServerToolsServiceImpl();
        (service as any).grpcClient = grpc;
        return { service, grpc };
    }

    it('serialises the criteria and parses the results JSON', async () => {
        const { service, grpc } = createService();
        grpc.resultsJson = '{"recipes":[{"id":"a"}],"hint":"try fewer filters"}';

        const result = await service.searchRecipeCatalog({ query: 'soup', limit: 2 });

        expect(grpc.searchCalls).to.deep.equal(['{"query":"soup","limit":2}']);
        expect(result).to.deep.equal({ recipes: [{ id: 'a' }], hint: 'try fewer filters' });
    });

    it('sends {} when criteria is missing', async () => {
        const { service, grpc } = createService();

        await service.searchRecipeCatalog(undefined as unknown as object);

        expect(grpc.searchCalls).to.deep.equal(['{}']);
    });

    it('turns an unparseable body into a readable error', async () => {
        const { service, grpc } = createService();
        grpc.resultsJson = 'not json';

        let message = '';
        try {
            await service.searchRecipeCatalog({});
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).to.equal('Catalog search returned an unreadable response.');
    });

    it('forwards getCatalogRecipe by id', async () => {
        const { service, grpc } = createService();

        const recipe = await service.getCatalogRecipe('r-9');

        expect(grpc.getCalls).to.deep.equal(['r-9']);
        expect(recipe.id).to.equal('r-9');
        expect(recipe.suggestedPath).to.equal('p');
    });
});

describe('CookbotGrpcClient outgoing history trimming', () => {

    const MAX_REQUEST_BYTES = (CookbotGrpcClient as any).MAX_REQUEST_BYTES as number;
    const TRIMMED = (CookbotGrpcClient as any).TRIMMED_TOOL_RESULT_CHARS as number;

    function trim(messages: any[]): any[] {
        const { client } = createClient();
        return (client as any).trimOversizedHistory(messages);
    }

    function toolResult(chars: number): any {
        return { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', toolResultContent: 'x'.repeat(chars) }] };
    }

    it('leaves an ordinary conversation untouched', () => {
        const messages = [
            { role: 'user', content: [{ type: 'text', text: 'suggest a weekend meal' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Chicken Pesto Pizza' }] },
        ];
        expect(trim(messages)).to.deep.equal(messages);
    });

    it('shortens a tool result that would exceed the request budget', () => {
        // The shape that wedged the session: one fetched image, ~4.8 MB.
        const messages = [toolResult(MAX_REQUEST_BYTES + 1_000_000)];
        const result = trim(messages);

        expect(result[0].content[0].toolResultContent.length).to.be.lessThan(TRIMMED + 500);
        expect(result[0].content[0].toolResultContent).to.contain('truncated');
    });

    it('brings an oversized history back under the budget', () => {
        const { client } = createClient();
        const messages = [toolResult(MAX_REQUEST_BYTES), toolResult(MAX_REQUEST_BYTES)];

        const result = (client as any).trimOversizedHistory(messages);

        expect((client as any).historyByteLength(result)).to.be.at.most(MAX_REQUEST_BYTES);
    });

    it('does not mutate the caller\'s messages', () => {
        const messages = [toolResult(MAX_REQUEST_BYTES + 1_000_000)];
        const originalLength = messages[0].content[0].toolResultContent.length;

        trim(messages);

        expect(messages[0].content[0].toolResultContent.length).to.equal(originalLength);
    });

    it('never trims user or assistant text, only tool results', () => {
        const speech = 'y'.repeat(MAX_REQUEST_BYTES + 1_000_000);
        const messages = [{ role: 'user', content: [{ type: 'text', text: speech }] }];

        const result = trim(messages);

        expect(result[0].content[0].text).to.equal(speech);
    });
});
