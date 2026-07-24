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
import { DraftSaver } from './draft-saver';

export const IMPORT_WIDGET_ID = 'cooklang-import-widget';

export type ImportTab = 'url' | 'text' | 'images' | 'browser';

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
    protected busy = false;
    protected errorMessage: string | undefined;
    protected errorShowsSignIn = false;
    protected successMessage: string | undefined;

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
    }

    protected refreshAuthState(): void {
        this.authService.getAuthState().then(state => {
            this.authState = state;
            this.update();
        });
    }

    protected get signedIn(): boolean {
        return this.authState.status === 'logged-in';
    }

    protected signIn = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    protected selectTab(tab: ImportTab): void {
        this.activeTab = tab;
        this.errorMessage = undefined;
        this.successMessage = undefined;
        this.update();
    }

    // Shared conversion pipeline used by all tabs (Tasks 8-10 call this).
    protected async runImport(convert: () => Promise<ConvertResult>): Promise<void> {
        this.busy = true;
        this.errorMessage = undefined;
        this.successMessage = undefined;
        this.update();
        try {
            const result = await convert();
            if (result.error !== undefined) {
                this.showError(result.error);
                return;
            }
            const uri = await this.draftSaver.save(result);
            this.successMessage = nls.localize('theia/cooklang-import/savedTo', 'Saved to {0}', `Drafts/${uri.path.base}`);
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
                <div className='cooklang-import-tab-body'>
                    {this.renderActiveTab()}
                </div>
            </div>
        );
    }

    protected renderTabBar(): React.ReactNode {
        const tabs: Array<{ id: ImportTab; label: string }> = [
            { id: 'url', label: nls.localizeByDefault('URL') },
            { id: 'text', label: nls.localizeByDefault('Text') },
            { id: 'images', label: nls.localize('theia/cooklang-import/tabImages', 'Images') },
            { id: 'browser', label: nls.localize('theia/cooklang-import/tabBrowser', 'Web Browser') },
        ];
        return (
            <div className='cooklang-import-tabbar' role='tablist'>
                {tabs.map(tab => (
                    <TabButton key={tab.id} tab={tab.id} label={tab.label}
                        active={this.activeTab === tab.id}
                        onSelect={this.onTabSelected} />
                ))}
            </div>
        );
    }

    protected onTabSelected = (tab: ImportTab): void => {
        this.selectTab(tab);
    };

    protected renderLimitsBanner(): React.ReactNode {
        return (
            <div className='cooklang-import-banner'>
                <span>{nls.localize('theia/cooklang-import/limitsBanner', 'Sign in for higher import limits.')}</span>
                <a onClick={this.signIn}>{nls.localizeByDefault('Sign in')}</a>
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
        // Tabs are implemented in Tasks 8-10; placeholders until then.
        switch (this.activeTab) {
            case 'url': return this.renderUrlTab();
            case 'text': return this.renderTextTab();
            case 'images': return this.renderImagesTab();
            case 'browser': return this.renderBrowserTab();
        }
    }

    protected renderUrlTab(): React.ReactNode {
        return <div />;
    }

    protected renderTextTab(): React.ReactNode {
        return <div />;
    }

    protected renderImagesTab(): React.ReactNode {
        return <div />;
    }

    protected renderBrowserTab(): React.ReactNode {
        return <div />;
    }
}

interface TabButtonProps {
    tab: ImportTab;
    label: string;
    active: boolean;
    onSelect: (tab: ImportTab) => void;
}

class TabButton extends React.Component<TabButtonProps> {
    override render(): React.ReactNode {
        const { label, active } = this.props;
        return <div role='tab' aria-selected={active}
            className={'cooklang-import-tab' + (active ? ' cooklang-import-tab-active' : '')}
            onClick={this.handleClick}>{label}</div>;
    }
    protected handleClick = (): void => {
        this.props.onSelect(this.props.tab);
    };
}
