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

import { inject, injectable } from '@theia/core/shared/inversify';
import { open, OpenerService, OpenHandler } from '@theia/core/lib/browser/opener-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FileNavigatorContribution } from '@theia/navigator/lib/browser/navigator-contribution';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CookLink, parseCookLink } from '../common/cook-link';

const COOK_URL_SCHEMES = new Set(['cook', 'cooklang']);

/**
 * Handles `cook://` and `cooklang://` links. The scheme has been registered with the
 * OS since the first release (`app/electron-builder.yml`, `app/package.json`), but
 * nothing was bound to it, so every link was a silent no-op.
 *
 * Theia's `ElectronUriHandlerContribution` forwards the Electron `open-url` event
 * into `OpenerService.getOpener`, so an `OpenHandler` is the whole extension point.
 * Every `cook:` URL is claimed, whatever its route: an unclaimed link is dropped
 * without a word, so even the ones this app cannot act on get a message.
 */
@injectable()
export class CookUrlOpenHandler implements OpenHandler {
    /** Well above the text editor: nothing else should claim these schemes. */
    static readonly PRIORITY = 500;
    readonly id = 'cooklang-cook-url';
    readonly label = nls.localize('theia/cooklang/cookUrl/label', 'Cook Link');

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(FileNavigatorContribution)
    protected readonly navigator: FileNavigatorContribution;

    canHandle(uri: URI): number {
        return COOK_URL_SCHEMES.has(uri.scheme.toLowerCase()) ? CookUrlOpenHandler.PRIORITY : 0;
    }

    async open(uri: URI): Promise<undefined> {
        const link = parseCookLink(this.toLinkString(uri));
        await this.dispatch(link);
        return undefined;
    }

    protected async dispatch(link: CookLink): Promise<void> {
        switch (link.route) {
            case 'my':
                // `mode` and `timer` are not acted on yet: the recipe opening is the point.
                await this.openRecipe(link.path);
                return;
            case 'share':
            case 'clip':
                // Both belong to the import widget.
                await this.messageService.info(
                    nls.localize('theia/cooklang/cookUrl/useImport', 'Use File → Import Recipe… to bring this recipe in.')
                );
                return;
            case 'timer':
            case 'unsupported':
                await this.messageService.info(
                    nls.localize('theia/cooklang/cookUrl/mobileOnly', 'This link opens in the Cook mobile app.')
                );
                return;
            default:
                // Deliberately generic: a traversal attempt gets no echo of its path.
                await this.showInvalid();
        }
    }

    /**
     * Rebuilds the link text for {@link parseCookLink} from the `URI` Theia hands us.
     *
     * Neither `toString` variant round-trips: `toString()` percent-encodes the query's
     * own `=` and `&` (so `?mode=cooking&timer=42` no longer parses), and
     * `toString(true)` leaves the path decoded, which the parser would decode a second
     * time (`100%25%20Rye` would become `100% Rye`, then fail). So the path is rebuilt
     * from its decoded segments, each re-encoded exactly once, and the (decoded) query is
     * passed through: nested encoded `&` inside a query value cannot be recovered from a
     * vscode-uri, but nothing here acts on query values yet.
     */
    protected toLinkString(uri: URI): string {
        const path = uri.path.toString()
            .split('/')
            .map(segment => encodeURIComponent(segment))
            .join('/');
        const query = uri.query ? `?${uri.query}` : '';
        return `${uri.scheme}://${uri.authority}${path}${query}`;
    }

    protected async openRecipe(path: string): Promise<void> {
        // A backslash is a separator on Windows, so `a\..\..\secret` would walk out of
        // the root there even though the parser saw no `..` segment.
        if (path.includes('\\')) {
            await this.showInvalid();
            return;
        }
        const roots = await this.workspaceService.roots;
        if (roots.length === 0) {
            await this.messageService.info(
                nls.localize('theia/cooklang/cookUrl/noWorkspace', 'Open a folder before following recipe links.')
            );
            return;
        }
        const root = roots[0].resource;
        if (!path) {
            // `cook://my` alone names the collection root.
            await this.revealFolder(root);
            return;
        }
        const target = this.resolveUnder(root, path);
        if (!target) {
            await this.showInvalid();
            return;
        }
        // Folder links are real (`cook://my/Sides%20%26%20Drinks`). No opener takes a
        // directory, and the rejection would be swallowed upstream: reveal it instead.
        const stat = await this.statOf(target);
        if (stat?.isDirectory) {
            await this.revealFolder(target);
            return;
        }
        if (stat) {
            await open(this.openerService, target);
            return;
        }
        if (!target.path.ext) {
            const withExtension = this.resolveUnder(root, `${path}.cook`);
            if (withExtension && (await this.statOf(withExtension))?.isFile) {
                await open(this.openerService, withExtension);
                return;
            }
        }
        await this.messageService.info(
            nls.localize('theia/cooklang/cookUrl/notHere', '{0} is not in this folder yet.', target.path.base)
        );
    }

    /**
     * Selects the folder in the file navigator and brings the navigator forward.
     * `openView` rather than `toggleView`: toggling collapses an already-active view.
     */
    protected async revealFolder(folder: URI): Promise<void> {
        await this.navigator.selectFileNode(folder);
        await this.navigator.openView({ activate: true, reveal: true });
    }

    protected async statOf(uri: URI): Promise<FileStat | undefined> {
        try {
            return await this.fileService.resolve(uri);
        } catch {
            return undefined;
        }
    }

    /**
     * `URI.resolve` does not collapse `..`, so the containment check only means
     * something on the normalised path. Returns `undefined` for anything that lands
     * outside `root`.
     */
    protected resolveUnder(root: URI, path: string): URI | undefined {
        const target = root.resolve(path).normalizePath();
        return root.isEqualOrParent(target) && !root.isEqual(target) ? target : undefined;
    }

    protected async showInvalid(): Promise<void> {
        await this.messageService.info(
            nls.localize('theia/cooklang/cookUrl/invalid', 'This Cook link could not be opened.')
        );
    }
}
