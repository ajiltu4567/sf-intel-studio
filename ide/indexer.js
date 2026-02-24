/**
 * SF-Intel Studio - Workspace Indexer
 * Parses metadata and open files to extract symbols (classes, methods, fields).
 * Now includes Governor Limit Guard (Static Analysis).
 */

window.SymbolIndex = {
    files: {}, // id -> { name, type, symbols: { methods: [], fields: [], classes: [] }, diagnostics: [] }

    /**
     * Parses a single file and updates its symbols in the index.
     */
    indexFile: function (id, name, type, content) {
        if (!content) return;

        const symbols = {
            methods: [],
            fields: [],
            classes: []
        };

        let diagnostics = [];

        const isApex = type === 'ApexClass' || type === 'ApexTrigger' || type === 'apex' ||
            name.endsWith('.cls') || name.endsWith('.trigger');

        if (isApex) {
            this._parseApex(content, symbols);
            diagnostics = this._analyzeGovernorLimits(content);

            // BETA 6: Enhanced Apex Symbol Indexing
            if (window.ApexSymbolIndexer) {
                try {
                    window.ApexSymbolIndexer.indexFile(id, content, name);
                } catch (err) {
                    console.warn('[SF-Intel Indexer] ApexSymbolIndexer failed:', err);
                }
            }
        } else if (type === 'LWC' || name.endsWith('.js')) {
            this._parseJavascript(content, symbols);
        }

        this.files[id] = {
            name: name,
            type: type,
            symbols: symbols,
            diagnostics: diagnostics,
            lastIndexed: Date.now()
        };

        console.log(`[SF-Intel Indexer] Indexed ${name} (${symbols.methods.length} methods). Diagnostics: ${diagnostics.length}`);

        // Notify editor to show markers
        if (diagnostics.length > 0) {
            window.parent.postMessage({ type: 'MARKERS_UPDATE', id, diagnostics }, window.location.origin);
        } else {
            window.parent.postMessage({ type: 'MARKERS_UPDATE', id, diagnostics: [] }, window.location.origin);
        }
    },

    /**
     * Extracts methods and properties from Apex code using regex.
     */
    _parseApex: function (content, symbols) {
        const classRegex = /(?:public|private|global|protected)\s+(?:with\s+sharing|without\s+sharing|inherited\s+sharing)?\s*class\s+(\w+)/gi;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
            symbols.classes.push({ name: match[1], offset: match.index });
        }

        const methodRegex = /(public|private|global|protected)\s+(static\s+)?([\w<>, ]+)\s+(\w+)\s*\(([^)]*)\)/gi;
        while ((match = methodRegex.exec(content)) !== null) {
            symbols.methods.push({
                name: match[4],
                isStatic: !!match[2],
                returnType: match[3].trim(),
                params: match[5].trim(),
                offset: match.index
            });
        }

        const propRegex = /(public|private|global|protected)\s+(static\s+)?([\w<>, ]+)\s+(\w+)\s*\{/gi;
        while ((match = propRegex.exec(content)) !== null) {
            symbols.fields.push({
                name: match[4],
                isStatic: !!match[2],
                type: match[3].trim(),
                offset: match.index
            });
        }
    },

    /**
     * Static Analysis for Governor Limits (SIP-3.0)
     */
    _analyzeGovernorLimits: function (content) {
        const lines = content.split('\n');
        const diagnostics = [];
        let insideLoop = false;
        let loopBraceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//')) continue;

            // Strip string literals before keyword analysis to avoid false positives
            // e.g. 'Compliance Update: ...' contains the word "update" but is not DML
            const lineStripped = line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

            // Detect entry into a loop
            if (line.match(/\b(for|while)\s*\(/)) {
                insideLoop = true;
            }

            if (insideLoop) {
                if (line.includes('{')) loopBraceCount += (line.match(/\{/g) || []).length;
                if (line.includes('}')) loopBraceCount -= (line.match(/\}/g) || []).length;

                // Detect SOQL in Loop
                if (lineStripped.match(/\[\s*SELECT/i)) {
                    diagnostics.push({
                        severity: 4, // Warning (monaco.MarkerSeverity.Warning)
                        message: 'Governor Limit Warning: SOQL query found inside a loop. Bulkify your code to avoid System.LimitException (101 queries).',
                        startLineNumber: i + 1,
                        startColumn: lines[i].indexOf('['),
                        endLineNumber: i + 1,
                        endColumn: lines[i].indexOf(']') + 2 || lines[i].length + 1
                    });
                }

                // Detect DML in Loop (check stripped line to ignore keywords in string literals)
                if (lineStripped.match(/\b(insert|update|delete|upsert|merge)\b/i) && !lineStripped.includes('(') && !line.trim().startsWith('//')) {
                    const match = lineStripped.match(/\b(insert|update|delete|upsert|merge)\b/i);
                    diagnostics.push({
                        severity: 8, // Error (monaco.MarkerSeverity.Error)
                        message: `Governor Limit Error: DML statement (${match[0]}) found inside a loop. This will quickly exceed 150 DML limit. Use Collections and bulkify.`,
                        startLineNumber: i + 1,
                        startColumn: match.index + 1,
                        endLineNumber: i + 1,
                        endColumn: match.index + match[0].length + 1
                    });
                }

                // Exit loop check
                if (loopBraceCount <= 0 && line.includes('}')) {
                    insideLoop = false;
                }
            } else {
                // Secondary check for compact loops: for(...) query;
                if (line.match(/\b(for|while)\s*\(.*\)\s*\[\s*SELECT/i)) {
                    diagnostics.push({
                        severity: 4,
                        message: 'Governor Limit Warning: SOQL query found inside a loop. Bulkify your code.',
                        startLineNumber: i + 1,
                        startColumn: 1,
                        endLineNumber: i + 1,
                        endColumn: lines[i].length + 1
                    });
                }
            }
        }
        return diagnostics;
    },

    /**
     * Extracts symbols from Javascript (LWC).
     */
    _parseJavascript: function (content, symbols) {
        const apiRegex = /@api\s+(\w+)/g;
        let match;
        while ((match = apiRegex.exec(content)) !== null) {
            symbols.fields.push({ name: match[1], isPublic: true });
        }

        const methodRegex = /(\w+)\s*\(([^)]*)\)\s*\{/g;
        while ((match = methodRegex.exec(content)) !== null) {
            if (['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(match[1])) continue;
            symbols.methods.push({ name: match[1], params: match[2] });
        }
    },

    /**
     * Searches for symbols by name across the index.
     */
    searchByClass: function (className) {
        for (const id in this.files) {
            const file = this.files[id];
            if (file.name.toLowerCase().includes(className.toLowerCase())) {
                return file.symbols;
            }
        }
        return null;
    }
};
