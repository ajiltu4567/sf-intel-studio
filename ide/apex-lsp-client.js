/**
 * Apex LSP Client - Browser Interface to Rust CLI
 * Communicates with sf-intel CLI for AST-based symbol indexing
 * Version: v3.2.0 (Beta 6.1)
 */

class ApexLSPClient {
    constructor(baseUrl = 'http://127.0.0.1:3000') {
        this.baseUrl = baseUrl;
        this.healthy = false;
        this.socket = null;
        this.requestId = 0;
        this.pendingRequests = new Map(); // id -> {resolve, reject}
        this.messageQueue = [];
        this.initialized = false; // Prevent multiple initialization
        this.checkHealth();
        this.connectLSP();
    }

    /**
     * Check if CLI is running and healthy
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/api/stats`, {
                method: 'GET',
                signal: AbortSignal.timeout(1000) // 1 second timeout
            });

            if (response.ok) {
                // Any 200 OK from the server means we are connected and healthy
                this.healthy = true;
                console.log('[ApexLSP] CLI is healthy');
            } else {
                this.healthy = false;
            }
        } catch (error) {
            this.healthy = false;
            console.log('[ApexLSP] CLI not available, using fallback mode');
        }

        return this.healthy;
    }

    /**
     * Index a file with the CLI
     * @param {string} fileId - Unique file identifier
     * @param {string} fileName - File name (e.g., "AccountController.cls")
     * @param {string} source - Apex source code
     * @returns {Promise<Object>} Indexed symbols
     */
    async indexFile(fileId, fileName, source) {
        if (!this.healthy) {
            console.log('[ApexLSP] CLI not available, skipping indexing');
            return null;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/apex/index`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId, fileName, source })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`[ApexLSP] Indexed ${fileName}:`, result.symbols);
            return result;
        } catch (error) {
            console.error('[ApexLSP] Error indexing file:', error);
            return null;
        }
    }

    /**
     * Get symbols for a specific file
     * @param {string} fileId - File identifier
     * @returns {Promise<Object>} File symbols
     */
    async getFileSymbols(fileId) {
        if (!this.healthy) return null;

        try {
            const response = await fetch(`${this.baseUrl}/api/apex/symbols/${fileId}`, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`[ApexLSP] No symbols found for ${fileId}`);
                    return null;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApexLSP] Error getting symbols:', error);
            return null;
        }
    }

    /**
     * Find symbol across all indexed files
     * @param {string} symbolName - Name of symbol to find
     * @returns {Promise<Array>} Array of symbol locations
     */
    async findSymbol(symbolName) {
        if (!this.healthy) return [];

        try {
            const response = await fetch(`${this.baseUrl}/api/apex/find-symbol`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbolName })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            return result.results || [];
        } catch (error) {
            console.error('[ApexLSP] Error finding symbol:', error);
            return [];
        }
    }

    /**
     * Hybrid: Get symbols from CLI or fallback to local indexer
     */
    async getSymbolsHybrid(fileId) {
        // Try CLI first
        const cliSymbols = await this.getFileSymbols(fileId);
        if (cliSymbols) return { source: 'cli', symbols: cliSymbols };

        // Fallback to local JavaScript indexer
        if (window.ApexSymbolIndexer) {
            const jsSymbols = window.ApexSymbolIndexer.getFileSymbols(fileId);
            if (jsSymbols) return { source: 'local', symbols: jsSymbols };
        }

        return { source: 'none', symbols: null };
    }

    /**
     * Hybrid: Find symbol from CLI or fallback to local indexer
     */
    async findSymbolHybrid(symbolName) {
        // Try CLI first
        const cliResults = await this.findSymbol(symbolName);
        if (cliResults.length > 0) return { source: 'cli', results: cliResults };

        // Fallback to local JavaScript indexer
        if (window.ApexSymbolIndexer) {
            const jsResults = window.ApexSymbolIndexer.findSymbol(symbolName);
            if (jsResults.length > 0) {
                return { source: 'local', results: jsResults };
            }
        }

        return { source: 'none', results: [] };
    }

    /**
     * Establish WebSocket connection to the LSP bridge
     */
    connectLSP() {
        const wsUrl = this.baseUrl.replace('http', 'ws') + '/api/lsp/ws';
        console.log(`[ApexLSP] Connecting to bridge at ${wsUrl}...`);

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log('[ApexLSP] Bridge connection established ✓');
            // Flush queue
            while (this.messageQueue.length > 0) {
                const msg = this.messageQueue.shift();
                this.socket.send(JSON.stringify(msg));
            }
            // Backend auto-initializes, clients just wait for responses
            console.log('[ApexLSP] Waiting for backend initialization...');
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleRPCMessage(data);
            } catch (err) {
                console.error('[ApexLSP] Failed to parse RPC message:', err, event.data);
            }
        };

        this.socket.onclose = () => {
            console.warn('[ApexLSP] Bridge connection closed. Reconnecting in 5s...');
            setTimeout(() => this.connectLSP(), 5000);
        };

        this.socket.onerror = (err) => {
            console.error('[ApexLSP] Bridge error:', err);
        };
    }

    /**
     * Send a JSON-RPC request or notification
     */
    sendRPC(method, params, isNotification = false) {
        const msg = {
            jsonrpc: '2.0',
            method,
            params
        };

        if (!isNotification) {
            msg.id = ++this.requestId;
        }

        const promise = isNotification ? Promise.resolve() : new Promise((resolve, reject) => {
            this.pendingRequests.set(msg.id, { resolve, reject, timestamp: Date.now() });
        });

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        } else {
            this.messageQueue.push(msg);
        }

        return promise;
    }

    /**
     * Handle incoming JSON-RPC messages
     */
    handleRPCMessage(data) {
        // Resolve pending requests
        if (data.id !== undefined && this.pendingRequests.has(data.id)) {
            const req = this.pendingRequests.get(data.id);
            this.pendingRequests.delete(data.id);
            if (data.error) req.reject(data.error);
            else req.resolve(data.result);
            return;
        }

        // Handle notifications
        if (data.method === 'textDocument/publishDiagnostics') {
            this.handleDiagnostics(data.params);
        } else if (data.method === 'telemetry/event') {
            // Ignore telemetry
        } else {
            console.log('[ApexLSP] Received notification/request:', data);
        }
    }

    /**
     * Map LSP diagnostics to Monaco markers
     */
    handleDiagnostics(params) {
        const { uri, diagnostics } = params;

        // Broadcast for editor.js to catch
        console.log(`[ApexLSP] Broadcasting ${diagnostics.length} diagnostics for ${uri}`);
        window.postMessage({
            type: 'LSP_DIAGNOSTICS',
            uri,
            diagnostics: diagnostics.map(d => ({
                startLineNumber: d.range.start.line + 1,
                startColumn: d.range.start.character + 1,
                endLineNumber: d.range.end.line + 1,
                endColumn: d.range.end.character + 1,
                message: d.message,
                severity: this.mapSeverity(d.severity),
                source: 'Apex LSP'
            }))
        }, window.location.origin);
    }

    /**
     * Send the initialize request
     */
    async initialize() {
        console.log('[ApexLSP] Sending initialize request...');
        return this.sendRPC('initialize', {
            processId: null,
            rootUri: 'file:///workspace',
            capabilities: {
                textDocument: {
                    completion: { completionItem: { snippetSupport: true } },
                    definition: { dynamicRegistration: true },
                    hover: { contentFormat: ['markdown', 'plaintext'] }
                }
            }
        });
    }

    /**
     * Notify LSP that a file was opened
     */
    openDocument(fileId, fileName, text) {
        console.log(`[ApexLSP] didOpen: ${fileName}`);
        return this.sendRPC('textDocument/didOpen', {
            textDocument: {
                uri: `file:///workspace/${fileId}/${fileName}`,
                languageId: 'apex',
                version: 1,
                text: text
            }
        }, true); // Is notification
    }

    /**
     * Notify LSP that a file was changed
     */
    updateDocument(fileId, fileName, text) {
        // console.log(`[ApexLSP] didChange: ${fileName}`);
        return this.sendRPC('textDocument/didChange', {
            textDocument: {
                uri: `file:///workspace/${fileId}/${fileName}`,
                version: Date.now()
            },
            contentChanges: [{ text: text }]
        }, true); // Is notification
    }

    /**
     * Get completions from custom Rust Intelligence Layer
     */
    async getCompletions(fileId, fileName, line, character, sourceContent) {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceContent,
                    line: line - 1,
                    column: character - 1
                })
            });
            if (response.ok) {
                const items = await response.json();
                return { items };
            }
        } catch (e) { console.error('[ApexLSP] Completion error:', e); }
        return null;
    }

    /**
     * Get hover info from custom Rust Intelligence Layer
     */
    async getHover(fileId, fileName, line, character, sourceContent) {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/hover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceContent,
                    line: line - 1,
                    column: character - 1
                })
            });
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Hover error:', e); }
        return null;
    }

    /**
     * Get definition from custom Rust Intelligence Layer
     */
    async getDefinition(fileId, fileName, line, character, sourceContent) {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/definition`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceContent,
                    line: line - 1,
                    column: character - 1,
                    file_path: fileName
                })
            });
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Definition error:', e); }
        return null;
    }

    mapSeverity(lspSeverity) {
        // monaco.MarkerSeverity
        // 8: Error, 4: Warning, 2: Info, 1: Hint
        switch (lspSeverity) {
            case 1: return 8;
            case 2: return 4;
            case 3: return 2;
            case 4: return 1;
            default: return 8;
        }
    }

    /**
     * Get references from custom Rust Intelligence Layer
     */
    async getReferences(fileId, fileName, line, character, sourceContent) {
        if (!this.healthy) return [];
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/references`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceContent,
                    line: line - 1,
                    column: character - 1,
                    root_path: '.'
                })
            });
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] References error:', e); }
        return [];
    }

    /**
     * Get impact analysis for a class
     */
    async getImpactAnalysis(className) {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/impact/${className}?format=json`);
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Impact Analysis error:', e); }
        return null;
    }

    /**
     * Get class relationships and call graph
     */
    async getClassRelationships(className) {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/class-relationships/${className}`);
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Class Relationships error:', e); }
        return null;
    }

    /**
     * Get org-wide architectural metrics
     */
    async getArchitectureMetrics() {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/analyze?format=json&type=roles`);
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Architecture Metrics error:', e); }
        return null;
    }

    /**
     * Get all entry points (Trigger handlers, @AuraEnabled, etc)
     */
    async getEntrypoints() {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/entrypoints`);
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Entrypoints error:', e); }
        return null;
    }

    /**
     * Get database stats
     */
    async getOrgStats() {
        if (!this.healthy) return null;
        try {
            const response = await fetch(`${this.baseUrl}/api/stats`);
            if (response.ok) return await response.json();
        } catch (e) { console.error('[ApexLSP] Org Stats error:', e); }
        return null;
    }

    /**
     * Validate Apex code using the backend parser
     * @param {string} code - Apex source code
     * @returns {Promise<Array>} Array of validation errors
     */
    async validate(code) {
        if (!this.healthy) return [];
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            if (response.ok) {
                const result = await response.json();
                return result.errors || [];
            }
        } catch (e) { console.error('[ApexLSP] Validation error:', e); }
        return [];
    }
}

// Create global instance
window.apexLSP = new ApexLSPClient();

setInterval(() => {
    window.apexLSP.checkHealth();
}, 10000);
