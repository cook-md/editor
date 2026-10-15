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
import { AbstractStreamParsingChatAgent, ChatModel, CommandChatResponseContentImpl, MutableChatRequestModel } from '@theia/ai-chat/lib/common';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { Navigatable } from '@theia/core/lib/browser/navigatable-types';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { nls } from '@theia/core/lib/common/nls';
import { CookbotError } from '../common/cookbot-error';
import { LanguageModelMessage, LanguageModelRequirement, ToolInvocationRegistry } from '@theia/ai-core/lib/common';

/** Request data key holding the workspace-relative path of the tab active when the message was sent. */
const ACTIVE_FILE_KEY = 'cookbotActiveFile';

@injectable()
export class CookbotChatAgent extends AbstractStreamParsingChatAgent {

    override id = 'cookbot';
    override name = 'Cookbot';
    override description = 'AI assistant for Cooklang recipe writing, meal planning, and recipe management';
    override languageModelRequirements: LanguageModelRequirement[] = [
        {
            purpose: 'chat',
            identifier: 'cookbot/claude',
        },
    ];
    protected override defaultLanguageModelPurpose = 'chat';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry: ToolInvocationRegistry;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @postConstruct()
    override init(): void {
        super.init();
        this.systemPromptId = 'cookbot-system';
        this.prompts = [{
            id: 'cookbot-system',
            defaultVariant: {
                id: 'cookbot-system-default',
                template: 'You are a helpful Cooklang recipe assistant integrated into a desktop editor.',
            },
        }];
        // Include all registered tools (file ops + server tools) in every request
        this.additionalToolRequests = this.toolRegistry.getAllFunctions();
        this.toolRegistry.onDidChange(() => {
            this.additionalToolRequests = this.toolRegistry.getAllFunctions();
        });
    }

    override async invoke(request: MutableChatRequestModel): Promise<void> {
        // Captured once per request, so the history re-sent on later turns stays
        // identical rather than following whatever tab is active by then.
        const activeFile = await this.getActiveFilePath();
        if (activeFile) {
            request.addData(ACTIVE_FILE_KEY, activeFile);
        }
        return super.invoke(request);
    }

    /**
     * The workspace-relative path of the selected main-area tab. Uses
     * `getCurrentWidget('main')`: recipe/menu previews are not focusable, so
     * `currentWidget` would miss them.
     */
    protected async getActiveFilePath(): Promise<string | undefined> {
        const widget = this.shell.getCurrentWidget('main');
        const uri = Navigatable.is(widget) ? widget.getResourceUri() : undefined;
        if (!uri) {
            return undefined;
        }
        return this.workspaceService.getWorkspaceRelativePath(uri);
    }

    /** Appends the active tab to each user message sent while one was open. */
    protected override async getMessages(model: ChatModel, includeResponseInProgress = false): Promise<LanguageModelMessage[]> {
        const messages = await super.getMessages(model, includeResponseInProgress);
        let next = 0;
        for (const request of model.getRequests()) {
            const text = request.message.parts.map(part => part.promptText).join('');
            if (!text) {
                continue;
            }
            const index = messages.findIndex((message, i) => i >= next && message.actor === 'user'
                && LanguageModelMessage.isTextMessage(message) && message.text === text);
            if (index < 0) {
                continue;
            }
            next = index + 1;
            const activeFile = request.data?.[ACTIVE_FILE_KEY];
            if (typeof activeFile === 'string') {
                messages[index] = { ...messages[index], text: `${text}\n\n[Active editor tab: ${activeFile}]` } as LanguageModelMessage;
            }
        }
        return messages;
    }

    protected override handleError(request: MutableChatRequestModel, error: Error): void {
        if (CookbotError.isLoginRequired(error)) {
            // `from` attributes the sign-in to the re-auth prompt, like the other login entry points.
            request.response.response.addContent(new CommandChatResponseContentImpl(
                { id: 'cooked.login', label: nls.localize('theia/cooklang-ai/loginAgain', 'Log in again') },
                undefined,
                ['cookbot_reauth']
            ));
        }
        // After the button: super marks the response as errored, and content must not be added to it afterwards.
        super.handleError(request, error);
    }
}
