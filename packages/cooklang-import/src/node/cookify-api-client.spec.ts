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
import { CookifyApiClient, HttpResponse } from './cookify-api-client';
import { ConvertResult } from '../common/recipe-import-protocol';

class TestClient extends CookifyApiClient {
    requests: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    nextResponse: HttpResponse = { status: 200, body: '{"cooklang": "recipe"}' };
    failWith: Error | undefined;

    protected override httpPost(url: URL, body: string, headers: Record<string, string>): Promise<HttpResponse> {
        this.requests.push({ url: url.toString(), body, headers });
        return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.nextResponse);
    }
}

function createClient(token: string | undefined): TestClient {
    const client = new TestClient();
    // Property injection: assign the injected services directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).authService = { getToken: () => Promise.resolve(token) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).applicationServer = { getApplicationInfo: () => Promise.resolve({ name: 'cook-editor', version: '0.1.0' }) };
    return client;
}

describe('CookifyApiClient', () => {

    it('POSTs the url and returns cooklang + name on 200', async () => {
        const client = createClient(undefined);
        client.nextResponse = { status: 200, body: '{"cooklang": "---\\ntitle: Pancakes\\n---\\n", "name": "Pancakes"}' };
        const result = await client.convertUrl('https://example.com/pancakes');
        expect(result.cooklang).to.contain('Pancakes');
        expect(result.name).to.equal('Pancakes');
        expect(client.requests[0].url).to.equal('https://cook.md/api/cookify/url');
        expect(JSON.parse(client.requests[0].body)).to.deep.equal({ url: 'https://example.com/pancakes' });
    });

    it('omits the Authorization header when logged out and adds it when a token exists', async () => {
        const anonymous = createClient(undefined);
        await anonymous.convertText('some recipe text');
        expect(anonymous.requests[0].headers).to.not.have.property('Authorization');

        const signedIn = createClient('jwt-token');
        await signedIn.convertText('some recipe text');
        expect(signedIn.requests[0].headers.Authorization).to.equal('Bearer jwt-token');
    });

    it('sends JSON and client-version headers', async () => {
        const client = createClient(undefined);
        await client.convertText('text');
        const headers = client.requests[0].headers;
        expect(headers['Content-Type']).to.equal('application/json');
        expect(headers.Accept).to.equal('application/json');
        expect(headers['X-Client-Version']).to.equal('editor/0.1.0');
    });

    it('rejects convertImages locally when no token is present', async () => {
        const client = createClient(undefined);
        const result = await client.convertImages(['base64data']);
        expect(result.error).to.equal('unauthorized');
        expect(client.requests).to.have.length(0);
    });

    it('sends images with the bearer token when signed in', async () => {
        const client = createClient('jwt-token');
        const result = await client.convertImages(['aaa', 'bbb']);
        expect(result.error).to.equal(undefined);
        expect(client.requests[0].url).to.equal('https://cook.md/api/cookify/images');
        expect(JSON.parse(client.requests[0].body)).to.deep.equal({ images: ['aaa', 'bbb'] });
    });

    it('rejects convertImages locally when more than 5 images are given', async () => {
        const client = createClient('jwt-token');
        const result = await client.convertImages(['1', '2', '3', '4', '5', '6']);
        expect(result.error).to.equal('conversion-failed');
        expect(client.requests).to.have.length(0);
    });

    it('rejects convertImages locally when the image list is empty', async () => {
        const client = createClient('jwt-token');
        const result = await client.convertImages([]);
        expect(result.error).to.equal('conversion-failed');
        expect(client.requests).to.have.length(0);
    });

    const statusCases: Array<[number, string]> = [
        [401, 'unauthorized'],
        [422, 'conversion-failed'],
        [429, 'rate-limited'],
        [500, 'network'],
    ];
    for (const [status, code] of statusCases) {
        it(`maps HTTP ${status} to '${code}'`, async () => {
            const client = createClient(undefined);
            client.nextResponse = { status, body: '' };
            const result: ConvertResult = await client.convertUrl('https://example.com');
            expect(result.error).to.equal(code);
        });
    }

    it('maps transport failures to network error', async () => {
        const client = createClient(undefined);
        client.failWith = new Error('ECONNREFUSED');
        const result = await client.convertUrl('https://example.com');
        expect(result.error).to.equal('network');
    });

    it('maps a 200 with unparseable body to conversion-failed', async () => {
        const client = createClient(undefined);
        client.nextResponse = { status: 200, body: 'not json' };
        const result = await client.convertUrl('https://example.com');
        expect(result.error).to.equal('conversion-failed');
    });
});
