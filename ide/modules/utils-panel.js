/**
 * SF-Intel Studio - Utils Panel Module (SOQL, Apex, Logs, Tests)
 * Enhanced with Query Tabs, Toolbar Toggles, Selection Execution, Enhanced Grid
 */

const UtilsPanel = {
    activeUtilId: null,
    lastQueryResult: null,
    _lastQueryTimestamp: null,
    _lastQueryObject: null,

    // Query Tabs state
    soqlTabs: [],
    activeSoqlTab: null,
    tabCounter: 0,

    // Selection state for delete
    selectedRecordIds: new Set(),
    _deleteInProgress: false,

    // Apex execution state
    apexHistory: [],
    MAX_APEX_HISTORY: 20,
    _lastApexResult: null,
    _lastApexLogBody: null,
    _lastApexLogId: null,
    _apexHistoryPanelOpen: false,
    _apexInitialized: false,

    // Trace Flag Manager state
    _traceFlag: null,
    _traceFlagTimer: null,
    _traceFlagCollapsed: true,
    _traceFlagLoading: false,
    _selectedPreset: 'live-trace',
    _customDebugLevels: {
        ApexCode: 'FINEST', Database: 'INFO', System: 'DEBUG',
        Workflow: 'INFO', Validation: 'INFO', Callout: 'INFO',
        Visualforce: 'DEBUG', ApexProfiling: 'INFO'
    },
    _debugPresets: {
        'live-trace': {
            label: 'Live Trace',
            tag: 'Recommended',
            levels: { ApexCode: 'FINEST', Database: 'FINE', System: 'DEBUG', Workflow: 'FINE', Validation: 'INFO', Callout: 'INFO', Visualforce: 'NONE', ApexProfiling: 'INFO' }
        },
        'full-detail': {
            label: 'Full Detail',
            tag: null,
            levels: { ApexCode: 'FINEST', Database: 'FINEST', System: 'FINE', Workflow: 'FINER', Validation: 'INFO', Callout: 'FINER', Visualforce: 'FINER', ApexProfiling: 'FINE' }
        },
        'minimal': {
            label: 'Minimal',
            tag: null,
            levels: { ApexCode: 'DEBUG', Database: 'NONE', System: 'NONE', Workflow: 'NONE', Validation: 'NONE', Callout: 'NONE', Visualforce: 'NONE', ApexProfiling: 'NONE' }
        },
        'custom': {
            label: 'Custom',
            tag: null,
            levels: null
        }
    },

    async open(utilId) {
        console.log('[SF-Intel] Opening utility:', utilId);
        this.activeUtilId = utilId;
        window.activeUtilId = utilId;

        if (typeof window.switchViewMode === 'function') {
            window.switchViewMode('utility');
        }

        try {
            const utilTitle = document.getElementById('utility-title');
            const utilMonaco = document.getElementById('utility-monaco-container');
            const utilView = document.getElementById('utility-view-container');
            const resizer = document.getElementById('utility-resizer');
            const soqlToolbar = document.getElementById('soql-toolbar');

            if (utilTitle) utilTitle.textContent = utilId.toUpperCase();

            // Show/hide SOQL toolbar, editor actions, and action strip
            if (soqlToolbar) soqlToolbar.style.display = utilId === 'soql' ? 'flex' : 'none';
            const editorActions = document.getElementById('soql-editor-actions');
            if (editorActions) editorActions.style.display = utilId === 'soql' ? 'flex' : 'none';
            const actionStrip = document.getElementById('soql-action-strip');
            if (actionStrip) actionStrip.style.display = utilId === 'soql' ? 'flex' : 'none';
            const saveQueryBtn = document.getElementById('soql-save-query-btn');
            if (saveQueryBtn) saveQueryBtn.style.display = utilId === 'soql' ? 'inline-flex' : 'none';

            // Show/hide Apex action strip and editor actions
            const apexActionStrip = document.getElementById('apex-action-strip');
            if (apexActionStrip) apexActionStrip.style.display = utilId === 'apex' ? 'flex' : 'none';
            const apexEditorActions = document.getElementById('apex-editor-actions');
            if (apexEditorActions) apexEditorActions.style.display = utilId === 'apex' ? 'flex' : 'none';

            // Show/hide Logs action strip
            const logsActionStrip = document.getElementById('logs-action-strip');
            if (logsActionStrip) logsActionStrip.style.display = utilId === 'logs' ? 'flex' : 'none';

            // Close panels when switching utilities
            if (utilId !== 'apex' && this._apexHistoryPanelOpen) {
                const histPanel = document.getElementById('apex-history-panel');
                if (histPanel) histPanel.classList.remove('open');
                this._apexHistoryPanelOpen = false;
            }
            if (utilId !== 'soql' && window.SavedQueries) {
                try { window.SavedQueries.closePanel(); } catch(e) {}
            }

            if (utilId === 'apex' || utilId === 'soql') {
                if (utilMonaco) utilMonaco.style.display = 'flex';

                if (utilId === 'soql') {
                    if (utilView) utilView.style.display = 'flex';
                    if (resizer) resizer.style.display = 'flex';

                    // Initialize query tabs if not done
                    if (this.soqlTabs.length === 0) {
                        this._initSoqlTabs();
                        if (utilView) this._renderEmptyState(utilView);
                    } else {
                        this._renderSoqlTabs();
                        // Restore active tab's result or show empty state
                        if (this.activeSoqlTab?.result) {
                            this.lastQueryResult = this.activeSoqlTab.result;
                            this._lastQueryTimestamp = this.activeSoqlTab.timestamp;
                            this.renderQueryResult(this.activeSoqlTab.result);
                        } else if (utilView) {
                            this._renderEmptyState(utilView);
                        }
                        if (this.activeSoqlTab && window.sendToEditor) {
                            window.sendToEditor({
                                type: 'SWITCH_MODEL',
                                id: this.activeSoqlTab.modelId
                            }, 'utility');
                        }
                    }
                } else {
                    // Remove tabs bar for non-SOQL
                    const existingTabs = document.getElementById('soql-tabs-bar');
                    if (existingTabs) existingTabs.remove();

                    // Enable split view for Apex (editor top, results bottom)
                    if (utilView) utilView.style.display = 'flex';
                    if (resizer) resizer.style.display = 'flex';

                    if (window.sendToEditor) {
                        if (!this._apexInitialized) {
                            window.sendToEditor({
                                type: 'OPEN_MODEL',
                                id: 'util-apex',
                                value: '// Anonymous Apex Scratchpad\n\nSystem.debug(\'Hello from SF-Intel Studio\');',
                                language: 'apex'
                            }, 'utility');
                            this._apexInitialized = true;
                        } else {
                            window.sendToEditor({ type: 'SWITCH_MODEL', id: 'util-apex' }, 'utility');
                        }
                    }

                    // Load history and show empty state or last result
                    this._loadApexHistory();
                    if (this._lastApexResult) {
                        this.renderApexResult(this._lastApexResult, this._lastApexLogId, this._lastApexLogBody);
                    } else if (utilView) {
                        this._renderApexEmptyState(utilView);
                    }
                }
            } else {
                // Remove tabs bar for non-code utilities
                const existingTabs = document.getElementById('soql-tabs-bar');
                if (existingTabs) existingTabs.remove();

                if (utilMonaco) utilMonaco.style.display = 'none';
                if (resizer) resizer.style.display = 'none';
                if (utilView) {
                    utilView.style.display = 'flex';
                }
                if (utilId === 'record') {
                    window.RecordInspector.render();
                } else if (utilId === 'workflow') {
                    window.WorkflowEmulator.render();
                } else if (utilId === 'flow') {
                    if (typeof window.renderFlowAnalysis === 'function') {
                        window.renderFlowAnalysis();
                    }
                } else if (utilId === 'automation') {
                    if (typeof window.renderAutomationInspector === 'function') {
                        window.renderAutomationInspector();
                    }
                } else {
                    this.renderSpecialView(utilId);
                }
            }

            if (utilId === 'tests' || utilId === 'flow' || utilId === 'automation') {
                const header = document.getElementById('utility-header');
                if (header) header.style.display = 'none';
            } else {
                const header = document.getElementById('utility-header');
                if (header) header.style.display = 'flex';

                const runBtn = document.getElementById('run-util-btn');
                if (runBtn) {
                    runBtn.disabled = false;
                    runBtn.classList.add('enabled');
                    runBtn.onclick = () => this.run(utilId);
                }
            }
        } catch (err) {
            console.error('[SF-Intel] Failed to open utility:', err);
            if (window.Terminal) window.Terminal.error(`Failed to launch ${utilId}: ${err.message}`);
        }
    },

    // === QUERY TABS ===

    _initSoqlTabs() {
        this.tabCounter = 1;
        const tab = {
            id: 'soql-1',
            name: 'New Query 1',
            modelId: 'util-soql-1',
            timestamp: null,
            result: null
        };
        this.soqlTabs = [tab];
        this.activeSoqlTab = tab;

        // Open the model in utility editor
        if (window.sendToEditor) {
            window.sendToEditor({
                type: 'OPEN_MODEL',
                id: tab.modelId,
                value: '-- SOQL Query Runner\nSELECT Id, Name FROM Account LIMIT 10',
                language: 'soql'
            }, 'utility');
        }

        this._renderSoqlTabs();
    },

    addQueryTab() {
        this.tabCounter++;
        const tab = {
            id: `soql-${this.tabCounter}`,
            name: `New Query ${this.tabCounter}`,
            modelId: `util-soql-${this.tabCounter}`,
            timestamp: null,
            result: null
        };
        this.soqlTabs.push(tab);
        this.activeSoqlTab = tab;

        if (window.sendToEditor) {
            window.sendToEditor({
                type: 'OPEN_MODEL',
                id: tab.modelId,
                value: 'SELECT Id, Name FROM ',
                language: 'soql'
            }, 'utility');
        }

        this._renderEmptyState();
        this._renderSoqlTabs();
    },

    switchQueryTab(tabId) {
        const tab = this.soqlTabs.find(t => t.id === tabId);
        if (!tab || tab === this.activeSoqlTab) return;

        this.activeSoqlTab = tab;

        if (window.sendToEditor) {
            window.sendToEditor({
                type: 'SWITCH_MODEL',
                id: tab.modelId
            }, 'utility');
        }

        // Show stored result for this tab
        if (tab.result) {
            this.lastQueryResult = tab.result;
            this._lastQueryTimestamp = tab.timestamp;
            this.renderQueryResult(tab.result);
        } else {
            const container = document.getElementById('utility-view-container');
            if (container) this._renderEmptyState(container);
        }

        this._renderSoqlTabs();
    },

    closeQueryTab(tabId) {
        if (this.soqlTabs.length <= 1) return; // Keep at least one tab

        const idx = this.soqlTabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;

        const tab = this.soqlTabs[idx];

        // Close the model in editor
        if (window.sendToEditor) {
            window.sendToEditor({ type: 'CLOSE_MODEL', id: tab.modelId }, 'utility');
        }

        this.soqlTabs.splice(idx, 1);

        // If closing active tab, switch to adjacent
        if (this.activeSoqlTab && this.activeSoqlTab.id === tabId) {
            const newIdx = Math.min(idx, this.soqlTabs.length - 1);
            this.switchQueryTab(this.soqlTabs[newIdx].id);
        } else {
            this._renderSoqlTabs();
        }
    },

    _renderSoqlTabs() {
        const utilBody = document.getElementById('utility-body');
        const utilMonaco = document.getElementById('utility-monaco-container');
        if (!utilBody || !utilMonaco) return;

        let tabsBar = document.getElementById('soql-tabs-bar');
        if (!tabsBar) {
            tabsBar = document.createElement('div');
            tabsBar.id = 'soql-tabs-bar';
            utilBody.insertBefore(tabsBar, utilMonaco);
        }

        tabsBar.innerHTML = this.soqlTabs.map(tab => `
            <div class="soql-tab ${tab === this.activeSoqlTab ? 'active' : ''}" data-id="${tab.id}">
                <span class="tab-label">${tab.name}</span>
                ${this.soqlTabs.length > 1 ? `<span class="tab-close" data-close="${tab.id}">&times;</span>` : ''}
            </div>
        `).join('') + `<button id="soql-add-tab">+</button>`;

        // Bind tab clicks
        tabsBar.querySelectorAll('.soql-tab').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('tab-close')) return;
                this.switchQueryTab(el.dataset.id);
            });
        });

        // Bind close buttons
        tabsBar.querySelectorAll('.tab-close').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeQueryTab(el.dataset.close);
            });
        });

        // Bind add button
        const addBtn = tabsBar.querySelector('#soql-add-tab');
        if (addBtn) addBtn.onclick = () => this.addQueryTab();
    },

    // === RUN (with selection support) ===

    async run(utilId) {
        console.log(`[SF-Intel] Running utility action: ${utilId}`);
        if (window.Terminal) {
            window.Terminal.open();
            window.Terminal.log(`Running ${utilId.toUpperCase()}...`);
        }

        const runBtn = document.getElementById('run-util-btn');
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.classList.remove('enabled');
        }

        try {
            if (utilId === 'soql') {
                // Use GET_SELECTION to support running selected text
                const modelId = this.activeSoqlTab ? this.activeSoqlTab.modelId : 'util-soql';
                if (window.sendToEditor) {
                    window.sendToEditor({ type: 'GET_SELECTION', modelId }, 'utility');
                } else {
                    throw new Error('Editor bridge not found.');
                }
            } else if (utilId === 'apex') {
                if (window.sendToEditor) {
                    window.sendToEditor({ type: 'GET_CONTENT', modelId: 'util-apex' }, 'utility');
                } else {
                    throw new Error('Editor bridge not found.');
                }
            } else if (utilId === 'logs') {
                await this.refreshLogs();
                if (runBtn) runBtn.disabled = false;
            } else if (utilId === 'tests') {
                if (typeof window.runSelectedTests === 'function') {
                    await window.runSelectedTests();
                }
                if (runBtn) runBtn.disabled = false;
            }
        } catch (error) {
            console.error('[SF-Intel] Utility run failed:', error);
            if (window.Terminal) window.Terminal.error(`${utilId.toUpperCase()} Failed: ${error.message}`);
            if (runBtn) {
                runBtn.disabled = false;
                runBtn.classList.add('enabled');
            }
        }
    },

    // === EXECUTE LOGIC (with toolbar toggles) ===

    async executeLogic(utilId, content) {
        console.log(`[SF-Intel] Executing logic for ${utilId}...`);
        const runBtn = document.getElementById('run-util-btn');

        try {
            if (utilId === 'apex') {
                const container = document.getElementById('utility-view-container');
                if (container) {
                    container.innerHTML = `<div class="apex-loading-state">
                        <div class="apex-spinner"></div>
                        <div class="apex-loading-text">Executing Anonymous Apex...</div>
                    </div>`;
                    container.style.display = 'flex';
                }

                console.log('[SF-Intel] Sending Anonymous Apex to API...');
                // Ensure a TraceFlag is active so Salesforce generates a debug log.
                try { await window.apiClient.ensureTraceFlag(30); } catch (e) {
                    console.warn('[SF-Intel] Could not ensure TraceFlag:', e);
                }

                // Snapshot the most recent log ID before executing (watermark).
                // We compare by ID position in the sorted list rather than by timestamp
                // to avoid clock-skew issues between the browser and Salesforce servers.
                let watermarkId = null;
                try {
                    const preLogs = await window.apiClient.getLogs();
                    watermarkId = preLogs?.[0]?.Id || null;
                } catch (e) {}

                const result = await window.apiClient.executeAnonymous(content);
                console.log('[SF-Intel] Apex Result:', result);

                if (result.success) {
                    if (window.Terminal) window.Terminal.success('Execution Successful');

                    let logId = null;
                    let logBody = null;
                    if (window.Terminal) window.Terminal.log('Polling for debug log...');

                    for (let i = 0; i < 5; i++) {
                        if (this.activeUtilId !== 'apex') return;
                        await new Promise(r => setTimeout(r, 1500));
                        try {
                            const logs = await window.apiClient.getLogs();
                            if (this.activeUtilId !== 'apex') return;
                            // Logs are sorted DESC — any entry before the watermark position is new.
                            const watermarkIdx = watermarkId ? logs.findIndex(l => l.Id === watermarkId) : -1;
                            const newLogs = watermarkIdx >= 0 ? logs.slice(0, watermarkIdx) : logs;
                            if (newLogs.length > 0) {
                                // Prefer the anonymous Apex log if concurrent automations also fired
                                const anonLog = newLogs.find(l => l.Operation === 'Anonymous') || newLogs[0];
                                logId = anonLog.Id;
                                try {
                                    logBody = await window.apiClient.getLogBody(logId);
                                } catch (bodyErr) {
                                    console.warn('[SF-Intel] Failed to fetch log body for preview:', bodyErr);
                                }
                                break;
                            }
                        } catch (e) { console.warn('Polling error', e); }
                    }

                    if (this.activeUtilId === 'apex') {
                        this.renderApexResult(result, logId, logBody, content);
                    }
                } else {
                    if (this.activeUtilId === 'apex') {
                        this.renderApexResult(result, null, null, content);
                        if (window.Terminal) {
                            window.Terminal.error(`Execution Failed: ${result.exceptionMessage || result.compileProblem}`);
                            window.Terminal.open();
                        }
                    }
                }
            } else if (utilId === 'soql') {
                console.log('[SF-Intel] Running SOQL Query...');

                // Fade out empty state if present
                const resultContainer = document.getElementById('utility-view-container');
                const emptyState = resultContainer?.querySelector('.soql-empty-state');
                if (emptyState) {
                    emptyState.classList.add('fade-out');
                    setTimeout(() => { emptyState.remove(); }, 150);
                }

                // Read toolbar toggle states
                const fetchAll = document.getElementById('soql-fetch-all')?.checked || false;
                const includeDeleted = document.getElementById('soql-include-deleted')?.checked || false;
                const tryTooling = document.getElementById('soql-try-tooling')?.checked || false;

                let queryToRun = content.trim().replace(/;?\s*$/, '');

                // Strip any user-typed ALL ROWS — the queryAll endpoint handles this
                queryToRun = queryToRun.replace(/\s+ALL\s+ROWS\s*$/i, '');

                // Check for LIMIT clause
                if (!/\bLIMIT\b/i.test(queryToRun) && !fetchAll) {
                    if (window.Terminal) {
                        window.Terminal.warn('No LIMIT clause detected. Adding LIMIT 200 for safety.');
                    }
                    queryToRun += ' LIMIT 200';
                }

                // Extract object name for tab naming
                const fromMatch = queryToRun.match(/FROM\s+(\w+)/i);
                this._lastQueryObject = fromMatch ? fromMatch[1] : 'Query';

                let result;
                if (tryTooling) {
                    if (window.Terminal) window.Terminal.log('Using Tooling API...');
                    result = await window.apiClient.toolingQuery(queryToRun);
                } else if (fetchAll) {
                    if (window.Terminal) window.Terminal.log('Fetching all pages...');
                    result = await window.apiClient.queryAllPages(queryToRun, includeDeleted);
                } else if (includeDeleted) {
                    result = await window.apiClient.queryAll(queryToRun);
                } else {
                    result = await window.apiClient.query(queryToRun);
                }

                console.log('[SF-Intel] Query Result:', result);
                this._lastQueryTimestamp = new Date();

                // Track as recent query
                if (window.SavedQueries) window.SavedQueries.addRecent(queryToRun);

                if (this.activeUtilId === 'soql') {
                    if (window.Terminal) window.Terminal.success(`Query successful: ${result.totalSize} records found.`);

                    // Store result in active tab
                    if (this.activeSoqlTab) {
                        this.activeSoqlTab.result = result;
                        this.activeSoqlTab.timestamp = this._lastQueryTimestamp;
                        // Rename tab
                        const now = this._lastQueryTimestamp;
                        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        this.activeSoqlTab.name = `${this._lastQueryObject} @${timeStr}`;
                        this._renderSoqlTabs();
                    }

                    this.renderQueryResult(result);
                }
            }
        } catch (error) {
            console.error('[SF-Intel] Execution loop failed:', error);
            if (window.Terminal) window.Terminal.error(`${utilId.toUpperCase()} Execution Error: ${error.message}`);
        } finally {
            if (runBtn) {
                runBtn.disabled = false;
                runBtn.classList.add('enabled');
            }
        }
    },

    renderApexResult(result, logId, logBody, executedCode) {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        // Store for action strip buttons
        this._lastApexResult = result;
        this._lastApexLogBody = logBody;
        this._lastApexLogId = logId;

        // Record in history
        if (executedCode !== undefined) {
            this._addToApexHistory(result, logId, logBody, executedCode);
        }

        // Update action strip status
        const statusEl = document.getElementById('apex-execution-status');
        if (statusEl) {
            const now = new Date();
            statusEl.textContent = `Last run: ${now.toLocaleTimeString()}`;
            statusEl.style.color = result.success ? '#2ecc71' : '#e74c3c';
        }

        // Fade out empty state if present
        const emptyState = container.querySelector('.apex-empty-state');
        if (emptyState) {
            emptyState.classList.add('fade-out');
            setTimeout(() => { if (emptyState.parentNode) emptyState.remove(); }, 150);
        }

        const isSuccess = result.success;
        const statusClass = isSuccess ? 'success' : 'error';
        const statusIcon = isSuccess ? '&#10003;' : '&#10007;';
        const statusText = isSuccess ? 'Execution Successful' : 'Execution Failed';
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Parse debug lines
        let debugLines = [];
        let logSizeKB = 0;
        if (logBody) {
            logSizeKB = Math.round(logBody.length / 1024);
            debugLines = logBody.split('\n')
                .filter(line => line.includes('|USER_DEBUG|'))
                .map(line => {
                    const parts = line.split('|USER_DEBUG|');
                    return parts.length > 1 ? parts[1].replace(/\[\d+\]\|DEBUG\|/, '').trim() : line.trim();
                });
        }

        // Build HTML
        let html = '';

        // Status Bar
        html += `<div class="apex-result-status-bar ${statusClass}">
            <div class="apex-status-left">
                <span class="apex-status-icon">${statusIcon}</span>
                <span class="apex-status-text">${statusText}</span>
                <span class="apex-status-time">${timestamp}</span>
            </div>
            <div class="apex-status-right">
                ${logId ? `<button class="apex-btn-inspector" id="apex-open-inspector">Open Inspector</button>` : ''}
            </div>
        </div>`;

        // Stats Row
        html += `<div class="apex-stats-row">
            <span class="apex-stat">${debugLines.length} debug line${debugLines.length !== 1 ? 's' : ''}</span>
            <span class="apex-stat-sep"></span>
            <span class="apex-stat">${logSizeKB} KB log</span>
            ${logId ? `<span class="apex-stat-sep"></span><span class="apex-stat apex-stat-mono">${logId}</span>` : ''}
        </div>`;

        // Error Section (if failed)
        if (!isSuccess) {
            const errorMsg = this._escapeHtml(result.exceptionMessage || result.compileProblem || 'Unknown error');
            html += `<div class="apex-error-section">
                <div class="apex-error-msg">${errorMsg}</div>
                ${result.exceptionStackTrace ? `
                    <div class="apex-stack-header">
                        <span>Stack Trace</span>
                        <button class="apex-copy-error-btn" id="apex-copy-error">Copy</button>
                    </div>
                    <pre class="apex-stack-trace">${this._escapeHtml(result.exceptionStackTrace)}</pre>
                ` : ''}
            </div>`;
        }

        // Debug Output Section
        if (debugLines.length > 0) {
            html += `<div class="apex-section">
                <div class="apex-section-header" data-toggle="apex-debug-body">
                    <span class="apex-section-chevron">&#9660;</span>
                    <span class="apex-section-title">Debug Output</span>
                    <span class="apex-section-count">${debugLines.length}</span>
                </div>
                <div class="apex-section-body" id="apex-debug-body">
                    ${debugLines.map((line, i) => `<div class="apex-debug-line"><span class="apex-debug-num">${i + 1}</span><span class="apex-debug-text">${this._escapeHtml(line)}</span></div>`).join('')}
                </div>
            </div>`;
        }

        // Execution Tree Section (collapsed by default)
        if (logBody) {
            html += `<div class="apex-section">
                <div class="apex-section-header collapsed" data-toggle="apex-log-tree-body">
                    <span class="apex-section-chevron">&#9654;</span>
                    <span class="apex-section-title">Execution Tree</span>
                </div>
                <div class="apex-section-body collapsed" id="apex-log-tree-body"></div>
            </div>`;
        }

        container.innerHTML = html;

        // Wire up section toggles
        container.querySelectorAll('.apex-section-header[data-toggle]').forEach(header => {
            header.onclick = () => {
                const targetId = header.dataset.toggle;
                const body = document.getElementById(targetId);
                const chevron = header.querySelector('.apex-section-chevron');
                if (body) {
                    const isCollapsed = body.classList.toggle('collapsed');
                    header.classList.toggle('collapsed', isCollapsed);
                    if (chevron) chevron.innerHTML = isCollapsed ? '&#9654;' : '&#9660;';
                }
            };
        });

        // Render log tree
        if (logBody && window.LogParser) {
            const treeContainer = document.getElementById('apex-log-tree-body');
            if (treeContainer) {
                try {
                    const tree = window.LogParser.parse(logBody);
                    window.LogParser.renderTree(tree, treeContainer);
                } catch (parseErr) {
                    console.error('[SF-Intel] Failed to render inline tree:', parseErr);
                    treeContainer.innerHTML = `<div style="padding:16px;color:#e74c3c;">Failed to render log tree: ${_escapeHtml(parseErr.message)}</div>`;
                }
            }
        }

        // Wire up inspector button
        const inspectorBtn = document.getElementById('apex-open-inspector');
        if (inspectorBtn && logId) {
            inspectorBtn.onclick = () => {
                if (window.viewLog) {
                    window.viewLog(logId);
                    const tab = document.querySelector('.panel-tab[data-target="inspector"]');
                    if (tab) tab.click();
                }
            };
        }

        // Wire up copy error button
        const copyErrorBtn = document.getElementById('apex-copy-error');
        if (copyErrorBtn) {
            copyErrorBtn.onclick = () => {
                const text = (result.exceptionMessage || result.compileProblem || '') + '\n' + (result.exceptionStackTrace || '');
                navigator.clipboard.writeText(text.trim()).then(() => {
                    copyErrorBtn.textContent = 'Copied!';
                    setTimeout(() => { copyErrorBtn.textContent = 'Copy'; }, 1000);
                });
            };
        }
    },

    // === SOQL EMPTY STATE ===

    _renderEmptyState(container) {
        if (!container) container = document.getElementById('utility-view-container');
        if (!container) return;

        container.innerHTML = `
            <div class="soql-empty-state" role="status" aria-live="polite">
                <div class="soql-empty-cta">
                    <svg class="soql-empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="rgba(79,172,254,0.08)"/>
                        <polyline points="13,2 13,9 20,9" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <line x1="8" y1="13" x2="16" y2="13" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round"/>
                        <line x1="8" y1="17" x2="12" y2="17" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    <div class="soql-empty-title">Run your SOQL query</div>
                    <div class="soql-empty-subtitle">Click <strong>Run</strong> or press <kbd>${/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'}</kbd> + <kbd>Enter</kbd></div>
                </div>
                <div class="soql-empty-grid">
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <div class="soql-empty-card-title">Fast SOQL Execution</div>
                        <div class="soql-empty-card-desc">Run and inspect queries instantly</div>
                    </div>
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="3" width="7" height="18" rx="1" stroke="#4facfe" stroke-width="1.5"/><rect x="9" y="3" width="7" height="18" rx="1" stroke="#4facfe" stroke-width="1.5" opacity="0.6"/><rect x="16" y="3" width="6" height="18" rx="1" stroke="#4facfe" stroke-width="1.5" opacity="0.3"/></svg>
                        <div class="soql-empty-card-title">Multi-Tab Queries</div>
                        <div class="soql-empty-card-desc">Work with multiple queries side by side</div>
                    </div>
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <div class="soql-empty-card-title">Export Results</div>
                        <div class="soql-empty-card-desc">Download as CSV or copy to clipboard</div>
                    </div>
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <div class="soql-empty-card-title">Advanced Filters</div>
                        <div class="soql-empty-card-desc">Fetch All, Include Deleted, Tooling API</div>
                    </div>
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <div class="soql-empty-card-title">Query Editing Tools</div>
                        <div class="soql-empty-card-desc">Search, copy, and prettify queries</div>
                    </div>
                    <div class="soql-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="#4facfe" stroke-width="1.5"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round"/></svg>
                        <div class="soql-empty-card-title">Result Exploration</div>
                        <div class="soql-empty-card-desc">Sort, search, and analyze records</div>
                    </div>
                </div>
            </div>
        `;
    },

    // === APEX HISTORY PERSISTENCE ===

    _loadApexHistory() {
        try {
            const stored = localStorage.getItem('sf-intel-apex-history');
            if (stored) this.apexHistory = JSON.parse(stored);
        } catch (e) { this.apexHistory = []; }
    },

    _persistApexHistory() {
        try {
            localStorage.setItem('sf-intel-apex-history', JSON.stringify(this.apexHistory));
        } catch (e) { console.warn('[SF-Intel] Failed to persist Apex history:', e); }
    },

    _addToApexHistory(result, logId, logBody, code) {
        const debugLines = logBody ? logBody.split('\n').filter(l => l.includes('|USER_DEBUG|')).length : 0;
        const codeStr = code || '';
        this.apexHistory.unshift({
            id: 'ax-' + Date.now(),
            timestamp: new Date().toISOString(),
            success: result.success,
            logId: logId || null,
            errorMsg: result.success ? null : (result.exceptionMessage || result.compileProblem || 'Unknown error'),
            debugLineCount: debugLines,
            codePreview: codeStr.substring(0, 100),
            code: codeStr.substring(0, 2000)
        });
        if (this.apexHistory.length > this.MAX_APEX_HISTORY) {
            this.apexHistory = this.apexHistory.slice(0, this.MAX_APEX_HISTORY);
        }
        this._persistApexHistory();
    },

    _formatRelativeTime(isoString) {
        const now = new Date();
        const then = new Date(isoString);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return then.toLocaleDateString();
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // === APEX EMPTY STATE ===

    _renderApexEmptyState(container) {
        if (!container) container = document.getElementById('utility-view-container');
        if (!container) return;
        const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

        container.innerHTML = `
            <div class="apex-empty-state" role="status" aria-live="polite">
                <div class="apex-empty-cta">
                    <svg class="apex-empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="rgba(79,172,254,0.08)"/>
                    </svg>
                    <div class="apex-empty-title">Execute Anonymous Apex</div>
                    <div class="apex-empty-subtitle">Click <strong>Run</strong> or press <kbd>${isMac ? '⌘' : 'Ctrl'}</kbd> + <kbd>Enter</kbd></div>
                </div>
                <div class="apex-empty-grid">
                    <div class="apex-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <div class="apex-empty-card-title">Execute Code</div>
                        <div class="apex-empty-card-desc">Run anonymous Apex with instant feedback</div>
                    </div>
                    <div class="apex-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polyline points="4,17 10,11 4,5" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="19" x2="20" y2="19" stroke="#4facfe" stroke-width="1.5" stroke-linecap="round"/></svg>
                        <div class="apex-empty-card-title">Debug Output</div>
                        <div class="apex-empty-card-desc">View System.debug statements inline</div>
                    </div>
                    <div class="apex-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#4facfe" stroke-width="1.5"/><polyline points="14,2 14,8 20,8" stroke="#4facfe" stroke-width="1.5"/><line x1="16" y1="13" x2="8" y2="13" stroke="#4facfe" stroke-width="1.5"/><line x1="16" y1="17" x2="8" y2="17" stroke="#4facfe" stroke-width="1.5"/></svg>
                        <div class="apex-empty-card-title">Log Inspector</div>
                        <div class="apex-empty-card-desc">Open full execution tree in Inspector</div>
                    </div>
                    <div class="apex-empty-card">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#4facfe" stroke-width="1.5"/><line x1="12" y1="9" x2="12" y2="13" stroke="#4facfe" stroke-width="1.5"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="#4facfe" stroke-width="1.5"/></svg>
                        <div class="apex-empty-card-title">Error Diagnostics</div>
                        <div class="apex-empty-card-desc">Compile errors with line numbers and stack traces</div>
                    </div>
                </div>
            </div>
        `;
    },

    // === APEX ACTION HANDLERS ===

    _setupApexActions() {
        const clearBtn = document.getElementById('apex-action-clear');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this._lastApexResult = null;
                this._lastApexLogBody = null;
                this._lastApexLogId = null;
                const statusEl = document.getElementById('apex-execution-status');
                if (statusEl) statusEl.textContent = '';
                this._renderApexEmptyState();
            };
        }

        const copyLogBtn = document.getElementById('apex-action-copy-log');
        if (copyLogBtn) {
            copyLogBtn.onclick = () => {
                if (!this._lastApexLogBody) {
                    if (window.Terminal) window.Terminal.warning('No debug log available to copy');
                    return;
                }
                navigator.clipboard.writeText(this._lastApexLogBody).then(() => {
                    copyLogBtn.classList.add('flash');
                    setTimeout(() => copyLogBtn.classList.remove('flash'), 600);
                    if (window.Terminal) window.Terminal.success('Debug log copied to clipboard');
                });
            };
        }

        const historyBtn = document.getElementById('apex-action-history');
        if (historyBtn) {
            historyBtn.onclick = () => this._toggleApexHistoryPanel();
        }

        const historyClose = document.getElementById('apex-history-panel-close');
        if (historyClose) {
            historyClose.onclick = () => this._toggleApexHistoryPanel();
        }
    },

    _toggleApexHistoryPanel() {
        const panel = document.getElementById('apex-history-panel');
        if (!panel) return;

        this._apexHistoryPanelOpen = !this._apexHistoryPanelOpen;
        const historyBtn = document.getElementById('apex-action-history');
        if (historyBtn) historyBtn.classList.toggle('active', this._apexHistoryPanelOpen);

        if (this._apexHistoryPanelOpen) {
            this._renderApexHistoryList();
            requestAnimationFrame(() => panel.classList.add('open'));
        } else {
            panel.classList.remove('open');
        }
    },

    _renderApexHistoryList() {
        const container = document.getElementById('apex-history-list');
        if (!container) return;

        if (this.apexHistory.length === 0) {
            container.innerHTML = '<div class="soql-queries-empty">No executions yet</div>';
            return;
        }

        container.innerHTML = this.apexHistory.map((entry, i) => {
            const time = this._formatRelativeTime(entry.timestamp);
            const statusIcon = entry.success
                ? '<span style="color:#2ecc71">&#10003;</span>'
                : '<span style="color:#e74c3c">&#10007;</span>';
            const detail = entry.success
                ? `${entry.debugLineCount} debug line${entry.debugLineCount !== 1 ? 's' : ''}`
                : (entry.errorMsg || 'Failed').substring(0, 60);
            const preview = entry.codePreview ? this._escapeHtml(entry.codePreview) : '';
            return `
                <div class="soql-query-item" data-history-idx="${i}">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                        <span>${statusIcon} <span class="soql-query-item-object">${entry.success ? 'Success' : 'Failed'}</span></span>
                        <span class="soql-query-item-time">${time}</span>
                    </div>
                    <div class="soql-query-item-preview">${this._escapeHtml(detail)}</div>
                    ${preview ? `<div class="soql-query-item-preview" style="margin-top:2px;opacity:0.5;font-size:10px;">${preview}</div>` : ''}
                </div>
            `;
        }).join('') + `
            <div style="padding:8px 12px;border-top:1px solid #333;">
                <button id="apex-clear-history" class="soql-queries-clear-btn">Clear History</button>
            </div>
        `;

        // Bind click on history items to load code into editor
        container.querySelectorAll('.soql-query-item[data-history-idx]').forEach(item => {
            item.style.cursor = 'pointer';
            item.onclick = () => {
                const idx = parseInt(item.dataset.historyIdx);
                const entry = this.apexHistory[idx];
                if (entry && entry.code && window.sendToEditor) {
                    window.sendToEditor({ type: 'SET_VALUE', value: entry.code }, 'utility');
                    if (window.Terminal) window.Terminal.log('Loaded code from history');
                    this._toggleApexHistoryPanel();
                }
            };
        });

        const clearBtn = document.getElementById('apex-clear-history');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this.apexHistory = [];
                this._persistApexHistory();
                this._renderApexHistoryList();
            };
        }
    },

    // === ENHANCED QUERY RESULT GRID ===

    renderQueryResult(result) {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        container.style.display = 'flex';
        this.lastQueryResult = result;
        window.lastQueryResult = result;
        this._sortField = null;
        this._sortDirection = 'asc';

        if (!result.records || result.records.length === 0) {
            const ts = this._lastQueryTimestamp ? this._lastQueryTimestamp.toLocaleString() : '';
            container.innerHTML = `
                <div class="utility-results-header">
                    <div class="soql-result-meta">
                        <span>0 records</span>
                        ${ts ? `<span class="meta-timestamp">Executed ${ts}</span>` : ''}
                    </div>
                </div>
                <div class="loading-container">No records found.</div>
            `;
            return;
        }

        const fields = Object.keys(result.records[0]).filter(k => k !== 'attributes');
        this._renderTable(container, fields, result.records);
    },

    _renderTable(container, fields, records) {
        const ts = this._lastQueryTimestamp ? this._lastQueryTimestamp.toLocaleString() : '';
        const objName = this._lastQueryObject || '';
        const instanceUrl = window.apiClient?.instanceUrl || '';

        const headerHtml = `
            <div class="utility-results-header">
                <div class="results-toolbar-row">
                    <div class="soql-result-meta">
                        <span>${objName ? `<strong>${_escapeHtml(objName)}</strong> &bull; ` : ''}<span class="meta-count">${records.length}</span> of ${this.lastQueryResult.totalSize || records.length} records</span>
                        ${ts ? `<span class="meta-timestamp">${ts}</span>` : ''}
                    </div>
                    <div class="soql-result-search">
                        <input type="text" id="soql-grid-search" placeholder="Search results..." />
                    </div>
                    <div class="soql-result-actions">
                        ${objName && instanceUrl ? `<button id="sf-intel-create-new-btn" class="action-btn" title="Create new ${objName} record"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg><span class="action-label">New</span></button>` : ''}
                        ${objName && instanceUrl ? `<button id="sf-intel-edit-object-btn" class="action-btn" title="Open ${objName} in Object Manager"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v.5H14a.5.5 0 0 1 0 1H9.5V5a2.5 2.5 0 0 1-5 0v-.5H2a.5.5 0 0 1 0-1h2.5V3zm2.5 0a1.5 1.5 0 0 0-3 0v2a1.5 1.5 0 0 0 3 0V3zm-7 8a.5.5 0 0 1 .5-.5h2.5V10a2.5 2.5 0 0 1 5 0v.5H14a.5.5 0 0 1 0 1H9.5v.5a2.5 2.5 0 0 1-5 0v-.5H2a.5.5 0 0 1-.5-.5zm7-.5a1.5 1.5 0 0 0-3 0v2a1.5 1.5 0 0 0 3 0v-2z"/></svg><span class="action-label">Object</span></button>` : ''}
                        <span class="actions-separator"></span>
                        <button id="sf-intel-fullscreen-btn" class="action-btn action-btn-icon" title="Toggle Full Screen (Esc to exit)"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707zm4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707z"/></svg></button>
                    </div>
                </div>
                <div class="results-selection-bar" id="sf-intel-selection-bar">
                    <div class="selection-info">
                        <span class="selection-pill" id="sf-intel-selection-count">0 selected</span>
                        <button id="sf-intel-select-clear" class="selection-clear-btn" title="Clear selection">Clear</button>
                    </div>
                    <div class="selection-actions">
                        <button id="sf-intel-delete-btn" class="btn-delete" title="Delete selected records">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                            <span class="btn-delete-label">Delete</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const sortIcon = (field) => {
            if (this._sortField !== field) return '↕';
            return this._sortDirection === 'asc' ? '↑' : '↓';
        };

        const tableHtml = `
            <div class="soql-table-wrapper">
                <table class="soql-table">
                    <thead><tr>
                        <th style="width:20px; text-align:center"><input type="checkbox" id="soql-select-all" class="row-check" title="Select all"></th>
                        <th style="width:36px" class="row-num">#</th>
                        ${fields.map(f => `<th class="sortable-header" data-field="${_escapeHtml(f)}">${_escapeHtml(f)} <span class="sort-icon">${sortIcon(f)}</span></th>`).join('')}
                    </tr></thead>
                    <tbody>
                        ${records.map((row, rowIndex) => {
            const recordId = row.Id || '';
            return `
                            <tr data-record-id="${recordId}">
                                <td style="text-align:center"><input type="checkbox" class="row-check" data-row="${rowIndex}" data-record-id="${recordId}"></td>
                                <td class="row-num">${rowIndex + 1}</td>
                                ${fields.map(f => {
                const val = row[f];
                const displayVal = this._formatCellValue(val, f, instanceUrl);
                return `<td data-row="${rowIndex}" data-field="${f}">${displayVal}</td>`;
            }).join('')}
                            </tr>`;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = headerHtml + tableHtml;

        // Bind Create New / Edit Object
        const createNewBtn = document.getElementById('sf-intel-create-new-btn');
        if (createNewBtn && instanceUrl && objName) {
            createNewBtn.onclick = () => {
                window.open(`${instanceUrl}/lightning/o/${objName}/new`, '_blank');
            };
        }
        const editObjectBtn = document.getElementById('sf-intel-edit-object-btn');
        if (editObjectBtn && instanceUrl && objName) {
            editObjectBtn.onclick = () => {
                window.open(`${instanceUrl}/lightning/setup/ObjectManager/${objName}/Details/view`, '_blank');
            };
        }

        // Bind sortable headers
        container.querySelectorAll('.sortable-header').forEach(th => {
            th.style.cursor = 'pointer';
            th.onclick = () => this._sortByField(th.dataset.field, fields);
        });

        // Clear selection state on new render
        this.selectedRecordIds.clear();
        this._updateDeleteButton();

        // Bind select all
        const selectAll = document.getElementById('soql-select-all');
        if (selectAll) {
            selectAll.onchange = () => {
                const visibleRows = container.querySelectorAll('.soql-table tbody tr');
                visibleRows.forEach(row => {
                    const cb = row.querySelector('.row-check[data-record-id]');
                    if (!cb) return;
                    // Only affect visible rows
                    if (row.style.display === 'none') return;
                    cb.checked = selectAll.checked;
                    const id = cb.dataset.recordId;
                    if (id) {
                        if (selectAll.checked) this.selectedRecordIds.add(id);
                        else this.selectedRecordIds.delete(id);
                    }
                });
                this._updateDeleteButton();
            };
        }

        // Bind individual row checkboxes
        container.querySelectorAll('.row-check[data-record-id]').forEach(cb => {
            cb.onchange = () => {
                const id = cb.dataset.recordId;
                if (!id) return;
                if (cb.checked) this.selectedRecordIds.add(id);
                else this.selectedRecordIds.delete(id);
                this._updateDeleteButton();
                // Update select-all checkbox state
                if (selectAll) {
                    const allCbs = container.querySelectorAll('.row-check[data-record-id]');
                    const allChecked = [...allCbs].every(c => c.checked);
                    selectAll.checked = allChecked;
                }
            };
        });

        // Bind double-click to copy cell + dynamic tooltip for truncated cells only
        container.querySelectorAll('.soql-table tbody td').forEach(td => {
            td.ondblclick = () => this._copyCell(td);
            td.onmouseenter = () => {
                if (td.scrollWidth > td.clientWidth) {
                    td.title = td.textContent;
                }
            };
            td.onmouseleave = () => {
                td.removeAttribute('title');
            };
        });

        // Bind search/filter input
        const searchInput = document.getElementById('soql-grid-search');
        if (searchInput) {
            searchInput.oninput = () => {
                const query = searchInput.value.toLowerCase().trim();
                const rows = container.querySelectorAll('.soql-table tbody tr');
                let visibleCount = 0;
                rows.forEach(row => {
                    const text = row.textContent.toLowerCase();
                    const match = !query || text.includes(query);
                    row.style.display = match ? '' : 'none';
                    if (match) visibleCount++;
                });
                const countEl = container.querySelector('.meta-count');
                if (countEl) countEl.textContent = visibleCount;
            };
        }

        // Bind fullscreen toggle
        const fullscreenBtn = document.getElementById('sf-intel-fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.onclick = () => this._toggleResultsFullscreen();
        }

        // Bind delete button
        const deleteBtn = document.getElementById('sf-intel-delete-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => this._confirmAndDelete();
        }

        // Bind clear selection
        const clearBtn = document.getElementById('sf-intel-select-clear');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this.selectedRecordIds.clear();
                container.querySelectorAll('.row-check').forEach(cb => cb.checked = false);
                this._updateDeleteButton();
            };
        }
    },

    _isResultsFullscreen: false,

    _toggleResultsFullscreen() {
        const root = document.getElementById('sf-intel-ide-root');
        if (!root) return;

        this._isResultsFullscreen = !this._isResultsFullscreen;
        root.classList.toggle('soql-results-fullscreen', this._isResultsFullscreen);

        const btn = document.getElementById('sf-intel-fullscreen-btn');
        if (btn) {
            btn.title = this._isResultsFullscreen ? 'Exit Full Screen (Esc)' : 'Toggle Full Screen (Esc to exit)';
            btn.innerHTML = this._isResultsFullscreen
                ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/></svg>'
                : '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707zm4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707z"/></svg>';
        }
    },

    _handleFullscreenEsc(e) {
        if (e.key === 'Escape' && this._isResultsFullscreen) {
            this._toggleResultsFullscreen();
        }
    },

    // --- Delete Functionality ---

    _updateDeleteButton() {
        const bar = document.getElementById('sf-intel-selection-bar');
        const btn = document.getElementById('sf-intel-delete-btn');
        const countEl = document.getElementById('sf-intel-selection-count');
        const count = this.selectedRecordIds.size;

        if (bar) {
            bar.classList.toggle('visible', count > 0);
        }
        if (btn) {
            btn.disabled = this._deleteInProgress;
            const label = btn.querySelector('.btn-delete-label');
            if (label) label.textContent = count > 1 ? `Delete (${count})` : 'Delete';
        }
        if (countEl) {
            countEl.textContent = `${count} record${count !== 1 ? 's' : ''} selected`;
        }
    },

    _confirmAndDelete() {
        const count = this.selectedRecordIds.size;
        if (count === 0 || this._deleteInProgress) return;

        const objName = this._lastQueryObject || 'records';
        const batchCount = Math.ceil(count / 200);
        const batchNote = count > 200 ? ` (${batchCount} batches)` : '';

        // Create confirmation modal
        let modal = document.getElementById('sf-intel-delete-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'sf-intel-delete-modal';
        modal.className = 'sf-intel-modal-overlay';
        modal.innerHTML = `
            <div class="sf-intel-modal">
                <div class="sf-intel-modal-header">Confirm Deletion</div>
                <div class="sf-intel-modal-body">
                    <p>You are about to delete <strong>${count} ${objName}</strong> record${count > 1 ? 's' : ''}${batchNote}.</p>
                    <p class="modal-warning">This action cannot be undone.</p>
                </div>
                <div class="sf-intel-modal-footer">
                    <button id="sf-intel-delete-cancel" class="modal-btn modal-btn-cancel">Cancel</button>
                    <button id="sf-intel-delete-confirm" class="modal-btn modal-btn-delete">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('sf-intel-delete-cancel').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.getElementById('sf-intel-delete-confirm').onclick = () => {
            modal.remove();
            this._executeBatchDelete();
        };
    },

    async _executeBatchDelete() {
        if (this._deleteInProgress) return;
        this._deleteInProgress = true;

        const ids = [...this.selectedRecordIds];
        const totalCount = ids.length;
        const batchSize = 200;
        const tryTooling = document.getElementById('soql-try-tooling')?.checked || false;

        // Lock UI
        this._updateDeleteButton();
        const runBtn = document.getElementById('run-util-btn');
        if (runBtn) runBtn.disabled = true;

        if (window.Terminal) {
            window.Terminal.log(`Deleting ${totalCount} records${totalCount > batchSize ? ` in ${Math.ceil(totalCount / batchSize)} batches` : ''}...`);
        }

        let successCount = 0;
        let failedRecords = []; // { id, errors }
        const successIds = new Set();

        // Split into batches of 200
        const batches = [];
        for (let i = 0; i < ids.length; i += batchSize) {
            batches.push(ids.slice(i, i + batchSize));
        }

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];
            if (window.Terminal && batches.length > 1) {
                window.Terminal.log(`Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} records)...`);
            }

            try {
                const results = tryTooling
                    ? await window.apiClient.compositeDeleteTooling(batch)
                    : await window.apiClient.compositeDelete(batch);

                if (Array.isArray(results)) {
                    results.forEach((res, i) => {
                        if (res.success) {
                            successCount++;
                            successIds.add(res.id || batch[i]);
                        } else {
                            failedRecords.push({
                                id: res.id || batch[i],
                                errors: res.errors || [{ message: 'Unknown error' }]
                            });
                        }
                    });
                }
            } catch (err) {
                // Entire batch failed
                batch.forEach(id => {
                    failedRecords.push({ id, errors: [{ message: err.message }] });
                });
                if (window.Terminal) window.Terminal.error(`Batch ${batchIdx + 1} failed: ${err.message}`);
            }
        }

        // Update UI after deletion
        this._deleteInProgress = false;

        // Remove successfully deleted rows from grid
        if (successIds.size > 0) {
            const container = document.getElementById('utility-view-container');
            if (container) {
                successIds.forEach(id => {
                    const row = container.querySelector(`tr[data-record-id="${id}"]`);
                    if (row) row.remove();
                    this.selectedRecordIds.delete(id);
                });

                // Remove from lastQueryResult records
                if (this.lastQueryResult?.records) {
                    this.lastQueryResult.records = this.lastQueryResult.records.filter(
                        r => !successIds.has(r.Id)
                    );
                    if (this.lastQueryResult.totalSize) {
                        this.lastQueryResult.totalSize -= successIds.size;
                    }
                }

                // Re-number visible rows
                const rows = container.querySelectorAll('.soql-table tbody tr');
                rows.forEach((row, i) => {
                    const numCell = row.querySelector('.row-num');
                    if (numCell) numCell.textContent = i + 1;
                });

                // Update count display
                const countEl = container.querySelector('.meta-count');
                if (countEl) countEl.textContent = rows.length;
            }
        }

        // Keep failed records selected
        this.selectedRecordIds = new Set(failedRecords.map(f => f.id));
        this._updateDeleteButton();

        // Unlock UI
        if (runBtn) runBtn.disabled = false;

        // Show results
        if (failedRecords.length === 0) {
            if (window.Terminal) window.Terminal.success(`Successfully deleted ${successCount} record${successCount > 1 ? 's' : ''}.`);
        } else if (successCount > 0) {
            if (window.Terminal) {
                window.Terminal.warn(`${successCount} records deleted. ${failedRecords.length} failed.`);
            }
            this._showDeleteErrors(failedRecords);
        } else {
            if (window.Terminal) window.Terminal.error(`Deletion failed for all ${totalCount} records.`);
            this._showDeleteErrors(failedRecords);
        }
    },

    _showDeleteErrors(failedRecords) {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        // Insert error details panel at top of results
        let errorPanel = document.getElementById('sf-intel-delete-errors');
        if (errorPanel) errorPanel.remove();

        errorPanel = document.createElement('div');
        errorPanel.id = 'sf-intel-delete-errors';
        errorPanel.className = 'delete-error-panel';
        errorPanel.innerHTML = `
            <div class="delete-error-header">
                <span>Failed to delete ${failedRecords.length} record${failedRecords.length > 1 ? 's' : ''}</span>
                <button class="delete-error-close" title="Dismiss">&times;</button>
            </div>
            <div class="delete-error-list">
                ${failedRecords.slice(0, 20).map(f => `
                    <div class="delete-error-item">
                        <span class="error-record-id">${_escapeHtml(f.id)}</span>
                        <span class="error-message">${_escapeHtml(f.errors.map(e => e.message).join('; '))}</span>
                    </div>
                `).join('')}
                ${failedRecords.length > 20 ? `<div class="delete-error-item">... and ${failedRecords.length - 20} more</div>` : ''}
            </div>
        `;

        const header = container.querySelector('.utility-results-header');
        if (header) {
            header.after(errorPanel);
        } else {
            container.prepend(errorPanel);
        }

        errorPanel.querySelector('.delete-error-close').onclick = () => errorPanel.remove();
    },

    _formatCellValue(val, fieldName, instanceUrl) {
        if (val === null || val === undefined) return '<span style="color:#555">null</span>';
        if (typeof val === 'object' && val !== null) {
            if (val.Name) return _escapeHtml(val.Name);
            if (val.Id) return _escapeHtml(val.Id);
            return _escapeHtml(JSON.stringify(val));
        }
        // Clickable Salesforce IDs
        if (fieldName === 'Id' && typeof val === 'string' && /^[a-zA-Z0-9]{15,18}$/.test(val) && instanceUrl) {
            return `<a href="${_escapeHtml(instanceUrl)}/${_escapeHtml(val)}" target="_blank" class="sf-id-link" title="Open in Salesforce">${_escapeHtml(val)}</a>`;
        }
        // Format dates
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
            return _escapeHtml(new Date(val).toLocaleString());
        }
        return _escapeHtml(String(val));
    },

    _sortByField(field, fields) {
        if (this._sortField === field) {
            this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortField = field;
            this._sortDirection = 'asc';
        }
        const records = [...this.lastQueryResult.records];
        records.sort((a, b) => {
            let valA = a[field], valB = b[field];
            if (valA === null) return 1;
            if (valB === null) return -1;
            if (typeof valA === 'object') valA = valA.Name || valA.Id || '';
            if (typeof valB === 'object') valB = valB.Name || valB.Id || '';
            if (typeof valA === 'string') {
                return this._sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return this._sortDirection === 'asc' ? valA - valB : valB - valA;
        });
        this._renderTable(document.getElementById('utility-view-container'), fields, records);
    },

    _copyCell(td) {
        const text = td.textContent;
        navigator.clipboard.writeText(text).then(() => {
            td.style.background = 'rgba(46, 204, 113, 0.3)';
            setTimeout(() => td.style.background = '', 300);
        });
    },

    exportJSON() {
        if (!this.lastQueryResult?.records) return;
        const data = this.lastQueryResult.records.map(r => { const c = {...r}; delete c.attributes; return c; });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `query_${Date.now()}.json`;
        a.click();
        if (window.Terminal) window.Terminal.success(`Exported ${data.length} records to JSON`);
    },

    exportCSV() {
        const result = this.lastQueryResult;
        if (!result || !result.records) return;

        const fields = Object.keys(result.records[0]).filter(k => k !== 'attributes');
        const csvRows = [fields.join(',')];

        result.records.forEach(row => {
            const values = fields.map(f => {
                let val = row[f];
                if (val === null || val === undefined) return '""';
                if (typeof val === 'object') {
                    if (val.Name) val = val.Name;
                    else if (val.attributes) val = '[Complex Object]';
                    else val = JSON.stringify(val);
                }
                const escaped = ('' + val).replace(/"/g, '""');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        });

        const csvContent = csvRows.join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sf_intel_export_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (window.Terminal) window.Terminal.success('CSV exported.');
    },

    copyToClipboard(format) {
        const result = this.lastQueryResult;
        if (!result || !result.records || result.records.length === 0) {
            if (window.Terminal) window.Terminal.warn('Run a query first to export results');
            return;
        }

        const records = result.records;
        const fields = Object.keys(records[0]).filter(k => k !== 'attributes');

        const formatCell = (val) => {
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') {
                if (val.Name) return val.Name;
                if (val.Id) return val.Id;
                return JSON.stringify(val);
            }
            return String(val);
        };

        let text;
        let label;

        if (format === 'excel') {
            // Tab-separated values for Excel paste
            const header = fields.join('\t');
            const rows = records.map(row => fields.map(f => formatCell(row[f])).join('\t'));
            text = header + '\n' + rows.join('\n');
            label = 'Excel';
        } else if (format === 'csv') {
            const header = fields.join(',');
            const rows = records.map(row =>
                fields.map(f => {
                    const val = formatCell(row[f]);
                    const escaped = val.replace(/"/g, '""');
                    return `"${escaped}"`;
                }).join(',')
            );
            text = header + '\r\n' + rows.join('\r\n');
            label = 'CSV';
        } else if (format === 'json') {
            const data = records.map(r => { const c = {...r}; delete c.attributes; return c; });
            text = JSON.stringify(data, null, 2);
            label = 'JSON';
        } else {
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            if (window.Terminal) window.Terminal.success(`${label} copied to clipboard (${records.length} records)`);
        }).catch(err => {
            if (window.Terminal) window.Terminal.error(`Failed to copy: ${err.message}`);
        });
    },

    // ─── Trace Flag Manager ──────────────────────────────────

    _renderTraceFlagManager() {
        const flag = this._traceFlag;
        const isActive = flag && new Date(flag.ExpirationDate) > new Date();
        const loading = this._traceFlagLoading;

        return `
        <div class="tf-manager" id="tf-manager">
            <div class="tf-manager-header" id="tf-manager-toggle">
                <div class="tf-header-left">
                    <span class="tf-status-dot ${isActive ? 'active' : 'inactive'}"></span>
                    <span class="tf-header-title">Trace Flag</span>
                    ${isActive ? `<span class="tf-countdown" id="tf-countdown"></span>` : ''}
                    ${loading ? '<span class="tf-loading-indicator"></span>' : ''}
                </div>
                <div class="tf-header-right">
                    ${isActive
                        ? `<button class="tf-quick-btn tf-btn-extend" id="tf-extend-btn" ${loading ? 'disabled' : ''}>+30m</button>
                           <button class="tf-quick-btn tf-btn-deactivate" id="tf-deactivate-btn" ${loading ? 'disabled' : ''}>Deactivate</button>`
                        : `<button class="tf-quick-btn tf-btn-activate" id="tf-activate-30" ${loading ? 'disabled' : ''}>30m</button>
                           <button class="tf-quick-btn tf-btn-activate" id="tf-activate-60" ${loading ? 'disabled' : ''}>1h</button>`
                    }
                    <span class="tf-chevron ${this._traceFlagCollapsed ? '' : 'open'}" id="tf-chevron">&#9654;</span>
                </div>
            </div>

            <div class="tf-manager-body ${this._traceFlagCollapsed ? 'collapsed' : ''}" id="tf-manager-body">
                <div class="tf-status-section">
                    <div class="tf-status-row">
                        <span class="tf-label">Status</span>
                        <span class="tf-value"><span class="tf-badge ${isActive ? 'tf-badge-active' : 'tf-badge-inactive'}">${isActive ? 'Active' : 'Inactive'}</span></span>
                    </div>
                    ${isActive ? `
                    <div class="tf-status-row">
                        <span class="tf-label">Expires</span>
                        <span class="tf-value tf-mono">${new Date(flag.ExpirationDate).toLocaleTimeString()}</span>
                    </div>
                    <div class="tf-status-row">
                        <span class="tf-label">Debug Level</span>
                        <span class="tf-value tf-mono">${flag.DebugLevel?.DeveloperName || 'Unknown'}</span>
                    </div>
                    <div class="tf-progress-bar">
                        <div class="tf-progress-fill" id="tf-progress-fill"></div>
                    </div>
                    ` : ''}
                </div>

                <div class="tf-presets-section">
                    <div class="tf-section-label">Debug Level Preset</div>
                    <div class="tf-presets-grid">
                        ${Object.entries(this._debugPresets).map(([key, p]) => `
                            <button class="tf-preset-btn ${this._selectedPreset === key ? 'selected' : ''}" data-preset="${key}">
                                <span class="tf-preset-name">${p.label}</span>
                                ${p.tag ? `<span class="tf-preset-tag">${p.tag}</span>` : ''}
                            </button>
                        `).join('')}
                    </div>
                </div>

                ${this._selectedPreset === 'custom' ? this._renderCustomLevelEditor() : `
                    <div class="tf-preset-preview">
                        ${this._renderPresetPreview(this._debugPresets[this._selectedPreset]?.levels)}
                    </div>
                `}

                ${!isActive ? `
                <div class="tf-activate-section">
                    <button class="tf-activate-btn" id="tf-activate-preset" ${loading ? 'disabled' : ''}>
                        ${loading ? '<span class="tf-btn-spinner"></span>' : ''}Activate with ${this._debugPresets[this._selectedPreset]?.label || 'Selected'} Preset
                    </button>
                </div>
                ` : ''}
            </div>
        </div>`;
    },

    _renderPresetPreview(levels) {
        if (!levels) return '';
        const logLevels = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];
        return `<div class="tf-preview-grid">
            ${Object.entries(levels).map(([cat, val]) => {
                const idx = logLevels.indexOf(val);
                const pct = (idx / (logLevels.length - 1)) * 100;
                return `<div class="tf-preview-row">
                    <span class="tf-preview-label">${cat}</span>
                    <div class="tf-preview-bar"><div class="tf-preview-fill" style="width:${pct}%"></div></div>
                    <span class="tf-preview-value">${val}</span>
                </div>`;
            }).join('')}
        </div>`;
    },

    _renderCustomLevelEditor() {
        const categories = ['ApexCode', 'Database', 'System', 'Workflow', 'Validation', 'Callout', 'Visualforce', 'ApexProfiling'];
        const logLevels = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];

        return `
        <div class="tf-custom-editor" id="tf-custom-editor">
            ${categories.map(cat => {
                const current = this._customDebugLevels[cat] || 'INFO';
                const idx = logLevels.indexOf(current);
                const pct = (idx / (logLevels.length - 1)) * 100;
                return `
                <div class="tf-level-row">
                    <span class="tf-level-label">${cat}</span>
                    <div class="tf-level-control">
                        <select class="tf-level-select" data-category="${cat}">
                            ${logLevels.map(l => `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                        <div class="tf-level-bar"><div class="tf-level-fill" style="width:${pct}%"></div></div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    },

    async _loadTraceFlagStatus() {
        try {
            const flags = await window.apiClient.getActiveTraceFlags();
            const now = new Date();
            const active = flags.find(f => new Date(f.ExpirationDate) > now);
            this._traceFlag = active || (flags.length > 0 ? flags[0] : null);
        } catch (e) {
            console.warn('[SF-Intel] Failed to load trace flag status:', e);
            this._traceFlag = null;
        }
    },

    async _activateTraceFlag(minutes) {
        this._traceFlagLoading = true;
        this._rerenderTraceFlagManager();
        try {
            const levels = this._selectedPreset === 'custom'
                ? this._customDebugLevels
                : this._debugPresets[this._selectedPreset].levels;
            await window.apiClient.createTraceFlagWithLevel(minutes, levels);
            await this._loadTraceFlagStatus();
            if (window.Terminal) window.Terminal.success(`Trace flag activated for ${minutes} minutes`);
        } catch (e) {
            if (window.Terminal) window.Terminal.error(`Failed to activate: ${e.message}`);
        } finally {
            this._traceFlagLoading = false;
            this._rerenderTraceFlagManager();
        }
    },

    async _extendTraceFlag() {
        if (!this._traceFlag) return;
        this._traceFlagLoading = true;
        this._rerenderTraceFlagManager();
        try {
            const newExp = new Date(this._traceFlag.ExpirationDate);
            newExp.setMinutes(newExp.getMinutes() + 30);
            await window.apiClient.updateTraceFlag(this._traceFlag.Id, newExp.toISOString());
            await this._loadTraceFlagStatus();
            if (window.Terminal) window.Terminal.success('Trace flag extended by 30 minutes');
        } catch (e) {
            if (window.Terminal) window.Terminal.error(`Failed to extend: ${e.message}`);
        } finally {
            this._traceFlagLoading = false;
            this._rerenderTraceFlagManager();
        }
    },

    async _deactivateTraceFlag() {
        if (!this._traceFlag) return;
        this._traceFlagLoading = true;
        this._rerenderTraceFlagManager();
        try {
            await window.apiClient.deleteTraceFlag(this._traceFlag.Id);
            this._traceFlag = null;
            this._stopCountdownTimer();
            if (window.Terminal) window.Terminal.success('Trace flag deactivated');
        } catch (e) {
            if (window.Terminal) window.Terminal.error(`Failed to deactivate: ${e.message}`);
        } finally {
            this._traceFlagLoading = false;
            this._rerenderTraceFlagManager();
        }
    },

    _rerenderTraceFlagManager() {
        const existing = document.getElementById('tf-manager');
        if (!existing) return;
        const temp = document.createElement('div');
        temp.innerHTML = this._renderTraceFlagManager();
        existing.replaceWith(temp.firstElementChild);
        this._bindTraceFlagEvents();
        this._startCountdownTimer();
    },

    _bindTraceFlagEvents() {
        // Toggle collapse (click on header, not on buttons)
        const toggle = document.getElementById('tf-manager-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                if (e.target.closest('.tf-quick-btn')) return;
                this._traceFlagCollapsed = !this._traceFlagCollapsed;
                const body = document.getElementById('tf-manager-body');
                const chevron = document.getElementById('tf-chevron');
                if (body) body.classList.toggle('collapsed', this._traceFlagCollapsed);
                if (chevron) chevron.classList.toggle('open', !this._traceFlagCollapsed);
            });
        }

        // Quick activate
        const act30 = document.getElementById('tf-activate-30');
        if (act30) act30.addEventListener('click', (e) => { e.stopPropagation(); this._activateTraceFlag(30); });
        const act60 = document.getElementById('tf-activate-60');
        if (act60) act60.addEventListener('click', (e) => { e.stopPropagation(); this._activateTraceFlag(60); });

        // Extend / Deactivate
        const extendBtn = document.getElementById('tf-extend-btn');
        if (extendBtn) extendBtn.addEventListener('click', (e) => { e.stopPropagation(); this._extendTraceFlag(); });
        const deactBtn = document.getElementById('tf-deactivate-btn');
        if (deactBtn) deactBtn.addEventListener('click', (e) => { e.stopPropagation(); this._deactivateTraceFlag(); });

        // Activate with preset button
        const activatePreset = document.getElementById('tf-activate-preset');
        if (activatePreset) activatePreset.addEventListener('click', () => this._activateTraceFlag(30));

        // Preset buttons
        document.querySelectorAll('.tf-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._selectedPreset = btn.dataset.preset;
                this._rerenderTraceFlagManager();
            });
        });

        // Custom level selects
        document.querySelectorAll('.tf-level-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._customDebugLevels[sel.dataset.category] = sel.value;
                const logLevels = ['NONE','ERROR','WARN','INFO','DEBUG','FINE','FINER','FINEST'];
                const fill = sel.closest('.tf-level-control')?.querySelector('.tf-level-fill');
                if (fill) fill.style.width = `${(logLevels.indexOf(sel.value) / 7) * 100}%`;
            });
        });
    },

    _startCountdownTimer() {
        this._stopCountdownTimer();
        if (!this._traceFlag || new Date(this._traceFlag.ExpirationDate) <= new Date()) return;

        const update = () => {
            const exp = new Date(this._traceFlag.ExpirationDate);
            const now = new Date();
            const diffMs = exp - now;

            if (diffMs <= 0) {
                this._stopCountdownTimer();
                this._traceFlag = null;
                this._rerenderTraceFlagManager();
                return;
            }

            const mins = Math.floor(diffMs / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);

            const countdownEl = document.getElementById('tf-countdown');
            if (countdownEl) countdownEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

            const progressEl = document.getElementById('tf-progress-fill');
            if (progressEl && this._traceFlag.StartDate) {
                const start = new Date(this._traceFlag.StartDate);
                const total = exp - start;
                const remaining = exp - now;
                progressEl.style.width = `${Math.max(0, (remaining / total) * 100)}%`;
            }

            const dot = document.querySelector('.tf-status-dot');
            if (dot && mins < 5) {
                dot.classList.remove('active');
                dot.classList.add('warning');
            }
        };

        update();
        this._traceFlagTimer = setInterval(update, 1000);
    },

    _stopCountdownTimer() {
        if (this._traceFlagTimer) {
            clearInterval(this._traceFlagTimer);
            this._traceFlagTimer = null;
        }
    },

    async refreshLogs(isPolling = false, attempt = 1) {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        try {
            if (!isPolling) {
                if (this.activeUtilId !== 'logs') return;

                if (window.Terminal) {
                    window.Terminal.clear();
                    window.Terminal.log('--- LOG INSPECTOR INITIALIZING ---');
                }
                container.innerHTML = '<div class="loading">Loading Trace Flags...</div>';
                await this._loadTraceFlagStatus();

                const isActive = this._traceFlag && new Date(this._traceFlag.ExpirationDate) > new Date();
                if (!isActive) {
                    // Auto-ensure a trace flag so logs can be captured
                    try {
                        await window.apiClient.ensureTraceFlag();
                        await this._loadTraceFlagStatus();
                    } catch (e) {
                        console.warn('[SF-Intel] Auto trace flag failed:', e);
                    }
                }
                if (window.Terminal) window.Terminal.success('TraceFlag loaded.');
            }

            const maxAttempts = 5;
            if (isPolling && window.Terminal) {
                if (this.activeUtilId !== 'logs') return;
                window.Terminal.log(`Polling for logs (${attempt}/${maxAttempts})...`);
                container.innerHTML = `<div class="loading">Polling Logs (${attempt}/${maxAttempts})</div>`;
            } else if (container) {
                container.innerHTML = '<div class="loading">Fetching Logs...</div>';
            }

            const logs = await window.apiClient.getLogs();
            if (this.activeUtilId !== 'logs') return;

            if (logs.length === 0) {
                if (attempt < maxAttempts) {
                    setTimeout(() => this.refreshLogs(true, attempt + 1), 2000);
                    return;
                } else {
                    if (window.Terminal) window.Terminal.error('No logs found.');
                    container.innerHTML = '';
                    container.insertAdjacentHTML('afterbegin', this._renderTraceFlagManager());
                    this._bindTraceFlagEvents();
                    this._startCountdownTimer();
                    this._renderLogsEmptyState(container);
                    this._updateLogsCount(0);
                    return;
                }
            }

            if (window.Terminal) window.Terminal.success(`Found ${logs.length} logs.`);
            this._updateLogsCount(logs.length);

            container.innerHTML = '';

            // Trace Flag Manager (prepended)
            container.insertAdjacentHTML('afterbegin', this._renderTraceFlagManager());
            this._bindTraceFlagEvents();
            this._startCountdownTimer();

            // Column headers
            const header = document.createElement('div');
            header.className = 'logs-header-row';
            header.innerHTML = `
                <span class="logs-col-time">TIME</span>
                <span class="logs-col-op">OPERATION</span>
                <span class="logs-col-status">STATUS</span>
                <span class="logs-col-size">SIZE</span>
            `;
            container.appendChild(header);

            const list = document.createElement('div');
            list.className = 'logs-list';

            logs.forEach(log => {
                const item = document.createElement('div');
                const isLastOpened = log.Id === window.lastOpenedLogId;
                item.className = 'log-item' + (isLastOpened ? ' last-opened' : '');
                const sizeKB = Math.round(log.LogLength / 1024);
                item.innerHTML = `
                    <span class="ts">${new Date(log.StartTime).toLocaleTimeString()}</span>
                    <span class="op">${_escapeHtml(log.Operation)}</span>
                    <span class="stat ${log.Status === 'Success' ? 'ok' : 'err'}">${_escapeHtml(log.Status)}</span>
                    <span class="len">${sizeKB >= 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB'}</span>
                `;
                item.onclick = () => { if (typeof window.viewLog === 'function') window.viewLog(log.Id); };
                list.appendChild(item);
            });

            container.appendChild(list);
        } catch (error) {
            console.error('Refresh Logs Failed:', error);
            if (window.Terminal) window.Terminal.error(`Log Fetch Failed: ${error.message}`);
        }
    },

    _updateLogsCount(count) {
        const el = document.getElementById('logs-count-status');
        if (el) el.textContent = count > 0 ? `${count} log${count !== 1 ? 's' : ''}` : '';
    },

    _renderLogsEmptyState(container) {
        const html = `
            <div class="logs-empty-state">
                <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" opacity="0.15">
                    <path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zM13 5H9.5a.5.5 0 01-.5-.5V1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5zM5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z"/>
                </svg>
                <div class="logs-empty-title">No Debug Logs Found</div>
                <div class="logs-empty-desc">Execute some Apex code or trigger an operation, then refresh to see logs here.</div>
                <button class="logs-empty-retry" onclick="UtilsPanel.refreshLogs()">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-11 2h3.932a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9z"/><path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 11-.771-.636A6.002 6.002 0 0114 8a.5.5 0 01-1 0 5 5 0 00-5-5zM2.5 7.5a.5.5 0 01.5.5 5 5 0 005 5c1.552 0 2.94-.707 3.857-1.818a.5.5 0 11.771.636A6.002 6.002 0 012 8a.5.5 0 01.5-.5z"/></svg>
                    Retry
                </button>
            </div>
        `;
        // Append instead of overwrite to preserve trace flag manager
        if (container.querySelector('#tf-manager')) {
            container.insertAdjacentHTML('beforeend', html);
        } else {
            container.innerHTML = html;
        }
    },

    _setupLogsActions() {
        const refreshBtn = document.getElementById('logs-action-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshLogs();
            });
        }

        const deleteAllBtn = document.getElementById('logs-action-delete-all');
        if (deleteAllBtn) {
            deleteAllBtn.addEventListener('click', async () => {
                if (!confirm('Delete all debug logs from this org?')) return;
                try {
                    const logs = await window.apiClient.getLogs();
                    if (logs.length === 0) return;
                    if (window.Terminal) window.Terminal.log(`Deleting ${logs.length} logs...`);
                    await Promise.all(logs.map(log => window.apiClient.deleteLog(log.Id)));
                    if (window.Terminal) window.Terminal.success('All logs deleted.');
                    this._updateLogsCount(0);
                    const container = document.getElementById('utility-view-container');
                    if (container) this._renderLogsEmptyState(container);
                } catch (e) {
                    if (window.Terminal) window.Terminal.error(`Delete failed: ${e.message}`);
                }
            });
        }
    },

    renderSpecialView(utilId) {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        if (utilId === 'logs') {
            this.refreshLogs();
        } else if (utilId === 'tests') {
            container.innerHTML = '<div class="loading">Test suite rendering...</div>';
            if (typeof window.renderTestSuite === 'function') window.renderTestSuite();
        } else if (utilId === 'flow') {
            container.innerHTML = '<div class="loading">Loading Code Analysis...</div>';
            if (typeof window.renderFlowAnalysis === 'function') window.renderFlowAnalysis();
        }
    }
};

window.UtilsPanel = UtilsPanel;

// Register global Esc key handler for fullscreen exit
document.addEventListener('keydown', (e) => UtilsPanel._handleFullscreenEsc(e));
