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

/* eslint-disable no-null/no-null -- mirrors the Web Storage API's `string | null` */

import { expect } from 'chai';
import { PENDING_PROMPT_KEY, PENDING_PROMPT_MAX_AGE_MS, PromptStore, savePendingPrompt, takePendingPrompt } from './pending-prompt';

class MapStore implements PromptStore {
    readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}

describe('pending prompt', () => {

    it('hands back a fresh prompt once, then forgets it', () => {
        const store = new MapStore();
        savePendingPrompt(store, 'Is my week balanced?', 1_000);

        expect(takePendingPrompt(store, 2_000)).to.equal('Is my week balanced?');
        expect(takePendingPrompt(store, 2_000)).to.be.undefined;
    });

    it('drops a prompt older than the limit without returning it', () => {
        const store = new MapStore();
        savePendingPrompt(store, 'old question', 0);

        expect(takePendingPrompt(store, PENDING_PROMPT_MAX_AGE_MS + 1)).to.be.undefined;
        expect(store.items.has(PENDING_PROMPT_KEY)).to.equal(false);
    });

    it('returns undefined when nothing was saved', () => {
        expect(takePendingPrompt(new MapStore(), 0)).to.be.undefined;
    });

    it('does not save a blank prompt', () => {
        const store = new MapStore();
        savePendingPrompt(store, '   ', 0);
        expect(store.items.size).to.equal(0);
    });

    it('ignores a corrupt entry', () => {
        const store = new MapStore();
        store.setItem(PENDING_PROMPT_KEY, '{not json');
        expect(takePendingPrompt(store, 0)).to.be.undefined;
        expect(store.items.size).to.equal(0);
    });
});
