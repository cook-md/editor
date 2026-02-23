import { injectable } from '@theia/core/shared/inversify';
import {
    GrammarDefinition,
    GrammarDefinitionProvider,
    LanguageGrammarDefinitionContribution,
    TextmateRegistry
} from '@theia/monaco/lib/browser/textmate';
import * as monaco from '@theia/monaco-editor-core';
import { COOKLANG_LANGUAGE_ID, COOKLANG_TEXTMATE_SCOPE } from '../common';

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
    }
}
