/**
 * SF-Intel Studio - Monaco Editor Loader
 * Loads and configures Monaco Editor for Apex development
 * Now using locally bundled Monaco Editor (Manifest V3 compliant)
 */

import * as monaco from 'monaco-editor';

class MonacoLoader {
    constructor() {
        this.monacoLoaded = false;
        this.monaco = monaco;
    }

    /**
     * Initialize Monaco Editor (now synchronous since it's bundled)
     * @returns {Promise<void>}
     */
    async load() {
        if (this.monacoLoaded) {
            return Promise.resolve();
        }

        // Configure Monaco environment for Chrome extension
        self.MonacoEnvironment = {
            getWorkerUrl: function (moduleId, label) {
                // Use extension-local worker files
                return chrome.runtime.getURL('dist/chunks/editor.worker.js');
            }
        };

        console.log('[Monaco] Loaded successfully from local bundle');
        this.monacoLoaded = true;
        this.configureApexLanguage();

        return Promise.resolve();
    }

    /**
     * Configure Apex language support
     */
    configureApexLanguage() {
        // Register Apex language
        monaco.languages.register({ id: 'apex' });

        // Set token provider (syntax highlighting)
        monaco.languages.setMonarchTokensProvider('apex', {
            defaultToken: '',
            tokenPostfix: '.apex',

            keywords: [
                'abstract', 'activate', 'and', 'any', 'array', 'as', 'asc', 'autonomous',
                'begin', 'bigdecimal', 'blob', 'break', 'bulk', 'by', 'case', 'cast',
                'catch', 'char', 'class', 'collect', 'commit', 'const', 'continue',
                'convertcurrency', 'decimal', 'default', 'delete', 'desc', 'do', 'else',
                'end', 'enum', 'exception', 'exit', 'export', 'extends', 'false', 'final',
                'finally', 'float', 'for', 'from', 'future', 'global', 'goto', 'group',
                'having', 'hint', 'if', 'implements', 'import', 'in', 'inner', 'insert',
                'instanceof', 'interface', 'into', 'int', 'join', 'last_90_days',
                'last_month', 'last_n_days', 'last_week', 'like', 'limit', 'list', 'long',
                'loop', 'map', 'merge', 'new', 'next_90_days', 'next_month', 'next_n_days',
                'next_week', 'not', 'null', 'nulls', 'number', 'object', 'of', 'on', 'or',
                'outer', 'override', 'package', 'parallel', 'pragma', 'private', 'protected',
                'public', 'retrieve', 'return', 'rollback', 'savepoint', 'search', 'select',
                'set', 'short', 'sort', 'static', 'super', 'switch', 'synchronized', 'system',
                'testmethod', 'then', 'this', 'this_month', 'this_week', 'throw', 'today',
                'tolabel', 'tomorrow', 'transaction', 'trigger', 'true', 'try', 'type',
                'undelete', 'update', 'upsert', 'using', 'virtual', 'void', 'webservice',
                'when', 'where', 'while', 'yesterday'
            ],

            operators: [
                '=', '>', '<', '!', '~', '?', ':',
                '==', '<=', '>=', '!=', '&&', '||', '++', '--',
                '+', '-', '*', '/', '&', '|', '^', '%', '<<',
                '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=',
                '^=', '%=', '<<=', '>>=', '>>>='
            ],

            symbols: /[=><!~?:&|+\-*\/\^%]+/,
            escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

            tokenizer: {
                root: [
                    // SOQL queries
                    [/\[/, { token: 'soql.bracket.open', next: '@soql' }],

                    // Identifiers and keywords
                    [/[a-z_$][\w$]*/, {
                        cases: {
                            '@keywords': 'keyword',
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
                    [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                    [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                    [/\d+/, 'number'],

                    // Delimiter
                    [/[;,.]/, 'delimiter'],

                    // Strings
                    [/"([^"\\]|\\.)*$/, 'string.invalid'],
                    [/'([^'\\]|\\.)*$/, 'string.invalid'],
                    [/"/, 'string', '@string_double'],
                    [/'/, 'string', '@string_single'],
                ],

                soql: [
                    [/\]/, { token: 'soql.bracket.close', next: '@pop' }],
                    [/SELECT|FROM|WHERE|ORDER BY|GROUP BY|LIMIT|OFFSET/, 'keyword.soql'],
                    [/[a-zA-Z_$][\w$]*/, 'identifier.soql'],
                    { include: '@root' }
                ],

                whitespace: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\*/, 'comment', '@comment'],
                    [/\/\/.*$/, 'comment'],
                ],

                comment: [
                    [/[^\/*]+/, 'comment'],
                    [/\/\*/, 'comment', '@push'],
                    ["\\*/", 'comment', '@pop'],
                    [/[\/*]/, 'comment']
                ],

                string_double: [
                    [/[^\\"]+/, 'string'],
                    [/@escapes/, 'string.escape'],
                    [/\\./, 'string.escape.invalid'],
                    [/"/, 'string', '@pop']
                ],

                string_single: [
                    [/[^\\']+/, 'string'],
                    [/@escapes/, 'string.escape'],
                    [/\\./, 'string.escape.invalid'],
                    [/'/, 'string', '@pop']
                ],
            },
        });

        // Set language configuration
        monaco.languages.setLanguageConfiguration('apex', {
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
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ],
            surroundingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ],
            folding: {
                markers: {
                    start: new RegExp('^\\s*//\\s*#?region\\b'),
                    end: new RegExp('^\\s*//\\s*#?endregion\\b')
                }
            }
        });

        console.log('[Monaco] Apex language configured');
    }

    /**
     * Create editor instance
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Editor options
     * @returns {Object} Monaco editor instance
     */
    createEditor(container, options = {}) {
        if (!this.monacoLoaded) {
            throw new Error('Monaco not loaded. Call load() first.');
        }

        const defaultOptions = {
            language: 'apex',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 4,
            insertSpaces: true
        };

        const editor = monaco.editor.create(container, {
            ...defaultOptions,
            ...options
        });

        console.log('[Monaco] Editor created');
        return editor;
    }

    /**
     * Get Monaco instance
     * @returns {Object} Monaco object
     */
    getMonaco() {
        if (!this.monacoLoaded) {
            throw new Error('Monaco not loaded');
        }
        return this.monaco;
    }
}

// Export for ES modules
export { MonacoLoader, monaco };

// Also create global instance for backwards compatibility
window.monacoLoader = new MonacoLoader();
