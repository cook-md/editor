// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { AbstractStreamParsingChatAgent } from '@theia/ai-chat/lib/common';
import { LanguageModelRequirement, ToolInvocationRegistry } from '@theia/ai-core/lib/common';

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
}
