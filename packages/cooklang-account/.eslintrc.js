/** @type {import('eslint').Linter.Config} */
module.exports = {
    extends: [
        '../../configs/build.eslintrc.json'
    ],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: 'tsconfig.json'
    },
    rules: {
        '@typescript-eslint/tslint/config': [
            'error',
            {
                rules: {
                    'file-header': [
                        true,
                        {
                            'allow-single-line-comments': true,
                            'match': 'MIT License, which is available in the project root'
                        }
                    ],
                    'jsdoc-format': [
                        true,
                        'check-multiline-start'
                    ],
                    'one-line': [
                        true,
                        'check-open-brace',
                        'check-catch',
                        'check-else',
                        'check-whitespace'
                    ],
                    'typedef': [
                        true,
                        'call-signature',
                        'property-declaration'
                    ],
                    'whitespace': [
                        true,
                        'check-branch',
                        'check-decl',
                        'check-operator',
                        'check-separator',
                        'check-type'
                    ]
                }
            }
        ]
    }
};
