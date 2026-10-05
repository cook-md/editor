/********************************************************************************
 * Copyright (C) 2022 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
 ********************************************************************************/

import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

import {
    createHttpPatch, createProxyResolver, createTlsPatch, loadSystemCertificates, LogLevel, ProxyAgentParams, ProxySupportSetting
} from '@vscode/proxy-agent';
import { PreferenceRegistryExtImpl } from '../../plugin/preference-registry';
import { WorkspaceExtImpl } from '../../plugin/workspace';

const noopLog: ProxyAgentParams['log'] = {
    trace: () => { },
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};

export function connectProxyResolver(workspaceExt: WorkspaceExtImpl, configProvider: PreferenceRegistryExtImpl): void {
    const httpConfig = () => configProvider.getConfiguration('http');
    const params: ProxyAgentParams = {
        resolveProxy: async url => workspaceExt.resolveProxy(url),
        getProxyURL: () => httpConfig().get<string>('proxy') || undefined,
        getProxySupport: () => httpConfig().get<ProxySupportSetting>('proxySupport') || 'override',
        getNoProxyConfig: () => httpConfig().get<string[]>('noProxy') || [],
        // Only http, https and tls are patched (see createPatchedModules), as before the 0.45 upgrade.
        isAdditionalFetchSupportEnabled: () => false,
        isWebSocketPatchEnabled: () => false,
        addCertificatesV1: () => !!httpConfig().get<boolean>('systemCertificates'),
        addCertificatesV2: () => false,
        loadSystemCertificatesFromNode: () => false,
        loadAdditionalCertificates: () => loadSystemCertificates({ loadSystemCertificatesFromNode: () => false, log: noopLog }),
        log: noopLog,
        getLogLevel: () => LogLevel.Off,
        proxyResolveTelemetry: () => { },
        isUseHostProxyEnabled: () => true,
        env: process.env,
    };
    const { resolveProxyWithRequest } = createProxyResolver(params);
    configureModuleLoading({
        http: Object.assign(http, createHttpPatch(params, http, resolveProxyWithRequest)),
        https: Object.assign(https, createHttpPatch(params, https, resolveProxyWithRequest)),
        tls: Object.assign(tls, createTlsPatch(params, tls))
    });
}

interface PatchedModules {
    http: typeof http;
    https: typeof https;
    tls: typeof tls;
}

function configureModuleLoading(lookup: PatchedModules): void {
    const node_module = require('module');
    const original = node_module._load;
    node_module._load = function (request: string): typeof tls | typeof http | typeof https {
        if (request === 'tls') {
            return lookup.tls;
        }

        if (request !== 'http' && request !== 'https') {
            return original.apply(this, arguments);
        }

        // Create a shallow copy of the http(s) module to work around extensions that apply changes to the modules
        // See for more info: https://github.com/microsoft/vscode/issues/93167
        return { ...lookup[request] };
    };
}
