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

import * as path from 'path';

export const PRODUCTION_COOKBOT_ADDRESS = 'cookbot.cook.md:443';
export const LOCAL_COOKBOT_ADDRESS = '127.0.0.1:50052';

const PRODUCTION_WEB_HOSTS = ['cook.md', 'www.cook.md'];

export interface PackagedAppInputs {
    /** `process.resourcesPath`: set in every Electron process, packaged or not. */
    resourcesPath: string | undefined;
    /** `process.defaultApp`: only set in the Electron *main* process of an unbundled app. */
    defaultApp: boolean | undefined;
    /** Directory the backend code runs from (`__dirname`). */
    backendDir: string;
    /** Path flavour to compare with; defaults to the host's. Injectable for tests. */
    pathModule?: typeof path.posix;
}

/**
 * Whether this backend belongs to a packaged (installed) app.
 *
 * `resourcesPath` and `defaultApp` are not enough: the backend is a forked
 * child of the Electron main process and `defaultApp` is not set there, so an
 * unpackaged `npm run start:electron` looked packaged. In a packaged app the
 * backend code lives inside `resourcesPath` (app.asar); in dev
 * `resourcesPath` is Electron's own folder under node_modules, far from it.
 *
 * Requires `backendDir` to be the real on-disk location, i.e. `__dirname` must
 * not be rewritten by webpack (`node: { __dirname: false }`, as app/webpack.config.js sets).
 */
export function isPackagedApp(inputs: PackagedAppInputs): boolean {
    if (!inputs.resourcesPath || inputs.defaultApp) {
        return false;
    }
    const p = inputs.pathModule ?? path;
    const relative = p.relative(p.resolve(inputs.resourcesPath), p.resolve(inputs.backendDir));
    const outside = relative === '..' || relative.startsWith('..' + p.sep) || p.isAbsolute(relative);
    return relative !== '' && !outside;
}

export interface CookbotAddressResult {
    address: string;
    /** Set when the address is probably not what a tester expects. */
    warning?: string;
}

/**
 * The Cookbot gRPC address: COOKBOT_ADDRESS if set, otherwise production for a
 * packaged app and a local server for an unpackaged one.
 */
export function resolveCookbotAddress(options: { packaged: boolean; env: NodeJS.ProcessEnv }): CookbotAddressResult {
    const { packaged, env } = options;
    if (env.COOKBOT_ADDRESS) {
        return { address: env.COOKBOT_ADDRESS };
    }
    const address = packaged ? PRODUCTION_COOKBOT_ADDRESS : LOCAL_COOKBOT_ADDRESS;
    const webBaseUrl = env.WEB_BASE_URL;
    if (webBaseUrl && isNonProductionHost(webBaseUrl)) {
        return {
            address,
            warning: `[Cookbot] WEB_BASE_URL is ${webBaseUrl} but COOKBOT_ADDRESS is not set, so CookBot is using ${address}. `
                + 'Set COOKBOT_ADDRESS to point CookBot at the matching server.'
        };
    }
    return { address };
}

function isNonProductionHost(url: string): boolean {
    try {
        return !PRODUCTION_WEB_HOSTS.includes(new URL(url).hostname);
    } catch {
        return false;
    }
}
