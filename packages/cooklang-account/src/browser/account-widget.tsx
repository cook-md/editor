// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import * as React from '@theia/core/shared/react';
import { AuthService, AuthState } from '../common/auth-protocol';
import { SubscriptionFrontendService, SubscriptionFrontendServiceImpl } from './subscription-frontend-service';
import { SubscriptionState } from '../common/subscription-protocol';
import { CookmdLoginCommand } from './auth-contribution';

export const ACCOUNT_WIDGET_ID = 'account-widget';

@injectable()
export class AccountWidget extends ReactWidget {

    static readonly ID = ACCOUNT_WIDGET_ID;
    static readonly LABEL = 'Account';

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptionFrontendService: SubscriptionFrontendServiceImpl;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    private authState: AuthState = { status: 'logged-out' };

    @postConstruct()
    protected init(): void {
        this.id = AccountWidget.ID;
        this.title.label = AccountWidget.LABEL;
        this.title.caption = AccountWidget.LABEL;
        this.title.iconClass = 'codicon codicon-account';
        this.title.closable = true;
        this.addClass('theia-account-widget');
        this.scrollOptions = { suppressScrollX: true };

        this.authService.getAuthState().then(state => {
            this.authState = state;
            this.update();
        });
        this.authService.onDidChangeAuth(state => {
            this.authState = state;
            this.update();
        });
        this.subscriptionFrontendService.onDidChangeSubscription(() => {
            this.update();
        });

        this.update();
    }

    protected render(): React.ReactNode {
        if (this.authState.status === 'logged-out') {
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
                <div className='theia-account-login-title'>Cook.md Account</div>
                <div className='theia-account-login-message'>
                    Log in to access sync, AI assistance, and other features.
                </div>
                <button
                    className='theia-button main theia-account-login-button'
                    onClick={this.handleLogin}
                >
                    Log In
                </button>
            </div>
        );
    }

    protected renderAccountPanel(): React.ReactNode {
        const subscription = this.subscriptionFrontendService.subscription;
        const email = this.authState.status === 'logged-in' ? this.authState.email : undefined;

        return (
            <div className='theia-account-panel'>
                <div className='theia-account-section'>
                    <div className='theia-account-email'>
                        <i className='codicon codicon-account' />
                        <span>{email}</span>
                    </div>
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
            <div className='theia-account-section theia-account-loading'>
                <div className='theia-account-spinner' />
                <span>Loading...</span>
            </div>
        );
    }

    protected renderSubscriptionActive(subscription: SubscriptionState): React.ReactNode {
        const planLabel = this.getPlanLabel(subscription);
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';

        return (
            <div className='theia-account-section'>
                <div className='theia-account-plan-status'>
                    <span className='theia-account-plan-badge'>{planLabel}</span>
                    {subscription.trialDaysRemaining !== null && subscription.trialDaysRemaining > 0 && (
                        <span className='theia-account-trial-remaining'>
                            {subscription.trialDaysRemaining} days remaining
                        </span>
                    )}
                </div>
                {subscription.features.length > 0 && (
                    <div className='theia-account-features'>
                        {subscription.features.map(feature => (
                            <span key={feature} className='theia-account-feature-badge'>
                                {feature}
                            </span>
                        ))}
                    </div>
                )}
                <div className='theia-account-sync-section'>
                    {this.renderSyncControls()}
                </div>
                <div className='theia-account-manage'>
                    <a
                        href={`${webBaseUrl}/account`}
                        onClick={this.handleManageSubscription}
                        className='theia-account-manage-link'
                    >
                        Manage Subscription
                    </a>
                </div>
            </div>
        );
    }

    protected renderSubscriptionUpgrade(): React.ReactNode {
        return (
            <div className='theia-account-section theia-account-upgrade'>
                <div className='theia-account-upgrade-message'>
                    Upgrade to unlock sync, AI assistance, and more features.
                </div>
                {this.renderSyncUpgrade()}
            </div>
        );
    }

    protected renderSyncControls(): React.ReactNode {
        return (
            <div className='theia-account-sync-placeholder'>
                <span>Sync controls coming soon</span>
            </div>
        );
    }

    protected renderSyncUpgrade(): React.ReactNode {
        return (
            <div className='theia-account-sync-upgrade'>
                <button
                    className='theia-button theia-account-upgrade-button'
                    onClick={this.handleUpgrade}
                >
                    Upgrade to Pro
                </button>
            </div>
        );
    }

    private getPlanLabel(subscription: SubscriptionState): string {
        switch (subscription.status) {
            case 'trial': return 'Trial';
            case 'active': return subscription.plan === 'annual' ? 'Pro (Annual)' : 'Pro (Monthly)';
            case 'grandfathered': return 'Pro (Grandfathered)';
            case 'canceled': return 'Canceled';
            case 'paused': return 'Paused';
            case 'expired': return 'Expired';
            default: return 'Free';
        }
    }

    private handleLogin = (): void => {
        this.commandService.executeCommand(CookmdLoginCommand.id);
    };

    private handleManageSubscription = (e: React.MouseEvent): void => {
        e.preventDefault();
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        this.windowService.openNewWindow(`${webBaseUrl}/account`, { external: true });
    };

    private handleUpgrade = (): void => {
        const webBaseUrl = process.env.WEB_BASE_URL || 'https://cook.md';
        this.windowService.openNewWindow(`${webBaseUrl}/pricing`, { external: true });
    };
}
