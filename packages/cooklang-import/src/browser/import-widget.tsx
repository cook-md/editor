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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import { AuthService, AuthState } from '@theia/cooklang-account/lib/common/auth-protocol';
import { AuthContribution, CookmdLoginCommand } from '@theia/cooklang-account/lib/browser/auth-contribution';
import { ConvertResult, ImportErrorCode, RecipeImportService } from '../common/recipe-import-protocol';
import { DraftSaver, DRAFTS_FOLDER_NAME } from './draft-saver';
import { ImageEncoder, MAX_IMPORT_IMAGES } from './image-encoder';

export const IMPORT_WIDGET_ID = 'cooklang-import-widget';

export type ImportTab = 'url' | 'text' | 'images' | 'browser';

const TAB_ORDER: ImportTab[] = ['url', 'text', 'images', 'browser'];
const TAB_PANEL_ID = 'cooklang-import-tabpanel';

@injectable()
export class ImportWidget extends ReactWidget {

    static readonly ID = IMPORT_WIDGET_ID;
    static readonly LABEL = nls.localize('theia/cooklang-import/widgetLabel', 'Import Recipe');

    @inject(RecipeImportService)
    protected readonly importService: RecipeImportService;

    @inject(DraftSaver)
    protected readonly draftSaver: DraftSaver;

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(AuthContribution)
    protected readonly authContribution: AuthContribution;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    protected activeTab: ImportTab = 'url';
    protected authState: AuthState = { status: 'logged-out' };
    // Import status is deliberately widget-global (not per-tab) for v1:
    // only one import runs at a time and switching tabs clears it.
    protected busy = false;
    protected errorMessage: string | undefined;
    protected errorShowsSignIn = false;
    protected successMessage: string | undefined;
    protected urlValue = '';
    protected textValue = '';
    protected images: Array<{ file: File; previewUrl: string }> = [];
    protected dropActive = false;

    @postConstruct()
    protected init(): void {
        this.id = ImportWidget.ID;
        this.title.label = ImportWidget.LABEL;
        this.title.caption = ImportWidget.LABEL;
        this.title.iconClass = 'codicon codicon-cloud-download';
        this.title.closable = true;
        this.addClass('cooklang-import-widget');
        this.refreshAuthState();
        this.toDispose.push(this.authContribution.onDidChangeAuth(() => this.refreshAuthState()));
        this.toDispose.push({ dispose: () => this.clearImages() });
    }

    protected refreshAuthState(): void {
        this.authService.getAuthState().then(state => {
            this.authState = state;
            this.update();
        }).catch(err => console.warn('Failed to refresh auth state:', err));
    }

    protected get signedIn(): boolean {
        return this.authState.status === 'logged-in';
    }

    protected signIn = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    protected onSignInKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.signIn();
        }
    };

    protected selectTab(tab: ImportTab): void {
        this.activeTab = tab;
        this.errorMessage = undefined;
        this.errorShowsSignIn = false;
        this.successMessage = undefined;
        this.update();
    }

    // Shared conversion pipeline used by all tabs (Tasks 8-10 call this).
    protected async runImport(convert: () => Promise<ConvertResult>): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.errorMessage = undefined;
        this.errorShowsSignIn = false;
        this.successMessage = undefined;
        this.update();
        try {
            const result = await convert();
            if (result.error !== undefined) {
                this.showError(result.error);
                return;
            }
            const uri = await this.draftSaver.save(result);
            this.successMessage = nls.localize('theia/cooklang-import/savedTo', 'Saved to {0}', `${DRAFTS_FOLDER_NAME}/${uri.path.base}`);
        } catch (err) {
            this.errorMessage = err instanceof Error ? err.message : String(err);
            this.errorShowsSignIn = false;
        } finally {
            this.busy = false;
            this.update();
        }
    }

    protected showError(code: ImportErrorCode): void {
        this.errorShowsSignIn = false;
        switch (code) {
            case 'rate-limited':
                if (this.signedIn) {
                    this.errorMessage = nls.localize('theia/cooklang-import/rateLimited', 'Import limit reached. Please try again later.');
                } else {
                    this.errorMessage = nls.localize('theia/cooklang-import/rateLimitedAnon', 'Import limit reached — sign in to increase your limits.');
                    this.errorShowsSignIn = true;
                }
                break;
            case 'unauthorized':
                this.errorMessage = nls.localize('theia/cooklang-import/unauthorized', 'Please sign in to continue.');
                this.errorShowsSignIn = true;
                break;
            case 'conversion-failed':
                this.errorMessage = nls.localize('theia/cooklang-import/conversionFailed', 'Couldn’t extract a recipe from this source. Try another one.');
                break;
            case 'network':
            default:
                this.errorMessage = nls.localize('theia/cooklang-import/networkError', 'Connection problem. Please try again.');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='cooklang-import-content'>
                {this.renderTabBar()}
                {!this.signedIn && this.activeTab !== 'images' && this.renderLimitsBanner()}
                {this.renderStatus()}
                <div className='cooklang-import-tab-body' role='tabpanel' id={TAB_PANEL_ID} aria-labelledby={this.tabElementId(this.activeTab)}>
                    {this.renderActiveTab()}
                </div>
            </div>
        );
    }

    protected renderTabBar(): React.ReactNode {
        return (
            <div className='cooklang-import-tabbar' role='tablist'>
                {TAB_ORDER.map(tab => (
                    <TabButton key={tab} tab={tab} label={this.tabLabel(tab)}
                        active={this.activeTab === tab}
                        id={this.tabElementId(tab)}
                        ariaControls={TAB_PANEL_ID}
                        onSelect={this.onTabSelected}
                        onKeyDown={this.onTabKeyDown} />
                ))}
            </div>
        );
    }

    protected tabLabel(tab: ImportTab): string {
        switch (tab) {
            case 'url': return nls.localizeByDefault('URL');
            case 'text': return nls.localizeByDefault('Text');
            case 'images': return nls.localize('theia/cooklang-import/tabImages', 'Images');
            case 'browser': return nls.localize('theia/cooklang-import/tabBrowser', 'Web Browser');
        }
    }

    protected tabElementId(tab: ImportTab): string {
        return `cooklang-import-tab-${tab}`;
    }

    protected onTabSelected = (tab: ImportTab): void => {
        this.selectTab(tab);
    };

    protected onTabKeyDown = (tab: ImportTab, event: React.KeyboardEvent): void => {
        switch (event.key) {
            case 'Enter':
            case ' ':
                event.preventDefault();
                this.selectTab(tab);
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.focusTab(this.adjacentTab(tab, 1));
                break;
            case 'ArrowLeft':
                event.preventDefault();
                this.focusTab(this.adjacentTab(tab, -1));
                break;
            case 'Home':
                event.preventDefault();
                this.focusTab(TAB_ORDER[0]);
                break;
            case 'End':
                event.preventDefault();
                this.focusTab(TAB_ORDER[TAB_ORDER.length - 1]);
                break;
        }
    };

    protected adjacentTab(tab: ImportTab, delta: number): ImportTab {
        const index = TAB_ORDER.indexOf(tab);
        const nextIndex = (index + delta + TAB_ORDER.length) % TAB_ORDER.length;
        return TAB_ORDER[nextIndex];
    }

    protected focusTab(tab: ImportTab): void {
        this.selectTab(tab);
        const element = this.node.querySelector<HTMLElement>(`#${this.tabElementId(tab)}`);
        element?.focus();
    }

    protected renderLimitsBanner(): React.ReactNode {
        return (
            <div className='cooklang-import-banner'>
                <span>{nls.localize('theia/cooklang-import/limitsBanner', 'Sign in for higher import limits.')}</span>
                <a role='button' tabIndex={0} onClick={this.signIn} onKeyDown={this.onSignInKeyDown}>{nls.localizeByDefault('Sign in')}</a>
            </div>
        );
    }

    protected renderStatus(): React.ReactNode {
        if (this.busy) {
            return <div className='cooklang-import-status'>
                <i className='codicon codicon-loading codicon-modifier-spin' />
                {nls.localize('theia/cooklang-import/importing', 'Importing…')}
            </div>;
        }
        if (this.errorMessage) {
            return <div className='cooklang-import-status cooklang-import-error'>
                <span>{this.errorMessage}</span>
                {this.errorShowsSignIn && !this.signedIn &&
                    <button className='theia-button' onClick={this.signIn}>
                        {nls.localizeByDefault('Sign in')}
                    </button>}
            </div>;
        }
        if (this.successMessage) {
            return <div className='cooklang-import-status cooklang-import-success'>{this.successMessage}</div>;
        }
        return undefined;
    }

    protected renderActiveTab(): React.ReactNode {
        // Images and browser tabs are implemented in Tasks 9-10; placeholders until then.
        switch (this.activeTab) {
            case 'url': return this.renderUrlTab();
            case 'text': return this.renderTextTab();
            case 'images': return this.renderImagesTab();
            case 'browser': return this.renderBrowserTab();
        }
    }

    protected renderUrlTab(): React.ReactNode {
        return (
            <div className='cooklang-import-form'>
                <label>{nls.localize('theia/cooklang-import/urlLabel', 'Recipe page URL')}</label>
                <input className='theia-input' type='text' value={this.urlValue}
                    placeholder='https://example.com/best-pancakes'
                    onChange={this.onUrlChanged} onKeyDown={this.onUrlKeyDown} disabled={this.busy} />
                <button className='theia-button main' onClick={this.importFromUrl}
                    disabled={this.busy || this.urlValue.trim().length === 0}>
                    {nls.localize('theia/cooklang-import/importButton', 'Import')}
                </button>
            </div>
        );
    }

    protected onUrlChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.urlValue = event.target.value;
        this.update();
    };

    protected onUrlKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter' && this.urlValue.trim().length > 0 && !this.busy) {
            this.importFromUrl();
        }
    };

    protected importFromUrl = (): void => {
        const raw = this.urlValue.trim();
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
            new URL(url);
        } catch {
            this.errorMessage = nls.localize('theia/cooklang-import/invalidUrl', 'Enter a valid web address.');
            this.errorShowsSignIn = false;
            this.successMessage = undefined;
            this.update();
            return;
        }
        this.runImport(() => this.importService.convertUrl(url)).catch(err => console.error('Failed to import from URL:', err));
    };

    protected renderTextTab(): React.ReactNode {
        return (
            <div className='cooklang-import-form'>
                <label>{nls.localize('theia/cooklang-import/textLabel', 'Paste the recipe text')}</label>
                <textarea className='theia-input' value={this.textValue}
                    onChange={this.onTextChanged} disabled={this.busy} />
                <button className='theia-button main' onClick={this.importFromText}
                    disabled={this.busy || this.textValue.trim().length === 0}>
                    {nls.localize('theia/cooklang-import/importButton', 'Import')}
                </button>
            </div>
        );
    }

    protected onTextChanged = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
        this.textValue = event.target.value;
        this.update();
    };

    protected importFromText = (): void => {
        const text = this.textValue.trim();
        this.runImport(() => this.importService.convertText(text)).catch(err => console.error('Failed to import from text:', err));
    };

    protected renderImagesTab(): React.ReactNode {
        if (!this.signedIn) {
            return (
                <div className='cooklang-import-signin-gate'>
                    <i className='codicon codicon-account' />
                    <span>{nls.localize('theia/cooklang-import/imagesSignIn', 'Sign in to CookCloud to use image clipping.')}</span>
                    <button className='theia-button main' onClick={this.signIn}>
                        {nls.localizeByDefault('Sign in')}
                    </button>
                </div>
            );
        }
        return (
            <div className='cooklang-import-form'>
                <div className={'cooklang-import-dropzone' + (this.dropActive ? ' cooklang-import-dropzone-active' : '')}
                    onDragOver={this.onDragOver} onDragLeave={this.onDragLeave} onDrop={this.onDrop}>
                    {nls.localize('theia/cooklang-import/dropImages', 'Drop up to {0} recipe photos here, or', MAX_IMPORT_IMAGES)}
                    <input type='file' accept='image/*' multiple onChange={this.onFilesPicked} disabled={this.busy} />
                </div>
                {this.images.length > 0 &&
                    <div className='cooklang-import-thumbs'>
                        {this.images.map((image, index) => <ImageThumb key={image.previewUrl} index={index}
                            previewUrl={image.previewUrl} fileName={image.file.name} onRemove={this.onRemoveImage} />)}
                    </div>}
                <button className='theia-button main' onClick={this.importFromImages}
                    disabled={this.busy || this.images.length === 0}>
                    {nls.localize('theia/cooklang-import/importButton', 'Import')}
                </button>
            </div>
        );
    }

    protected onDragOver = (event: React.DragEvent): void => {
        event.preventDefault();
        this.dropActive = true;
        this.update();
    };

    protected onDragLeave = (event: React.DragEvent): void => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) {
            return;
        }
        this.dropActive = false;
        this.update();
    };

    protected onDrop = (event: React.DragEvent): void => {
        event.preventDefault();
        this.dropActive = false;
        if (this.busy) {
            this.update();
            return;
        }
        this.addImageFiles(Array.from(event.dataTransfer.files));
    };

    protected onFilesPicked = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.addImageFiles(Array.from(event.target.files ?? []));
        event.target.value = '';
    };

    protected addImageFiles(files: File[]): void {
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        for (const file of imageFiles) {
            if (this.images.length >= MAX_IMPORT_IMAGES) {
                break;
            }
            this.images.push({ file, previewUrl: URL.createObjectURL(file) });
        }
        this.update();
    }

    protected onRemoveImage = (index: number): void => {
        const [removed] = this.images.splice(index, 1);
        if (removed) {
            URL.revokeObjectURL(removed.previewUrl);
        }
        this.update();
    };

    protected clearImages(): void {
        this.images.forEach(image => URL.revokeObjectURL(image.previewUrl));
        this.images = [];
    }

    protected importFromImages = (): void => {
        const files = this.images.map(image => image.file);
        this.runImport(async () => {
            // Encode sequentially so at most one full-resolution bitmap is held in memory at a time.
            const encoded: string[] = [];
            for (const file of files) {
                try {
                    encoded.push(await ImageEncoder.toBase64Jpeg(file));
                } catch {
                    // E.g. HEIC photos: Chromium cannot decode them, so createImageBitmap rejects.
                    throw new Error(nls.localize('theia/cooklang-import/imageDecodeFailed',
                        'Couldn’t read {0}. Convert it to JPEG or PNG and try again.', file.name));
                }
            }
            return this.importService.convertImages(encoded);
        }).then(() => {
            if (this.successMessage) {
                this.clearImages();
                this.update();
            }
        }, (err: unknown) => console.error('Image import failed:', err));
    };

    protected renderBrowserTab(): React.ReactNode {
        return <div />;
    }
}

interface TabButtonProps {
    tab: ImportTab;
    label: string;
    active: boolean;
    id: string;
    ariaControls: string;
    onSelect: (tab: ImportTab) => void;
    onKeyDown: (tab: ImportTab, event: React.KeyboardEvent) => void;
}

class TabButton extends React.Component<TabButtonProps> {
    override render(): React.ReactNode {
        const { label, active, id, ariaControls } = this.props;
        return <div role='tab' id={id} aria-selected={active} aria-controls={ariaControls} tabIndex={active ? 0 : -1}
            className={'cooklang-import-tab' + (active ? ' cooklang-import-tab-active' : '')}
            onClick={this.handleClick} onKeyDown={this.handleKeyDown}>{label}</div>;
    }
    protected handleClick = (): void => {
        this.props.onSelect(this.props.tab);
    };
    protected handleKeyDown = (event: React.KeyboardEvent): void => {
        this.props.onKeyDown(this.props.tab, event);
    };
}

interface ImageThumbProps {
    index: number;
    previewUrl: string;
    fileName: string;
    onRemove: (index: number) => void;
}

class ImageThumb extends React.Component<ImageThumbProps> {
    override render(): React.ReactNode {
        return (
            <div className='cooklang-import-thumb'>
                <img src={this.props.previewUrl} alt={this.props.fileName} />
                <button className='cooklang-import-thumb-remove' onClick={this.handleRemove}
                    title={nls.localizeByDefault('Remove')}>
                    <i className='codicon codicon-close' />
                </button>
            </div>
        );
    }
    protected handleRemove = (): void => {
        this.props.onRemove(this.props.index);
    };
}
