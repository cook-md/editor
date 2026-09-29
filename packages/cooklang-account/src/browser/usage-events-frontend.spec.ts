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
import { UsageEventsFrontend } from './usage-events-frontend';
import { UsageEvent, UsageEventContext } from '../common/usage-events-protocol';
import { USAGE_EVENTS_PREF } from './usage-preferences';

function make(enabled: boolean): { frontend: UsageEventsFrontend; sent: Array<[UsageEvent, UsageEventContext]> } {
    const sent: Array<[UsageEvent, UsageEventContext]> = [];
    const frontend = new UsageEventsFrontend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = frontend as any;
    f.preferenceService = { get: (name: string, dflt: boolean) => (name === USAGE_EVENTS_PREF ? enabled : dflt) };
    f.service = { track: async (e: UsageEvent, c: UsageEventContext) => { sent.push([e, c]); } };
    f.appVersion = '0.1.0-alpha.50';
    f.userAgent = 'Mozilla/5.0 (Macintosh) Chrome/134 Electron/37';
    return { frontend, sent };
}

describe('UsageEventsFrontend', () => {
    it('sends nothing when Send Usage Statistics is off', async () => {
        const { frontend, sent } = make(false);
        await frontend.track('editor_welcome_shown', { first_run: true });
        expect(sent).to.have.length(0);
    });

    it('adds surface, app version and OS, and passes the user agent', async () => {
        const { frontend, sent } = make(true);
        await frontend.track('cookbot_gate_clicked', { action: 'trial' });
        expect(sent).to.have.length(1);
        const [event, context] = sent[0];
        expect(event.name).to.equal('cookbot_gate_clicked');
        expect(event.properties).to.include({ action: 'trial', surface: 'editor', app_version: '0.1.0-alpha.50' });
        expect(event.properties.os).to.be.oneOf(['mac', 'windows', 'linux']);
        expect(context).to.deep.equal({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/134 Electron/37', appVersion: '0.1.0-alpha.50' });
    });

    it('never throws when the backend fails', async () => {
        const { frontend } = make(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (frontend as any).service = { track: async () => { throw new Error('offline'); } };
        await frontend.track('editor_cookbot_first_message', {});
    });
});
