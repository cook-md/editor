// *****************************************************************************
// Copyright (C) 2026 cook.md and contributors
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

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { PluginReportService } from './plugin-report-service';

class Fixture {
    renders: Array<{ content: string; template: string; config: string }> = [];
    configs: Array<{ scale: number; uri: string }> = [];
    responses: string[] = [];
    text = 'Mix @apple{2} and @flour{200%g}.';
    model = true;

    create(): PluginReportService {
        const service = new PluginReportService();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (service as any).languageService = {
            renderReport: async (content: string, template: string, config: string) => {
                this.renders.push({ content, template, config });
                return this.responses.shift() ?? JSON.stringify({ error: 'no response queued' });
            },
        };
        (service as any).reportConfigService = {
            buildConfigJson: async (scale: number, uri: URI) => {
                this.configs.push({ scale, uri: uri.toString() });
                return JSON.stringify({ scale });
            },
        };
        (service as any).monacoWorkspace = { getTextDocument: () => this.model ? { getText: () => this.text } : undefined };
        (service as any).fileService = { read: async () => ({ value: `disk: ${this.text}` }) };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return service;
    }
}

const URI_A = new URI('file:///ws/a.cook');
const TEMPLATE = '{{ ingredients | length | tojson }}';

describe('PluginReportService', () => {
    it('renders the template against the open editor text with the report config', async () => {
        const fixture = new Fixture();
        fixture.responses.push(JSON.stringify({ output: '2' }));
        expect(await fixture.create().render(URI_A, TEMPLATE, 2)).to.deep.equal({ ok: true, output: '2' });
        expect(fixture.renders).to.deep.equal([{ content: fixture.text, template: TEMPLATE, config: JSON.stringify({ scale: 2 }) }]);
        expect(fixture.configs).to.deep.equal([{ scale: 2, uri: 'file:///ws/a.cook' }]);
    });

    it('reads the file when no editor has it open', async () => {
        const fixture = new Fixture();
        fixture.model = false;
        fixture.responses.push(JSON.stringify({ output: '' }));
        await fixture.create().render(URI_A, TEMPLATE, 1);
        expect(fixture.renders[0].content).to.equal(`disk: ${fixture.text}`);
    });

    for (const [message, reason] of [
        ['Error: authentication required: missing or invalid API key', 'unauthenticated'],
        ['Error: subscription required for nutrition', 'forbidden'],
        ['Error: transport error: dns failure', 'network'],
        ['Error: nutrition service unavailable: 503', 'network'],
        ['Error: server error: status 500', 'server'],
        ['Error: category not found: legume\n\n--- base ---', 'template'],
        ['Error: unknown function', 'template'],
    ] as const) {
        it(`maps "${message.split('\n')[0]}" to ${reason}`, async () => {
            const fixture = new Fixture();
            fixture.responses.push(JSON.stringify({ error: message }));
            expect(await fixture.create().render(URI_A, TEMPLATE, 1))
                .to.deep.equal({ ok: false, reason, message: message.replace(/^Error: /, '').split('\n')[0] });
        });
    }

    it('reports an unreadable engine response as a template failure', async () => {
        const fixture = new Fixture();
        fixture.responses.push('not json');
        expect(await fixture.create().render(URI_A, TEMPLATE, 1))
            .to.deep.equal({ ok: false, reason: 'template', message: 'Unexpected response from the report engine.' });
    });

    it('caches successes by uri, text, template and scale, but not failures', async () => {
        const fixture = new Fixture();
        const service = fixture.create();
        fixture.responses.push(JSON.stringify({ error: 'Error: server error: status 500' }));
        fixture.responses.push(JSON.stringify({ output: 'a' }));
        await service.render(URI_A, TEMPLATE, 1);
        await service.render(URI_A, TEMPLATE, 1);
        expect(await service.render(URI_A, TEMPLATE, 1)).to.deep.equal({ ok: true, output: 'a' });
        expect(fixture.renders).to.have.length(2);
        for (const change of [
            (): Promise<unknown> => service.render(URI_A, TEMPLATE, 2),
            (): Promise<unknown> => service.render(URI_A, '{{ 1 }}', 1),
            (): Promise<unknown> => service.render(new URI('file:///ws/b.cook'), TEMPLATE, 1),
        ]) {
            fixture.responses.push(JSON.stringify({ output: 'b' }));
            await change();
        }
        fixture.text = 'Changed @apple{1}.';
        fixture.responses.push(JSON.stringify({ output: 'c' }));
        await service.render(URI_A, TEMPLATE, 1);
        expect(fixture.renders).to.have.length(6);
    });
});
