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
