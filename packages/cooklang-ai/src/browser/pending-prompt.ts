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

/**
 * Carries the user's question across the window reload that opening a recipe
 * folder causes. Without it the chat ended and the user had to retype the
 * question (uid 2647, 2026-09-21). The prompt is only put back in the input
 * box, never re-sent: sending it again would spend credits unasked.
 */

export const PENDING_PROMPT_KEY = 'cookbot.pendingPrompt';

/** A reload takes seconds; anything older is from an abandoned attempt. */
export const PENDING_PROMPT_MAX_AGE_MS = 10 * 60 * 1000;

/** The slice of `window.localStorage` this needs, so tests can use a Map. */
export interface PromptStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export function savePendingPrompt(store: PromptStore, text: string, now: number = Date.now()): void {
    if (!text.trim()) {
        return;
    }
    try {
        store.setItem(PENDING_PROMPT_KEY, JSON.stringify({ text, savedAt: now }));
    } catch {
        // Storage full or unavailable: the prompt is lost, as it was before.
    }
}

/** Returns the saved prompt if it is fresh, and always clears it. */
export function takePendingPrompt(store: PromptStore, now: number = Date.now()): string | undefined {
    let raw: string | null;
    try {
        raw = store.getItem(PENDING_PROMPT_KEY);
        if (raw !== null) {
            store.removeItem(PENDING_PROMPT_KEY);
        }
    } catch {
        return undefined;
    }
    if (raw === null) {
        return undefined;
    }
    try {
        const { text, savedAt } = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
        if (typeof text === 'string' && typeof savedAt === 'number' && savedAt <= now && now - savedAt <= PENDING_PROMPT_MAX_AGE_MS) {
            return text;
        }
    } catch {
        // Corrupt entry: already removed above.
    }
    return undefined;
}
