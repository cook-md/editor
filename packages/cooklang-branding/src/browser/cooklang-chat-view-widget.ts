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

    @postConstruct()
    protected override init(): void {
        super.init();

        this.gateOverlay = document.createElement('div');
        this.gateOverlay.className = 'ai-chat-gate-overlay';
        this.gateOverlay.style.display = 'none';
        this.node.prepend(this.gateOverlay);

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
            button.textContent = nls.localize('theia/ai-chat/gate/loginButton', 'Log In');
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
}
