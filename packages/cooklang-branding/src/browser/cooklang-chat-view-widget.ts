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
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Message } from '@theia/core/lib/browser';
import { ChatModel, ChatResponseModel, isActiveSessionChangedEvent } from '@theia/ai-chat/lib/common';
import { CookbotUsageService, CookbotUsageStats } from '@theia/cooklang-ai/lib/common';
import { takePendingPrompt } from '@theia/cooklang-ai/lib/browser/pending-prompt';
import { AccountCommands } from '@theia/cooklang-account/lib/browser/account-contribution';
import { UsageEventsFrontend } from '@theia/cooklang-account/lib/browser/usage-events-frontend';
import { proOfferCopy } from '@theia/cooklang-account/lib/common/pro-offer-copy';
import { computeExchangeCost, computeQuotaBannerState, CookbotQuotaBannerState } from './cookbot-quota-banner-state';
import { computeCookbotGate, CookbotGate, decideTrialContinuation, LOADING_FALLBACK_MS } from './cookbot-gate-state';
import { FirstRunState } from './first-run-state';

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

    @inject(UsageEventsFrontend)
    protected readonly usageEvents: UsageEventsFrontend;

    @inject(FirstRunState)
    protected readonly firstRunState: FirstRunState;

    /** `undefined` until the subscription has loaded. */
    private trialEligible: boolean | undefined;
    /** The gate currently rendered, to skip rebuilding an unchanged one. */
    private lastGate: CookbotGate | undefined;
    /** The last real gate reported in cookbot_gate_shown ('loading' is never reported). */
    private lastTrackedGate: CookbotGate | undefined;
    /**
     * When a signed-out user chose "Start 7-day free trial": go straight on to
     * checkout after login. Expires after TRIAL_CONTINUATION_TTL_MS.
     */
    private trialRequestedAt: number | undefined;
    /** Timer for the 'loading' fallback; runs at most once per stretch of loading. */
    private loadingFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    private loadingFallbackArmed = false;
    /** Set when the plan still wasn't known after the fallback's refresh. */
    private planUnavailable = false;
    private gateOverlay: HTMLDivElement;
    private webBaseUrl: string = DEFAULT_WEB_BASE_URL;

    @inject(CookbotUsageService)
    protected readonly cookbotUsageService: CookbotUsageService;

    private quotaBanner: HTMLDivElement;
    private quotaBannerState: CookbotQuotaBannerState | undefined;
    private exchangeCostNote: HTMLDivElement;
    /** The reading the next exchange's cost is measured against. */
    private lastUsage: CookbotUsageStats | undefined;
    private readonly usageTracking = new DisposableCollection();
    private usageRequestSeq = 0;

    @postConstruct()
    protected override init(): void {
        super.init();

        // A question asked before a recipe folder was open survives the
        // reload that opening one causes. Prefill only; never auto-send.
        const pendingPrompt = typeof window !== 'undefined' ? takePendingPrompt(window.localStorage) : undefined;
        if (pendingPrompt) {
            this.inputWidget.initialValue = pendingPrompt;
        }

        this.gateOverlay = document.createElement('div');
        this.gateOverlay.className = 'ai-chat-gate-overlay';
        this.gateOverlay.style.display = 'none';
        this.node.prepend(this.gateOverlay);

        this.quotaBanner = document.createElement('div');
        this.quotaBanner.className = 'ai-chat-quota-banner';
        this.quotaBanner.style.display = 'none';
        this.quotaBanner.setAttribute('role', 'status');
        this.exchangeCostNote = document.createElement('div');
        this.exchangeCostNote.className = 'ai-chat-exchange-cost';
        this.exchangeCostNote.style.display = 'none';
        this.exchangeCostNote.setAttribute('role', 'status');

        this.trackModelForUsage(this.chatSession.model);
        this.toDispose.push(this.chatService.onSessionEvent(event => {
            // Runs after the base class's own listener, so chatSession is
            // already switched to the new active session here.
            if (isActiveSessionChangedEvent(event)) {
                this.trackModelForUsage(this.chatSession.model);
            }
        }));
        this.toDispose.push(this.usageTracking);

        this.toDispose.push(Disposable.create(() => this.clearLoadingFallback()));
        this.checkAiFeature();
        this.toDispose.push(this.authContribution.onDidChangeAuth(state => {
            if (state.status === 'logged-out') {
                this.trialRequestedAt = undefined;
            }
            this.checkAiFeature();
        }));
        this.toDispose.push(this.subscriptionFrontendService.onDidChangeSubscription(() => {
            this.checkAiFeature();
        }));

        // Mirror the Node-side services' WEB_BASE_URL override so the
        // pricing-page fallback in startUpgradeFlow points at the same backend
        // during local dev.
        this.envVariablesServer.getValue('WEB_BASE_URL').then(envVar => {
            if (envVar?.value) {
                this.webBaseUrl = envVar.value;
            }
        });
    }

    /**
     * Synchronous on purpose: everything comes from the frontend caches, which
     * fire change events whenever they update, so no await can race a newer call.
     */
    private checkAiFeature(): void {
        this.authState = this.authContribution.authState;
        const loggedIn = this.authState.status === 'logged-in';
        const sub = loggedIn ? this.subscriptionFrontendService.subscription : undefined;
        this.hasAiFeature = sub?.features.includes('ai') ?? false;
        this.trialEligible = sub?.trialEligible;
        if (!loggedIn || sub) {
            this.planUnavailable = false;
        }
        this.updateGating();

        const next = decideTrialContinuation({
            requestedAt: this.trialRequestedAt,
            now: Date.now(),
            loggedIn,
            hasAi: this.hasAiFeature,
            trialEligible: this.trialEligible,
        });
        if (next !== 'wait') {
            // Consumed, dropped or expired. Clear before starting so an
            // overlapping call can't open checkout twice.
            this.trialRequestedAt = undefined;
        }
        if (next === 'start') {
            this.startUpgradeFlow();
        }
    }

    private updateGating(): void {
        const authKnown = this.authContribution.authStateKnown;
        const gate = computeCookbotGate({
            authKnown,
            loggedIn: this.authState.status === 'logged-in',
            hasAi: this.hasAiFeature,
            trialEligible: this.trialEligible,
            planUnavailable: this.planUnavailable,
        });
        if (gate === 'loading' && authKnown) {
            // Waiting for the plan (not for auth): retry, then fall back.
            this.armLoadingFallback();
        } else if (gate !== 'plan_unknown') {
            this.clearLoadingFallback();
            this.loadingFallbackArmed = false;
        }
        if (gate === this.lastGate) {
            if (gate === 'open') {
                this.refreshUsage();
            }
            return;
        }
        this.lastGate = gate;
        if (gate !== 'loading') {
            if (gate !== 'open' && gate !== this.lastTrackedGate) {
                this.usageEvents.track('cookbot_gate_shown', {
                    state: gate === 'signed_out' ? 'signed_out' : 'no_pro',
                    // Eligibility isn't known when signed out or when the plan failed to load.
                    trial_eligible: gate === 'signed_out' || gate === 'plan_unknown' ? 'unknown' : gate !== 'upgrade',
                });
            }
            this.lastTrackedGate = gate;
        }
        if (gate !== 'open') {
            this.showGateScreen(gate);
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

    /**
     * If the plan hasn't loaded after LOADING_FALLBACK_MS, retry once; if it's
     * still unknown, show the trial offer rather than a spinner forever. A
     * subscription arriving later takes over through the normal change event.
     */
    private armLoadingFallback(): void {
        if (this.loadingFallbackArmed) {
            return;
        }
        this.loadingFallbackArmed = true;
        this.loadingFallbackTimer = setTimeout(async () => {
            this.loadingFallbackTimer = undefined;
            try {
                await this.subscriptionFrontendService.refresh();
            } catch {
                // fall through to the check below
            }
            if (this.isDisposed || !this.loadingFallbackArmed) {
                return;
            }
            if (this.authContribution.authState.status === 'logged-in' && !this.subscriptionFrontendService.subscription) {
                this.planUnavailable = true;
                this.checkAiFeature();
            }
        }, LOADING_FALLBACK_MS);
    }

    private clearLoadingFallback(): void {
        if (this.loadingFallbackTimer !== undefined) {
            clearTimeout(this.loadingFallbackTimer);
            this.loadingFallbackTimer = undefined;
        }
    }

    private showGateScreen(gate: Exclude<CookbotGate, 'open'>): void {
        const layout = this.layout;
        if (layout) {
            for (const widget of layout) {
                widget.hide();
            }
        }
        this.gateOverlay.style.display = 'flex';
        this.gateOverlay.replaceChildren();
        this.quotaBanner.style.display = 'none';

        const el = (cls: string, text: string, tag = 'div'): HTMLElement => {
            const node = document.createElement(tag);
            node.className = cls;
            node.textContent = text;
            return node;
        };
        const icon = el('ai-chat-gate-icon', '\u{1F916}');
        icon.setAttribute('aria-hidden', 'true');
        const heading = (text: string): HTMLElement => {
            const node = el('ai-chat-gate-title', text);
            node.setAttribute('role', 'heading');
            node.setAttribute('aria-level', '2');
            return node;
        };

        if (gate === 'loading') {
            const loadingTitle = heading(nls.localize('theia/ai-chat/gate/checkingPlan', 'Checking your plan…'));
            loadingTitle.setAttribute('aria-live', 'polite');
            this.gateOverlay.append(icon, loadingTitle);
            return;
        }

        // 'plan_unknown' shows the trial offer: checkout on cook.md knows the real plan.
        const offer = proOfferCopy(gate !== 'upgrade');
        const title = heading(offer.headline);
        const message = el('ai-chat-gate-message', offer.body);
        const button = el('theia-button main', '', 'button') as HTMLButtonElement;
        button.type = 'button';

        if (gate === 'signed_out') {
            button.textContent = nls.localize('theia/ai-chat/gate/startTrial', 'Start 7-day free trial');
            button.addEventListener('click', () => {
                this.usageEvents.track('cookbot_gate_clicked', { action: 'trial' });
                this.trialRequestedAt = Date.now();
                this.commandService.executeCommand(CookmdLoginCommand.id, 'cookbot_trial');
            });
            const loginText = nls.localize('theia/ai-chat/gate/haveAccount', 'I already have an account: Log in');
            const login = el('ai-chat-gate-note ai-chat-gate-link', loginText, 'button') as HTMLButtonElement;
            login.type = 'button';
            login.addEventListener('click', () => {
                this.usageEvents.track('cookbot_gate_clicked', { action: 'login' });
                // A plain login cancels an earlier "Start trial" choice.
                this.trialRequestedAt = undefined;
                this.commandService.executeCommand(CookmdLoginCommand.id, 'cookbot_login');
            });
            this.gateOverlay.append(icon, title, message, button, login);
            return;
        }

        button.textContent = offer.button;
        button.addEventListener('click', () => {
            this.usageEvents.track('cookbot_gate_clicked', { action: offer.action });
            this.startUpgradeFlow();
        });
        this.gateOverlay.append(icon, title, message, button, el('ai-chat-gate-note', offer.note));
    }

    private async startUpgradeFlow(): Promise<void> {
        let url: string;
        try {
            url = await this.subscriptionFrontendService.startUpgradeFlow('editor_cookbot');
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

    /** Put text in the input without sending it. Works before and after the input editor mounts. */
    prefillPrompt(text: string): void {
        const editor = this.inputWidget.editor;
        if (editor) {
            editor.getControl().setValue(text);
            editor.focus();
        } else {
            this.inputWidget.initialValue = text;
        }
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // The banner sits between the chat tree and the input inside the
        // widget's flex column, outside the PanelLayout's own widgets.
        if (!this.quotaBanner.isConnected) {
            this.node.insertBefore(this.quotaBanner, this.inputWidget.node);
        }
        if (!this.exchangeCostNote.isConnected) {
            this.node.insertBefore(this.exchangeCostNote, this.quotaBanner);
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
                if (this.firstRunState.markCookbotUsed()) {
                    this.usageEvents.track('editor_cookbot_first_message', {});
                }
                // A note about the previous exchange is stale once the next one starts.
                this.exchangeCostNote.style.display = 'none';
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
            this.refreshUsage(true);
            return;
        }
        const listener = response.onDidChange(() => {
            if (response.isComplete || response.isCanceled || response.isError) {
                listener.dispose();
                this.refreshUsage(true);
            }
        });
        this.usageTracking.push(listener);
    }

    /**
     * @param afterExchange the refresh follows a finished exchange, so the
     * change since the last reading is what that exchange cost.
     */
    private refreshUsage(afterExchange = false): void {
        if (this.authState.status !== 'logged-in' || !this.hasAiFeature) {
            this.quotaBanner.style.display = 'none';
            this.exchangeCostNote.style.display = 'none';
            return;
        }
        const seq = ++this.usageRequestSeq;
        this.cookbotUsageService.getUsage().then(usageStats => {
            if (seq !== this.usageRequestSeq || this.isDisposed) {
                return;
            }
            this.quotaBannerState = computeQuotaBannerState(usageStats);
            this.renderQuotaBanner();
            if (afterExchange) {
                this.renderExchangeCost(usageStats);
            }
            this.lastUsage = usageStats ?? this.lastUsage;
        }).catch(error => {
            // The backend already collapses expected failures to undefined;
            // anything surfacing here is RPC noise not worth a banner change.
            console.info('[Chat] Could not refresh Cookbot usage:', error);
        });
    }

    private renderExchangeCost(usageStats: CookbotUsageStats | undefined): void {
        const cost = computeExchangeCost(this.lastUsage, usageStats);
        if (!cost) {
            this.exchangeCostNote.style.display = 'none';
            return;
        }
        this.exchangeCostNote.textContent = nls.localize('theia/ai-chat/quota/exchangeCost',
            'That request used {0}% of your monthly Cookbot AI credits · {1}% left.', cost.percentOfCycle, cost.percentLeft);
        this.exchangeCostNote.style.display = 'block';
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
