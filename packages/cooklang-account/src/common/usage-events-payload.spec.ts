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
import { buildEventsBody, buildVisitBody } from './usage-events-payload';

describe('usage event payloads', () => {
    it('builds the Ahoy visit body with the editor as platform', () => {
        expect(buildVisitBody('v1', 'vr1', '0.1.0-alpha.50')).to.deep.equal({
            visit_token: 'v1', visitor_token: 'vr1', platform: 'Editor', app_version: '0.1.0-alpha.50',
        });
    });

    it('builds the Ahoy events body', () => {
        const body = buildEventsBody('v1', 'vr1', [
            { name: 'cookbot_gate_shown', properties: { surface: 'editor', state: 'signed_out' }, time: '2026-10-01T10:00:00Z' },
        ]);
        expect(body).to.deep.equal({
            visit_token: 'v1', visitor_token: 'vr1',
            events: [{ name: 'cookbot_gate_shown', properties: { surface: 'editor', state: 'signed_out' }, time: '2026-10-01T10:00:00Z' }],
        });
    });
});
