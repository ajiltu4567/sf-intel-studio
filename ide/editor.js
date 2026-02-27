let monacoEditor = null;
let models = new Map(); // id -> monaco.editor.IModel
let modelStates = new Map(); // id -> IEditorViewState
let coverageDecorations = []; // Array of active decoration IDs
let modelCoverage = new Map(); // id -> { covered, uncovered, runId }
let localLatestRunId = 0; // v2.3.3 - Local state to avoid window.parent sandbox violations

// Calculate absolute path to Monaco
const baseUrl = window.location.href.split('/').slice(0, -2).join('/');
const vsPath = baseUrl + '/dist/monaco/vs';

/**
 * Central Worker Factory
 * Creates CSP-compliant workers using Blob + importScripts
 * Caches workers for reuse across all Monaco instances
 */
const workerCache = new Map();

function createMonacoWorker(workerPath) {
    // Return cached worker if available
    if (workerCache.has(workerPath)) {
        console.log(`[Monaco] Reusing cached worker: ${workerPath}`);
        return workerCache.get(workerPath);
    }

    const fullPath = `${baseUrl}/${workerPath}`;

    // Create Blob-based worker with importScripts (CSP-compliant)
    const workerCode = `
        self.MonacoEnvironment = {
            baseUrl: '${baseUrl}/dist/monaco/'
        };
        try {
            importScripts('${fullPath}');
        } catch (e) {
            console.error('[Monaco Worker] Failed to load:', e);
            self.postMessage({ error: 'Worker load failed: ' + e.message });
        }
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    // Cache for reuse
    workerCache.set(workerPath, worker);
    console.log(`[Monaco] Created and cached worker: ${workerPath}`);

    return worker;
}

// Configure Monaco Environment (MUST be defined before Monaco loads)
window.MonacoEnvironment = {
    getWorker: function (workerId, label) {
        console.log(`[Monaco] Creating worker for label: ${label}`);

        switch (label) {
            case 'editorWorkerService':
                return createMonacoWorker('dist/monaco/vs/base/worker/workerMain.js');

            case 'html':
            case 'handlebars':
            case 'razor':
                return createMonacoWorker('dist/monaco/vs/language/html/html.worker.js');

            case 'css':
            case 'scss':
            case 'less':
                return createMonacoWorker('dist/monaco/vs/language/css/css.worker.js');

            case 'json':
                return createMonacoWorker('dist/monaco/vs/language/json/json.worker.js');

            case 'typescript':
            case 'javascript':
                return createMonacoWorker('dist/monaco/vs/language/typescript/ts.worker.js');

            default:
                // Fallback to base worker
                return createMonacoWorker('dist/monaco/vs/base/worker/workerMain.js');
        }
    }
};

/**
 * Language Resolution for Salesforce Files
 * Maps file extensions to Monaco language IDs
 */
function resolveLanguage(filePath) {
    if (!filePath) return 'plaintext';

    const fileName = filePath.toLowerCase();

    // LWC & Aura templates
    if (fileName.endsWith('.html')) return 'html';
    if (fileName.endsWith('.cmp') || fileName.endsWith('.app')) return 'html'; // Aura markup
    if (fileName.endsWith('.evt') || fileName.endsWith('.intf')) return 'html'; // Aura events/interfaces

    // Stylesheets
    if (fileName.endsWith('.css')) return 'css';

    // JavaScript
    if (fileName.endsWith('.js')) return 'javascript';

    // Metadata & Config
    if (fileName.endsWith('.json')) return 'json';
    if (fileName.endsWith('-meta.xml') || fileName.endsWith('.xml')) return 'xml';

    // Apex (fallback to plaintext for now, can be upgraded to custom language later)
    if (fileName.endsWith('.cls') || fileName.endsWith('.trigger')) return 'apex';

    return 'plaintext';
}

// Expose to parent for use in openFile calls
window.resolveLanguage = resolveLanguage;

// Initialize Monaco
require.config({ paths: { 'vs': vsPath } });
require(['vs/editor/editor.main'], function () {
    console.log('[Monaco] Initializing editor with full language services...');

    // ===== REGISTER APEX LANGUAGE =====
    // Register Apex as a custom language for syntax highlighting
    monaco.languages.register({ id: 'apex' });
    
    // Define Apex syntax highlighting (Monarch Tokenizer)
    monaco.languages.setMonarchTokensProvider('apex', {
        defaultToken: '',
        keywords: [
            'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
            'class', 'interface', 'enum', 'extends', 'implements', 'new', 'this', 'super',
            'public', 'private', 'protected', 'global', 'with', 'without', 'sharing',
            'void', 'boolean', 'integer', 'long', 'double', 'decimal', 'string', 'blob', 'date', 'datetime', 'time', 'id',
            'object', 'list', 'set', 'map',
            'static', 'final', 'abstract', 'virtual', 'override', 'transient', 'webservice',
            'testmethod', 'instanceof', 'try', 'catch', 'finally', 'throw',
            'insert', 'update', 'delete', 'undelete', 'upsert', 'merge',
            'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like', 'null',
            'order', 'by', 'asc', 'desc', 'limit', 'offset', 'group', 'having',
            'trigger', 'on', 'before', 'after'
        ],
        typeKeywords: ['System', 'Database', 'Schema', 'Test', 'ApexPages', 'Limits', 'UserInfo'],
        constants: ['true', 'false', 'null'],
        operators: ['=', '>', '<', '!', '==', '<=', '>=', '!=', '&&', '||', '++', '--', '+', '-', '*', '/', '%'],
        
        tokenizer: {
            root: [
                [/[a-z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@constants': 'constant', '@default': 'identifier' } }],
                [/[A-Z][\w\$]*/, 'type.identifier'],
                { include: '@whitespace' },
                [/[{}()\[\]]/, '@brackets'],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/\d+/, 'number'],
                [/[;,.]/, 'delimiter'],
                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                [/'/, 'string', '@string'],
                [/@\w+/, 'annotation'],
                [/\[/, 'soql.bracket', '@soql']
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment']
            ],
            comment: [
                [/[^\/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],
            string: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, 'string', '@pop']
            ],
            soql: [
                [/\]/, 'soql.bracket', '@pop'],
                [/\b(SELECT|FROM|WHERE|ORDER BY|LIMIT)\b/i, 'keyword.soql'],
                { include: '@root' }
            ]
        }
    });
    
    // Set language configuration (brackets, auto-closing, etc.)
    monaco.languages.setLanguageConfiguration('apex', {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: "'", close: "'", notIn: ['string', 'comment'] }
        ],
        folding: {
            markers: {
                start: new RegExp('^\\s*//\\s*#?region\\b'),
                end: new RegExp('^\\s*//\\s*#?endregion\\b')
            }
        }
    });
    
    console.log('[Monaco] ✅ Apex language registered with syntax highlighting');

    // --- Register SOQL as a custom language (avoids built-in SQL completion interference) ---
    monaco.languages.register({ id: 'soql' });
    monaco.languages.setMonarchTokensProvider('soql', {
        defaultToken: '',
        tokenPostfix: '.soql',
        ignoreCase: true,
        keywords: [
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
            'ORDER', 'BY', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
            'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'FOR', 'UPDATE',
            'TYPEOF', 'ALL', 'ROWS', 'WITH', 'SECURITY_ENFORCED',
            'COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX',
            'TRUE', 'FALSE', 'NULL', 'TODAY', 'YESTERDAY', 'TOMORROW',
            'LAST_N_DAYS', 'NEXT_N_DAYS', 'THIS_MONTH', 'THIS_YEAR',
            'INCLUDES', 'EXCLUDES', 'NOT_IN'
        ],
        operators: ['=', '!=', '<', '>', '<=', '>='],
        tokenizer: {
            root: [
                [/--.*$/, 'comment'],
                [/\/\/.*$/, 'comment'],
                [/'[^']*'/, 'string'],
                [/[0-9]+(\.[0-9]+)?/, 'number'],
                [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
                [/[=<>!]+/, 'operator'],
                [/[,.()\[\]]/, 'delimiter'],
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('soql', {
        comments: { lineComment: '--' },
        brackets: [['(', ')']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: "'", close: "'", notIn: ['string'] }
        ]
    });
    console.log('[Monaco] ✅ SOQL language registered');

    // Configure language services BEFORE creating editor

    // JavaScript/TypeScript: Enable syntax validation, disable heavy semantics
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,  // Disable slow semantic checks
        noSyntaxValidation: false,   // Keep syntax validation
        noSuggestionDiagnostics: true
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: true
    });

    // HTML: Enable full validation (now safe with workers)
    monaco.languages.html.htmlDefaults.setOptions({
        format: {
            tabSize: 2,
            insertSpaces: true,
            wrapLineLength: 120,
            unformatted: 'wbr',
            contentUnformatted: 'pre,code,textarea',
            indentInnerHtml: false,
            preserveNewLines: true,
            maxPreserveNewLines: null,
            indentHandlebars: false,
            endWithNewline: false,
            extraLiners: 'head, body, /html',
            wrapAttributes: 'auto'
        },
        validate: true,
        autoClosingTags: true
    });

    // CSS: Enable validation
    monaco.languages.css.cssDefaults.setOptions({
        validate: true,
        lint: {
            compatibleVendorPrefixes: 'warning',
            vendorPrefix: 'warning',
            duplicateProperties: 'warning'
        }
    });

    // JSON: Enable schema validation
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemaValidation: 'warning'
    });

    const container = document.getElementById('monaco-container');
    monacoEditor = monaco.editor.create(container, {
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,

        // Editor Features
        minimap: { 
            enabled: false, 
            side: 'right',
            renderCharacters: true,
            showSlider: 'mouseover'
        },
        // SIP-2.0.7 & Stable Folding
        folding: true,
        foldingStrategy: 'auto',
        foldingHighlight: true,
        showFoldingControls: 'always',
        scrollBeyondLastLine: false,
        guides: {
            indentation: true
        },

        // Rich editing features (now safe with workers)
        bracketPairColorization: { enabled: true },
        renderValidationDecorations: 'on', // Show validation errors

        // UX Polish
        padding: { top: 10 },
        fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', 'Courier New', monospace",
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        renderLineHighlight: "all",
        // Suggestion settings
        wordBasedSuggestions: 'off',
        quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
        },

        model: null // Set dynamically per file
    });

    // Debounced layout to prevent thrashing
    let layoutTimer = null;
    window.addEventListener('resize', () => {
        if (layoutTimer) clearTimeout(layoutTimer);
        layoutTimer = setTimeout(() => {
            if (monacoEditor) monacoEditor.layout();
        }, 150);
    });

    // Register Salesforce completions
    if (window.SFIntelCompletions) {
        window.SFIntelCompletions.register();
    }

    // Register LWC IntelliSense (type defs + import path completions)
    if (window.LWCIntelliSense) {
        window.LWCIntelliSense.init(monaco);
    }

    // --- Premium Intelligence: Code Lens ---
    monaco.languages.registerCodeLensProvider('apex', {
        provideCodeLenses: async (model, token) => {
            const lenses = [];
            const text = model.getValue();
            
            // Basic regex to find class and method definitions
            const classMatch = text.match(/class\s+([A-Z][a-zA-Z0-9_]*)/);
            if (classMatch) {
                const className = classMatch[1];
                try {
                    const data = await window.sfIntelAPI.getImpactAnalysis(className);
                    lenses.push({
                        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                        command: {
                            id: 'sf-intel.openDashboard',
                            title: `⚡ Impact: ${data.risk_score} (${data.risk_level}) | Entry Points: ${data.entry_points ? data.entry_points.length : 0}`,
                            arguments: [className]
                        }
                    });
                } catch (err) {}
            }
            return { lenses: lenses, dispose: () => {} };
        }
    });

    // --- Premium Intelligence: Gutter Markers ---
    let intelligenceDecorations = [];
    monacoEditor.onDidChangeModelContent(() => {
        // Redacted for brevity, but this is where we'd add gutter icons for @AuraEnabled, async, etc.
    });

    console.log('[Monaco] Editor initialized with full language services ✓');
    // Notify parent that editor is ready
    window.parent.postMessage({ type: 'EDITOR_READY' }, window.location.origin);

    // Listen for changes
    monacoEditor.onDidChangeModelContent(() => {
        const currentModel = monacoEditor.getModel();
        if (!currentModel) return;

        // Find model ID
        let modelId = null;
        for (const [id, m] of models.entries()) {
            if (m === currentModel) {
                modelId = id;
                break;
            }
        }

        const content = monacoEditor.getValue();

        window.parent.postMessage({
            type: 'CONTENT_CHANGED',
            value: content,
            modelId: modelId
        }, window.location.origin);

        // Real-time syntax validation via ApexLSP + Terminal Output
        if (!window._validationTimeout) window._validationTimeout = {};
        clearTimeout(window._validationTimeout[modelId]);
        
        window._validationTimeout[modelId] = setTimeout(async () => {
            if (!window.apexLSP) return;
            
            try {
                // Call validation endpoint via Parent Bridge (Sandbox safe)
                window.parent.postMessage({
                    type: 'VALIDATE_CODE',
                    value: content,
                    modelId: modelId
                }, window.location.origin);
            } catch (err) {
                console.error('[Validation] Bridge error:', err);
            }
        }, 1000); // Debounce 1s

        // Update local symbol index for intelligence
        if (window.SymbolIndex) {
            const fileName = currentModel.uri.path.split('/').pop();
            const language = currentModel.getLanguageId();
            window.SymbolIndex.indexFile(modelId, fileName, language, content);
        }

        // --- CLEAR COVERAGE ON EDIT (v2.3.0) ---
        applyCoverage([], [], null, true); // Partial clear
    });

    // Listen for cursor moves for breadcrumbs (SIP-3.0)
    monacoEditor.onDidChangeCursorPosition((e) => {
        const line = e.position.lineNumber;
        const currentModel = monacoEditor.getModel();
        if (!currentModel || !window.SymbolIndex) return;

        // Find model ID
        let modelId = null;
        for (const [id, m] of models.entries()) {
            if (m === currentModel) {
                modelId = id;
                break;
            }
        }

        const fileIndex = window.SymbolIndex.files[modelId];
        if (fileIndex) {
            let breadcrumb = '';
            // Find class
            const cls = fileIndex.symbols.classes.find(c => c.range && line >= c.range.startLineNumber && line <= c.range.endLineNumber);
            if (cls) breadcrumb = cls.name;

            // Find method
            const method = fileIndex.symbols.methods.find(m => m.range && line >= m.range.startLineNumber && line <= m.range.endLineNumber);
            if (method) breadcrumb += (breadcrumb ? ' > ' : '') + method.name;

            if (breadcrumb) {
                window.parent.postMessage({ type: 'UPDATE_BREADCRUMB', breadcrumb }, window.location.origin);
            }
        }
    });

    // Initialize Schema Manager
    if (window.SchemaManager) {
        window.SchemaManager.init();
    }

    // --- SOQL Intelligence: Completion Provider ---
    // Registered for custom 'soql' language to avoid Monaco built-in SQL completion interference.
    // Synchronous: reads from SchemaManager cache directly; triggers background fetch on cache miss.
    monaco.languages.registerCompletionItemProvider('soql', {
        triggerCharacters: ['.', ',', ' '],
        provideCompletionItems: (model, position) => {
            const SM = window.SchemaManager;
            if (!window.SOQLParser || !SM) return { suggestions: [] };

            const text = model.getValue();
            const offset = model.getOffsetAt(position);
            const context = window.SOQLParser.getContext(text, offset);

            // Use Monaco's word detection for range (most reliable)
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn
            };
            const filter = (word.word || '').toLowerCase();

            const soqlKeywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY',
                'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
                'NULLS FIRST', 'NULLS LAST', 'IN', 'NOT IN', 'LIKE', 'NOT'];
            const keywordItems = soqlKeywords.map(kw => ({
                label: kw,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: kw + ' ',
                filterText: kw,
                sortText: 'z' + kw,
                range
            }));

            if (context.type === 'object') {
                if (SM.globalDescribe) {
                    // Pre-filter ourselves to ensure correct results
                    let filtered = SM.globalDescribe;
                    if (filter) {
                        filtered = SM.globalDescribe.filter(obj =>
                            obj.name.toLowerCase().startsWith(filter)
                        );
                    }
                    const objItems = filtered.map((obj, i) => ({
                        label: obj.name,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: obj.name + ' ',
                        filterText: obj.name,
                        detail: obj.label || '',
                        documentation: obj.isCustom ? 'Custom Object' : 'Standard Object',
                        sortText: String(i).padStart(5, '0'),
                        range
                    }));

                    return { suggestions: objItems };
                }
                SM.getObjectList();
                return { suggestions: keywordItems, incomplete: true };
            }

            if (context.type === 'field' || context.type === 'relationship') {
                let fieldItems = [];

                if (context.rootObject) {
                    const cached = SM.sobjectCache[context.rootObject];
                    if (cached && cached.fields) {
                        let fields = cached.fields;

                        // Handle relationship path
                        if (context.relationshipPath) {
                            const parts = context.relationshipPath.split('.');
                            let targetObject = context.rootObject;
                            for (const part of parts) {
                                const relField = cached.fields.find(ff =>
                                    ff.relationshipName && ff.relationshipName.toLowerCase() === part.toLowerCase()
                                );
                                if (relField && relField.referenceTo && relField.referenceTo[0]) {
                                    targetObject = relField.referenceTo[0];
                                } else {
                                    targetObject = null;
                                    break;
                                }
                            }
                            if (targetObject && targetObject !== context.rootObject) {
                                const targetCached = SM.sobjectCache[targetObject];
                                if (targetCached && targetCached.fields) {
                                    fields = targetCached.fields;
                                } else {
                                    SM.describeSObject(targetObject);
                                    return { suggestions: keywordItems, incomplete: true };
                                }
                            }
                        }

                        // Pre-filter fields
                        let filteredFields = fields;
                        if (filter) {
                            filteredFields = fields.filter(f =>
                                f.name.toLowerCase().startsWith(filter)
                            );
                        }

                        fieldItems = filteredFields.map((f, i) => ({
                            label: f.name,
                            kind: f.isRelationship
                                ? monaco.languages.CompletionItemKind.Reference
                                : monaco.languages.CompletionItemKind.Field,
                            insertText: f.name,
                            filterText: f.name,
                            detail: f.label || '',
                            documentation: `Type: ${f.type || ''}${f.length ? ` (${f.length})` : ''}${f.isCustom ? ' | Custom' : ''}`,
                            sortText: String(i).padStart(5, '0'),
                            range
                        }));

                        return { suggestions: [...fieldItems, ...keywordItems] };
                    }

                    SM.describeSObject(context.rootObject);
                    return { suggestions: keywordItems, incomplete: true };
                }

                return { suggestions: keywordItems };
            }

            if (context.type === 'operator') {
                return {
                    suggestions: [
                        { label: '=', detail: 'Equals' },
                        { label: '!=', detail: 'Not equals' },
                        { label: '<', detail: 'Less than' },
                        { label: '>', detail: 'Greater than' },
                        { label: '<=', detail: 'Less than or equal' },
                        { label: '>=', detail: 'Greater than or equal' },
                        { label: 'LIKE', detail: 'Pattern match' },
                        { label: 'IN', detail: 'In list' },
                        { label: 'NOT IN', detail: 'Not in list' },
                    ].map((op, i) => ({
                        label: op.label,
                        kind: monaco.languages.CompletionItemKind.Operator,
                        insertText: op.label + ' ',
                        filterText: op.label,
                        detail: op.detail,
                        sortText: String(i).padStart(4, '0'),
                        range
                    }))
                };
            }

            if (context.type === 'value') {
                return {
                    suggestions: ['null', 'true', 'false', 'TODAY', 'YESTERDAY', 'TOMORROW',
                        'LAST_N_DAYS:', 'NEXT_N_DAYS:', 'THIS_MONTH', 'THIS_YEAR'
                    ].map((v, i) => ({
                        label: v,
                        kind: monaco.languages.CompletionItemKind.Constant,
                        insertText: v,
                        filterText: v,
                        sortText: String(i).padStart(4, '0'),
                        range
                    }))
                };
            }

            return { suggestions: keywordItems };
        }
    });

    // --- SOQL Intelligence: Hover Provider ---
    monaco.languages.registerHoverProvider('soql', {
        provideHover: async (model, position) => {
            if (!window.SchemaManager) return null;

            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const text = model.getValue();
            const fromMatch = text.match(/FROM\s+(\w+)/i);
            if (!fromMatch) return null;

            const objectName = fromMatch[1];
            const fieldName = word.word;

            try {
                const fields = await window.SchemaManager.getFields(objectName);
                const field = fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
                if (!field) return null;

                const contents = [
                    { value: `**${field.label}** (\`${field.name}\`)` },
                    { value: `Type: \`${field.type}\`${field.length ? ` (${field.length})` : ''}` },
                    { value: `${field.nillable ? 'Nullable' : 'Required'} | ${field.updateable ? 'Editable' : 'Read-only'}${field.custom ? ' | Custom' : ''}` }
                ];

                if (field.isRelationship && field.referenceTo) {
                    contents.push({ value: `Relationship: \`${field.relationshipName}\` → \`${field.referenceTo.join(', ')}\`` });
                }

                return {
                    range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                    contents
                };
            } catch (err) {
                return null;
            }
        }
    });

    // --- SOQL Intelligence: Real-time Diagnostics ---
    let soqlValidationTimer = null;
    monacoEditor.onDidChangeModelContent(() => {
        const currentModel = monacoEditor.getModel();
        if (!currentModel || currentModel.getLanguageId() !== 'soql') return;
        if (!window.SOQLParser) return;

        clearTimeout(soqlValidationTimer);
        soqlValidationTimer = setTimeout(async () => {
            const text = currentModel.getValue();
            if (!text.trim()) {
                monaco.editor.setModelMarkers(currentModel, 'soql-lint', []);
                return;
            }

            try {
                const diagnostics = await window.SOQLParser.validateQuery(text);
                const markers = diagnostics.map(d => ({
                    severity: d.type === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
                    message: d.message,
                    startLineNumber: 1,
                    startColumn: Math.max(1, (d.start || 0) + 1),
                    endLineNumber: 1,
                    endColumn: Math.max(2, (d.end || d.start || 0) + 1)
                }));
                monaco.editor.setModelMarkers(currentModel, 'soql-lint', markers);
            } catch (err) {
                console.warn('[SOQL Diagnostics] Error:', err);
            }
        }, 500);
    });

    // --- CLI Context Menu Actions ---
    function getClassNameAtCursor(editor) {
        const position = editor.getPosition();
        const model = editor.getModel();
        const word = model.getWordAtPosition(position);
        return word ? word.word : null;
    }

    // --- Premium Intelligence: Smart Hover ---
    monaco.languages.registerHoverProvider('apex', {
        provideHover: async (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            // Basic heuristic: check if word looks like a Class (PascalCase)
            if (!/^[A-Z][a-zA-Z0-9_]*$/.test(word.word)) return null;

            try {
                // Fetch intelligence summary (v0.7.0 CLI backend)
                if (!window.sfIntelAPI || !window.sfIntelAPI.getImpactAnalysis) {
                    console.warn('[SmartHover] Impact analysis API not available');
                    return;
                }
                
                const data = await window.sfIntelAPI.getImpactAnalysis(word.word);

                // Build Markdown content
                const contents = [
                    { value: `**⚡ SF-INTEL SUMMARY: ${word.word}**` },
                    { value: `---` },
                    { value: `**Impact Score:** ${data.risk_score}/100 (${data.risk_level})` },
                    { value: `**Entry Points:** ${data.entry_points ? data.entry_points.length : 0}` },
                    { value: `**Direct Callers:** ${data.direct_callers ? data.direct_callers.length : 0}` },
                    { value: `---` },
                    { 
                        value: `[View Flow](command:sf-intel.showFlow?${encodeURIComponent(JSON.stringify([word.word]))}) | [View Graph](command:sf-intel.showImpact?${encodeURIComponent(JSON.stringify([word.word]))}) | [Full Report](command:sf-intel.openDashboard?${encodeURIComponent(JSON.stringify([word.word]))})`,
                        isTrusted: true,
                        supportHtml: true
                    }
                ];

                return {
                    range: new monaco.Range(
                        position.lineNumber,
                        word.startColumn,
                        position.lineNumber,
                        word.endColumn
                    ),
                    contents: contents
                };
            } catch (err) {
                console.warn('[SmartHover] Failed:', err);
                return null;
            }
        }
    });

    // Register additional commands for hover actions
    monacoEditor.addAction({
        id: 'sf-intel.showFlow',
        label: 'Show Execution Flow',
        run: (editor, className) => {
            window.parent.postMessage({ type: 'SHOW_FLOW', className: className[0] }, window.location.origin);
        }
    });

    monacoEditor.addAction({
        id: 'sf-intel.openDashboard',
        label: 'Open Dashboard',
        run: (editor, className) => {
            window.parent.postMessage({ type: 'OPEN_DASHBOARD', className: className[0] }, window.location.origin);
        }
    });

    // TODO: Re-enable these context menu actions when Impact Analysis, Relationships,
    // and SOQL Analysis features are fully implemented.
    // monacoEditor.addAction({ id: 'sf-intel.showImpact', label: '🔍 Show Impact Analysis', ... });
    // monacoEditor.addAction({ id: 'sf-intel.showRelationships', label: '🔗 Show Relationships', ... });
    // monacoEditor.addAction({ id: 'sf-intel.analyzeSoql', label: '⚡ Analyze SOQL Queries', ... });

    // ========================================
    // FETCH LATEST FROM SALESFORCE
    // ========================================
    monacoEditor.addAction({
        id: 'sf-intel.fetchLatest',
        label: '⬇️ Fetch Latest from Salesforce',
        contextMenuGroupId: 'sf-intel',
        contextMenuOrder: 0, // Show at top of SF-Intel group
        run: async (editor) => {
            // Request parent window to fetch latest for current file
            window.parent.postMessage({ type: 'FETCH_LATEST_CURRENT' }, window.location.origin);
        }
    });

    monacoEditor.addAction({
        id: 'sf-intel.fetchLatestForce',
        label: '🔄 Force Refresh from Salesforce',
        contextMenuGroupId: 'sf-intel',
        contextMenuOrder: 0.5,
        run: async (editor) => {
            // Request parent window to force fetch latest for current file
            window.parent.postMessage({ type: 'FETCH_LATEST_CURRENT', force: true }, window.location.origin);
        }
    });

    monacoEditor.addAction({
        id: 'sf-intel.diffAgainstOrg',
        label: 'Diff File Against Org',
        contextMenuGroupId: 'sf-intel',
        contextMenuOrder: 0.1,
        run: () => {
            window.parent.postMessage({ type: 'DIFF_AGAINST_ORG' }, window.location.origin);
        }
    });

    // Cmd/Ctrl+Enter: Run SOQL/Apex utility (works even when Monaco has focus)
    monacoEditor.addAction({
        id: 'sf-intel.runUtility',
        label: 'Run Query (Ctrl+Enter)',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter
        ],
        run: () => {
            window.parent.postMessage({ type: 'RUN_UTILITY' }, window.location.origin);
        }
    });
});

// Forward Cmd/Ctrl+Enter to parent so Run works even when iframe has focus (fallback for non-Monaco areas)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        window.parent.postMessage({ type: 'RUN_UTILITY' }, window.location.origin);
    }
});

// Listen for messages from parent
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return; // P0 Security: origin validation
    const message = event.data;
    if (!monacoEditor) return;

    switch (message.type) {
        case 'OPEN_MODEL':
            openOrFocusModel(message.id, message.value, message.language);
            break;
        case 'VALIDATE_RESULT':
            console.log('[Editor] VALIDATE_RESULT received:', message.modelId, message.result);
            const modelToUpdate = models.get(message.modelId);
            if (modelToUpdate) {
                const errors = message.result.results || [];
                const markers = errors.map(d => ({
                    message: d.message,
                    severity: monaco.MarkerSeverity.Error,
                    startLineNumber: d.line || 1,
                    startColumn: d.column || 1,
                    endLineNumber: (d.line || 1),
                    endColumn: (d.column || 1) + 10
                }));
                monaco.editor.setModelMarkers(modelToUpdate, 'syntax', markers);
                console.log(`[Editor] Set ${markers.length} markers for ${message.modelId}`);
            }
            break;
        case 'SWITCH_MODEL':
            switchModel(message.id);
            break;
        case 'CLOSE_MODEL':
            closeModel(message.id);
            break;
        case 'SCROLL_TO_LINE':
            scrollToLine(message.line);
            break;
        case 'TOGGLE_MINIMAP':
            monacoEditor.updateOptions({ minimap: { enabled: message.enabled } });
            break;
        case 'EXECUTE_ACTION':
            console.log(`[Editor] Executing action: ${message.action}`);
            monacoEditor.trigger('keyboard', message.action, null);
            break;
        case 'SET_VALUE':
            if (message.modelId) {
                // Target a specific model (e.g. fetch latest for a non-active bundle file)
                const targetModel = models.get(message.modelId);
                if (targetModel) {
                    targetModel.setValue(message.value);
                    if (message.language) monaco.editor.setModelLanguage(targetModel, message.language);
                }
            } else {
                monacoEditor.setValue(message.value);
                if (message.language) {
                    monaco.editor.setModelLanguage(monacoEditor.getModel(), message.language);
                }
            }
            break;
        case 'GET_CONTENT':
            const model = models.get(message.modelId);
            if (model) {
                window.parent.postMessage({
                    type: 'CONTENT_RESULT',
                    id: message.modelId,
                    value: model.getValue()
                }, window.location.origin);
            }
            break;
        case 'GET_SELECTION': {
            const selModel = models.get(message.modelId);
            if (selModel && monacoEditor) {
                const selection = monacoEditor.getSelection();
                const selectedText = selection && !selection.isEmpty()
                    ? selModel.getValueInRange(selection)
                    : '';
                window.parent.postMessage({
                    type: 'SELECTION_RESULT',
                    id: message.modelId,
                    value: selectedText || selModel.getValue()
                }, window.location.origin);
            }
            break;
        }
        case 'GLOBAL_DESCRIBE_RESULT':
        case 'DESCRIBE_RESULT':
            if (window.SchemaManager) {
                window.SchemaManager.handleBridgeResult(message);
            }
            break;
        case 'APEX_CLASSES_RESULT':
            if (window.LWCIntelliSense) {
                window.LWCIntelliSense.handleBridgeResult(message);
            }
            break;
        case 'MARKERS_UPDATE':
            const modelToMark = models.get(message.id);
            if (modelToMark) {
                monaco.editor.setModelMarkers(modelToMark, 'sf-intel-guard', message.diagnostics);
            }
            break;
        case 'SHOW_COVERAGE':
            applyCoverage(message.covered, message.uncovered, message.runId, false, message.modelId);
            break;
        case 'SET_COVERAGE_VISIBILITY':
            const container = document.getElementById('monaco-container');
            if (container) {
                container.classList.toggle('coverage-hidden', !message.visible);
            }
            break;
        case 'CLEAR_COVERAGE':
            applyCoverage([], [], null, true);
            break;
        case 'SYNC_RUN_ID':
            localLatestRunId = message.runId;
            console.log(`[Monaco] Synced latestRunId: ${localLatestRunId}`);
            break;
        case 'SHOW_DIFF':
            showDiffEditor(message.localContent, message.orgContent, message.fileName, message.metadata, message.tabType, message.tabId, message.edgeCaseType, message.errorMessage);
            break;
        case 'CLOSE_DIFF':
            closeDiffEditor();
            break;
    }
});

function openOrFocusModel(id, value, language) {
    if (models.has(id)) {
        switchModel(id);
        return;
    }

    // Create new model
    const model = monaco.editor.createModel(value, language);
    models.set(id, model);

    // Initial indexing
    if (window.SymbolIndex) {
        window.SymbolIndex.indexFile(id, tabNameFromId(id), language, value);
    }

    // Switch to it
    switchModel(id);
}

function tabNameFromId(id) {
    // We don't have direct access to window.openTabs here easily, 
    // but we can try to find the filename from the parent message if we stored it.
    // For now, use a placeholder or ID.
    return id;
}

function switchModel(id) {
    const newModel = models.get(id);
    if (!newModel) return;

    // Save state of current model
    const currentModel = monacoEditor.getModel();
    if (currentModel) {
        let oldId = null;
        for (const [mid, m] of models.entries()) {
            if (m === currentModel) {
                oldId = mid;
                break;
            }
        }
        if (oldId) {
            modelStates.set(oldId, monacoEditor.saveViewState());
        }
    }

    // Clear current coverage decorations
    coverageDecorations = monacoEditor.deltaDecorations(coverageDecorations, []);

    // Swap model
    monacoEditor.setModel(newModel);

    // Re-apply stored coverage if it exists (v2.3.1)
    const storedCov = modelCoverage.get(id);
    if (storedCov) {
        console.log(`[Monaco] switchModel: Re-applying stored coverage for model: ${id}`);
        applyCoverage(storedCov.covered, storedCov.uncovered, storedCov.runId, false, id);
    } else {
        console.log(`[Monaco] switchModel: No stored coverage for model: ${id}`);
    }

    // Restore state if exists
    const savedState = modelStates.get(id);
    if (savedState) {
        monacoEditor.restoreViewState(savedState);
    }

    monacoEditor.focus();
}

function closeModel(id) {
    const model = models.get(id);
    if (model) {
        model.dispose();
        models.delete(id);
        modelStates.delete(id);
    }
}

function scrollToLine(line) {
    const lineNum = parseInt(line);
    if (isNaN(lineNum)) return;
    monacoEditor.revealLineInCenter(lineNum);
    monacoEditor.setPosition({ lineNumber: lineNum, column: 1 });
    monacoEditor.focus();
}

function applyCoverage(coveredLines, uncoveredLines, runId = null, isForceClear = false, targetModelId = null) {
    if (!monacoEditor) return;

    // --- MODEL TARGETING & STORAGE (v2.3.1) ---
    // If targetModelId is provided, we associate this data with that model.
    // If not provided, we use the active model.
    let modelId = targetModelId;
    if (!modelId) {
        const currentModel = monacoEditor.getModel();
        if (currentModel) {
            for (const [mid, m] of models.entries()) {
                if (m === currentModel) {
                    modelId = mid;
                    break;
                }
            }
        }
    }

    if (modelId) {
        if (isForceClear) {
            modelCoverage.delete(modelId);
        } else {
            modelCoverage.set(modelId, { covered: coveredLines, uncovered: uncoveredLines, runId });
        }
    }

    // Only apply to editor if this IS the active model
    const activeModel = monacoEditor.getModel();
    let activeModelId = null;
    if (activeModel) {
        for (const [mid, m] of models.entries()) {
            if (m === activeModel) {
                activeModelId = mid;
                break;
            }
        }
    }

    if (modelId !== activeModelId && !isForceClear) {
        console.log(`[Monaco] applyCoverage: Stored coverage for model ${modelId} but it's not active (Active: ${activeModelId}). Waiting for model switch.`);
        return;
    }

    console.log(`[Monaco] applyCoverage: Applying ${coveredLines.length} covered and ${uncoveredLines.length} uncovered lines to model ${modelId}`);

    // --- RACE CONDITION GUARD (v2.3.0) ---
    // v2.3.3: Use localLatestRunId instead of window.parent to avoid sandbox violation
    if (runId) {
        if (runId < localLatestRunId) {
            console.warn(`[Monaco] Discarding stale coverage run: ${runId} (Local Latest: ${localLatestRunId})`);
            return;
        }
        // Update local watermark if this is newer
        if (runId > localLatestRunId) localLatestRunId = runId;
    }

    const newDecorations = [];
    const totalLines = (coveredLines?.length || 0) + (uncoveredLines?.length || 0);

    // --- PERFORMANCE GUARD (v2.3.0) ---
    // If over 10k lines, fallback to gutter-only mode to prevent DOM thrashing.
    const isPerformanceFallback = totalLines > 10000;
    if (isPerformanceFallback) {
        console.warn(`[Monaco] 10k+ coverage lines detected. Falling back to Gutter-Only mode.`);
    }

    // Process covered lines
    if (Array.isArray(coveredLines)) {
        coveredLines.forEach(line => {
            newDecorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: isPerformanceFallback ? '' : 'coverage-line-covered',
                    linesDecorationsClassName: 'coverage-gutter-covered'
                }
            });
        });
    }

    // Process uncovered lines
    if (Array.isArray(uncoveredLines)) {
        uncoveredLines.forEach(line => {
            newDecorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: isPerformanceFallback ? '' : 'coverage-line-uncovered',
                    linesDecorationsClassName: 'coverage-gutter-uncovered'
                }
            });
        });
    }

    // --- BATCH APPLICATION (v2.3.0) ---
    // Single deltaDecorations call for entire file.
    coverageDecorations = monacoEditor.deltaDecorations(coverageDecorations, newDecorations);

    // Show coverage if not force clearing
    if (!isForceClear) {
        const container = document.getElementById('monaco-container');
        if (container) container.classList.remove('coverage-hidden');
    }
}

// ========================================
// DIFF EDITOR — Enterprise Metadata Diff Viewer
// ========================================
let diffEditorInstance = null;
let diffState = {};

// SVG icons for diff toolbar
const DIFF_ICONS = {
    sideBySide: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V2a1 1 0 00-1-1zM2 14V2h6v12H2zm12 0H9V2h5v12z"/></svg>',
    inline: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H2a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V2a1 1 0 00-1-1zm-1 13H3V2h10v12z"/></svg>',
    whitespace: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 10h3v3H1v-3zm5 0h3v3H6v-3zm5 0h3v3h-3v-3zM1 3h14v1H1V3zm0 3h14v1H1V6z"/></svg>',
    collapse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3l4 4.5-4 4.5L4 10.5 6.75 7.5 4 4.5 5.5 3zM11 3v10h1V3h-1z"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2a.5.5 0 00-.5.5V5h-2.5a.5.5 0 000 1H14a.5.5 0 00.5-.5v-3a.5.5 0 00-.5-.5z"/><path d="M12.76 4.05A5.5 5.5 0 002.05 8a.5.5 0 01-1 0 6.5 6.5 0 0112.66-2.12l.05.17z"/><path d="M2.5 14a.5.5 0 00.5-.5V11h2.5a.5.5 0 000-1H2a.5.5 0 00-.5.5v3a.5.5 0 00.5.5z"/><path d="M3.24 11.95A5.5 5.5 0 0013.95 8a.5.5 0 011 0 6.5 6.5 0 01-12.66 2.12l-.05-.17z"/></svg>',
    fullscreen: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h4a.5.5 0 010 1H2v3.5a.5.5 0 01-1 0v-4a.5.5 0 01.5-.5zm0 9a.5.5 0 01.5.5V14h3.5a.5.5 0 010 1h-4a.5.5 0 01-.5-.5v-4a.5.5 0 01.5-.5zm13-9a.5.5 0 01.5.5v4a.5.5 0 01-1 0V2h-3.5a.5.5 0 010-1h4zm0 9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4a.5.5 0 010-1H14v-3.5a.5.5 0 01.5-.5z"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>',
    deploy: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1.75a.75.75 0 00-1.5 0V8.5L4.28 5.78a.75.75 0 00-1.06 1.06l4.25 4.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 00-1.06-1.06L8.5 8.5V1.75z"/><path d="M1.75 13a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H1.75z"/></svg>',
    retrieve: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 14.25a.75.75 0 001.5 0V7.5l2.72 2.72a.75.75 0 101.06-1.06L8.53 4.91a.75.75 0 00-1.06 0L3.22 9.16a.75.75 0 001.06 1.06L7.5 7.5v6.75z"/><path d="M1.75 3a.75.75 0 010-1.5h12.5a.75.75 0 010 1.5H1.75z"/></svg>',
    copy: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>',
    export: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 9.75a.75.75 0 01.75.75v2.75h7.5V10.5a.75.75 0 011.5 0v3.25a.75.75 0 01-.75.75h-9a.75.75 0 01-.75-.75V10.5a.75.75 0 01.75-.75z"/><path d="M8 1a.75.75 0 01.75.75v5.69l1.72-1.72a.75.75 0 111.06 1.06L8.53 9.78a.75.75 0 01-1.06 0L4.47 6.78a.75.75 0 111.06-1.06L7.25 7.44V1.75A.75.75 0 018 1z"/></svg>',
    apply: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>',
};

const DIFF_TYPE_COLORS = {
    ApexClass: '#4facfe',
    ApexTrigger: '#ff6b6b',
    LWC: '#ff9f43',
    AuraDefinitionBundle: '#a29bfe',
};

const DIFF_TYPE_LABELS = {
    ApexClass: 'Apex Class',
    ApexTrigger: 'Apex Trigger',
    LWC: 'LWC Component',
    AuraDefinitionBundle: 'Aura Component',
};

function normalizeForDiff(content) {
    if (!content) return '';
    // Light normalization only — preserve real differences
    return content
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

/**
 * LCS-based line diff algorithm (main-thread fallback for when Monaco's worker diff fails)
 * Returns hunks: groups of consecutive changes with original and modified line ranges.
 */
function computeLineDiff(origLines, modLines) {
    const m = origLines.length;
    const n = modLines.length;

    // Build LCS table
    const dp = [];
    for (let i = 0; i <= m; i++) {
        dp[i] = new Array(n + 1).fill(0);
    }
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (origLines[i - 1] === modLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to build edit script (sequence of equal/delete/insert operations)
    const ops = []; // { type: 'equal'|'delete'|'insert', origLine, modLine }
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
            ops.push({ type: 'equal', origLine: i, modLine: j });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            ops.push({ type: 'insert', modLine: j });
            j--;
        } else {
            ops.push({ type: 'delete', origLine: i });
            i--;
        }
    }
    ops.reverse();

    // Group consecutive non-equal ops into hunks.
    // modContextBefore = modLine of the last equal op before this hunk — used to position
    // pure-deletion arrows and compute insertion point when reverting deletions.
    const hunks = [];
    let currentHunk = null;
    let lastEqualModLine = 0;
    for (const op of ops) {
        if (op.type === 'equal') {
            if (currentHunk) {
                hunks.push(currentHunk);
                currentHunk = null;
            }
            lastEqualModLine = op.modLine;
        } else {
            if (!currentHunk) {
                currentHunk = { origStart: 0, origEnd: 0, modStart: 0, modEnd: 0, deletedLines: [], addedLines: [], modContextBefore: lastEqualModLine };
            }
            if (op.type === 'delete') {
                if (!currentHunk.origStart) currentHunk.origStart = op.origLine;
                currentHunk.origEnd = op.origLine;
                currentHunk.deletedLines.push(op.origLine);
            } else {
                if (!currentHunk.modStart) currentHunk.modStart = op.modLine;
                currentHunk.modEnd = op.modLine;
                currentHunk.addedLines.push(op.modLine);
            }
        }
    }
    if (currentHunk) hunks.push(currentHunk);

    return { hunks, ops };
}

/**
 * Char-level diff within a single line pair using LCS.
 * Returns arrays of { startCol, endCol } ranges for changed characters.
 * More accurate than prefix/suffix approach — highlights only the exact chars that changed.
 */
function _charDiff(origLine, modLine) {
    if (!origLine && !modLine) return { origRanges: [], modRanges: [] };
    if (!origLine) return { origRanges: [], modRanges: [{ startCol: 1, endCol: modLine.length + 1 }] };
    if (!modLine) return { origRanges: [{ startCol: 1, endCol: origLine.length + 1 }], modRanges: [] };

    const a = origLine, b = modLine;

    // Trim common prefix/suffix to shrink the LCS matrix
    let prefixLen = 0;
    while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) prefixLen++;
    let suffixA = a.length, suffixB = b.length;
    while (suffixA > prefixLen && suffixB > prefixLen && a[suffixA - 1] === b[suffixB - 1]) { suffixA--; suffixB--; }

    const aInner = a.slice(prefixLen, suffixA);
    const bInner = b.slice(prefixLen, suffixB);

    if (!aInner && !bInner) return { origRanges: [], modRanges: [] };

    // For very long inner sections, highlight the whole changed region (performance guard)
    if (aInner.length > 200 || bInner.length > 200) {
        return {
            origRanges: aInner ? [{ startCol: prefixLen + 1, endCol: suffixA + 1 }] : [],
            modRanges: bInner ? [{ startCol: prefixLen + 1, endCol: suffixB + 1 }] : []
        };
    }

    // LCS char diff on the inner portion only
    const m = aInner.length, n = bInner.length;
    const dp = [];
    for (let i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = aInner[i - 1] === bInner[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // Backtrack: mark chars that are NOT in the LCS as changed
    const aChanged = new Array(m).fill(true);
    const bChanged = new Array(n).fill(true);
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (aInner[i - 1] === bInner[j - 1]) { aChanged[i - 1] = false; bChanged[j - 1] = false; i--; j--; }
        else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
        else j--;
    }

    // Convert changed char indices to Monaco column ranges (1-based, offset by prefix)
    const toRanges = (changed, offset) => {
        const ranges = [];
        let start = -1;
        for (let k = 0; k <= changed.length; k++) {
            if (k < changed.length && changed[k]) {
                if (start === -1) start = k;
            } else if (start !== -1) {
                ranges.push({ startCol: offset + start + 1, endCol: offset + k + 1 });
                start = -1;
            }
        }
        return ranges;
    };

    return {
        origRanges: toRanges(aChanged, prefixLen),
        modRanges: toRanges(bChanged, prefixLen)
    };
}

/**
 * Apply diff decorations + char-level highlights + revert arrows manually to the diff editor.
 * This bypasses Monaco's worker-based diff which can silently fail in Chrome extensions.
 */
function applyManualDiffDecorations(diffEditor, origContent, modContent) {
    const origLines = origContent.split('\n');
    const modLines = modContent.split('\n');
    const { hunks } = computeLineDiff(origLines, modLines);

    const origEditor = diffEditor.getOriginalEditor();
    const modEditor = diffEditor.getModifiedEditor();

    let totalAdded = 0, totalRemoved = 0;

    const origDecorations = [];
    const modDecorations = [];

    for (const hunk of hunks) {
        // Line-level decorations
        for (const lineNum of hunk.deletedLines) {
            origDecorations.push({
                range: new monaco.Range(lineNum, 1, lineNum, 1),
                options: {
                    isWholeLine: true,
                    className: 'sf-diff-line-delete',
                    linesDecorationsClassName: 'sf-diff-gutter-delete',
                    overviewRuler: { color: '#f85149', position: monaco.editor.OverviewRulerLane.Full }
                }
            });
            totalRemoved++;
        }
        for (const lineNum of hunk.addedLines) {
            modDecorations.push({
                range: new monaco.Range(lineNum, 1, lineNum, 1),
                options: {
                    isWholeLine: true,
                    className: 'sf-diff-line-insert',
                    linesDecorationsClassName: 'sf-diff-gutter-insert',
                    overviewRuler: { color: '#2cbe4e', position: monaco.editor.OverviewRulerLane.Full }
                }
            });
            totalAdded++;
        }

        // Char-level highlighting: pair up deleted and added lines within each hunk
        const pairCount = Math.min(hunk.deletedLines.length, hunk.addedLines.length);
        for (let p = 0; p < pairCount; p++) {
            const origLineNum = hunk.deletedLines[p];
            const modLineNum = hunk.addedLines[p];
            const { origRanges, modRanges } = _charDiff(origLines[origLineNum - 1], modLines[modLineNum - 1]);

            for (const r of origRanges) {
                origDecorations.push({
                    range: new monaco.Range(origLineNum, r.startCol, origLineNum, r.endCol),
                    options: { className: 'sf-diff-char-delete' }
                });
            }
            for (const r of modRanges) {
                modDecorations.push({
                    range: new monaco.Range(modLineNum, r.startCol, modLineNum, r.endCol),
                    options: { className: 'sf-diff-char-insert' }
                });
            }
        }
    }

    origEditor.deltaDecorations([], origDecorations);
    modEditor.deltaDecorations([], modDecorations);

    // Add revert arrows
    _addRevertArrows(diffEditor, hunks, origLines);

    // Store hunks for navigation
    diffState._hunks = hunks;
    diffState._currentHunkIndex = -1;

    // Build change overview strip
    _buildOverviewStrip(diffEditor, hunks, origLines.length, modLines.length);

    return { added: totalAdded, removed: totalRemoved };
}

/**
 * Add VS Code-style revert arrows in the gutter between diff panels.
 * Each arrow reverts one hunk (replaces modified lines with original lines).
 */
function _addRevertArrows(diffEditor, hunks, origLines) {
    // Remove any existing arrows
    const existing = document.getElementById('sf-diff-arrows');
    if (existing) existing.remove();

    if (hunks.length === 0) return;

    const modEditor = diffEditor.getModifiedEditor();

    // Create arrow container — positioned over the modified editor's margin
    const arrowContainer = document.createElement('div');
    arrowContainer.id = 'sf-diff-arrows';
    arrowContainer.style.cssText = 'position:absolute;left:0;top:0;width:28px;z-index:10;pointer-events:none;';

    // Find the modified editor's DOM element and overlay the arrows
    const diffDom = document.querySelector('#diff-editor-container .monaco-diff-editor');
    if (!diffDom) return;
    const modEditorDom = modEditor.getDomNode();
    if (!modEditorDom) return;

    // Position arrow container at the left edge of the modified editor
    modEditorDom.style.position = 'relative';
    modEditorDom.appendChild(arrowContainer);

    const arrowSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.78 1.97a.75.75 0 010 1.06L4.81 6h8.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 01-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"/></svg>';

    for (let idx = 0; idx < hunks.length; idx++) {
        const hunk = hunks[idx];
        // For mixed/insert hunks: anchor to first added line.
        // For pure-delete hunks: anchor to the line AFTER where the deletion happened
        // (modContextBefore + 1), matching VS Code's behaviour.
        const anchorLine = hunk.addedLines.length > 0
            ? hunk.addedLines[0]
            : Math.max(1, hunk.modContextBefore + 1);
        const topPx = modEditor.getTopForLineNumber(anchorLine) - modEditor.getScrollTop();

        const arrow = document.createElement('button');
        arrow.className = 'sf-diff-revert-arrow';
        arrow.title = 'Revert this change (use org version)';
        arrow.innerHTML = arrowSvg;
        arrow.style.cssText = `position:absolute;top:${topPx}px;left:0;pointer-events:auto;`;
        arrow.dataset.hunkIndex = idx;

        arrow.addEventListener('click', () => {
            _revertHunk(diffEditor, hunk, origLines);
        });

        arrowContainer.appendChild(arrow);
    }

    // Re-position arrows on scroll and layout change (resize)
    const scrollDisposable = modEditor.onDidScrollChange(() => {
        _repositionArrows(modEditor, hunks, arrowContainer);
    });
    const layoutDisposable = modEditor.onDidLayoutChange(() => {
        _repositionArrows(modEditor, hunks, arrowContainer);
    });

    // Store disposables for cleanup
    arrowContainer._scrollDisposable = scrollDisposable;
    arrowContainer._layoutDisposable = layoutDisposable;
}

function _repositionArrows(modEditor, hunks, arrowContainer) {
    const arrows = arrowContainer.querySelectorAll('.sf-diff-revert-arrow');
    arrows.forEach((arrow, idx) => {
        if (idx >= hunks.length) return;
        const hunk = hunks[idx];
        const anchorLine = hunk.addedLines.length > 0
            ? hunk.addedLines[0]
            : Math.max(1, hunk.modContextBefore + 1);
        const topPx = modEditor.getTopForLineNumber(anchorLine) - modEditor.getScrollTop();
        arrow.style.top = topPx + 'px';
    });
}

function _revertHunk(diffEditor, hunk, origLines) {
    const modEditor = diffEditor.getModifiedEditor();
    const model = modEditor.getModel();
    if (!model) return;

    // Get the original lines to restore
    const origReplacement = hunk.deletedLines.map(ln => origLines[ln - 1]).join('\n');

    if (hunk.addedLines.length > 0) {
        const modStart = Math.min(...hunk.addedLines);
        const modEnd = Math.max(...hunk.addedLines);

        if (origReplacement === '') {
            // Pure-insert revert: delete the added lines entirely.
            // Ending at (modEnd, maxCol) only reaches the *start* of that line for blank
            // lines (maxCol=1), so only n-1 lines get removed. Extend to (modEnd+1, 1)
            // to capture the trailing newline of modEnd too.
            let range;
            if (modEnd < model.getLineCount()) {
                range = new monaco.Range(modStart, 1, modEnd + 1, 1);
            } else if (modStart > 1) {
                // Inserted at end of file — capture newline at end of preceding line
                range = new monaco.Range(modStart - 1, model.getLineMaxColumn(modStart - 1), modEnd, model.getLineMaxColumn(modEnd));
            } else {
                range = new monaco.Range(modStart, 1, modEnd, model.getLineMaxColumn(modEnd));
            }
            model.pushEditOperations([], [{ range, text: '' }], () => []);
        } else {
            // Mixed hunk: replace the added lines with the original (deleted) content
            const range = new monaco.Range(modStart, 1, modEnd, model.getLineMaxColumn(modEnd));
            model.pushEditOperations([], [{ range, text: origReplacement }], () => []);
        }
    } else {
        // Pure-delete hunk: insert the original lines at modContextBefore + 1
        // (the position in modified where these lines used to be, between the context lines)
        const insertAfterLine = hunk.modContextBefore || 0;
        if (insertAfterLine === 0) {
            // Deletion was at the very start of the file — prepend
            model.pushEditOperations([], [{
                range: new monaco.Range(1, 1, 1, 1),
                text: origReplacement + '\n'
            }], () => []);
        } else {
            // Insert after the context line by appending '\n' + content to that line
            const maxCol = model.getLineMaxColumn(insertAfterLine);
            model.pushEditOperations([], [{
                range: new monaco.Range(insertAfterLine, maxCol, insertAfterLine, maxCol),
                text: '\n' + origReplacement
            }], () => []);
        }
    }

    // Re-run diff with updated content
    const newModContent = model.getValue();
    const overlay = document.getElementById('diff-overlay');
    if (overlay) {
        // Remove old arrows
        const oldArrows = document.getElementById('sf-diff-arrows');
        if (oldArrows) {
            if (oldArrows._scrollDisposable) oldArrows._scrollDisposable.dispose();
            if (oldArrows._layoutDisposable) oldArrows._layoutDisposable.dispose();
            oldArrows.remove();
        }
    }

    // Re-compute diff decorations with the new modified content
    const origEditor = diffEditor.getOriginalEditor();
    origEditor.deltaDecorations(origEditor.getModel().getAllDecorations().filter(d => d.options.className?.startsWith('sf-diff-')).map(d => d.id), []);
    modEditor.deltaDecorations(modEditor.getModel().getAllDecorations().filter(d => d.options.className?.startsWith('sf-diff-')).map(d => d.id), []);

    const origContent = origEditor.getModel().getValue();
    const stats = applyManualDiffDecorations(diffEditor, origContent, newModContent);

    // Update stats display
    const el = document.getElementById('diff-change-stats');
    if (el) {
        if (stats.added || stats.removed) {
            el.innerHTML = `<span class="diff-stat-add">+${stats.added}</span>&nbsp;&nbsp;<span class="diff-stat-remove">&minus;${stats.removed}</span>`;
        } else {
            el.innerHTML = '<span class="diff-stat-identical">Identical</span>';
        }
    }

    // Update the diffState's local content and sync back to main editor
    if (diffState) {
        diffState.localContent = newModContent;
        window.parent.postMessage({
            type: 'DIFF_CONTENT_CHANGED',
            content: newModContent,
            tabId: diffState.tabId
        }, window.location.origin);
    }
}

/**
 * Navigate to prev/next diff hunk in the modified editor.
 * direction: -1 for previous, +1 for next
 */
function _navigateHunk(direction) {
    if (!diffEditorInstance || !diffState._hunks || diffState._hunks.length === 0) return;

    const hunks = diffState._hunks;
    let idx = (diffState._currentHunkIndex ?? -1) + direction;

    // Wrap around
    if (idx < 0) idx = hunks.length - 1;
    if (idx >= hunks.length) idx = 0;

    diffState._currentHunkIndex = idx;
    const hunk = hunks[idx];

    // Scroll modified editor to the hunk.
    // Pure-delete hunks have modStart=0 (never set); use modContextBefore+1 instead.
    const modEditor = diffEditorInstance.getModifiedEditor();
    const targetLine = hunk.addedLines.length > 0
        ? hunk.addedLines[0]
        : Math.max(1, hunk.modContextBefore + 1);
    modEditor.revealLineInCenter(targetLine);

    // Also scroll original editor
    const origEditor = diffEditorInstance.getOriginalEditor();
    const origTargetLine = hunk.deletedLines.length > 0 ? hunk.deletedLines[0] : Math.max(1, hunk.modContextBefore + 1);
    origEditor.revealLineInCenter(origTargetLine);

    // Update nav counter display
    const counter = document.getElementById('diff-nav-counter');
    if (counter) counter.textContent = `${idx + 1} / ${hunks.length}`;

    // Highlight current hunk in overview strip
    _highlightOverviewHunk(idx);
}

/**
 * Build a change overview strip on the right edge of the diff container.
 * Shows colored markers for each hunk relative to file length.
 */
function _buildOverviewStrip(_diffEditor, hunks, origLineCount, modLineCount) {
    const existing = document.getElementById('sf-diff-overview');
    if (existing) existing.remove();

    if (hunks.length === 0) return;

    const container = document.getElementById('diff-editor-container');
    if (!container) return;

    const strip = document.createElement('div');
    strip.id = 'sf-diff-overview';

    const totalLines = Math.max(origLineCount, modLineCount, 1);

    for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        // Use modified line position for placement.
        // Pure-delete hunks have modStart=0; use modContextBefore+1 for correct placement.
        const startLine = hunk.addedLines.length > 0
            ? Math.min(...hunk.addedLines)
            : Math.max(1, hunk.modContextBefore + 1);
        const endLine = hunk.addedLines.length > 0 ? Math.max(...hunk.addedLines) : startLine;
        const hunkSize = endLine - startLine + 1;

        const topPercent = ((startLine - 1) / totalLines) * 100;
        const heightPercent = Math.max((hunkSize / totalLines) * 100, 1.5); // min 1.5% height for visibility

        const isDelete = hunk.addedLines.length === 0;
        const isMixed = hunk.addedLines.length > 0 && hunk.deletedLines.length > 0;

        const marker = document.createElement('div');
        marker.className = 'sf-diff-overview-marker' + (isMixed ? ' mixed' : isDelete ? ' delete' : ' insert');
        marker.style.top = topPercent + '%';
        marker.style.height = heightPercent + '%';
        marker.dataset.hunkIndex = i;
        marker.title = `Change ${i + 1}: ${hunk.deletedLines.length > 0 ? '-' + hunk.deletedLines.length : ''}${hunk.addedLines.length > 0 ? '+' + hunk.addedLines.length : ''}`;

        marker.addEventListener('click', () => {
            diffState._currentHunkIndex = i - 1; // -1 because _navigateHunk will +1
            _navigateHunk(1);
        });

        strip.appendChild(marker);
    }

    container.appendChild(strip);
}

function _highlightOverviewHunk(activeIndex) {
    const markers = document.querySelectorAll('.sf-diff-overview-marker');
    markers.forEach((m, i) => {
        m.classList.toggle('active', i === activeIndex);
    });
}

function _countChanges(changes) {
    let added = 0, removed = 0;
    for (const change of changes) {
        if (change.modifiedEndLineNumber >= change.modifiedStartLineNumber) {
            added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
        }
        if (change.originalEndLineNumber >= change.originalStartLineNumber) {
            removed += change.originalEndLineNumber - change.originalStartLineNumber + 1;
        }
    }
    return { added, removed, total: changes.length };
}

function generateUnifiedDiff(originalContent, modifiedContent, fileName) {
    const origLines = originalContent.split('\n');
    const modLines = modifiedContent.split('\n');
    let output = `--- a/${fileName} (Org)\n+++ b/${fileName} (Local)\n`;

    // Try Monaco native diff first
    if (diffEditorInstance) {
        const changes = diffEditorInstance.getLineChanges();
        if (changes && changes.length > 0) {
            for (const change of changes) {
                const origStart = change.originalStartLineNumber;
                const origEnd = change.originalEndLineNumber;
                const modStart = change.modifiedStartLineNumber;
                const modEnd = change.modifiedEndLineNumber;
                const origCount = Math.max(0, origEnd - origStart + 1);
                const modCount = Math.max(0, modEnd - modStart + 1);
                output += `@@ -${origStart},${origCount} +${modStart},${modCount} @@\n`;
                for (let i = origStart - 1; i <= origEnd - 1 && i < origLines.length; i++) {
                    output += `-${origLines[i]}\n`;
                }
                for (let i = modStart - 1; i <= modEnd - 1 && i < modLines.length; i++) {
                    output += `+${modLines[i]}\n`;
                }
            }
            return output;
        }
    }

    // Fallback: use manual LCS diff
    const { hunks } = computeLineDiff(origLines, modLines);
    if (hunks.length === 0) {
        output += '\n(No changes)\n';
        return output;
    }
    for (const hunk of hunks) {
        // origStart: for pure-insert (origStart=0) use the context line (modContextBefore)
        // since equal lines share the same number in both sides.
        const origStart = hunk.origStart || hunk.modContextBefore || 0;
        // modStart: for pure-delete (modStart=0) use modContextBefore+1 (insertion point)
        const modStart = hunk.modStart || Math.max(1, hunk.modContextBefore + 1);
        output += `@@ -${origStart},${hunk.deletedLines.length} +${modStart},${hunk.addedLines.length} @@\n`;
        for (const lineNum of hunk.deletedLines) output += `-${origLines[lineNum - 1]}\n`;
        for (const lineNum of hunk.addedLines) output += `+${modLines[lineNum - 1]}\n`;
    }
    return output;
}

function showDiffEditor(localContent, orgContent, fileName, metadata, tabType, tabId, edgeCaseType, errorMessage) {
    closeDiffEditor();

    diffState = { localContent, orgContent, fileName, metadata, tabType, tabId, edgeCaseType };

    const ext = fileName.split('.').pop().toLowerCase();
    const langMap = { cls: 'apex', trigger: 'apex', js: 'javascript', html: 'html', css: 'css', xml: 'xml', json: 'json', cmp: 'html', app: 'html', design: 'xml' };
    const language = langMap[ext] || 'plaintext';

    const typeLabel = DIFF_TYPE_LABELS[tabType] || tabType || 'File';
    const typeColor = DIFF_TYPE_COLORS[tabType] || '#888';
    const displayName = fileName.replace(/\.\w+$/, '');

    // Edge case badges
    let edgeBadge = '';
    if (edgeCaseType === 'new_in_local') {
        edgeBadge = '<span class="diff-badge diff-badge-new">New in Local</span>';
    } else if (edgeCaseType === 'deleted_locally') {
        edgeBadge = '<span class="diff-badge diff-badge-deleted">Deleted Locally</span>';
    }

    // Metadata detail string
    let metaDetail = '';
    if (metadata) {
        const parts = [];
        if (metadata.apiVersion) parts.push(`API v${metadata.apiVersion}`);
        if (metadata.lastModifiedBy) parts.push(`by ${metadata.lastModifiedBy}`);
        if (metadata.lastModified) parts.push(new Date(metadata.lastModified).toLocaleString());
        metaDetail = parts.join(' &middot; ');
    }

    const overlay = document.createElement('div');
    overlay.id = 'diff-overlay';

    // Handle error/unsupported edge cases with special overlay
    if (edgeCaseType === 'unsupported') {
        overlay.innerHTML = `
            <div class="diff-metadata-header">
                <div class="diff-meta-left">
                    <span class="diff-type-badge" style="background:${typeColor}">${typeLabel}</span>
                    <span class="diff-file-name">${displayName}</span>
                </div>
                <div class="diff-meta-right">
                    <button class="diff-toolbar-btn" id="diff-close-btn" title="Close (Esc)">${DIFF_ICONS.close}</button>
                </div>
            </div>
            <div class="diff-edge-state">
                <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.15"><path d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-9.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM6.5 8a.5.5 0 01.5-.5h1a.5.5 0 01.5.5v4a.5.5 0 01-.5.5H7a.5.5 0 01-.5-.5V8z"/></svg>
                <div class="diff-edge-title">Diff Not Supported</div>
                <div class="diff-edge-desc">Metadata type "${typeLabel}" does not support file-level diffing.</div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('diff-close-btn').addEventListener('click', closeDiffEditor);
        overlay._escHandler = (e) => { if (e.key === 'Escape') closeDiffEditor(); };
        document.addEventListener('keydown', overlay._escHandler);
        return;
    }

    if (edgeCaseType === 'fetch_error') {
        overlay.innerHTML = `
            <div class="diff-metadata-header">
                <div class="diff-meta-left">
                    <span class="diff-type-badge" style="background:${typeColor}">${typeLabel}</span>
                    <span class="diff-file-name">${displayName}</span>
                    <span class="diff-badge diff-badge-error">Fetch Failed</span>
                </div>
                <div class="diff-meta-right">
                    <button class="diff-toolbar-btn" id="diff-close-btn" title="Close (Esc)">${DIFF_ICONS.close}</button>
                </div>
            </div>
            <div class="diff-edge-state">
                <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.15"><path d="M8 15A7 7 0 108 1a7 7 0 000 14zm-.5-2.5a.5.5 0 011 0v-1a.5.5 0 01-1 0v1zM8 4a.5.5 0 01.5.5v4a.5.5 0 01-1 0v-4A.5.5 0 018 4z"/></svg>
                <div class="diff-edge-title">Failed to Retrieve Org Version</div>
                <div class="diff-edge-desc">${errorMessage || 'An error occurred while fetching the file from the org.'}</div>
                <button class="diff-edge-retry" id="diff-retry-btn">${DIFF_ICONS.refresh} Retry</button>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('diff-close-btn').addEventListener('click', closeDiffEditor);
        document.getElementById('diff-retry-btn').addEventListener('click', () => {
            window.parent.postMessage({ type: 'DIFF_REFRESH' }, window.location.origin);
        });
        overlay._escHandler = (e) => { if (e.key === 'Escape') closeDiffEditor(); };
        document.addEventListener('keydown', overlay._escHandler);
        return;
    }

    // Normal diff overlay
    overlay.innerHTML = `
        <div class="diff-metadata-header">
            <div class="diff-meta-left">
                <span class="diff-type-badge" style="background:${typeColor}">${typeLabel}</span>
                <span class="diff-file-name">${displayName}</span>
                <span class="diff-direction-label">Local vs Org</span>
                ${edgeBadge}
            </div>
            <div class="diff-meta-right">
                ${metaDetail ? `<span class="diff-meta-detail">${metaDetail}</span>` : ''}
                <span id="diff-change-stats" class="diff-change-stats"></span>
            </div>
        </div>
        <div class="diff-toolbar">
            <div class="diff-toolbar-left">
                <button class="diff-toolbar-btn active" id="diff-btn-sbs" title="Side by Side">${DIFF_ICONS.sideBySide}<span class="diff-btn-label">Side-by-side</span></button>
                <button class="diff-toolbar-btn" id="diff-btn-inline" title="Inline">${DIFF_ICONS.inline}<span class="diff-btn-label">Inline</span></button>
                <span class="diff-toolbar-divider"></span>
                <button class="diff-toolbar-btn" id="diff-btn-whitespace" title="Ignore Whitespace">${DIFF_ICONS.whitespace}<span class="diff-btn-label">Whitespace</span></button>
                <button class="diff-toolbar-btn" id="diff-btn-collapse" title="Collapse Unchanged">${DIFF_ICONS.collapse}<span class="diff-btn-label">Collapse</span></button>
            </div>
            <div class="diff-toolbar-right">
                <button class="diff-toolbar-btn" id="diff-btn-prev" title="Previous Change (Alt+↑)"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 01.354.146l4 4a.5.5 0 01-.708.708L8 4.707 4.354 8.354a.5.5 0 11-.708-.708l4-4A.5.5 0 018 3.5z"/></svg></button>
                <span id="diff-nav-counter" class="diff-nav-counter"></span>
                <button class="diff-toolbar-btn" id="diff-btn-next" title="Next Change (Alt+↓)"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12.5a.5.5 0 01-.354-.146l-4-4a.5.5 0 01.708-.708L8 11.293l3.646-3.647a.5.5 0 01.708.708l-4 4A.5.5 0 018 12.5z"/></svg></button>
                <span class="diff-toolbar-divider"></span>
                <button class="diff-toolbar-btn" id="diff-btn-refresh" title="Refresh Diff">${DIFF_ICONS.refresh}</button>
                <button class="diff-toolbar-btn" id="diff-btn-fullscreen" title="Fullscreen">${DIFF_ICONS.fullscreen}</button>
                <span class="diff-toolbar-divider"></span>
                <button class="diff-toolbar-btn diff-close-btn" id="diff-close-btn" title="Close (Esc)">${DIFF_ICONS.close}</button>
            </div>
        </div>
        <div class="diff-actions-strip">
            <button class="diff-action-btn apply" id="diff-act-apply">${DIFF_ICONS.apply}<span>Apply to Editor</span></button>
            <span class="diff-actions-divider"></span>
            <button class="diff-action-btn deploy" id="diff-act-deploy">${DIFF_ICONS.deploy}<span>Deploy Local &rarr; Org</span></button>
            <button class="diff-action-btn retrieve" id="diff-act-retrieve">${DIFF_ICONS.retrieve}<span>Retrieve Org &rarr; Local</span></button>
            <div class="diff-actions-spacer"></div>
            <button class="diff-action-btn" id="diff-act-copy">${DIFF_ICONS.copy}<span>Copy Changes</span></button>
            <button class="diff-action-btn" id="diff-act-export">${DIFF_ICONS.export}<span>Export Diff</span></button>
        </div>
        <div id="diff-editor-container"></div>
    `;
    document.body.appendChild(overlay);

    // Normalize for display
    const normalizedLocal = normalizeForDiff(localContent || '');
    const normalizedOrg = normalizeForDiff(orgContent || '');

    const originalModel = monaco.editor.createModel(normalizedOrg, language);
    const modifiedModel = monaco.editor.createModel(normalizedLocal, language);

    // Define and apply custom theme with diff colors
    monaco.editor.defineTheme('sf-diff-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'diffEditor.insertedTextBackground': '#23863633',
            'diffEditor.removedTextBackground': '#ce313133',
            'diffEditor.insertedLineBackground': '#2cbe4e33',
            'diffEditor.removedLineBackground': '#f8514933',
            'diffEditorGutter.insertedLineBackground': '#2cbe4e44',
            'diffEditorGutter.removedLineBackground': '#f8514944',
            'diffEditor.insertedTextBorder': '#23863600',
            'diffEditor.removedTextBorder': '#ce313100',
            'diffEditorOverview.insertedForeground': '#28a745',
            'diffEditorOverview.removedForeground': '#dc3545',
        }
    });
    // Set theme GLOBALLY before creating diff editor (Monaco requires this)
    monaco.editor.setTheme('sf-diff-dark');

    // Inject CSS variables on <html> element as failsafe (ensures cascade to all Monaco elements)
    document.documentElement.style.setProperty('--vscode-diffEditor-insertedTextBackground', 'rgba(35, 134, 54, 0.2)');
    document.documentElement.style.setProperty('--vscode-diffEditor-removedTextBackground', 'rgba(206, 49, 49, 0.2)');
    document.documentElement.style.setProperty('--vscode-diffEditor-insertedLineBackground', 'rgba(44, 190, 78, 0.2)');
    document.documentElement.style.setProperty('--vscode-diffEditor-removedLineBackground', 'rgba(248, 81, 73, 0.2)');
    document.documentElement.style.setProperty('--vscode-diffEditorGutter-insertedLineBackground', 'rgba(44, 190, 78, 0.27)');
    document.documentElement.style.setProperty('--vscode-diffEditorGutter-removedLineBackground', 'rgba(248, 81, 73, 0.27)');

    const diffContainer = document.getElementById('diff-editor-container');
    diffEditorInstance = monaco.editor.createDiffEditor(diffContainer, {
        automaticLayout: true,
        readOnly: false,
        renderSideBySide: true,
        enableSplitViewResizing: true,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        ignoreTrimWhitespace: false,
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        renderOverviewRuler: true,
        originalEditable: false,
        padding: { top: 8 },
    });

    diffEditorInstance.setModel({ original: originalModel, modified: modifiedModel });

    // Track edits on the modified (local) side and sync back to main editor
    let _diffSyncTimer = null;
    const _initialModContent = modifiedModel.getValue();
    modifiedModel.onDidChangeContent(() => {
        // Activate "Apply to Editor" button when content differs from last applied/initial
        const applyBtn = document.getElementById('diff-act-apply');
        if (applyBtn) {
            const baseline = diffState._appliedContent || _initialModContent;
            const changed = modifiedModel.getValue() !== baseline;
            applyBtn.classList.toggle('enabled', changed);
            applyBtn.disabled = !changed;
        }

        clearTimeout(_diffSyncTimer);
        _diffSyncTimer = setTimeout(() => {
            if (!diffEditorInstance) return;
            const newContent = modifiedModel.getValue();
            if (diffState) diffState.localContent = newContent;

            // Sync to parent tab
            window.parent.postMessage({
                type: 'DIFF_CONTENT_CHANGED',
                content: newContent,
                tabId: diffState.tabId
            }, window.location.origin);

            // Re-compute diff decorations
            const origEditor = diffEditorInstance.getOriginalEditor();
            const modEditor = diffEditorInstance.getModifiedEditor();
            origEditor.deltaDecorations(
                origEditor.getModel().getAllDecorations().filter(d => d.options.className?.startsWith('sf-diff-')).map(d => d.id), []
            );
            modEditor.deltaDecorations(
                modEditor.getModel().getAllDecorations().filter(d => d.options.className?.startsWith('sf-diff-')).map(d => d.id), []
            );
            // Remove old arrows
            const oldArrows = document.getElementById('sf-diff-arrows');
            if (oldArrows) {
                if (oldArrows._scrollDisposable) oldArrows._scrollDisposable.dispose();
                oldArrows.remove();
            }
            const origContent = origEditor.getModel().getValue();
            const stats = applyManualDiffDecorations(diffEditorInstance, origContent, newContent);
            const el = document.getElementById('diff-change-stats');
            if (el) {
                if (stats.added || stats.removed) {
                    el.innerHTML = `<span class="diff-stat-add">+${stats.added}</span>&nbsp;&nbsp;<span class="diff-stat-remove">&minus;${stats.removed}</span>`;
                } else {
                    el.innerHTML = '<span class="diff-stat-identical">Identical</span>';
                }
            }
        }, 500);
    });

    // Monaco's worker-based diff silently fails in Chrome extension iframes.
    // Use manual diff computation + decorations as primary approach.
    let monacoHandledDiff = false;

    // Listen for Monaco's native diff (in case it works)
    diffEditorInstance.onDidUpdateDiff(() => {
        monacoHandledDiff = true;
        const changes = diffEditorInstance.getLineChanges();
        if (changes && changes.length > 0) {
            const stats = _countChanges(changes);
            const el = document.getElementById('diff-change-stats');
            if (el) {
                el.innerHTML = `<span class="diff-stat-add">+${stats.added}</span>&nbsp;&nbsp;<span class="diff-stat-remove">&minus;${stats.removed}</span>`;
            }
        }
    });

    // Apply manual diff decorations after editor renders (reliable fallback)
    setTimeout(() => {
        if (!diffEditorInstance) return;
        if (monacoHandledDiff) return;
        const stats = applyManualDiffDecorations(diffEditorInstance, normalizedOrg, normalizedLocal);
        const el = document.getElementById('diff-change-stats');
        if (el) {
            if (stats.added || stats.removed) {
                el.innerHTML = `<span class="diff-stat-add">+${stats.added}</span>&nbsp;&nbsp;<span class="diff-stat-remove">&minus;${stats.removed}</span>`;
            } else {
                el.innerHTML = '<span class="diff-stat-identical">Identical</span>';
            }
        }
    }, 800);

    // --- Toolbar handlers ---
    const sbsBtn = document.getElementById('diff-btn-sbs');
    const inlineBtn = document.getElementById('diff-btn-inline');
    const wsBtn = document.getElementById('diff-btn-whitespace');
    const collapseBtn = document.getElementById('diff-btn-collapse');

    sbsBtn.addEventListener('click', () => {
        diffEditorInstance.updateOptions({ renderSideBySide: true });
        sbsBtn.classList.add('active');
        inlineBtn.classList.remove('active');
    });
    inlineBtn.addEventListener('click', () => {
        diffEditorInstance.updateOptions({ renderSideBySide: false });
        inlineBtn.classList.add('active');
        sbsBtn.classList.remove('active');
    });
    wsBtn.addEventListener('click', () => {
        const active = wsBtn.classList.toggle('active');
        diffEditorInstance.updateOptions({ ignoreTrimWhitespace: active });
    });
    collapseBtn.addEventListener('click', () => {
        const active = collapseBtn.classList.toggle('active');
        diffEditorInstance.updateOptions({ hideUnchangedRegions: { enabled: active, contextLineCount: 3 } });
    });

    // Navigation handlers
    document.getElementById('diff-btn-prev').addEventListener('click', () => _navigateHunk(-1));
    document.getElementById('diff-btn-next').addEventListener('click', () => _navigateHunk(1));

    document.getElementById('diff-btn-refresh').addEventListener('click', () => {
        window.parent.postMessage({ type: 'DIFF_REFRESH' }, window.location.origin);
    });
    document.getElementById('diff-btn-fullscreen').addEventListener('click', () => {
        window.parent.postMessage({ type: 'DIFF_FULLSCREEN' }, window.location.origin);
    });
    document.getElementById('diff-close-btn').addEventListener('click', closeDiffEditor);

    // --- Quick action handlers ---
    document.getElementById('diff-act-apply').addEventListener('click', () => {
        if (!diffEditorInstance || !diffState.tabId) return;
        const modModel = diffEditorInstance.getModifiedEditor().getModel();
        if (!modModel) return;
        const currentContent = modModel.getValue();
        diffState.localContent = currentContent;
        diffState._appliedContent = currentContent; // track what was applied
        window.parent.postMessage({
            type: 'DIFF_APPLY_TO_EDITOR',
            content: currentContent,
            tabId: diffState.tabId
        }, window.location.origin);
        const btn = document.getElementById('diff-act-apply');
        btn.classList.add('flash');
        btn.innerHTML = DIFF_ICONS.apply + '<span>Applied!</span>';
        setTimeout(() => {
            btn.classList.remove('flash', 'enabled');
            btn.disabled = true;
            btn.innerHTML = DIFF_ICONS.apply + '<span>Apply to Editor</span>';
        }, 1500);
    });
    document.getElementById('diff-act-deploy').addEventListener('click', () => {
        window.parent.postMessage({ type: 'DIFF_DEPLOY_LOCAL' }, window.location.origin);
    });
    document.getElementById('diff-act-retrieve').addEventListener('click', () => {
        window.parent.postMessage({ type: 'DIFF_RETRIEVE_ORG', orgContent: diffState.orgContent }, window.location.origin);
    });
    document.getElementById('diff-act-copy').addEventListener('click', () => {
        const diffText = generateUnifiedDiff(normalizedOrg, normalizedLocal, fileName);
        navigator.clipboard.writeText(diffText).then(() => {
            const btn = document.getElementById('diff-act-copy');
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 800);
        });
    });
    document.getElementById('diff-act-export').addEventListener('click', () => {
        const diffText = generateUnifiedDiff(normalizedOrg, normalizedLocal, fileName);
        const blob = new Blob([diffText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.patch`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Keyboard shortcuts: Esc to close, Alt+Up/Down to navigate hunks
    overlay._escHandler = (e) => {
        if (e.key === 'Escape') closeDiffEditor();
        if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); _navigateHunk(-1); }
        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); _navigateHunk(1); }
    };
    document.addEventListener('keydown', overlay._escHandler);
}

function closeDiffEditor() {
    const overlay = document.getElementById('diff-overlay');
    if (overlay) {
        if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
        overlay.remove();
    }
    // Clean up revert arrows
    const arrows = document.getElementById('sf-diff-arrows');
    if (arrows) {
        if (arrows._scrollDisposable) arrows._scrollDisposable.dispose();
        if (arrows._layoutDisposable) arrows._layoutDisposable.dispose();
        arrows.remove();
    }
    if (diffEditorInstance) {
        const model = diffEditorInstance.getModel();
        if (model) {
            if (model.original) model.original.dispose();
            if (model.modified) model.modified.dispose();
        }
        diffEditorInstance.dispose();
        diffEditorInstance = null;
    }
    // Restore original theme for the main editor
    monaco.editor.setTheme('vs-dark');
    // Clean up CSS variables from <html>
    document.documentElement.style.removeProperty('--vscode-diffEditor-insertedTextBackground');
    document.documentElement.style.removeProperty('--vscode-diffEditor-removedTextBackground');
    document.documentElement.style.removeProperty('--vscode-diffEditor-insertedLineBackground');
    document.documentElement.style.removeProperty('--vscode-diffEditor-removedLineBackground');
    document.documentElement.style.removeProperty('--vscode-diffEditorGutter-insertedLineBackground');
    document.documentElement.style.removeProperty('--vscode-diffEditorGutter-removedLineBackground');
    // If content was modified via revert arrows, update the main editor model
    if (diffState.localContent && diffState.tabId) {
        const mainModel = monaco.editor.getModels().find(m => m.uri.toString().includes(diffState.tabId));
        if (mainModel) {
            mainModel.setValue(diffState.localContent);
        }
    }
    diffState = {};
    window.parent.postMessage({ type: 'DIFF_CLOSED' }, window.location.origin);
}
