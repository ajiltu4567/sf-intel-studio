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
        automaticLayout: false, // Manual layout for performance
        fontSize: 13,

        // Performance optimizations
        minimap: { enabled: false }, // Heavy DOM rendering
        folding: true,
        foldingStrategy: 'indentation', // Use indentation-based folding for better Apex support
        showFoldingControls: 'always', // Always show fold controls, not just on hover
        scrollBeyondLastLine: false,

        // Rich editing features (now safe with workers)
        bracketPairColorization: { enabled: true },
        renderValidationDecorations: 'on', // Show validation errors

        // UX Polish
        padding: { top: 10 },
        fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', 'Courier New', monospace",
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        renderLineHighlight: "all",
        fixedOverflowWidgets: true,

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

    // ===== SOQL INTELLIGENT AUTOCOMPLETE (Beta-9) =====
    // Register completion provider for SOQL queries in the SQL language
    monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ',', ' ', '('],
        
        provideCompletionItems: async (model, position) => {
            if (!window.SOQLParser || !window.SchemaCache) {
                return { suggestions: [] };
            }
            
            const text = model.getValue();
            const offset = model.getOffsetAt(position);
            
            try {
                // Get context-aware suggestions
                const suggestions = await window.SOQLAutocomplete.getSuggestions(text, offset);
                
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn
                };
                
                return {
                    suggestions: suggestions.map(s => ({
                        label: s.label,
                        kind: mapSuggestionKind(s.kind),
                        insertText: s.insertText || s.label,
                        detail: s.detail || '',
                        documentation: s.documentation || '',
                        range: range,
                        sortText: s.isCustom ? '1' + s.label : '0' + s.label
                    }))
                };
            } catch (err) {
                console.error('[SOQL Autocomplete] Error:', err);
                return { suggestions: [] };
            }
        }
    });
    
    // Map suggestion kinds to Monaco CompletionItemKind
    function mapSuggestionKind(kind) {
        const kinds = {
            'field': monaco.languages.CompletionItemKind.Field,
            'reference': monaco.languages.CompletionItemKind.Reference,
            'class': monaco.languages.CompletionItemKind.Class,
            'keyword': monaco.languages.CompletionItemKind.Keyword,
            'operator': monaco.languages.CompletionItemKind.Operator,
            'constant': monaco.languages.CompletionItemKind.Constant
        };
        return kinds[kind] || monaco.languages.CompletionItemKind.Text;
    }
    
    // Register hover provider for SOQL field information
    monaco.languages.registerHoverProvider('sql', {
        provideHover: async (model, position) => {
            if (!window.SOQLParser || !window.SchemaCache) return null;
            
            const text = model.getValue();
            const word = model.getWordAtPosition(position);
            if (!word) return null;
            
            const context = window.SOQLParser.getContext(text, model.getOffsetAt(position));
            if (!context.rootObject) return null;
            
            try {
                // Validate the field and get its metadata
                const fieldPath = word.word;
                const validation = await window.SOQLParser.validateField(context.rootObject, fieldPath);
                
                if (validation.valid && validation.field) {
                    const f = validation.field;
                    const contents = [
                        { value: `**${f.apiName}** (${f.type})` },
                        { value: `Label: ${f.label}` },
                        { value: `${f.isCustom ? '📌 Custom Field' : '📋 Standard Field'}` }
                    ];
                    
                    if (f.length) contents.push({ value: `Length: ${f.length}` });
                    if (f.isRelationship) contents.push({ value: `→ Relationship to: ${f.referenceTo}` });
                    if (f.isNillable) contents.push({ value: `Nullable: Yes` });
                    
                    return {
                        range: new monaco.Range(
                            position.lineNumber, word.startColumn,
                            position.lineNumber, word.endColumn
                        ),
                        contents: contents
                    };
                }
            } catch (err) {
                console.warn('[SOQL Hover] Error:', err);
            }
            
            return null;
        }
    });
    
    console.log('[Monaco] ✅ SOQL Intelligent Autocomplete registered');

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
        case 'SET_VALUE':
            monacoEditor.setValue(message.value);
            if (message.language) {
                monaco.editor.setModelLanguage(monacoEditor.getModel(), message.language);
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
        case 'GLOBAL_DESCRIBE_RESULT':
        case 'DESCRIBE_RESULT':
            if (window.SchemaManager) {
                window.SchemaManager.handleBridgeResult(message);
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
