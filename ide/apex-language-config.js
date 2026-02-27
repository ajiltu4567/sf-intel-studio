/**
 * Apex Language Configuration for Monaco Editor
 * Provides syntax highlighting, bracket matching, and editor behaviors for Salesforce Apex
 * Version: v3.2.0 (Beta 6)
 */

// Apex Language Definition
export const apexLanguageConfig = {
    // Language ID
    id: 'apex',

    // File extensions
    extensions: ['.cls', '.trigger'],

    // Monarch Tokenizer for Syntax Highlighting
    monarchTokensProvider: {
        defaultToken: '',
        tokenPostfix: '.apex',

        // Keywords
        keywords: [
            // Control Flow
            'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
            // Class/Interface
            'class', 'interface', 'enum', 'extends', 'implements', 'new', 'this', 'super',
            // Access Modifiers
            'public', 'private', 'protected', 'global', 'with', 'without', 'sharing',
            // Data Types
            'void', 'boolean', 'integer', 'long', 'double', 'decimal', 'string', 'blob', 'date', 'datetime', 'time', 'id',
            'object', 'list', 'set', 'map',
            // Other
            'static', 'final', 'abstract', 'virtual', 'override', 'transient', 'webservice',
            'testmethod', 'instanceof', 'try', 'catch', 'finally', 'throw',
            // DML
            'insert', 'update', 'delete', 'undelete', 'upsert', 'merge',
            // SOQL/SOSL
            'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'null',
            'order', 'by', 'asc', 'desc', 'limit', 'offset', 'group',
            'having', 'count', 'sum', 'avg', 'min', 'max',
            'find', 'returning',
            // Trigger Keywords
            'trigger', 'on', 'before', 'after', 'trigger.new', 'trigger.old', 'trigger.newmap', 'trigger.oldmap',
            'trigger.isinsert', 'trigger.isupdate', 'trigger.isdelete', 'trigger.isundelete',
            'trigger.isbefore', 'trigger.isafter', 'trigger.isexecuting'
        ],

        // Standard Library Classes
        typeKeywords: [
            'System', 'Database', 'Schema', 'Test', 'ApexPages', 'Limits', 'UserInfo',
            'PageReference', 'SelectOption', 'Savepoint', 'Exception', 'DmlException',
            'QueryException', 'SObjectException', 'HttpRequest', 'HttpResponse', 'Http',
            'JSON', 'JSONParser', 'JSONGenerator', 'Blob', 'Crypto', 'EncodingUtil'
        ],

        // Boolean literals
        constants: ['true', 'false', 'null'],

        // Operators
        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
            '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
            '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
            '%=', '<<=', '>>=', '>>>='
        ],

        // Symbols
        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        // Escape sequences
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        // Tokenizer rules
        tokenizer: {
            root: [
                // Identifiers and keywords
                [/[a-z_$][\w$]*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@typeKeywords': 'type',
                        '@constants': 'constant',
                        '@default': 'identifier'
                    }
                }],
                [/[A-Z][\w\$]*/, 'type.identifier'],

                // Whitespace
                { include: '@whitespace' },

                // Delimiters and operators
                [/[{}()\[\]]/, '@brackets'],
                [/[<>](?!@symbols)/, '@brackets'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],

                // Numbers
                [/\d*\.\d+([eE][\-+]?\d+)?[fFdD]?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+[Ll]?/, 'number.hex'],
                [/\d+[lLfFdD]?/, 'number'],

                // Delimiter: after number because of .\d floats
                [/[;,.]/, 'delimiter'],

                // Strings
                [/'([^'\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
                [/'/, 'string', '@string'],

                // Annotations
                [/@\w+/, 'annotation'],

                // SOQL inline
                [/\[/, 'soql.bracket', '@soql']
            ],

            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment'],
            ],

            comment: [
                [/[^\/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],

            string: [
                [/[^\\']+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'],
                [/'/, 'string', '@pop']
            ],

            soql: [
                [/\]/, 'soql.bracket', '@pop'],
                [/\b(SELECT|FROM|WHERE|ORDER BY|LIMIT|OFFSET)\b/i, 'keyword.soql'],
                { include: '@root' }
            ]
        }
    },

    // Language Configuration
    languageConfiguration: {
        comments: {
            lineComment: '//',
            blockComment: ['/*', '*/']
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: "'", close: "'", notIn: ['string', 'comment'] },
            { open: '/*', close: ' */', notIn: ['string'] }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: "'", close: "'" },
            { open: '<', close: '>' }
        ],
        folding: {
            markers: {
                start: new RegExp('^\\s*//\\s*#?region\\b'),
                end: new RegExp('^\\s*//\\s*#?endregion\\b')
            }
        },
        wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        indentationRules: {
            increaseIndentPattern: new RegExp('^((?!.*?\\/\\*).*\\*\\/)?.*[\\{\\[]\\s*$'),
            decreaseIndentPattern: new RegExp('^\\s*[\\}\\]].*$')
        }
    }
};

/**
 * Register Apex Language with Monaco
 * @param {object} monaco - Monaco editor instance
 */
export function registerApexLanguage(monaco) {
    // Register the language
    monaco.languages.register({ id: apexLanguageConfig.id });

    // Set the tokens provider (syntax highlighting)
    monaco.languages.setMonarchTokensProvider(
        apexLanguageConfig.id,
        apexLanguageConfig.monarchTokensProvider
    );

    // Set the language configuration
    monaco.languages.setLanguageConfiguration(
        apexLanguageConfig.id,
        apexLanguageConfig.languageConfiguration
    );

    console.log('[Apex] Language registered with Monaco ✓');
}
