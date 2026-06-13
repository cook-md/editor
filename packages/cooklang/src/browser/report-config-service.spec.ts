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

// `ReportConfigService` imports browser widget types (ApplicationShell, Widget,
// NavigatableWidget) whose modules evaluate `@lumino/widgets` at require time,
// which touches `document`/`navigator`. Set up jsdom before importing the
// service — mirrors the sibling `shopping-list-service.spec.ts`.
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
// Guard against double-set: another spec in the same mocha run may have already
// configured the provider (it throws if set twice).
try {
    FrontendApplicationConfigProvider.get();
} catch {
    FrontendApplicationConfigProvider.set({});
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { ReportConfigService } from './report-config-service';

after(() => disableJSDOM());

/** In-memory FileService stub — only `exists` is used by buildConfigJson. */
class FakeFileService {
    existing = new Set<string>();
    async exists(uri: { toString(): string }): Promise<boolean> {
        return this.existing.has(uri.toString());
    }
}

/** WorkspaceService stub returning a single root (or none). */
class FakeWorkspaceService {
    constructor(protected readonly root?: URI) { }
    tryGetRoots(): Array<{ resource: URI }> {
        return this.root ? [{ resource: this.root }] : [];
    }
}

function createService(root: URI | undefined, existing: string[] = []): {
    service: ReportConfigService;
    fileService: FakeFileService;
} {
    const fileService = new FakeFileService();
    existing.forEach(p => fileService.existing.add(p));
    const service = new ReportConfigService();
    // Property injection — assign the fakes the service actually uses.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (service as any).fileService = fileService;
    (service as any).workspaceService = new FakeWorkspaceService(root);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { service, fileService };
}

describe('ReportConfigService#buildConfigJson', () => {

    it('returns only the scale when there is no workspace root', async () => {
        const { service } = createService(undefined);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config).to.deep.equal({ scale: 1 });
    });

    it('respects the scale argument', async () => {
        const { service } = createService(undefined);
        const config = JSON.parse(await service.buildConfigJson(2.5));
        expect(config.scale).to.equal(2.5);
    });

    it('includes basePath but omits optional paths when files are absent', async () => {
        const root = new URI('file:///ws');
        const { service } = createService(root, []);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.basePath).to.equal(root.toString());
        expect(config.aislePath).to.equal(undefined);
        expect(config.pantryPath).to.equal(undefined);
        expect(config.datastorePath).to.equal(undefined);
    });

    it('includes aisle, pantry, and datastore paths when present', async () => {
        const root = new URI('file:///ws');
        const aisle = root.resolve('config/aisle.conf').toString();
        const pantry = root.resolve('config/pantry.conf').toString();
        const datastore = root.resolve('db').toString();
        const { service } = createService(root, [aisle, pantry, datastore]);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.aislePath).to.equal(aisle);
        expect(config.pantryPath).to.equal(pantry);
        expect(config.datastorePath).to.equal(datastore);
    });

    it('prefers db over config/db for the datastore', async () => {
        const root = new URI('file:///ws');
        const db = root.resolve('db').toString();
        const configDb = root.resolve('config/db').toString();
        const { service } = createService(root, [db, configDb]);
        const config = JSON.parse(await service.buildConfigJson());
        expect(config.datastorePath).to.equal(db);
    });
});
