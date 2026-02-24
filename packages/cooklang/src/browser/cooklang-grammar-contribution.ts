// Copyright (C) 2026 Cooklang contributors
// SPDX-License-Identifier: MIT

import { injectable } from '@theia/core/shared/inversify';
import {
    GrammarDefinition,
    GrammarDefinitionProvider,
    LanguageGrammarDefinitionContribution,
    TextmateRegistry
} from '@theia/monaco/lib/browser/textmate';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE, AISLE_CONF_LANGUAGE_ID, AISLE_CONF_TEXTMATE_SCOPE } from '../common';

@injectable()
export class CooklangGrammarContribution implements LanguageGrammarDefinitionContribution {

    readonly config: monaco.languages.LanguageConfiguration = {
        comments: {
            lineComment: '--'
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' }
        ]
    };

    readonly aisleConfConfig: monaco.languages.LanguageConfiguration = {
        comments: {
            lineComment: '#'
        },
        brackets: [
            ['[', ']']
        ],
        autoClosingPairs: [
            { open: '[', close: ']' }
        ],
        surroundingPairs: [
            { open: '[', close: ']' }
        ]
    };

    registerTextmateLanguage(registry: TextmateRegistry): void {
        monaco.languages.register({
            id: COOKLANG_LANGUAGE_ID,
            aliases: ['Cooklang', 'cooklang'],
            extensions: ['.cook', '.menu'],
            filenames: []
        });

        monaco.languages.setLanguageConfiguration(COOKLANG_LANGUAGE_ID, this.config);

        const grammar = require('../../data/cooklang.tmLanguage.json');
        const grammarDefinitionProvider: GrammarDefinitionProvider = {
            getGrammarDefinition(): Promise<GrammarDefinition> {
                return Promise.resolve({
                    format: 'json',
                    content: grammar
                });
            }
        };

        registry.registerTextmateGrammarScope(COOKLANG_TEXTMATE_SCOPE, grammarDefinitionProvider);
        registry.mapLanguageIdToTextmateGrammar(COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE);

        // Aisle config
        monaco.languages.register({
            id: AISLE_CONF_LANGUAGE_ID,
            aliases: ['Aisle Config', 'aisle-conf'],
            extensions: ['.conf'],
            filenames: ['aisle.conf']
        });

        monaco.languages.setLanguageConfiguration(AISLE_CONF_LANGUAGE_ID, this.aisleConfConfig);

        const aisleConfGrammar = require('../../data/aisle-conf.tmLanguage.json');
        const aisleConfGrammarProvider: GrammarDefinitionProvider = {
            getGrammarDefinition(): Promise<GrammarDefinition> {
                return Promise.resolve({
                    format: 'json',
                    content: aisleConfGrammar
                });
            }
        };

        registry.registerTextmateGrammarScope(AISLE_CONF_TEXTMATE_SCOPE, aisleConfGrammarProvider);
        registry.mapLanguageIdToTextmateGrammar(AISLE_CONF_LANGUAGE_ID, AISLE_CONF_TEXTMATE_SCOPE);
    }
}
