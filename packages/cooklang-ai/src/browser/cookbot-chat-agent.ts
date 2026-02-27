// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { AbstractStreamParsingChatAgent } from '@theia/ai-chat/lib/common';
import { LanguageModelRequirement } from '@theia/ai-core/lib/common';

@injectable()
export class CookbotChatAgent extends AbstractStreamParsingChatAgent {

    override id = 'cookbot';
    override name = 'Cooklang Assistant';
    override description = 'AI assistant for Cooklang recipe writing, meal planning, and recipe management';
    override languageModelRequirements: LanguageModelRequirement[] = [
        {
            purpose: 'chat',
            identifier: 'cookbot/claude',
        },
    ];
    protected override defaultLanguageModelPurpose = 'chat';

    @postConstruct()
    override init(): void {
        super.init();
        this.systemPromptId = 'cookbot-system';
        this.prompts = [{
            id: 'cookbot-system',
            defaultVariant: {
                id: 'cookbot-system-default',
                template: `You are a helpful Cooklang recipe assistant. Help users write, edit, and manage recipes in Cooklang format.

Cooklang is a markup language for recipes. Key syntax:
- @ingredient{quantity%unit} for ingredients (e.g. @salt{1%tsp})
- #cookware{} for cookware (e.g. #pot{})
- ~timer{quantity%unit} for timers (e.g. ~{10%minutes})
- >> key: value for metadata
- -- for comments
- Steps are written as plain text with inline annotations.

When creating or editing recipes, always use proper Cooklang syntax.`,
            },
        }];
    }
}
