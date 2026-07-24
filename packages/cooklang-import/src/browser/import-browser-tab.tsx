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
}

/**
 * Collects the raw data used to build a clip payload. Runs inside the clipped
 * page; extraction logic (choosing JSON-LD vs. page text) lives in {@link RecipePayload}.
 */
const CLIP_SCRIPT = `(() => ({
    jsonLdBlocks: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent || ''),
    pageText: document.body ? document.body.innerText : ''
}))()`;

interface ClipScriptResult {
    jsonLdBlocks: string[];
    pageText: string;
}

export interface ImportBrowserTabProps {
    busy: boolean;
    onClip: (payload: string) => void;
}

interface ImportBrowserTabState {
    address: string;
    committedUrl: string;
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

    protected readonly handleDidFinishLoad = (): void => {
        this.setState({ pageLoaded: true, pageLoadFailed: false });
    };

    protected readonly handleDidFailLoad = (event: Event): void => {
        if ((event as DidFailLoadEvent).isMainFrame === false) {
            return;
        }
        this.setState({ pageLoaded: false, pageLoadFailed: true });
    };

    protected readonly handleDidNavigate = (): void => {
        if (this.webview) {
            this.setState({ address: this.webview.getURL() });
        }
    };

    constructor(props: ImportBrowserTabProps) {
        super(props);
        this.state = {
            address: '',
            committedUrl: '',
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
                    <button className='theia-button secondary' onClick={this.reload} disabled={!this.state.pageLoaded}
                        title={nls.localizeByDefault('Reload')}>
                        <i className='codicon codicon-refresh' />
                    </button>
                    <input className='theia-input' type='text' value={this.state.address}
                        placeholder='https://example.com/best-pancakes'
                        onChange={this.onAddressChanged} onKeyDown={this.onAddressKeyDown} />
                    <button className='theia-button main' onClick={this.clip}
                        disabled={this.props.busy || !this.state.pageLoaded}>
                        {nls.localize('theia/cooklang-import/clipRecipe', 'Clip Recipe')}
                    </button>
                </div>
                {this.state.pageLoadFailed &&
                    <div className='cooklang-import-status cooklang-import-error'>
                        {nls.localize('theia/cooklang-import/pageLoadFailed', 'Couldn’t load this page.')}
                    </div>}
                {this.renderBrowserArea()}
                {this.state.clipError &&
                    <div className='cooklang-import-status cooklang-import-error'>{this.state.clipError}</div>}
            </div>
        );
    }

    protected renderBrowserArea(): React.ReactNode {
        if (!this.state.committedUrl) {
            return (
                <div className='cooklang-import-signin-gate'>
                    <span>{nls.localize('theia/cooklang-import/browserHint', 'Browse to a recipe page, then press Clip Recipe.')}</span>
                </div>
            );
        }
        // React has no intrinsic 'webview' type; createElement with a raw props object is required.
        return React.createElement('webview', {
            ref: this.setWebview,
            src: this.state.committedUrl,
            partition: 'import-browser'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    protected setWebview = (element: WebviewElement | null): void => {
        if (this.webview) {
            this.webview.removeEventListener('did-finish-load', this.handleDidFinishLoad);
            this.webview.removeEventListener('did-fail-load', this.handleDidFailLoad);
            this.webview.removeEventListener('did-navigate', this.handleDidNavigate);
            this.webview.removeEventListener('did-navigate-in-page', this.handleDidNavigate);
        }
        this.webview = element ?? undefined;
        if (this.webview) {
            this.webview.addEventListener('did-finish-load', this.handleDidFinishLoad);
            this.webview.addEventListener('did-fail-load', this.handleDidFailLoad);
            this.webview.addEventListener('did-navigate', this.handleDidNavigate);
            this.webview.addEventListener('did-navigate-in-page', this.handleDidNavigate);
        }
    };

    protected canGoBack(): boolean {
        return this.state.pageLoaded && !!this.webview?.canGoBack();
    }

    protected canGoForward(): boolean {
        return this.state.pageLoaded && !!this.webview?.canGoForward();
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
        if (this.state.pageLoaded) {
            this.webview?.reload();
        }
    };

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
            this.setState({ pageLoaded: false, pageLoadFailed: false });
            this.webview?.reload();
            return;
        }
        this.setState({ address: url, committedUrl: url, pageLoaded: false, pageLoadFailed: false, clipError: undefined });
        if (this.webview) {
            this.webview.src = url;
        }
    }

    protected clip = (): void => {
        if (!this.webview || !this.state.pageLoaded) {
            return;
        }
        this.setState({ clipError: undefined });
        this.webview.executeJavaScript(CLIP_SCRIPT).then(result => {
            const data = result as ClipScriptResult;
            const payload = RecipePayload.extract(data.jsonLdBlocks ?? [], data.pageText ?? '');
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
