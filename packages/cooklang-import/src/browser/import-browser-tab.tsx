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

import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import { RecipePayload } from './recipe-payload';

/**
 * Minimal typing for the Electron `<webview>` element. We deliberately avoid
 * pulling in Electron renderer typings here since this is plain browser code.
 */
interface WebviewElement extends HTMLElement {
    src: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
}

interface DidFailLoadEvent extends Event {
    isMainFrame: boolean;
    errorCode: number;
}

interface DidNavigateEvent extends Event {
    url?: string;
}

/** Chromium's ERR_ABORTED, reported when a load is superseded by a newer one — not a real failure. */
const ERR_ABORTED = -3;

/** Upper bound applied to each JSON-LD block and to the page text before extraction. */
const MAX_CLIP_TEXT_LENGTH = 200000;

/**
 * Session partition of the clipping `<webview>`. The name has no `persist:`
 * prefix, so the session is in-memory: site logins made inside the clipping
 * browser do not survive an app restart — a deliberate privacy default.
 * Must match `IMPORT_BROWSER_PARTITION` in
 * `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts`.
 */
const IMPORT_BROWSER_PARTITION = 'import-browser';

/**
 * Collects the raw data used to build a clip payload. Runs inside the clipped
 * page; extraction logic (choosing JSON-LD vs. page text) lives in {@link RecipePayload}.
 */
const CLIP_SCRIPT = `(() => ({
    jsonLdBlocks: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent || ''),
    pageText: document.body ? document.body.innerText : ''
}))()`;

interface ClipScriptResult {
    jsonLdBlocks: unknown;
    pageText: unknown;
}

export interface ImportBrowserTabProps {
    busy: boolean;
    onClip: (payload: string) => void;
    /** Page loaded when the tab opens (user preference; must be http/https to be honored). */
    startPage?: string;
    /** Widget-level import status (error/success) rendered in the browser's status row. */
    statusNode?: React.ReactNode;
}

interface ImportBrowserTabState {
    address: string;
    committedUrl: string;
    /** True once 'dom-ready' fired: webview methods (reload, canGoBack, …) throw before that. */
    domReady: boolean;
    pageLoaded: boolean;
    pageLoadFailed: boolean;
    clipError: string | undefined;
}

/**
 * Internal clipping browser: an embedded, isolated `<webview>` the user
 * navigates to a recipe page, then clips via JSON-LD/page-text extraction.
 *
 * Navigation state (address, loaded page) is owned by this component's React
 * state rather than the parent widget. It is deliberately not persisted across
 * tab switches for v1: the browser tab unmounts when another tab is selected,
 * so surfing history is lost. Revisit if users want the browser to stay warm.
 */
export class ImportBrowserTab extends React.Component<ImportBrowserTabProps, ImportBrowserTabState> {

    protected webview: WebviewElement | undefined;

    protected readonly handleDomReady = (): void => {
        this.setState({ domReady: true });
    };

    protected readonly handleDidFinishLoad = (): void => {
        this.setState({ pageLoaded: true, pageLoadFailed: false });
    };

    protected readonly handleDidFailLoad = (event: Event): void => {
        const failure = event as DidFailLoadEvent;
        if (failure.isMainFrame === false || failure.errorCode === ERR_ABORTED) {
            return;
        }
        this.setState({ pageLoaded: false, pageLoadFailed: true });
    };

    // 'did-navigate' fires at commit time, before 'dom-ready', when getURL() would
    // still throw — so read the URL off the event instead of asking the webview.
    protected readonly handleDidNavigate = (event: Event): void => {
        const url = (event as DidNavigateEvent).url;
        if (url) {
            this.setState({ address: url });
        }
    };

    constructor(props: ImportBrowserTabProps) {
        super(props);
        const startPage = props.startPage && /^https?:\/\//i.test(props.startPage) ? props.startPage : '';
        this.state = {
            address: startPage,
            committedUrl: startPage,
            domReady: false,
            pageLoaded: false,
            pageLoadFailed: false,
            clipError: undefined
        };
    }

    override render(): React.ReactNode {
        return (
            <div className='cooklang-import-browser'>
                <div className='cooklang-import-browser-toolbar'>
                    <button className='theia-button secondary' onClick={this.goBack} disabled={!this.canGoBack()}
                        title={nls.localizeByDefault('Back')}>
                        <i className='codicon codicon-arrow-left' />
                    </button>
                    <button className='theia-button secondary' onClick={this.goForward} disabled={!this.canGoForward()}
                        title={nls.localizeByDefault('Forward')}>
                        <i className='codicon codicon-arrow-right' />
                    </button>
                    <button className='theia-button secondary' onClick={this.reload} disabled={!this.state.committedUrl}
                        title={nls.localizeByDefault('Reload')}>
                        <i className='codicon codicon-refresh' />
                    </button>
                    <input className='theia-input' type='text' value={this.state.address}
                        placeholder={nls.localize('theia/cooklang-import/browserPlaceholder', 'Enter a URL and press Enter')}
                        onChange={this.onAddressChanged} onKeyDown={this.onAddressKeyDown} />
                    <button className='theia-button main' onClick={this.clip}
                        disabled={this.props.busy || !this.state.pageLoaded}>
                        {this.props.busy
                            ? <React.Fragment>
                                <i className='codicon codicon-loading codicon-modifier-spin' />
                                {nls.localize('theia/cooklang-import/importing', 'Importing…')}
                            </React.Fragment>
                            : nls.localize('theia/cooklang-import/clipRecipe', 'Clip Recipe')}
                    </button>
                </div>
                {this.renderStatusRow()}
                {this.renderBrowserArea()}
            </div>
        );
    }

    /** Fixed-height status row between toolbar and page, so messages never shift the layout. */
    protected renderStatusRow(): React.ReactNode {
        return (
            <div className='cooklang-import-browser-status'>
                {this.state.pageLoadFailed &&
                    <span className='cooklang-import-error'>
                        {nls.localize('theia/cooklang-import/pageLoadFailed', 'Couldn’t load this page.')}
                    </span>}
                {this.state.clipError &&
                    <span className='cooklang-import-error'>{this.state.clipError}</span>}
                {this.props.statusNode}
            </div>
        );
    }

    protected renderBrowserArea(): React.ReactNode {
        if (!this.state.committedUrl) {
            return (
                <div className='cooklang-import-browser-hint'>
                    <span>{nls.localize('theia/cooklang-import/browserHint', 'Browse to a recipe page, then press Clip Recipe.')}</span>
                </div>
            );
        }
        // React has no intrinsic 'webview' type; createElement with a raw props object is required.
        return React.createElement('webview', {
            ref: this.setWebview,
            src: this.state.committedUrl,
            partition: IMPORT_BROWSER_PARTITION
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    protected setWebview = (element: WebviewElement | null): void => {
        if (this.webview) {
            this.webview.removeEventListener('dom-ready', this.handleDomReady);
            this.webview.removeEventListener('did-finish-load', this.handleDidFinishLoad);
            this.webview.removeEventListener('did-fail-load', this.handleDidFailLoad);
            this.webview.removeEventListener('did-navigate', this.handleDidNavigate);
            this.webview.removeEventListener('did-navigate-in-page', this.handleDidNavigate);
        }
        this.webview = element ?? undefined;
        if (this.webview) {
            this.webview.addEventListener('dom-ready', this.handleDomReady);
            this.webview.addEventListener('did-finish-load', this.handleDidFinishLoad);
            this.webview.addEventListener('did-fail-load', this.handleDidFailLoad);
            this.webview.addEventListener('did-navigate', this.handleDidNavigate);
            this.webview.addEventListener('did-navigate-in-page', this.handleDidNavigate);
        }
    };

    protected canGoBack(): boolean {
        return this.state.domReady && !!this.webview?.canGoBack();
    }

    protected canGoForward(): boolean {
        return this.state.domReady && !!this.webview?.canGoForward();
    }

    protected goBack = (): void => {
        if (this.canGoBack()) {
            this.webview?.goBack();
        }
    };

    protected goForward = (): void => {
        if (this.canGoForward()) {
            this.webview?.goForward();
        }
    };

    protected reload = (): void => {
        this.reloadCommittedUrl();
    };

    /**
     * Reloads the committed page. Before the first 'dom-ready' (e.g. after a failed
     * initial load) `reload()` throws, so retry by re-assigning `src` instead —
     * assigning `src` its own value reloads the page.
     */
    protected reloadCommittedUrl(): void {
        if (!this.webview || !this.state.committedUrl) {
            return;
        }
        this.setState({ pageLoaded: false, pageLoadFailed: false });
        if (this.state.domReady) {
            this.webview.reload();
        } else {
            this.webview.src = this.state.committedUrl;
        }
    }

    protected onAddressChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.setState({ address: event.target.value });
    };

    protected onAddressKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter') {
            this.navigate();
        }
    };

    protected navigate(): void {
        const raw = this.state.address.trim();
        if (!raw) {
            return;
        }
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
            new URL(url);
        } catch {
            this.setState({ pageLoaded: false, pageLoadFailed: true });
            return;
        }
        if (url === this.state.committedUrl) {
            this.reloadCommittedUrl();
            return;
        }
        // The controlled `src` prop of the webview element performs the navigation;
        // no imperative load is needed here.
        this.setState({ address: url, committedUrl: url, pageLoaded: false, pageLoadFailed: false, clipError: undefined });
    }

    protected clip = (): void => {
        if (!this.webview || !this.state.pageLoaded) {
            return;
        }
        this.setState({ clipError: undefined });
        this.webview.executeJavaScript(CLIP_SCRIPT).then(result => {
            const data = result as ClipScriptResult;
            // Defensive clamping: the data comes from an untrusted page, so keep only
            // strings and cap their size before handing them to the extractor.
            const jsonLdBlocks = Array.isArray(data.jsonLdBlocks)
                ? data.jsonLdBlocks.filter((block): block is string => typeof block === 'string')
                    .map(block => block.slice(0, MAX_CLIP_TEXT_LENGTH))
                : [];
            const pageText = typeof data.pageText === 'string' ? data.pageText.slice(0, MAX_CLIP_TEXT_LENGTH) : '';
            const payload = RecipePayload.extract(jsonLdBlocks, pageText);
            if (!payload.trim()) {
                this.setState({ clipError: nls.localize('theia/cooklang-import/nothingToClip', 'Nothing to clip on this page.') });
                return;
            }
            this.props.onClip(payload);
        }).catch(err => {
            console.error('Failed to clip page:', err);
            this.setState({ clipError: nls.localize('theia/cooklang-import/clipFailed', 'Couldn’t read this page. Try reloading it.') });
        });
    };
}
