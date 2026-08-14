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
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { AuthState } from '@theia/cooklang-account/lib/common/auth-protocol';
import { AuthContribution, CookmdLoginCommand } from '@theia/cooklang-account/lib/browser/auth-contribution';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Message } from '@theia/core/lib/browser';
import { ChatModel, ChatResponseModel, isActiveSessionChangedEvent } from '@theia/ai-chat/lib/common';
import { CookbotUsageService } from '@theia/cooklang-ai/lib/common';
import { AccountCommands } from '@theia/cooklang-account/lib/browser/account-contribution';
import { computeQuotaBannerState, CookbotQuotaBannerState } from './cookbot-quota-banner-state';

const DEFAULT_WEB_BASE_URL = 'https://cook.md';

@injectable()
export class CooklangChatViewWidget extends ChatViewWidget {

    @inject(AuthContribution)
    protected readonly authContribution: AuthContribution;

    @inject(SubscriptionFrontendService)
    protected readonly subscriptionFrontendService: SubscriptionFrontendService;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(EnvVariablesServer)
    protected readonly envVariablesServer: EnvVariablesServer;

    private authState: AuthState = { status: 'logged-out' };
    private hasAiFeature = false;
    private gateOverlay: HTMLDivElement;
    private webBaseUrl: string = DEFAULT_WEB_BASE_URL;

    @inject(CookbotUsageService)
    protected readonly cookbotUsageService: CookbotUsageService;

    private quotaBanner: HTMLDivElement;
    private quotaBannerState: CookbotQuotaBannerState | undefined;
    private readonly usageTracking = new DisposableCollection();
    private usageRequestSeq = 0;

    @postConstruct()
    protected override init(): void {
        super.init();

        this.gateOverlay = document.createElement('div');
        this.gateOverlay.className = 'ai-chat-gate-overlay';
        this.gateOverlay.style.display = 'none';
        this.node.prepend(this.gateOverlay);

        this.quotaBanner = document.createElement('div');
        this.quotaBanner.className = 'ai-chat-quota-banner';
        this.quotaBanner.style.display = 'none';
        this.quotaBanner.setAttribute('role', 'status');

        this.trackModelForUsage(this.chatSession.model);
        this.toDispose.push(this.chatService.onSessionEvent(event => {
            // Runs after the base class's own listener, so chatSession is
            // already switched to the new active session here.
            if (isActiveSessionChangedEvent(event)) {
                this.trackModelForUsage(this.chatSession.model);
            }
        }));
        this.toDispose.push(this.usageTracking);

        this.authState = this.authContribution.authState;
        this.checkAiFeature();
        this.authContribution.onDidChangeAuth(state => {
            this.authState = state;
            this.checkAiFeature();
        });
        this.subscriptionFrontendService.onDidChangeSubscription(() => {
            this.checkAiFeature();
        });

        // Mirror the Node-side services' WEB_BASE_URL override so the Get AI
        // Addon button points at the same backend during local dev.
        this.envVariablesServer.getValue('WEB_BASE_URL').then(envVar => {
            if (envVar?.value) {
                this.webBaseUrl = envVar.value;
            }
        });
    }

    private async checkAiFeature(): Promise<void> {
        if (this.authState.status === 'logged-in') {
            this.hasAiFeature = await this.subscriptionFrontendService.hasFeature('ai');
        } else {
            this.hasAiFeature = false;
        }
        this.updateGating();
    }

    private updateGating(): void {
        if (this.authState.status === 'logged-out') {
            this.showGateScreen('login');
            return;
        }
        if (!this.hasAiFeature) {
            this.showGateScreen('upgrade');
            return;
        }
        this.gateOverlay.style.display = 'none';
        const layout = this.layout;
        if (layout) {
            for (const widget of layout) {
                widget.show();
            }
        }
        this.refreshUsage();
    }

    private showGateScreen(type: 'login' | 'upgrade'): void {
        const layout = this.layout;
        if (layout) {
            for (const widget of layout) {
                widget.hide();
            }
        }

        this.gateOverlay.style.display = 'flex';
        this.gateOverlay.replaceChildren();
        this.quotaBanner.style.display = 'none';

        const icon = document.createElement('div');
        icon.className = 'ai-chat-gate-icon';
        icon.textContent = '\u{1F916}';

        const title = document.createElement('div');
        title.className = 'ai-chat-gate-title';
        title.textContent = nls.localize('theia/ai-chat/gate/title', 'AI Assistant');

        const message = document.createElement('div');
        message.className = 'ai-chat-gate-message';

        const button = document.createElement('button');
        button.className = 'theia-button main';

        if (type === 'login') {
            message.textContent = nls.localize('theia/ai-chat/gate/loginMessage', 'Log in to your Cook.md account to use the AI recipe assistant.');
            button.textContent = nls.localizeByDefault('Log In');
            button.addEventListener('click', () => {
                this.commandService.executeCommand(CookmdLoginCommand.id);
            });
        } else {
            message.textContent = nls.localize('theia/ai-chat/gate/upgradeMessage',
                'The AI assistant requires the AI addon. Add it to your subscription to get started.');
            button.textContent = nls.localize('theia/ai-chat/gate/upgradeButton', 'Get AI Addon \u2192');
            button.addEventListener('click', () => {
                this.startUpgradeFlow();
            });
            const note = document.createElement('div');
            note.className = 'ai-chat-gate-note';
            note.textContent = nls.localize('theia/ai-chat/gate/upgradeNote', 'Opens cook.md in your browser');
            this.gateOverlay.append(icon, title, message, button, note);
            return;
        }

        this.gateOverlay.append(icon, title, message, button);
    }

    private async startUpgradeFlow(): Promise<void> {
        let url: string;
        try {
            url = await this.subscriptionFrontendService.startUpgradeFlow();
        } catch (err) {
            console.warn('Failed to start upgrade flow, falling back to pricing page:', err);
            this.windowService.openNewWindow(`${this.webBaseUrl}/pricing`, { external: true });
            return;
        }
        this.windowService.openNewWindow(url, { external: true });
        try {
            const result = await this.subscriptionFrontendService.awaitUpgradeCallback();
            if (result.status === 'ok') {
                await this.subscriptionFrontendService.refresh();
            }
        } catch (err) {
            // Timeout, state mismatch, or superseded flow — gate will stay as-is.
            console.warn('Upgrade flow did not complete:', err);
        }
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // The banner sits between the chat tree and the input inside the
        // widget's flex column, outside the PanelLayout's own widgets.
        if (!this.quotaBanner.isConnected) {
            this.node.insertBefore(this.quotaBanner, this.inputWidget.node);
        }
        this.refreshUsage();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refreshUsage();
    }

    private trackModelForUsage(model: ChatModel): void {
        this.usageTracking.dispose();
        this.usageTracking.push(model.onDidChange(event => {
            if (event.kind === 'addResponse') {
                this.watchResponseCompletion(event.response);
            }
        }));
    }

    /**
     * Refresh once per exchange, when the response settles — streaming
     * deltas must not each trigger a usage query.
     */
    private watchResponseCompletion(response: ChatResponseModel): void {
        if (response.isComplete || response.isCanceled || response.isError) {
            this.refreshUsage();
            return;
        }
        const listener = response.onDidChange(() => {
            if (response.isComplete || response.isCanceled || response.isError) {
                listener.dispose();
                this.refreshUsage();
            }
        });
        this.usageTracking.push(listener);
    }

    private refreshUsage(): void {
        if (this.authState.status !== 'logged-in' || !this.hasAiFeature) {
            this.quotaBanner.style.display = 'none';
            return;
        }
        const seq = ++this.usageRequestSeq;
        this.cookbotUsageService.getUsage().then(usageStats => {
            if (seq !== this.usageRequestSeq || this.isDisposed) {
                return;
            }
            this.quotaBannerState = computeQuotaBannerState(usageStats);
            this.renderQuotaBanner();
        }).catch(error => {
            // The backend already collapses expected failures to undefined;
            // anything surfacing here is RPC noise not worth a banner change.
            console.info('[Chat] Could not refresh Cookbot usage:', error);
        });
    }

    private renderQuotaBanner(): void {
        const state = this.quotaBannerState;
        const gated = this.authState.status !== 'logged-in' || !this.hasAiFeature;
        if (!state || gated) {
            this.quotaBanner.style.display = 'none';
            return;
        }
        this.quotaBanner.replaceChildren();
        this.quotaBanner.classList.toggle('exhausted', state.level === 'exhausted');

        const message = document.createElement('span');
        message.className = 'ai-chat-quota-banner-message';
        const parsedReset = state.resetsOn ? new Date(state.resetsOn) : undefined;
        const resetsOn = parsedReset && !isNaN(parsedReset.getTime()) ? parsedReset.toLocaleDateString() : undefined;
        if (state.level === 'exhausted') {
            message.textContent = resetsOn
                ? nls.localize('theia/ai-chat/quota/exhaustedWithDate', 'Your Cookbot AI credits are used up until {0}.', resetsOn)
                : nls.localize('theia/ai-chat/quota/exhausted', 'Your Cookbot AI credits for this billing cycle are used up.');
        } else {
            message.textContent = resetsOn
                ? nls.localize('theia/ai-chat/quota/warningWithDate', 'You\'ve used {0}% of your Cookbot AI credits this cycle — resets {1}.', state.percentUsed, resetsOn)
                : nls.localize('theia/ai-chat/quota/warning', 'You\'ve used {0}% of your Cookbot AI credits this cycle.', state.percentUsed);
        }

        const account = this.createQuotaBannerAction(nls.localize('theia/ai-chat/quota/openAccount', 'Open Account'), () => {
            this.commandService.executeCommand(AccountCommands.OPEN_VIEW.id);
        });
        const upgrade = this.createQuotaBannerAction(nls.localizeByDefault('Upgrade'), () => {
            this.startUpgradeFlow();
        });

        this.quotaBanner.append(message, account, upgrade);
        this.quotaBanner.style.display = 'flex';
    }

    private createQuotaBannerAction(label: string, run: () => void): HTMLAnchorElement {
        const link = document.createElement('a');
        link.className = 'ai-chat-quota-banner-link';
        link.textContent = label;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.addEventListener('click', () => run());
        link.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                run();
            }
        });
        return link;
    }
}
