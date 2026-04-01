// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, CommandService } from '@theia/core/lib/common/command';
import { Emitter, Event } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { AuthService, AuthState } from '../common/auth-protocol';

const AUTH_STATUS_ID = 'cookbot-auth-status';
const AUTH_POLL_INTERVAL_MS = 2000;
const AUTH_POLL_MAX_ATTEMPTS = 150; // 5 minutes

export const CookmdLoginCommand: Command = {
    id: 'cookmd.login',
    label: 'Login',
};

export const CookmdLogoutCommand: Command = {
    id: 'cookmd.logout',
    label: 'Cook.md: Logout',
};

@injectable()
export class AuthContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(AuthService)
    protected readonly authService: AuthService;

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    private _authState: AuthState = { status: 'logged-out' };
    private pollTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly onDidChangeAuthEmitter = new Emitter<AuthState>();
    readonly onDidChangeAuth: Event<AuthState> = this.onDidChangeAuthEmitter.event;

    get authState(): AuthState {
        return this._authState;
    }

    @postConstruct()
    protected init(): void {
        this.refreshAuthState();
    }

    async onStart(): Promise<void> {
        // FrontendApplicationContribution lifecycle — state already refreshed in init
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CookmdLoginCommand, {
            execute: () => this.doLogin(),
        });
        registry.registerCommand(CookmdLogoutCommand, {
            execute: () => this.doLogout(),
        });
        registry.registerCommand({ id: 'cookmd.manageSubscription' }, {
            execute: () => this.commandService.executeCommand('cookmd.openAccount'),
        });
    }

    private async refreshAuthState(): Promise<void> {
        try {
            this._authState = await this.authService.getAuthState();
        } catch {
            this._authState = { status: 'logged-out' };
        }
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (this._authState.status === 'logged-in') {
            this.statusBar.setElement(AUTH_STATUS_ID, {
                text: '$(account) Logged In',
                command: 'cookmd.manageSubscription',
                tooltip: nls.localize('theia/cooklang-account/manageSubscriptionTooltip', 'Manage Subscription'),
                alignment: StatusBarAlignment.LEFT,
                priority: 100,
            });
        } else {
            this.statusBar.setElement(AUTH_STATUS_ID, {
                text: `$(account) ${nls.localize('theia/cooklang-account/statusBarLogin', 'Login')}`,
                command: CookmdLoginCommand.id,
                tooltip: nls.localize('theia/cooklang-account/statusBarLoginTooltip', 'Click to login to Cook.md'),
                alignment: StatusBarAlignment.LEFT,
                priority: 100,
            });
        }
    }

    private async doLogin(): Promise<void> {
        try {
            const result = await this.authService.login();
            this.windowService.openNewWindow(result.authUrl, { external: true });
            this.startAuthPolling();
        } catch (err) {
            console.error('Cook.md login failed:', err);
        }
    }

    private async doLogout(): Promise<void> {
        try {
            await this.authService.logout();
            this._authState = { status: 'logged-out' };
            this.updateStatusBar();
            this.onDidChangeAuthEmitter.fire(this._authState);
        } catch (err) {
            console.error('Cook.md logout failed:', err);
        }
    }

    private startAuthPolling(): void {
        this.stopAuthPolling();
        let attempts = 0;
        const poll = async (): Promise<void> => {
            attempts++;
            if (attempts > AUTH_POLL_MAX_ATTEMPTS) {
                this.stopAuthPolling();
                return;
            }
            try {
                const state = await this.authService.getAuthState();
                if (state.status !== this._authState.status) {
                    this._authState = state;
                    this.updateStatusBar();
                    this.onDidChangeAuthEmitter.fire(this._authState);
                    this.stopAuthPolling();
                    return;
                }
            } catch {
                // Ignore polling errors
            }
            this.pollTimer = setTimeout(poll, AUTH_POLL_INTERVAL_MS);
        };
        this.pollTimer = setTimeout(poll, AUTH_POLL_INTERVAL_MS);
    }

    private stopAuthPolling(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
}
