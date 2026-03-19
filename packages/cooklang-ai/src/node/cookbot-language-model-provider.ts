// *****************************************************************************
// Copyright (C) 2026 and others.
//
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { LanguageModel } from '@theia/ai-core/lib/common';
import { CookbotLanguageModel } from './cookbot-language-model';

@injectable()
export class CookbotLanguageModelProvider {

    @inject(CookbotLanguageModel)
    protected readonly model: CookbotLanguageModel;

    async getModels(): Promise<LanguageModel[]> {
        return [this.model];
    }
}
