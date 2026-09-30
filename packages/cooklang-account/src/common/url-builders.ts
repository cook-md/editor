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

/**
 * The sign-in URL. Built by hand, not with URL, so the callback stays
 * unencoded: cook.md's admin funnel and past analytics match on this exact shape.
 */
export function buildAuthUrl(webBaseUrl: string, port: number, state: string, from?: string): string {
    const base = `${webBaseUrl}/auth/desktops?callback=http://localhost:${port}/callback&state=${state}&app=editor`;
    return from ? `${base}&from=${encodeURIComponent(from)}` : base;
}

/** The pricing URL for an in-editor purchase; cook.md redirects to the callback when checkout ends. */
export function buildUpgradeUrl(webBaseUrl: string, port: number, state: string, from?: string): string {
    const url = new URL('/pricing', webBaseUrl);
    url.searchParams.set('callback', `http://localhost:${port}/upgrade-done`);
    url.searchParams.set('state', state);
    if (from) {
        url.searchParams.set('from', from);
    }
    return url.toString();
}
