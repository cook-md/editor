// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import * as React from '@theia/core/shared/react';
import { SubscriptionFrontendService } from './subscription-frontend-service';
import { SubscriptionState } from '../common/subscription-protocol';
import { SyncService, SyncStatus } from '../common/sync-protocol';
import { AuthContribution, CookmdLoginCommand, CookmdLogoutCommand } from './auth-contribution';

const WEB_BASE_URL = 'https://cook.md';

export const ACCOUNT_WIDGET_ID = 'account-widget';

@injectable()
export class AccountWidget extends ReactWidget {

    static readonly ID = ACCOUNT_WIDGET_ID;
    static readonly LABEL = 'Account';

    @inject(AuthContribution)
    protected readonly authContribution: AuthContribution;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptionFrontendService: SubscriptionFrontendService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(SyncService)
    protected readonly syncService: SyncService;

    private static readonly SYNC_POLL_INTERVAL_MS = 2000;

    private syncEnabled = false;
    private syncStatus: SyncStatus = { status: 'stopped', lastSyncedAt: undefined, error: undefined };
    private syncPollTimer: ReturnType<typeof setInterval> | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AccountWidget.ID;
        this.title.label = AccountWidget.LABEL;
        this.title.caption = AccountWidget.LABEL;
        this.title.iconClass = 'codicon codicon-account';
        this.title.closable = true;
        this.addClass('theia-account-widget');
        this.scrollOptions = { suppressScrollX: true };

        this.authContribution.onDidChangeAuth(() => {
            this.syncService.isSyncEnabled().then(enabled => {
                this.syncEnabled = enabled;
                this.refreshSyncStatus().then(() => this.update());
            });
        });
        this.subscriptionFrontendService.onDidChangeSubscription(() => {
            this.update();
        });

        this.syncService.isSyncEnabled().then(async enabled => {
            this.syncEnabled = enabled;
            await this.refreshSyncStatus();
            this.startSyncPolling();
            this.update();
        });

        this.update();
    }

    override dispose(): void {
        this.stopSyncPolling();
        super.dispose();
    }

    private startSyncPolling(): void {
        this.stopSyncPolling();
        if (!this.syncEnabled) {
            return;
        }
        this.syncPollTimer = setInterval(async () => {
            await this.refreshSyncStatus();
            this.update();
        }, AccountWidget.SYNC_POLL_INTERVAL_MS);
    }

    private stopSyncPolling(): void {
        if (this.syncPollTimer) {
            clearInterval(this.syncPollTimer);
            this.syncPollTimer = undefined;
        }
    }

    private async refreshSyncStatus(): Promise<void> {
        try {
            this.syncStatus = await this.syncService.getSyncStatus();
        } catch {
            // keep last known status
        }
    }

    protected render(): React.ReactNode {
        const authState = this.authContribution.authState;
        if (authState.status === 'logged-out') {
            return this.renderLoginPrompt();
        }
        return this.renderAccountPanel();
    }

    protected renderLoginPrompt(): React.ReactNode {
        return (
            <div className='theia-account-login-prompt'>
                <div className='theia-account-login-icon'>
                    <i className='codicon codicon-account' />
                </div>

                <div className='theia-account-login-message'>
                    {nls.localize('theia/cooklang-account/loginMessage', 'Log in to access sync, AI assistance, and other features.')}
                </div>
                <button
                    className='theia-button main theia-account-login-button'
                    onClick={this.handleLogin}
                >
                    {nls.localize('theia/cooklang-account/loginButton', 'Log In')}
                </button>
            </div>
        );
    }

    protected renderAccountPanel(): React.ReactNode {
        const subscription = this.subscriptionFrontendService.subscription;
        const email = this.authContribution.authState.status === 'logged-in'
            ? this.authContribution.authState.email
            : undefined;

        return (
            <div className='theia-account-panel'>
                <div className='theia-account-row'>
                    <i className='codicon codicon-account' />
                    <span className='theia-account-row-label'>{email}</span>
                </div>
                {subscription === undefined
                    ? this.renderSubscriptionLoading()
                    : subscription.hasAccess
                        ? this.renderSubscriptionActive(subscription)
                        : this.renderSubscriptionUpgrade()
                }
            </div>
        );
    }

    protected renderSubscriptionLoading(): React.ReactNode {
        return (
            <div className='theia-account-loading'>
                <div className='theia-account-spinner' />
                <span>{nls.localize('theia/cooklang-account/loading', 'Loading...')}</span>
            </div>
        );
    }

    protected renderSubscriptionActive(subscription: SubscriptionState): React.ReactNode {
        const planLabel = this.getPlanLabel(subscription);
        const hasSyncFeature = subscription.features.includes('sync');
        const statusLabel = this.syncStatus.status.charAt(0).toUpperCase() + this.syncStatus.status.slice(1);

        return (
            <React.Fragment>
                <div className='theia-account-row'>
                    <i className='codicon codicon-credit-card' />
                    <span className='theia-account-plan-badge'>{planLabel}</span>
                    {subscription.trialDaysRemaining !== undefined && subscription.trialDaysRemaining > 0 && (
                        <span className='theia-account-row-detail'>
                            {nls.localize('theia/cooklang-account/trialDaysLeft', '{0} days left', subscription.trialDaysRemaining)}
                        </span>
                    )}
                </div>
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleManageSubscription}>
                    <i className='codicon codicon-link-external' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/manageSubscription', 'Manage Subscription')}</span>
                </div>
                {hasSyncFeature && this.renderSyncSection(statusLabel)}
                <div className='theia-account-divider' />
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleLogout}>
                    <i className='codicon codicon-sign-out' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/logOut', 'Log Out')}</span>
                </div>
            </React.Fragment>
        );
    }

    protected renderSyncSection(statusLabel: string): React.ReactNode {
        return (
            <React.Fragment>
                <div className='theia-account-section-header'>{nls.localize('theia/cooklang-account/syncHeader', 'CookCloud Sync')}</div>
                <div className='theia-account-row'>
                    <i className='codicon codicon-sync' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/syncEnabled', 'Enabled')}</span>
                    <input
                        className='theia-account-sync-toggle'
                        type='checkbox'
                        checked={this.syncEnabled}
                        onChange={this.handleSyncToggle}
                    />
                </div>
                <div className='theia-account-row theia-account-sync-status'>
                    <i className='codicon codicon-info' />
                    <span className='theia-account-row-label'>{statusLabel}</span>
                </div>
                {this.syncStatus.lastSyncedAt && (
                    <div className='theia-account-row theia-account-sync-status'>
                        <i className='codicon codicon-history' />
                        <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/lastSynced', 'Last synced')}</span>
                        <span className='theia-account-row-detail'>{this.syncStatus.lastSyncedAt}</span>
                    </div>
                )}
                {this.syncStatus.error && (
                    <div className='theia-account-row theia-account-sync-error'>
                        <i className='codicon codicon-error' />
                        <span className='theia-account-row-label'>{this.syncStatus.error}</span>
                    </div>
                )}
            </React.Fragment>
        );
    }

    protected renderSubscriptionUpgrade(): React.ReactNode {
        return (
            <React.Fragment>
                <div className='theia-account-section-header'>{nls.localize('theia/cooklang-account/subscriptionHeader', 'Subscription')}</div>
                <div className='theia-account-upgrade-section'>
                    <div className='theia-account-upgrade-message'>
                        {nls.localize('theia/cooklang-account/upgradeMessage', 'Upgrade to unlock sync, AI assistance, and more features.')}
                    </div>
                    <button
                        className='theia-button main theia-account-upgrade-button'
                        onClick={this.handleUpgrade}
                    >
                        {nls.localize('theia/cooklang-account/upgradeButton', 'Upgrade to Pro')}
                    </button>
                </div>
                <div className='theia-account-divider' />
                <div className='theia-account-row theia-account-row-interactive' onClick={this.handleLogout}>
                    <i className='codicon codicon-sign-out' />
                    <span className='theia-account-row-label'>{nls.localize('theia/cooklang-account/logOut', 'Log Out')}</span>
                </div>
            </React.Fragment>
        );
    }

    private getPlanLabel(subscription: SubscriptionState): string {
        // Rails owns the display name — prefer it when present.
        if (subscription.planName) {
            return subscription.planName;
        }
        switch (subscription.status) {
            case 'trial': return nls.localize('theia/cooklang-account/planTrial', 'Trial');
            case 'grandfathered': return nls.localize('theia/cooklang-account/planGrandfathered', 'Pro (Grandfathered)');
            case 'past_due': return nls.localize('theia/cooklang-account/planPastDue', 'Pro (Payment Issue)');
            case 'canceled': return nls.localize('theia/cooklang-account/planCanceled', 'Canceled');
            case 'paused': return nls.localize('theia/cooklang-account/planPaused', 'Paused');
            case 'expired': return nls.localize('theia/cooklang-account/planExpired', 'Expired');
            default: return nls.localize('theia/cooklang-account/planFree', 'Free');
        }
    }

    private handleLogin = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    private handleSyncToggle = async (): Promise<void> => {
        const enabling = !this.syncEnabled;
        // Optimistically update UI before the RPC call completes
        this.syncEnabled = enabling;
        this.syncStatus = enabling
            ? { status: 'idle', lastSyncedAt: undefined, error: undefined }
            : { status: 'stopped', lastSyncedAt: undefined, error: undefined };
        this.update();

        try {
            if (enabling) {
                await this.syncService.enableSync();
                await this.refreshSyncStatus();
                this.startSyncPolling();
            } else {
                this.stopSyncPolling();
                await this.syncService.disableSync();
            }
        } catch (err) {
            console.error('Failed to toggle sync:', err);
            // Revert on failure
            this.syncEnabled = !enabling;
        }
        this.update();
    };

    private handleManageSubscription = (): void => {
        this.windowService.openNewWindow(`${WEB_BASE_URL}/subscription`, { external: true });
    };

    private handleLogout = (): void => {
        this.commandService.executeCommand(CookmdLogoutCommand.id);
    };

    private handleUpgrade = (): void => {
        this.windowService.openNewWindow(`${WEB_BASE_URL}/pricing`, { external: true });
    };

}
