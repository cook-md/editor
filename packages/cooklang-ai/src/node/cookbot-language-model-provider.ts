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
