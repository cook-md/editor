import { ContainerModule } from '@theia/core/shared/inversify';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import { CooklangGrammarContribution } from './cooklang-grammar-contribution';

export default new ContainerModule(bind => {
    bind(CooklangGrammarContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(CooklangGrammarContribution);
});
