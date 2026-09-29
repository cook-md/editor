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

import * as React from '@theia/core/shared/react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { codicon, Message } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { environment, isOSX } from '@theia/core/lib/common';
import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { UsageEventsFrontend } from '@theia/cooklang-account/lib/browser/usage-events-frontend';
import { SubscriptionFrontendService } from '@theia/cooklang-account/lib/browser/subscription-frontend-service';
import {
    childPath, computeChecklist, ChecklistStep, ChecklistStepId, findFirstRecipe, isRecipePath, newlyCompleted
} from './welcome-checklist';
import { FirstRunState, RENDER_REPORT_COMMAND_ID } from './first-run-state';
import { CooklangChatViewWidget } from './cooklang-chat-view-widget';
import '../../src/browser/style/welcome.css';

const PLAN_PROMPT = 'Plan my dinners for this week from my recipes';
const IMPORT_COMMAND_ID = 'cooklang.import.open';
/** File-change events arrive in bursts; wait this long after the last one before rescanning. */
const RESCAN_DEBOUNCE_MS = 500;

type ChecklistResult = ReturnType<typeof computeChecklist>;

/**
 * The Cooklang welcome page: a four-step checklist leading to CookBot, above the Recent section.
 * Steps are ticked from real app state (see computeChecklist); this class is only glue.
 */
@injectable()
export class CookWelcomeWidget extends GettingStartedWidget {

    /** `editor_welcome_shown` fires once per launch, even if the page is closed and reopened. */
    protected static welcomeTrackedThisLaunch = false;

    @inject(FileService) protected readonly fileService: FileService;
    @inject(EditorManager) protected readonly editorManager: EditorManager;
    @inject(AIChatContribution) protected readonly chatContribution: AIChatContribution;
    @inject(UsageEventsFrontend) protected readonly usageEvents: UsageEventsFrontend;
    @inject(SubscriptionFrontendService) protected readonly subscriptions: SubscriptionFrontendService;
    @inject(FirstRunState) protected readonly firstRunState: FirstRunState;
    @inject(FrontendApplicationStateService) protected readonly appState: FrontendApplicationStateService;

    /** First `.cook` file found in the workspace roots (bounded search). */
    protected firstRecipe: URI | undefined;
    protected state: ChecklistResult | undefined;
    /** Undefined until the baseline is taken: steps done at startup never fire `editor_checklist_completed`. */
    protected previousDone: Set<ChecklistStepId> | undefined;
    protected scanGeneration = 0;
    protected rescanTimer: number | undefined;
    protected webBaseUrl = 'https://cook.md';

    protected override async doInit(): Promise<void> {
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => this.refreshRecipes()));
        this.toDispose.push(this.fileService.onDidFilesChange(e => {
            // Only a deletion can lose the recipe we found; only an addition can create the first one.
            if (this.firstRecipe ? e.gotDeleted() : e.gotAdded()) {
                this.scheduleRescan();
            }
        }));
        this.toDispose.push(this.firstRunState.onDidChange(() => this.recompute()));
        this.toDispose.push(this.subscriptions.onDidChangeSubscription(() => this.update()));
        this.toDispose.push(this.editorManager.onCreated(widget => {
            this.recompute();
            // `all` drops the widget only after dispose finishes, so recompute on the next tick.
            widget.disposed.connect(() => setTimeout(() => this.recompute(), 0));
        }));
        this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => this.recompute()));
        this.toDispose.push(Disposable.create(() => this.cancelRescan()));

        await super.doInit();
        try {
            const env = await this.environments.getValue('WEB_BASE_URL');
            if (env?.value) {
                this.webBaseUrl = env.value;
            }
        } catch {
            // keep the default
        }
        this.recompute();
        await Promise.all([this.refreshRecipes(), this.appState.reachedState('ready')]);
        this.previousDone = this.doneSteps(this.state ?? this.computeState());
    }

    protected scheduleRescan(): void {
        this.cancelRescan();
        this.rescanTimer = window.setTimeout(() => {
            this.rescanTimer = undefined;
            this.refreshRecipes();
        }, RESCAN_DEBOUNCE_MS);
    }

    protected cancelRescan(): void {
        if (this.rescanTimer !== undefined) {
            window.clearTimeout(this.rescanTimer);
            this.rescanTimer = undefined;
        }
    }

    /** Rescans the roots. A scan that a newer one has superseded drops its result. */
    protected async refreshRecipes(): Promise<void> {
        const generation = ++this.scanGeneration;
        let found: URI | undefined;
        try {
            const roots = (await this.workspaceService.roots).filter(r => r.isDirectory);
            // findFirstRecipe works on path strings; keep each path's real URI (scheme, authority,
            // Windows drive) so the result can be opened without rebuilding a URI from a path.
            const uris = new Map<string, URI>(roots.map(r => [r.resource.path.toString(), r.resource]));
            const path = await findFirstRecipe(async dir => {
                const uri = uris.get(dir);
                if (!uri) {
                    return [];
                }
                const stat = await this.fileService.resolve(uri);
                return (stat.children ?? []).map(c => {
                    uris.set(childPath(dir, c.name), c.resource);
                    return { name: c.name, dir: c.isDirectory };
                });
            }, [...uris.keys()]);
            found = path !== undefined ? uris.get(path) : undefined;
        } catch (err) {
            console.warn('Welcome checklist: recipe search failed', err);
        }
        if (generation !== this.scanGeneration || this.isDisposed) {
            return;
        }
        this.firstRecipe = found;
        this.recompute();
    }

    /** An open `.cook` editor, so a folder too big for the bounded search still counts as having recipes. */
    protected openRecipe(): URI | undefined {
        return this.editorManager.all
            .map(w => w.getResourceUri())
            .find(uri => uri !== undefined && isRecipePath(uri.path.toString()));
    }

    protected computeState(): ChecklistResult {
        return computeChecklist({
            folderOpen: this.workspaceService.opened,
            hasRecipes: this.firstRecipe !== undefined || this.openRecipe() !== undefined,
            cookbotUsed: this.firstRunState.flags.cookbotUsed,
            reportRendered: this.firstRunState.flags.reportRendered,
        });
    }

    protected doneSteps(result: ChecklistResult): Set<ChecklistStepId> {
        return new Set(result.steps.filter(s => s.done).map(s => s.id));
    }

    /** Recomputes the steps, reports transitions to done (after the baseline), and re-renders. */
    protected recompute(): void {
        if (this.isDisposed) {
            return;
        }
        this.state = this.computeState();
        if (this.previousDone) {
            const done = this.doneSteps(this.state);
            for (const step of newlyCompleted(this.previousDone, done)) {
                this.usageEvents.track('editor_checklist_completed', { step });
            }
            this.previousDone = done;
        }
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        if (!CookWelcomeWidget.welcomeTrackedThisLaunch) {
            CookWelcomeWidget.welcomeTrackedThisLaunch = true;
            this.usageEvents.track('editor_welcome_shown', { first_run: this.firstRunState.flags.takeFirstWelcome() });
        }
    }

    protected override render(): React.ReactNode {
        const { steps, allDone } = this.state ?? this.computeState();
        return <div className='gs-container'>
            <div className='gs-content-container'>
                {this.renderHeader()}
                <hr className='gs-hr' />
                {!allDone && <div className='flex-grid'><div className='col'>{this.renderChecklist(steps)}</div></div>}
                <div className='flex-grid'><div className='col'>{this.renderRecentWorkspaces()}</div></div>
                <div className='flex-grid'><div className='col'>{this.renderVersion()}</div></div>
            </div>
            <div className='gs-preference-container'>{this.renderPreferences()}</div>
        </div>;
    }

    protected renderChecklist(steps: ChecklistStep[]): React.ReactNode {
        const step = (id: ChecklistStepId): ChecklistStep => steps.find(s => s.id === id)!;
        const trialLine = this.subscriptions.subscription?.features.includes('ai')
            ? undefined
            : nls.localize('theia/cooklang-branding/welcome/trialLine', 'Cook Pro, 7 days free');
        return <div className='gs-section cook-checklist'>
            <h3 className='gs-section-header'><i className={codicon('checklist')}></i>
                {nls.localize('theia/cooklang-branding/welcome/getStarted', 'Get started')}</h3>
            {this.renderStep(step('folder'), nls.localize('theia/cooklang-branding/welcome/folder', 'Pick your recipe folder'),
                [[nls.localize('theia/cooklang-branding/welcome/openFolder', 'Open folder'), 'folder', this.doPickFolder]])}
            {this.renderStep(step('recipes'), nls.localize('theia/cooklang-branding/welcome/recipes', 'Add recipes'),
                [[nls.localize('theia/cooklang-branding/welcome/import', 'Import from a URL or photo'), 'import', this.doImport],
                [nls.localize('theia/cooklang-branding/welcome/kickstart', 'Get a starter collection'), 'kickstart', this.doKickstart]],
                nls.localize('theia/cooklang-branding/welcome/kickstartHint', 'Kickstart downloads a ZIP: unzip it, then open the folder here.'))}
            {this.renderStep(step('cookbot'), nls.localize('theia/cooklang-branding/welcome/cookbot', 'Plan my week with CookBot'),
                [[nls.localize('theia/cooklang-branding/welcome/askCookbot', 'Ask CookBot'), 'cookbot', this.doCookbot]],
                step('cookbot').enabled ? trialLine : nls.localize('theia/cooklang-branding/welcome/addFirst', 'Add a few recipes first'))}
            {this.renderStep(step('report'), nls.localize('theia/cooklang-branding/welcome/report', 'Analyse with a report template'),
                [[nls.localize('theia/cooklang-branding/welcome/shoppingList', 'Make a shopping list'), 'report', this.doReport]])}
        </div>;
    }

    protected renderStep(s: ChecklistStep, label: string, actions: Array<[string, string, () => void]>, hint?: string): React.ReactNode {
        return <div className={`cook-step${s.done ? ' done' : ''}${s.enabled ? '' : ' disabled'}`} key={s.id}>
            <i className={codicon(s.done ? 'pass-filled' : 'circle-large-outline')}></i>
            <div className='cook-step-body'>
                <div className='cook-step-label'>{label}</div>
                {!s.done && s.enabled && <div className='cook-step-actions'>
                    {actions.map(([text, action, run]) => <a key={action} role='button' tabIndex={0}
                        onClick={() => this.runAction(action, run)}
                        onKeyDown={e => this.isEnterKey(e) && this.runAction(action, run)}>{text}</a>)}
                </div>}
                {!s.done && hint && <div className='cook-step-hint'>{hint}</div>}
            </div>
        </div>;
    }

    protected runAction(step: string, run: () => void): void {
        this.usageEvents.track('editor_checklist_clicked', { step });
        run();
    }

    protected doPickFolder = (): void => {
        const single = isOSX || !environment.electron.is();
        this.commandRegistry.executeCommand(single ? WorkspaceCommands.OPEN.id : WorkspaceCommands.OPEN_FOLDER.id);
    };

    protected doImport = (): void => {
        this.commandRegistry.executeCommand(IMPORT_COMMAND_ID);
    };

    protected doKickstart = (): void => {
        this.windowService.openNewWindow(`${this.webBaseUrl}/kickstart?from=editor`, { external: true });
    };

    protected doCookbot = async (): Promise<void> => {
        const widget: unknown = await this.chatContribution.openView({ activate: true, reveal: true });
        if (widget instanceof CooklangChatViewWidget) {
            widget.prefillPrompt(PLAN_PROMPT);
        }
    };

    protected doReport = async (): Promise<void> => {
        const recipe = this.firstRecipe ?? this.openRecipe();
        if (!recipe) {
            return;
        }
        await this.editorManager.open(recipe, { mode: 'activate' });
        await this.commandRegistry.executeCommand(RENDER_REPORT_COMMAND_ID);
    };
}
