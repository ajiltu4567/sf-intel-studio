/**
 * SF-Intel Studio - Monaco Completion Providers
 * Provides Apex, LWC, and SOQL specific autocompletions (Intelligence v3 Pro).
 */

window.SFIntelCompletions = {
    register: function () {
        if (!window.monaco) return;
        const monaco = window.monaco;

        // --- 1. MEMBER SUGGESTIONS (this. and Static) ---
        const memberProvider = {
            triggerCharacters: ['.'],
            provideCompletionItems: async (model, position) => {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });

                // --- NEW: LSP Bridge (Jorje) ---
                if (window.apexLSP && window.apexLSP.healthy) {
                    const fileName = model.id.split('/').pop();
                    const result = await window.apexLSP.getCompletions(model.id, fileName, position.lineNumber, position.column, model.getValue());

                    if (result && result.items) {
                        return {
                            suggestions: result.items.map(item => ({
                                label: item.label,
                                kind: window.SFIntelCompletions.mapLspKind(item.kind),
                                insertText: item.insertText || item.label,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                detail: item.detail,
                                documentation: item.documentation,
                                sortText: item.sortText
                            }))
                        };
                    }
                }

                const match = textUntilPosition.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.$/);
                if (!match) return { suggestions: [] };
                const variableName = match[1];

                // Legacy Fallback Logic (SymbolIndex)
                if (window.SymbolIndex) {
                    const fileIndex = window.SymbolIndex.files[model.id] || Object.values(window.SymbolIndex.files)[0];
                    if (fileIndex) {
                        return {
                            suggestions: [
                                ...fileIndex.symbols.methods.map(m => ({
                                    label: m.name,
                                    kind: monaco.languages.CompletionItemKind.Method,
                                    insertText: m.name + '($0)',
                                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                })),
                                ...fileIndex.symbols.fields.map(f => ({
                                    label: f.name,
                                    kind: monaco.languages.CompletionItemKind.Field,
                                    insertText: f.name
                                }))
                            ]
                        };
                    }
                }

                return { suggestions: [] };
            }
        };

        monaco.languages.registerCompletionItemProvider('apex', memberProvider);
        monaco.languages.registerCompletionItemProvider('javascript', memberProvider);

        // --- 2. APEX KEYWORDS & SNIPPETS ---
        monaco.languages.registerCompletionItemProvider('apex', {
            provideCompletionItems: (model, position) => {
                const standardLibraryCompletions = [
                    { label: 'String.isBlank', kind: monaco.languages.CompletionItemKind.Method, insertText: 'String.isBlank($0)', detail: 'Returns true if string is null or empty' },
                    { label: 'Database.query', kind: monaco.languages.CompletionItemKind.Method, insertText: 'Database.query($0)', detail: 'Dynamic SOQL query' },
                    { label: 'System.debug', kind: monaco.languages.CompletionItemKind.Method, insertText: 'System.debug($0)', detail: 'Log message to debug logs' },
                    { label: 'Test.startTest', kind: monaco.languages.CompletionItemKind.Method, insertText: 'Test.startTest();', detail: 'Start test context' },
                    { label: 'Test.stopTest', kind: monaco.languages.CompletionItemKind.Method, insertText: 'Test.stopTest();', detail: 'Stop test context' }
                ].map(item => ({
                    ...item,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                }));

                const keywords = ['public', 'private', 'protected', 'global', 'class', 'interface', 'trigger', 'void', 'static', 'if', 'else', 'for', 'while', 'return', 'new', 'try', 'catch', 'finally', 'throw'].map(kw => ({
                    label: kw,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: kw
                }));

                const snippets = [
                    {
                        label: 'cls',
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: 'public with sharing class ${1:ClassName} {\n\tpublic ${1:ClassName}() {\n\t\t$0\n\t}\n}',
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        detail: 'Standard Apex Class'
                    }
                ];

                return { suggestions: [...keywords, ...standardLibraryCompletions, ...snippets] };
            }
        });

        // --- 3. LWC HTML DIRECTIVES ---
        monaco.languages.registerCompletionItemProvider('html', {
            triggerCharacters: ['{', ' '],
            provideCompletionItems: async (model, position) => {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });

                if (textUntilPosition.endsWith('{') && window.SymbolIndex) {
                    const htmlFileName = model.uri.path.split('/').pop();
                    const jsFileName = htmlFileName.replace('.html', '.js');
                    const jsFile = Object.values(window.SymbolIndex.files).find(f => f.name === jsFileName);

                    if (jsFile) {
                        return {
                            suggestions: [
                                ...jsFile.symbols.methods.map(m => ({ label: m.name, kind: monaco.languages.CompletionItemKind.Method, insertText: m.name })),
                                ...jsFile.symbols.fields.map(f => ({ label: f.name, kind: monaco.languages.CompletionItemKind.Field, insertText: f.name }))
                            ]
                        };
                    }
                }
                return { suggestions: [] };
            }
        });

        // NOTE: SOQL completion provider is registered in editor.js (SOQL Intelligence section)

        // --- 5. HOVER PROVIDER ---
        monaco.languages.registerHoverProvider('apex', {
            provideHover: async (model, position) => {
                const word = model.getWordAtPosition(position);
                if (!word) return;

                if (window.apexLSP && window.apexLSP.healthy) {
                    const fileName = model.id.split('/').pop();
                    const result = await window.apexLSP.getHover(model.id, fileName, position.lineNumber, position.column, model.getValue());

                    if (result && result.contents) {
                        return {
                            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                            contents: Array.isArray(result.contents) ? result.contents : [result.contents]
                        };
                    }
                }
                return null;
            }
        });

        // --- 6. DEFINITION PROVIDER ---
        monaco.languages.registerDefinitionProvider('apex', {
            provideDefinition: async (model, position) => {
                if (window.apexLSP && window.apexLSP.healthy) {
                    const fileName = model.id.split('/').pop();
                    const results = await window.apexLSP.getDefinition(model.id, fileName, position.lineNumber, position.column, model.getValue());

                    if (results) {
                        const location = Array.isArray(results) ? results[0] : results;
                        if (location && location.uri) {
                            const match = location.uri.match(/\/workspace\/([^/]+)/);
                            const fileId = match ? match[1] : location.uri;

                            window.parent.postMessage({ type: 'SWITCH_MODEL', id: fileId }, window.location.origin);
                            setTimeout(() => {
                                window.parent.postMessage({
                                    type: 'SCROLL_TO_LINE',
                                    line: location.range.start.line + 1
                                }, window.location.origin);
                            }, 100);
                            return null;
                        }
                    }
                }
                return null;
            }
        });

        // --- 7. REFERENCE PROVIDER ---
        monaco.languages.registerReferenceProvider('apex', {
            provideReferences: async (model, position) => {
                const word = model.getWordAtPosition(position);
                if (!word || !window.apexLSP || !window.apexLSP.healthy) return [];

                const fileName = model.id.split('/').pop();
                const results = await window.apexLSP.getReferences(model.id, fileName, position.lineNumber, position.column, model.getValue());

                if (results && Array.isArray(results)) {
                    return results.map(ref => ({
                        uri: monaco.Uri.parse(ref.uri),
                        range: {
                            startLineNumber: ref.range.start.line + 1,
                            startColumn: ref.range.start.character + 1,
                            endLineNumber: ref.range.end.line + 1,
                            endColumn: ref.range.end.character + 1
                        }
                    }));
                }
                return [];
            }
        });

        console.log('[SF-Intel] Advanced Intelligence Providers Loaded.');
    },

    mapLspKind: function (lspKind) {
        const monaco = window.monaco;
        if (!monaco) return 1;

        switch (lspKind) {
            case 1: return monaco.languages.CompletionItemKind.Text;
            case 2: return monaco.languages.CompletionItemKind.Method;
            case 3: return monaco.languages.CompletionItemKind.Function;
            case 4: return monaco.languages.CompletionItemKind.Constructor;
            case 5: return monaco.languages.CompletionItemKind.Field;
            case 6: return monaco.languages.CompletionItemKind.Variable;
            case 7: return monaco.languages.CompletionItemKind.Class;
            case 8: return monaco.languages.CompletionItemKind.Interface;
            case 9: return monaco.languages.CompletionItemKind.Module;
            case 10: return monaco.languages.CompletionItemKind.Property;
            case 11: return monaco.languages.CompletionItemKind.Unit;
            case 12: return monaco.languages.CompletionItemKind.Value;
            case 13: return monaco.languages.CompletionItemKind.Enum;
            case 14: return monaco.languages.CompletionItemKind.Keyword;
            case 15: return monaco.languages.CompletionItemKind.Snippet;
            case 16: return monaco.languages.CompletionItemKind.Color;
            case 17: return monaco.languages.CompletionItemKind.File;
            case 18: return monaco.languages.CompletionItemKind.Reference;
            case 19: return monaco.languages.CompletionItemKind.Folder;
            case 20: return monaco.languages.CompletionItemKind.EnumMember;
            case 21: return monaco.languages.CompletionItemKind.Constant;
            case 22: return monaco.languages.CompletionItemKind.Struct;
            case 23: return monaco.languages.CompletionItemKind.Event;
            case 24: return monaco.languages.CompletionItemKind.Operator;
            case 25: return monaco.languages.CompletionItemKind.TypeParameter;
            default: return monaco.languages.CompletionItemKind.Property;
        }
    }
};
