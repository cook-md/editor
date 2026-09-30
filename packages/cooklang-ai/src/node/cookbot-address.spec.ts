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
import * as path from 'path';
import { isPackagedApp, resolveCookbotAddress } from './cookbot-address';

describe('isPackagedApp', () => {

    const resources = path.join('/Applications', 'Cook Editor.app', 'Contents', 'Resources');

    it('is true for the packaged backend, which runs from inside resourcesPath', () => {
        expect(isPackagedApp({
            resourcesPath: resources,
            defaultApp: undefined,
            backendDir: path.join(resources, 'app.asar', 'lib', 'backend'),
        })).to.be.true;
    });

    // The forked backend has Electron's resourcesPath but no defaultApp
    // (only the main process gets it), so those two alone read as packaged.
    it('is false for the forked backend of an unpackaged dev run', () => {
        expect(isPackagedApp({
            resourcesPath: '/repo/node_modules/electron/dist/Electron.app/Contents/Resources',
            defaultApp: undefined,
            backendDir: '/repo/app/lib/backend',
        })).to.be.false;
    });

    it('is false when the process is not Electron at all', () => {
        expect(isPackagedApp({ resourcesPath: undefined, defaultApp: undefined, backendDir: '/repo/app/lib/backend' })).to.be.false;
    });

    it('is false when Electron reports an unbundled app', () => {
        expect(isPackagedApp({ resourcesPath: resources, defaultApp: true, backendDir: path.join(resources, 'app') })).to.be.false;
    });

    describe('Windows paths', () => {
        const win = path.win32;
        const base = { defaultApp: undefined as boolean | undefined, pathModule: win };

        it('is true for a backslash path inside resourcesPath', () => {
            expect(isPackagedApp({
                ...base,
                resourcesPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Cook Editor\\resources',
                backendDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\Cook Editor\\resources\\app.asar\\lib\\backend',
            })).to.be.true;
        });

        it('ignores drive-letter and directory casing', () => {
            expect(isPackagedApp({
                ...base,
                resourcesPath: 'C:\\Program Files\\Cook Editor\\resources',
                backendDir: 'c:\\program files\\cook editor\\RESOURCES\\app.asar\\lib\\backend',
            })).to.be.true;
        });

        it('is false on a different drive (dev)', () => {
            expect(isPackagedApp({
                ...base,
                resourcesPath: 'C:\\repo\\node_modules\\electron\\dist\\resources',
                backendDir: 'D:\\repo\\app\\lib\\backend',
            })).to.be.false;
        });
    });

    it('is true for code unpacked from the asar', () => {
        expect(isPackagedApp({
            resourcesPath: resources,
            defaultApp: undefined,
            backendDir: path.join(resources, 'app.asar.unpacked', 'lib', 'backend'),
        })).to.be.true;
    });

    it('tolerates a trailing slash on resourcesPath', () => {
        expect(isPackagedApp({
            resourcesPath: resources + '/',
            defaultApp: undefined,
            backendDir: path.join(resources, 'app.asar', 'lib', 'backend'),
        })).to.be.true;
    });

    it('counts a child directory whose name merely starts with two dots as inside', () => {
        expect(isPackagedApp({
            resourcesPath: resources,
            defaultApp: undefined,
            backendDir: path.join(resources, '..foo', 'backend'),
        })).to.be.true;
    });

    it('is false for the parent of resourcesPath', () => {
        expect(isPackagedApp({ resourcesPath: resources, defaultApp: undefined, backendDir: path.dirname(resources) })).to.be.false;
    });

    it('does not mistake a sibling directory with the same prefix for resourcesPath', () => {
        expect(isPackagedApp({
            resourcesPath: '/opt/app/Resources',
            defaultApp: undefined,
            backendDir: '/opt/app/Resources-dev/lib/backend',
        })).to.be.false;
    });
});

describe('resolveCookbotAddress', () => {

    it('uses production when packaged and nothing is configured', () => {
        expect(resolveCookbotAddress({ packaged: true, env: {} })).to.deep.equal({ address: 'cookbot.cook.md:443' });
    });

    it('uses the local server when not packaged', () => {
        expect(resolveCookbotAddress({ packaged: false, env: {} })).to.deep.equal({ address: '127.0.0.1:50052' });
    });

    it('lets COOKBOT_ADDRESS win, without a warning', () => {
        expect(resolveCookbotAddress({
            packaged: true,
            env: { COOKBOT_ADDRESS: 'staging.example:443', WEB_BASE_URL: 'https://staging.cook.md' },
        })).to.deep.equal({ address: 'staging.example:443' });
    });

    it('warns when WEB_BASE_URL is not production and COOKBOT_ADDRESS is unset', () => {
        const result = resolveCookbotAddress({ packaged: true, env: { WEB_BASE_URL: 'https://staging.cook.md' } });
        expect(result.address).to.equal('cookbot.cook.md:443');
        expect(result.warning).to.contain('cookbot.cook.md:443').and.to.contain('https://staging.cook.md').and.to.contain('COOKBOT_ADDRESS');
    });

    it('warns for a local web host too', () => {
        const result = resolveCookbotAddress({ packaged: false, env: { WEB_BASE_URL: 'http://localhost:3000' } });
        expect(result.warning).to.contain('127.0.0.1:50052');
    });

    it('does not warn for the production web host', () => {
        expect(resolveCookbotAddress({ packaged: true, env: { WEB_BASE_URL: 'https://cook.md/' } }).warning).to.be.undefined;
        expect(resolveCookbotAddress({ packaged: true, env: { WEB_BASE_URL: 'https://www.cook.md' } }).warning).to.be.undefined;
    });

    it('does not warn for an unparseable WEB_BASE_URL', () => {
        expect(resolveCookbotAddress({ packaged: true, env: { WEB_BASE_URL: 'not a url' } }).warning).to.be.undefined;
    });
});
