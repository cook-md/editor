// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CookbotAuthService, AuthState } from '../common/cookbot-auth-protocol';

const AUTH_STATUS_ID = 'cookbot-auth-status';

export const CookmdLoginCommand: Command = {
    id: 'cookmd.login',
    label: 'Cook.md: Login',
};

export const CookmdLogoutCommand: Command = {
    id: 'cookmd.logout',
    label: 'Cook.md: Logout',
};

@injectable()
export class CookbotAuthContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(CookbotAuthService)
    protected readonly authService: CookbotAuthService;

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    private authState: AuthState = { status: 'logged-out' };
    private loginPollTimer: ReturnType<typeof setInterval> | undefined;

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
    }

    private async refreshAuthState(): Promise<void> {
        try {
            this.authState = await this.authService.getAuthState();
        } catch {
            this.authState = { status: 'logged-out' };
        }
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (this.authState.status === 'logged-in') {
            this.statusBar.setElement(AUTH_STATUS_ID, {
                text: `$(account) ${this.authState.email}`,
                command: CookmdLogoutCommand.id,
                tooltip: 'Cook.md: Logout',
                alignment: StatusBarAlignment.LEFT,
                priority: 100,
            });
        } else {
            this.statusBar.setElement(AUTH_STATUS_ID, {
                text: '$(account) Cook.md: Login',
                command: CookmdLoginCommand.id,
                tooltip: 'Click to login to Cook.md',
                alignment: StatusBarAlignment.LEFT,
                priority: 100,
            });
        }
    }

    private async doLogin(): Promise<void> {
        try {
            const result = await this.authService.login();
            this.windowService.openNewWindow(result.authUrl, { external: true });
            this.startLoginPolling();
        } catch (err) {
            console.error('Cook.md login failed:', err);
        }
    }

    private async doLogout(): Promise<void> {
        try {
            await this.authService.logout();
            this.authState = { status: 'logged-out' };
            this.updateStatusBar();
        } catch (err) {
            console.error('Cook.md logout failed:', err);
        }
    }

    private startLoginPolling(): void {
        this.stopLoginPolling();
        this.loginPollTimer = setInterval(async () => {
            try {
                const state = await this.authService.getAuthState();
                if (state.status === 'logged-in') {
                    this.authState = state;
                    this.updateStatusBar();
                    this.stopLoginPolling();
                }
            } catch {
                // Polling error, will retry on next interval
            }
        }, 2000);
    }

    private stopLoginPolling(): void {
        if (this.loginPollTimer) {
            clearInterval(this.loginPollTimer);
            this.loginPollTimer = undefined;
        }
    }
}
