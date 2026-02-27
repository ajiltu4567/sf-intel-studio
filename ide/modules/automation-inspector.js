/**
 * Automation Inspector — SF Intel Studio
 * Traces the full blast radius when a Salesforce record is saved.
 * Maps triggers, flows, Apex classes, DML cascades with governor limit budgets.
 */
const LIVE_TRACE_SYSTEM_FIELDS = new Set([
    'Id', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById',
    'SystemModstamp', 'IsDeleted', 'LastActivityDate', 'LastViewedDate',
    'LastReferencedDate', 'attributes'
]);

const AutomationInspector = {

    // ─── State ──────────────────────────────────────────────
    activeTab: 'overview',
    traceMode: 'live',
    traceData: null,
    currentTarget: '',
    currentOperation: 'update',
    isLoading: false,

    // ─── Live Trace State ────────────────────────────────────
    liveTraceState: 'idle',        // 'idle' | 'armed' | 'capturing' | 'results'
    liveTraceStartedAt: null,
    liveTraceResult: null,
    liveTraceLogId: null,
    liveTraceActiveTab: 'summary',
    noiseFilterLevel: 'full',     // 'full' | 'balanced' | 'minimal'
    savedTraces: [],              // Array of { label, timestamp, result, fingerprint }
    comparisonTrace: null,        // The trace being compared against
    liveTraceProgress: null,      // { current, total, phase } during capture
    performanceBudgets: { soqlQueries: 80, dmlStatements: 80, cpuTime: 70, heapSize: 70 },

    // ─── Init ───────────────────────────────────────────────
    init() {
        console.log('[AutomationInspector] Initialized');
        window.renderAutomationInspector = () => this.render();
    },

    // ─── Render ─────────────────────────────────────────────
    render() {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        const header = document.getElementById('utility-header');
        if (header) header.style.display = 'none';
        const editorContainer = document.getElementById('utility-monaco-container');
        const resizer = document.getElementById('utility-resizer');
        if (editorContainer) editorContainer.style.display = 'none';
        if (resizer) resizer.style.display = 'none';

        container.style.display = 'flex';
        container.innerHTML = this.getShellHTML();
        this.bindEvents();
    },

    // ─── Shell HTML ─────────────────────────────────────────
    getShellHTML() {
        return `
            <div class="auto-inspector-shell">
                <div class="auto-input-pane">
                    <div class="auto-input-row">
                        ${ /* TODO: Re-enable mode toggle when Object/Entity/Pre-flight tabs are ready.
                        Restore default traceMode to 'object' in state and uncomment the full button row:
                        <div class="auto-mode-toggle">
                            <button data-mode="object"> Object </button>
                            <button data-mode="entity"> Entity </button>
                            <button data-mode="preflight"> Pre-flight </button>
                            <button data-mode="live"> Live </button>
                        </div>
                        */ ''}

                        ${this.traceMode === 'live' ? this.getLiveTraceControlHTML() :
                          this.traceMode === 'object' ? `
                            <div class="auto-input-group">
                                <label class="auto-input-label">OBJECT NAME</label>
                                <input type="text" id="auto-object-input"
                                    placeholder="e.g. Account, Contact, Opportunity"
                                    value="${this.escapeHtml(this.currentTarget || '')}"
                                    spellcheck="false">
                            </div>
                            <div class="auto-input-group auto-input-narrow">
                                <label class="auto-input-label">OPERATION</label>
                                <select id="auto-operation-select">
                                    <option value="insert" ${this.currentOperation === 'insert' ? 'selected' : ''}>Insert</option>
                                    <option value="update" ${this.currentOperation === 'update' ? 'selected' : ''}>Update</option>
                                    <option value="delete" ${this.currentOperation === 'delete' ? 'selected' : ''}>Delete</option>
                                </select>
                            </div>
                        ` : this.traceMode === 'preflight' ? `
                            <div class="auto-input-group">
                                <label class="auto-input-label">OBJECT NAME</label>
                                <input type="text" id="auto-preflight-input"
                                    placeholder="e.g. Account, Contact, Opportunity"
                                    value="${this.escapeHtml(this.currentTarget || '')}"
                                    spellcheck="false">
                            </div>
                        ` : `
                            <div class="auto-input-group">
                                <label class="auto-input-label">ENTITY NAME</label>
                                <input type="text" id="auto-entity-input"
                                    placeholder="e.g. AccountTrigger, Account_Auto_Update"
                                    value="${this.escapeHtml(this.currentTarget || '')}"
                                    spellcheck="false">
                            </div>
                        `}

                        ${this.traceMode !== 'live' ? `
                        <button id="auto-trace-btn" class="auto-trace-btn ${this.isLoading ? 'loading' : ''}">
                            ${this.isLoading ? `
                                <span class="auto-spinner"></span> ${this.traceMode === 'preflight' ? 'Analyzing...' : 'Tracing...'}
                            ` : `
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>
                                ${this.traceMode === 'preflight' ? 'Analyze' : 'Trace'}
                            `}
                        </button>
                        ` : ''}
                    </div>
                </div>

                ${this.traceMode === 'live' && this.liveTraceState === 'results' && this.liveTraceResult ? `
                    <div class="auto-tabs">
                        <button class="auto-tab ${this.liveTraceActiveTab === 'summary' ? 'active' : ''}" data-tab="live-summary">
                            Summary
                            ${(() => { const urgentRecs = (this.liveTraceResult.recommendations || []).filter(r => r.severity === 'critical' || r.severity === 'high').length; return urgentRecs ? `<span class="auto-tab-badge warn">${urgentRecs}</span>` : ''; })()}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'automations' ? 'active' : ''}" data-tab="live-automations">
                            Automations
                            ${this.liveTraceResult.automations?.length ? `<span class="auto-tab-badge">${this.liveTraceResult.automations.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'dml' ? 'active' : ''}" data-tab="live-dml">
                            DML Changes
                            ${this.liveTraceResult.dmlOps?.length ? `<span class="auto-tab-badge">${this.liveTraceResult.dmlOps.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'soql' ? 'active' : ''}" data-tab="live-soql">
                            SOQL
                            ${this.liveTraceResult.soqlQueries?.length ? `<span class="auto-tab-badge">${this.liveTraceResult.soqlQueries.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'limits' ? 'active' : ''}" data-tab="live-limits">
                            Limits
                            ${(() => { const gl = this.liveTraceResult.governorLimits || {}; const hasWarn = Object.values(gl).some(v => v.limit && (v.used / v.limit) > 0.7); return hasWarn ? '<span class="auto-tab-badge warn">!</span>' : ''; })()}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'debug' ? 'active' : ''}" data-tab="live-debug">
                            Debug
                            ${(() => { const count = (this.liveTraceResult.exceptions?.length || 0) + (this.liveTraceResult.userDebug?.length || 0); return count ? `<span class="auto-tab-badge ${this.liveTraceResult.stats?.totalExceptions > 0 ? 'warn' : ''}">${count}</span>` : ''; })()}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'validations' ? 'active' : ''}" data-tab="live-validations">
                            Rules
                            ${(() => { const count = (this.liveTraceResult.validations?.length || 0) + (this.liveTraceResult.duplicateRules?.length || 0); return count ? `<span class="auto-tab-badge ${this.liveTraceResult.stats?.totalValidationFails > 0 ? 'warn' : ''}">${count}</span>` : ''; })()}
                        </button>
                        <button class="auto-tab ${this.liveTraceActiveTab === 'timing' ? 'active' : ''}" data-tab="live-timing">
                            Timing
                            ${this.liveTraceResult.codeUnitTimings?.length ? `<span class="auto-tab-badge">${this.liveTraceResult.codeUnitTimings.length}</span>` : ''}
                        </button>
                        ${this.comparisonTrace ? `
                            <button class="auto-tab ${this.liveTraceActiveTab === 'comparison' ? 'active' : ''}" data-tab="live-comparison">
                                Compare
                            </button>
                        ` : ''}
                    </div>
                ` : this.traceData ? (this.traceMode === 'preflight' ? `
                    <div class="auto-tabs">
                        <button class="auto-tab ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">
                            Overview
                        </button>
                        <button class="auto-tab ${this.activeTab === 'required-fields' ? 'active' : ''}" data-tab="required-fields">
                            Required Fields
                            ${this.traceData.required_fields?.length ? `<span class="auto-tab-badge">${this.traceData.required_fields.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.activeTab === 'validation-rules' ? 'active' : ''}" data-tab="validation-rules">
                            Validation Rules
                            ${this.traceData.validation_rules?.length ? `<span class="auto-tab-badge warn">${this.traceData.validation_rules.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.activeTab === 'automations' ? 'active' : ''}" data-tab="automations">
                            Automations
                        </button>
                        <button class="auto-tab ${this.activeTab === 'warnings' ? 'active' : ''}" data-tab="warnings">
                            Warnings
                            ${this.traceData.risk_summary?.warnings?.length ? `<span class="auto-tab-badge warn">${this.traceData.risk_summary.warnings.length}</span>` : ''}
                        </button>
                    </div>
                ` : `
                    <div class="auto-tabs">
                        <button class="auto-tab ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">
                            Overview
                        </button>
                        <button class="auto-tab ${this.activeTab === 'execution-order' ? 'active' : ''}" data-tab="execution-order">
                            Execution Order
                            ${this.traceData.execution_order?.length ? `<span class="auto-tab-badge">${this.traceData.execution_order.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.activeTab === 'execution-chain' ? 'active' : ''}" data-tab="execution-chain">
                            Execution Chain
                            ${this.traceData.execution_chain?.length ? `<span class="auto-tab-badge">${this.traceData.execution_chain.length}</span>` : ''}
                        </button>
                        <button class="auto-tab ${this.activeTab === 'dml-cascade' ? 'active' : ''}" data-tab="dml-cascade">
                            DML Cascade
                            ${this.traceData.dml_cascade?.length ? `<span class="auto-tab-badge warn">${this.traceData.dml_cascade.length}</span>` : ''}
                        </button>
                    </div>
                `) : ''}

                <div class="auto-content">
                    ${this.renderTabContent()}
                </div>
            </div>
        `;
    },

    // ─── Events ─────────────────────────────────────────────
    bindEvents() {
        // Mode toggle
        document.querySelectorAll('.auto-mode-btn').forEach(btn => {
            btn.onclick = () => {
                this.traceMode = btn.dataset.mode;
                if (btn.dataset.mode !== 'live') {
                    this.traceData = null;
                    this.activeTab = 'overview';
                }
                this.render();
            };
        });

        // Live trace buttons
        const liveStartBtn = document.getElementById('auto-live-start-btn');
        const liveCaptureBtn = document.getElementById('auto-live-capture-btn');
        const liveCancelBtn = document.getElementById('auto-live-cancel-btn');
        const liveNewBtn = document.getElementById('auto-live-new-btn');
        if (liveStartBtn) liveStartBtn.onclick = () => this.startLiveTrace();
        if (liveCaptureBtn) liveCaptureBtn.onclick = () => this.captureLiveTrace();
        if (liveCancelBtn) liveCancelBtn.onclick = () => this.resetLiveTrace();
        if (liveNewBtn) liveNewBtn.onclick = () => this.resetLiveTrace();
        const liveViewLogBtn = document.getElementById('auto-live-viewlog-btn');
        if (liveViewLogBtn) liveViewLogBtn.onclick = () => { if (window.viewLog && this.liveTraceLogId) window.viewLog(this.liveTraceLogId); };

        // Record link click handlers (open record in Salesforce)
        document.querySelectorAll('.auto-record-link').forEach(link => {
            link.onclick = () => {
                const recordId = link.dataset.recordId;
                if (recordId && this.apiClient) {
                    const instanceUrl = this.apiClient.instanceUrl || '';
                    if (instanceUrl) window.open(`${instanceUrl}/${recordId}`, '_blank');
                }
            };
        });

        // Export buttons
        document.querySelectorAll('[data-export]').forEach(btn => {
            btn.onclick = () => this._exportTrace(btn.dataset.export);
        });

        // Noise filter profile buttons
        document.querySelectorAll('.auto-noise-btn').forEach(btn => {
            btn.onclick = () => {
                this.noiseFilterLevel = btn.dataset.noise;
                this.render();
            };
        });

        // Save trace button
        const saveTraceBtn = document.getElementById('auto-save-trace-btn');
        if (saveTraceBtn) saveTraceBtn.onclick = () => this._saveCurrentTrace();

        // Compare dropdown
        const compareSelect = document.getElementById('auto-compare-select');
        if (compareSelect) compareSelect.onchange = () => {
            const idx = parseInt(compareSelect.value);
            if (!isNaN(idx)) this._compareTraces(idx);
        };

        // Field detail toggles
        document.querySelectorAll('.auto-fields-toggle').forEach(toggle => {
            toggle.onclick = () => {
                const detail = toggle.nextElementSibling;
                if (detail) {
                    detail.classList.toggle('collapsed');
                    const icon = toggle.querySelector('.auto-toggle-icon');
                    if (icon) icon.textContent = detail.classList.contains('collapsed') ? '▶' : '▼';
                }
            };
        });

        // Deep log jump links
        document.querySelectorAll('.auto-log-jump').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const lineNum = btn.dataset.logLine;
                let container = document.getElementById('auto-log-context');
                // Create floating container if not present (e.g. in DML/SOQL tabs)
                if (!container) {
                    const panel = btn.closest('.auto-exec-order') || btn.closest('.auto-overview');
                    if (panel) {
                        container = document.createElement('div');
                        container.id = 'auto-log-context';
                        container.style.display = 'none';
                        panel.appendChild(container);
                    }
                }
                const snippet = this.liveTraceResult?.rawLogSnippets?.[lineNum];
                if (container && snippet) {
                    if (container.style.display !== 'none' && container.dataset.activeLine === lineNum) {
                        container.style.display = 'none';
                    } else {
                        container.dataset.activeLine = lineNum;
                        container.style.display = 'block';
                        container.innerHTML = `<div class="auto-log-context"><div class="auto-log-context-header">Log context (line ${this.escapeHtml(lineNum)})</div><pre class="auto-log-context-pre">${this.escapeHtml(snippet)}</pre></div>`;
                    }
                }
            };
        });

        // Evidence links in root cause
        document.querySelectorAll('.auto-evidence-link').forEach(link => {
            link.onclick = () => {
                const lineNum = link.dataset.evidenceLine;
                const container = document.getElementById('auto-evidence-container');
                const snippet = this.liveTraceResult?.rawLogSnippets?.[lineNum];
                if (container && snippet) {
                    if (container.style.display !== 'none' && container.dataset.activeLine === lineNum) {
                        container.style.display = 'none';
                    } else {
                        container.dataset.activeLine = lineNum;
                        container.style.display = 'block';
                        container.innerHTML = `<div class="auto-log-context"><div class="auto-log-context-header">Evidence (line ${this.escapeHtml(lineNum)})</div><pre class="auto-log-context-pre">${this.escapeHtml(snippet)}</pre></div>`;
                    }
                }
            };
        });

        // Async "View Log" buttons
        document.querySelectorAll('.auto-async-view-log').forEach(btn => {
            btn.onclick = () => {
                const logId = btn.dataset.logId;
                if (logId && window.apiClient) {
                    window.apiClient.getLog(logId).then(logBody => {
                        if (window.Terminal) window.Terminal.info(`Async log ${logId} loaded (${(logBody || '').length} chars)`);
                    }).catch(err => {
                        if (window.Terminal) window.Terminal.error(`Failed to fetch async log: ${err.message}`);
                    });
                }
            };
        });

        // Trace button
        const traceBtn = document.getElementById('auto-trace-btn');
        if (traceBtn) traceBtn.onclick = () => this.runTrace();

        // Enter key on inputs
        const objectInput = document.getElementById('auto-object-input');
        const entityInput = document.getElementById('auto-entity-input');
        const preflightInput = document.getElementById('auto-preflight-input');
        if (objectInput) objectInput.onkeydown = (e) => { if (e.key === 'Enter') this.runTrace(); };
        if (entityInput) entityInput.onkeydown = (e) => { if (e.key === 'Enter') this.runTrace(); };
        if (preflightInput) preflightInput.onkeydown = (e) => { if (e.key === 'Enter') this.runTrace(); };

        // Operation select
        const opSelect = document.getElementById('auto-operation-select');
        if (opSelect) opSelect.onchange = () => { this.currentOperation = opSelect.value; };

        // Tab switching
        document.querySelectorAll('.auto-tab').forEach(tab => {
            tab.onclick = () => {
                const tabId = tab.dataset.tab;
                if (tabId.startsWith('live-')) {
                    this.liveTraceActiveTab = tabId.replace('live-', '');
                } else {
                    this.activeTab = tabId;
                }
                this.render();
            };
        });

        // Tree node toggle
        document.querySelectorAll('.auto-tree-toggle').forEach(toggle => {
            toggle.onclick = (e) => {
                e.stopPropagation();
                const node = toggle.closest('.auto-tree-node');
                if (node) node.classList.toggle('collapsed');
            };
        });

        // Jump-to-tab buttons (e.g. "View in Debug →" on exception banner)
        document.querySelectorAll('[data-jump-tab]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.liveTraceActiveTab = btn.dataset.jumpTab;
                this.render();
            };
        });

        // Example chips (empty state)
        document.querySelectorAll('.auto-example-chip').forEach(chip => {
            chip.onclick = () => {
                this.currentTarget = chip.dataset.example;
                this.traceMode = 'object';
                this.render();
                // Auto-focus and trigger trace
                setTimeout(() => this.runTrace(), 50);
            };
        });

        // Quick action buttons (overview tab)
        document.querySelectorAll('.auto-action-btn').forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.action;
                if (action) {
                    this.activeTab = action;
                    this.render();
                }
            };
        });
    },

    // ─── API Calls ──────────────────────────────────────────
    async runTrace() {
        let input;
        if (this.traceMode === 'object') input = document.getElementById('auto-object-input');
        else if (this.traceMode === 'preflight') input = document.getElementById('auto-preflight-input');
        else input = document.getElementById('auto-entity-input');

        if (!input || !input.value.trim()) {
            if (window.Terminal) window.Terminal.error('Please enter a name');
            return;
        }

        this.currentTarget = input.value.trim();
        this.isLoading = true;
        this.render();

        try {
            let url;
            if (this.traceMode === 'object') {
                const op = this.currentOperation || 'update';
                url = `http://127.0.0.1:3000/api/automation/trace/object/${encodeURIComponent(this.currentTarget)}?operation=${op}&max_depth=5`;
            } else if (this.traceMode === 'preflight') {
                const orgAlias = window.SessionState?.currentOrg || '';
                const orgParam = orgAlias ? `?org=${encodeURIComponent(orgAlias)}` : '';
                url = `http://127.0.0.1:3000/api/import/preflight/${encodeURIComponent(this.currentTarget)}${orgParam}`;
            } else {
                url = `http://127.0.0.1:3000/api/automation/trace/entity/${encodeURIComponent(this.currentTarget)}?max_depth=5`;
            }

            if (window.Terminal) window.Terminal.log(`${this.traceMode === 'preflight' ? 'Analyzing' : 'Tracing'} ${this.currentTarget}...`);

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API returned ${response.status}`);

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            this.traceData = data;
            this.activeTab = 'overview';
            this.isLoading = false;

            if (window.Terminal) {
                if (this.traceMode === 'preflight') {
                    const rs = data.risk_summary || {};
                    window.Terminal.success(`Pre-flight complete: ${rs.required_field_count || 0} required fields, ${rs.validation_rule_count || 0} validation rules, ${rs.automation_count || 0} automations — Risk: ${rs.risk_level || 'UNKNOWN'}`);
                } else {
                    const chainCount = data.execution_chain?.length || 0;
                    const cascadeCount = data.dml_cascade?.length || 0;
                    window.Terminal.success(`Trace complete: ${chainCount} automations found${cascadeCount > 0 ? `, ${cascadeCount} DML cascade(s)` : ''}`);
                }
            }

            this.render();
        } catch (error) {
            console.error('[AutomationInspector] Trace failed:', error);
            this.isLoading = false;
            this.traceData = null;
            if (window.Terminal) window.Terminal.error(`Trace failed: ${error.message}`);
            this.render();

            // Show inline error
            const content = document.querySelector('.auto-content');
            if (content) {
                content.innerHTML = `
                    <div class="auto-error-state">
                        <div class="auto-error-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                        </div>
                        <h3>Trace Failed</h3>
                        <p>${this.escapeHtml(error.message)}</p>
                        <p class="auto-error-hint">Make sure the SF-Intel CLI server is running on port 3000</p>
                    </div>
                `;
            }
        }
    },

    // ─── Tab Router ─────────────────────────────────────────
    renderTabContent() {
        // Live trace has its own content flow
        if (this.traceMode === 'live') {
            if (this.liveTraceState === 'results' && this.liveTraceResult) {
                switch (this.liveTraceActiveTab) {
                    case 'summary': return this.renderLiveTraceSummary();
                    case 'automations': return this.renderLiveTraceAutomations();
                    case 'dml': return this.renderLiveTraceDml();
                    case 'soql': return this.renderLiveTraceSoql();
                    case 'limits': return this.renderLiveTraceLimits();
                    case 'debug': return this.renderLiveTraceDebug();
                    case 'validations': return this.renderLiveTraceValidations();
                    case 'timing': return this.renderLiveTraceTiming();
                    case 'comparison': return this.renderLiveTraceComparison();
                    default: return '';
                }
            }
            if (this.liveTraceState === 'idle') {
                return `
                <div class="auto-empty-state">
                    <div class="auto-empty-icon">
                        <svg width="260" height="220" viewBox="0 0 260 220" fill="none">
                            <!-- Central pulse ring -->
                            <circle cx="130" cy="90" r="44" stroke="#555" stroke-width="6" opacity="0.5"/>
                            <circle cx="130" cy="90" r="44" stroke="#e74c3c" stroke-width="6" stroke-dasharray="20 256" stroke-linecap="round" opacity="0.6"/>
                            <circle cx="130" cy="90" r="28" stroke="#555" stroke-width="5" opacity="0.35"/>
                            <circle cx="130" cy="90" r="12" fill="#e74c3c" opacity="0.25"/>
                            <circle cx="130" cy="90" r="6" fill="#e74c3c" opacity="0.5"/>
                            <!-- Radiating trace lines -->
                            <line x1="85" y1="90" x2="40" y2="60" stroke="#555" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round" opacity="0.4"/>
                            <line x1="175" y1="90" x2="220" y2="60" stroke="#555" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round" opacity="0.4"/>
                            <line x1="130" y1="135" x2="130" y2="180" stroke="#555" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round" opacity="0.4"/>
                            <!-- Endpoint nodes -->
                            <circle cx="35" cy="55" r="16" stroke="#555" stroke-width="4" opacity="0.4"/>
                            <circle cx="225" cy="55" r="16" stroke="#555" stroke-width="4" opacity="0.4"/>
                            <circle cx="130" cy="188" r="16" stroke="#555" stroke-width="4" opacity="0.4"/>
                            <!-- Activity arcs -->
                            <path d="M88 40 Q100 25 115 32" stroke="#3498db" stroke-width="2.5" stroke-linecap="round" opacity="0.3"/>
                            <path d="M145 32 Q160 25 172 40" stroke="#e67e22" stroke-width="2.5" stroke-linecap="round" opacity="0.3"/>
                        </svg>
                    </div>
                    <h3 class="auto-empty-title">Live Trace</h3>
                    <p class="auto-empty-desc">Capture and analyze real-time automation execution,<br>governor limits, and DML cascades</p>
                </div>`;
            }
            return '';  // control panel handles armed/capturing states
        }

        if (!this.traceData) {
            return `
                <div class="auto-empty-state">
                    <div class="auto-empty-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1"><circle cx="12" cy="12" r="10"/><path d="M12 6v6M12 6l3 3M12 6l-3 3"/><path d="M8 14h8" stroke-dasharray="2 2"/><path d="M6 18h12"/></svg>
                    </div>
                    <h3 class="auto-empty-title">Automation Inspector</h3>
                    <p class="auto-empty-desc">Enter an object or entity name above to trace the full automation execution chain, DML cascades, and governor limit budget.</p>
                    <div class="auto-empty-examples">
                        <span class="auto-example-chip" data-example="Account">Account</span>
                        <span class="auto-example-chip" data-example="Contact">Contact</span>
                        <span class="auto-example-chip" data-example="Opportunity">Opportunity</span>
                        <span class="auto-example-chip" data-example="Case">Case</span>
                        <span class="auto-example-chip" data-example="Lead">Lead</span>
                    </div>
                </div>
            `;
        }

        if (this.traceMode === 'preflight') {
            switch (this.activeTab) {
                case 'overview': return this.renderPreflightOverview();
                case 'required-fields': return this.renderPreflightRequiredFields();
                case 'validation-rules': return this.renderPreflightValidationRules();
                case 'automations': return this.renderPreflightAutomations();
                case 'warnings': return this.renderPreflightWarnings();
                default: return '';
            }
        }

        switch (this.activeTab) {
            case 'overview': return this.renderOverview();
            case 'execution-order': return this.renderExecutionOrder();
            case 'execution-chain': return this.renderExecutionChain();
            case 'dml-cascade': return this.renderDmlCascade();
            default: return '';
        }
    },

    // ─── Overview Tab ───────────────────────────────────────
    renderOverview() {
        const d = this.traceData;
        const gl = d.governor_limits || {};
        const triggerCount = (d.execution_chain || []).filter(n => n.type === 'trigger').length;
        const flowCount = (d.execution_chain || []).filter(n => n.type === 'flow').length;

        const riskColors = { LOW: '#2ecc71', MEDIUM: '#f39c12', HIGH: '#e67e22', CRITICAL: '#e74c3c' };
        const riskColor = riskColors[d.risk_level] || '#888';

        return `
            <div class="auto-overview">
                <div class="auto-overview-header">
                    <h3 class="auto-section-title">
                        ${this.escapeHtml(d.target)}
                        ${d.operation ? `<span class="auto-operation-badge">${d.operation.toUpperCase()}</span>` : ''}
                    </h3>
                    <div class="auto-risk-badge" style="--risk-color: ${riskColor}">
                        <span class="auto-risk-dot"></span>
                        ${d.risk_level || 'UNKNOWN'}
                        <span class="auto-risk-score">${d.risk_score || 0}/100</span>
                    </div>
                </div>

                <div class="auto-stats-grid">
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${triggerCount}</span>
                        <span class="auto-stat-label">Triggers</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${flowCount}</span>
                        <span class="auto-stat-label">Flows</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${gl.soql_queries || 0}</span>
                        <span class="auto-stat-label">SOQL Queries</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${gl.dml_statements || 0}</span>
                        <span class="auto-stat-label">DML Statements</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${gl.callouts || 0}</span>
                        <span class="auto-stat-label">Callouts</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${(d.dml_cascade || []).length}</span>
                        <span class="auto-stat-label">Cascades</span>
                    </div>
                </div>

                <div class="auto-governor-section">
                    <h4 class="auto-section-subtitle">Governor Limit Budget</h4>
                    <div class="auto-governor-bars">
                        ${this.renderGovernorBar('SOQL Queries', gl.soql_queries || 0, 100)}
                        ${this.renderGovernorBar('DML Statements', gl.dml_statements || 0, 150)}
                        ${this.renderGovernorBar('Callouts', gl.callouts || 0, 100)}
                    </div>
                </div>

                ${(d.recursion_warnings || []).length > 0 ? `
                    <div class="auto-warnings-section">
                        <h4 class="auto-section-subtitle auto-warning-title">Recursion Warnings</h4>
                        ${d.recursion_warnings.map(w => `
                            <div class="auto-warning-item">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="#e74c3c"><path d="M8 1l7 14H1L8 1zm0 4v5m0 2v1"/></svg>
                                <span>${this.escapeHtml(w)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="auto-quick-actions">
                    <button class="auto-action-btn" data-action="execution-order">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h10M3 6h8M3 9h6M3 12h4"/></svg>
                        View Execution Order
                    </button>
                    <button class="auto-action-btn" data-action="execution-chain">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2v12M6 4v4M10 6v6M14 3v8"/></svg>
                        View Execution Chain
                    </button>
                    ${(d.dml_cascade || []).length > 0 ? `
                        <button class="auto-action-btn warn" data-action="dml-cascade">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v4M4 8h8M6 12h4"/><circle cx="8" cy="14" r="1" fill="currentColor"/></svg>
                            View DML Cascades (${d.dml_cascade.length})
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    },

    renderGovernorBar(label, used, limit) {
        const pct = Math.min((used / limit) * 100, 100);
        const level = pct > 80 ? 'critical' : pct > 50 ? 'warning' : 'safe';
        return `
            <div class="auto-governor-bar">
                <div class="auto-governor-label">
                    <span>${label}</span>
                    <span class="auto-governor-count">${used} / ${limit}</span>
                </div>
                <div class="auto-governor-track">
                    <div class="auto-governor-fill ${level}" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    },

    // ─── Execution Order Tab ────────────────────────────────
    renderExecutionOrder() {
        const phases = this.traceData.execution_order || [];

        if (phases.length === 0) {
            return `
                <div class="auto-empty-tab">
                    <p>No execution phases found for this trace.</p>
                    ${this.traceMode === 'entity' ? '<p class="auto-hint">Execution order is only available for object-centric traces.</p>' : ''}
                </div>
            `;
        }

        const phaseColors = {
            2: { color: '#9b59b6', icon: '🔀', label: 'Before-Save Flows' },
            3: { color: '#3498db', icon: '⚡', label: 'Before Triggers' },
            5: { color: '#2ecc71', icon: '⚡', label: 'After Triggers' },
            7: { color: '#9b59b6', icon: '🔀', label: 'After-Save Flows' },
            11: { color: '#e67e22', icon: '⚙️', label: 'Process Builder' },
        };

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Salesforce Order of Execution</h3>
                    <span class="auto-section-count">${phases.length} phase${phases.length !== 1 ? 's' : ''} active</span>
                </div>

                <div class="auto-timeline">
                    ${phases.map((phase, idx) => {
                        const config = phaseColors[phase.order] || { color: '#888', icon: '📋', label: phase.phase_name };
                        return `
                            <div class="auto-phase-card" style="--phase-color: ${config.color}">
                                <div class="auto-phase-header">
                                    <div class="auto-phase-number">Phase ${phase.order}</div>
                                    <div class="auto-phase-name">${this.escapeHtml(phase.phase_name)}</div>
                                </div>
                                <div class="auto-phase-automations">
                                    ${(phase.automations || []).map(a => `
                                        <div class="auto-automation-item">
                                            <span class="auto-automation-icon">${a.automation_type === 'trigger' ? '⚡' : '🔀'}</span>
                                            <span class="auto-automation-name">${this.escapeHtml(a.name)}</span>
                                            <span class="auto-automation-events">${(a.events || []).map(e => this.escapeHtml(e)).join(', ')}</span>
                                        </div>
                                    `).join('')}
                                </div>
                                ${idx < phases.length - 1 ? '<div class="auto-timeline-connector"></div>' : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    },

    // ─── Execution Chain Tab ────────────────────────────────
    renderExecutionChain() {
        const chain = this.traceData.execution_chain || [];

        if (chain.length === 0) {
            return `<div class="auto-empty-tab"><p>No execution chain found.</p></div>`;
        }

        return `
            <div class="auto-exec-chain">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Execution Chain</h3>
                    <span class="auto-section-count">${this.countNodes(chain)} nodes</span>
                </div>
                <div class="auto-tree">
                    ${chain.map(node => this.renderNode(node, 0)).join('')}
                </div>
            </div>
        `;
    },

    renderNode(node, depth) {
        const typeConfig = {
            trigger:  { icon: '⚡', color: '#3498db', label: 'Trigger' },
            flow:     { icon: '🔀', color: '#9b59b6', label: 'Flow' },
            method:   { icon: '→',  color: '#7f8c8d', label: 'Method' },
            soql:     { icon: '🔍', color: '#2980b9', label: 'SOQL' },
            dml:      { icon: '💾', color: '#8e44ad', label: 'DML' },
            callout:  { icon: '🌐', color: '#f39c12', label: 'Callout' },
        };

        const config = typeConfig[node.type] || { icon: '•', color: '#888', label: node.type };
        const hasChildren = node.children && node.children.length > 0;
        const details = node.details || '';

        return `
            <div class="auto-tree-node" style="--node-depth: ${depth}">
                <div class="auto-tree-node-content">
                    ${hasChildren ? `<span class="auto-tree-toggle">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l5 3-5 3z"/></svg>
                    </span>` : `<span class="auto-tree-spacer"></span>`}
                    <span class="auto-node-icon" style="color: ${config.color}">${config.icon}</span>
                    <span class="auto-node-type-badge" style="--badge-color: ${config.color}">${config.label}</span>
                    <span class="auto-node-name">${this.escapeHtml(node.name)}</span>
                    ${details ? `<span class="auto-node-details">${this.escapeHtml(details)}</span>` : ''}
                    ${node.async_boundary ? '<span class="auto-async-badge">ASYNC</span>' : ''}
                </div>
                ${hasChildren ? `
                    <div class="auto-tree-children">
                        ${node.children.map(child => this.renderNode(child, depth + 1)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    },

    countNodes(nodes) {
        let count = 0;
        for (const node of nodes) {
            count++;
            if (node.children) count += this.countNodes(node.children);
        }
        return count;
    },

    // ─── DML Cascade Tab ────────────────────────────────────
    renderDmlCascade() {
        const cascades = this.traceData.dml_cascade || [];
        const warnings = this.traceData.recursion_warnings || [];

        if (cascades.length === 0) {
            return `
                <div class="auto-empty-tab">
                    <div class="auto-empty-tab-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg>
                    </div>
                    <p>No DML cascades detected.</p>
                    <p class="auto-hint">This means record saves on this object don't trigger secondary automations on other objects.</p>
                </div>
            `;
        }

        return `
            <div class="auto-dml-cascade">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">DML Cascade Analysis</h3>
                    <span class="auto-section-count warn">${cascades.length} cascade${cascades.length !== 1 ? 's' : ''} detected</span>
                </div>

                ${warnings.length > 0 ? `
                    <div class="auto-cascade-warnings">
                        ${warnings.map(w => `
                            <div class="auto-warning-item">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="#e74c3c"><path d="M8 1l7 14H1L8 1zm0 4v5m0 2v1"/></svg>
                                <span>${this.escapeHtml(w)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="auto-cascade-list">
                    ${cascades.map((c, idx) => `
                        <div class="auto-cascade-card">
                            <div class="auto-cascade-header">
                                <div class="auto-cascade-object">
                                    <span class="auto-cascade-icon">💾</span>
                                    <span class="auto-cascade-name">${this.escapeHtml(c.object_name)}</span>
                                    <span class="auto-cascade-op">${this.escapeHtml(c.operation)}</span>
                                </div>
                                <span class="auto-cascade-depth">Depth ${c.cascade_depth}</span>
                            </div>
                            <div class="auto-cascade-triggered-by">
                                Triggered by: <strong>${this.escapeHtml(c.triggered_by)}</strong>
                            </div>
                            ${(c.secondary_automations || []).length > 0 ? `
                                <div class="auto-cascade-secondary">
                                    <div class="auto-cascade-secondary-label">Secondary Automations:</div>
                                    ${c.secondary_automations.map(a => `
                                        <div class="auto-cascade-secondary-item">
                                            <span class="auto-cascade-arrow">↳</span>
                                            ${this.escapeHtml(a)}
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    // ─── Preflight Tabs ────────────────────────────────────────

    renderPreflightOverview() {
        const d = this.traceData;
        const rs = d.risk_summary || {};
        const riskColors = { LOW: '#2ecc71', MEDIUM: '#f39c12', HIGH: '#e74c3c' };
        const riskColor = riskColors[rs.risk_level] || '#888';

        const insertCount = (d.automations_on_insert?.triggers?.length || 0) + (d.automations_on_insert?.flows?.length || 0)
            + (d.automations_on_insert?.workflow_rules?.length || 0) + (d.automations_on_insert?.process_builders?.length || 0);
        const updateCount = (d.automations_on_update?.triggers?.length || 0) + (d.automations_on_update?.flows?.length || 0)
            + (d.automations_on_update?.workflow_rules?.length || 0) + (d.automations_on_update?.process_builders?.length || 0);

        return `
            <div class="auto-overview">
                <div class="auto-overview-header">
                    <h3 class="auto-section-title">Import Pre-flight: ${this.escapeHtml(d.object)}</h3>
                    <div class="auto-risk-badge" style="--risk-color: ${riskColor}">
                        <span class="auto-risk-dot"></span>
                        ${rs.risk_level || 'UNKNOWN'}
                    </div>
                </div>

                <div class="auto-stats-grid">
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${rs.required_field_count || 0}</span>
                        <span class="auto-stat-label">Required Fields</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${rs.validation_rule_count || 0}</span>
                        <span class="auto-stat-label">Validation Rules</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${rs.duplicate_rule_count || 0}</span>
                        <span class="auto-stat-label">Duplicate Rules</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${rs.record_type_count || 0}</span>
                        <span class="auto-stat-label">Record Types</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${(d.lookup_dependencies || []).length}</span>
                        <span class="auto-stat-label">Lookups</span>
                    </div>
                    <div class="auto-stat-card">
                        <span class="auto-stat-value">${rs.automation_count || 0}</span>
                        <span class="auto-stat-label">Automations</span>
                    </div>
                </div>

                ${(rs.warnings || []).length > 0 ? `
                    <div class="auto-warnings-section">
                        <h4 class="auto-section-subtitle auto-warning-title">Warnings</h4>
                        ${rs.warnings.map(w => `
                            <div class="auto-warning-item">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="#f39c12"><path d="M8 1l7 14H1L8 1zm0 4v5m0 2v1"/></svg>
                                <span>${this.escapeHtml(w)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="auto-quick-actions">
                    <button class="auto-action-btn" data-action="required-fields">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h10M3 6h8M3 9h6M3 12h4"/></svg>
                        View Required Fields (${rs.required_field_count || 0})
                    </button>
                    <button class="auto-action-btn" data-action="automations">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2v12M6 4v4M10 6v6M14 3v8"/></svg>
                        View Automations (Insert: ${insertCount}, Update: ${updateCount})
                    </button>
                </div>
            </div>
        `;
    },

    renderPreflightRequiredFields() {
        const fields = this.traceData.required_fields || [];
        const lookups = this.traceData.lookup_dependencies || [];

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Required Fields</h3>
                    <span class="auto-section-count">${fields.length} field${fields.length !== 1 ? 's' : ''}</span>
                </div>

                ${fields.length === 0 ? `
                    <div class="auto-empty-tab">
                        <p>No required fields found in local database.</p>
                        <p class="auto-hint">Run the CLI with --org flag for live field data: sf-intel import preflight ${this.escapeHtml(this.traceData.object)} --org &lt;alias&gt;</p>
                    </div>
                ` : `
                    <div class="auto-preflight-table">
                        <div class="auto-table-header">
                            <span class="auto-table-col auto-col-name">Field</span>
                            <span class="auto-table-col auto-col-type">Type</span>
                            <span class="auto-table-col auto-col-note">Note</span>
                        </div>
                        ${fields.map(f => `
                            <div class="auto-table-row">
                                <span class="auto-table-col auto-col-name">${this.escapeHtml(f.name)}</span>
                                <span class="auto-table-col auto-col-type"><span class="auto-type-badge">${this.escapeHtml(f.data_type)}</span></span>
                                <span class="auto-table-col auto-col-note">${this.escapeHtml(f.note)}</span>
                            </div>
                        `).join('')}
                    </div>
                `}

                ${lookups.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 20px;">
                        <h3 class="auto-section-title">Lookup Dependencies</h3>
                        <span class="auto-section-count">${lookups.length} lookup${lookups.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="auto-preflight-table">
                        <div class="auto-table-header">
                            <span class="auto-table-col auto-col-name">Field</span>
                            <span class="auto-table-col auto-col-type">Target Object</span>
                            <span class="auto-table-col auto-col-note">Required</span>
                        </div>
                        ${lookups.map(l => `
                            <div class="auto-table-row ${l.required ? 'auto-row-required' : ''}">
                                <span class="auto-table-col auto-col-name">${this.escapeHtml(l.field)}</span>
                                <span class="auto-table-col auto-col-type">${this.escapeHtml(l.target_object)}</span>
                                <span class="auto-table-col auto-col-note">${l.required ? '<span class="auto-required-badge">REQUIRED</span>' : '<span class="auto-optional-badge">Optional</span>'}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    },

    renderPreflightValidationRules() {
        const rules = this.traceData.validation_rules || [];
        const dupes = this.traceData.duplicate_rules || [];
        const recordTypes = this.traceData.record_types || [];

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Validation Rules</h3>
                    <span class="auto-section-count">${rules.length} rule${rules.length !== 1 ? 's' : ''}</span>
                </div>

                ${rules.length === 0 ? `
                    <div class="auto-empty-tab"><p>No active validation rules found for this object.</p></div>
                ` : rules.map(vr => `
                    <div class="auto-phase-card" style="--phase-color: #e74c3c">
                        <div class="auto-phase-header">
                            <div class="auto-phase-name">${this.escapeHtml(vr.name)}</div>
                        </div>
                        <div class="auto-phase-automations">
                            <div class="auto-automation-item">
                                <span class="auto-automation-events">${this.escapeHtml(vr.error_message || '(no error message)')}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}

                ${dupes.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 20px;">
                        <h3 class="auto-section-title">Duplicate Rules</h3>
                        <span class="auto-section-count warn">${dupes.length} rule${dupes.length !== 1 ? 's' : ''}</span>
                    </div>
                    ${dupes.map(dr => `
                        <div class="auto-phase-card" style="--phase-color: #f39c12">
                            <div class="auto-phase-header">
                                <div class="auto-phase-name">${this.escapeHtml(dr.master_label || dr.name)}</div>
                            </div>
                        </div>
                    `).join('')}
                ` : ''}

                ${recordTypes.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 20px;">
                        <h3 class="auto-section-title">Record Types</h3>
                        <span class="auto-section-count">${recordTypes.length} type${recordTypes.length !== 1 ? 's' : ''}</span>
                    </div>
                    ${recordTypes.map(rt => `
                        <div class="auto-phase-card" style="--phase-color: #3498db">
                            <div class="auto-phase-header">
                                <div class="auto-phase-name">${this.escapeHtml(rt.name)}</div>
                                <div class="auto-phase-number">${this.escapeHtml(rt.developer_name)}</div>
                            </div>
                        </div>
                    `).join('')}
                ` : ''}
            </div>
        `;
    },

    renderPreflightAutomations() {
        const d = this.traceData;
        const ins = d.automations_on_insert || {};
        const upd = d.automations_on_update || {};

        const renderAutoList = (autos, label) => {
            const all = [
                ...(autos.triggers || []).map(n => ({ name: n, type: 'trigger', icon: '⚡' })),
                ...(autos.flows || []).map(n => ({ name: n, type: 'flow', icon: '🔀' })),
                ...(autos.workflow_rules || []).map(n => ({ name: n, type: 'workflow', icon: '📋' })),
                ...(autos.process_builders || []).map(n => ({ name: n, type: 'process builder', icon: '⚙️' })),
            ];

            if (all.length === 0) {
                return `<div class="auto-empty-tab" style="padding: 16px;"><p>No automations for ${label}.</p></div>`;
            }

            return all.map(a => `
                <div class="auto-automation-item" style="padding: 8px 12px;">
                    <span class="auto-automation-icon">${a.icon}</span>
                    <span class="auto-automation-name">${this.escapeHtml(a.name)}</span>
                    <span class="auto-automation-events">${this.escapeHtml(a.type)}</span>
                </div>
            `).join('');
        };

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Automations on INSERT</h3>
                </div>
                <div class="auto-phase-card" style="--phase-color: #2ecc71">
                    ${renderAutoList(ins, 'INSERT')}
                </div>

                <div class="auto-section-header" style="margin-top: 20px;">
                    <h3 class="auto-section-title">Automations on UPDATE</h3>
                </div>
                <div class="auto-phase-card" style="--phase-color: #3498db">
                    ${renderAutoList(upd, 'UPDATE')}
                </div>
            </div>
        `;
    },

    renderPreflightWarnings() {
        const rs = this.traceData.risk_summary || {};
        const warnings = rs.warnings || [];

        if (warnings.length === 0) {
            return `
                <div class="auto-empty-tab">
                    <div class="auto-empty-tab-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg>
                    </div>
                    <p>No warnings. This object looks safe for import.</p>
                </div>
            `;
        }

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Import Warnings</h3>
                    <span class="auto-section-count warn">${warnings.length} warning${warnings.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="auto-cascade-list">
                    ${warnings.map(w => `
                        <div class="auto-cascade-card">
                            <div class="auto-cascade-header">
                                <div class="auto-cascade-object">
                                    <span class="auto-cascade-icon" style="font-size: 18px;">⚠️</span>
                                    <span class="auto-cascade-name" style="white-space: normal;">${this.escapeHtml(w)}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    // ─── Live Trace ──────────────────────────────────────────

    getLiveTraceControlHTML() {
        if (this.liveTraceState === 'idle') {
            return `
                <div class="auto-input-group" style="flex: 1;">
                    <div class="auto-live-control">
                        <button id="auto-live-start-btn" class="auto-trace-btn">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3" fill="#e74c3c"/><circle cx="8" cy="8" r="6"/></svg>
                            Start Live Trace
                        </button>
                        <span class="auto-live-hint">Arm a debug trace, perform your action in Salesforce, then capture the log.</span>
                    </div>
                </div>`;
        }
        if (this.liveTraceState === 'armed') {
            const startTime = this.liveTraceStartedAt ? new Date(this.liveTraceStartedAt).toLocaleTimeString() : '';
            return `
                <div class="auto-input-group" style="flex: 1;">
                    <div class="auto-live-control">
                        <span class="auto-live-recording">
                            <span class="auto-live-dot"></span>
                            Recording since ${startTime}
                        </span>
                        <button id="auto-live-capture-btn" class="auto-trace-btn">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2l10 6-10 6V2z" fill="currentColor"/></svg>
                            Capture Now
                        </button>
                        <button id="auto-live-cancel-btn" class="auto-trace-btn" style="background: transparent; border: 1px solid #555;">
                            Cancel
                        </button>
                    </div>
                </div>`;
        }
        if (this.liveTraceState === 'capturing') {
            const prog = this.liveTraceProgress;
            return `
                <div class="auto-input-group" style="flex: 1;">
                    <div class="auto-live-control" style="flex-direction:column;align-items:stretch;gap:6px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span class="auto-spinner"></span>
                            <span style="color: #ccc;">${this.escapeHtml(prog?.phase || 'Fetching and parsing log...')}</span>
                        </div>
                        ${prog && prog.total > 0 ? `
                            <div class="auto-progress-bar">
                                <div class="auto-progress-fill" style="width: ${Math.round((prog.current / prog.total) * 100)}%;"></div>
                            </div>
                        ` : ''}
                    </div>
                </div>`;
        }
        if (this.liveTraceState === 'results') {
            return `
                <div class="auto-input-group" style="flex: 1;">
                    <div class="auto-live-control">
                        <button id="auto-live-new-btn" class="auto-trace-btn" style="min-width: 130px;">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3" fill="#e74c3c"/><circle cx="8" cy="8" r="6"/></svg>
                            New Trace
                        </button>
                        ${this.liveTraceLogId ? `
                            <button id="auto-live-viewlog-btn" class="auto-trace-btn" style="background: transparent; border: 1px solid #555;">
                                View Full Log
                            </button>
                        ` : ''}
                    </div>
                </div>`;
        }
        return '';
    },

    async startLiveTrace() {
        if (!window.apiClient) {
            if (window.Terminal) window.Terminal.error('No active Salesforce connection.');
            return;
        }
        this.liveTraceState = 'armed';
        this.render();
        try {
            const debugLevelId = await window.apiClient.getOrCreateLiveTraceDebugLevel();
            const userId = await window.apiClient.getCurrentUserId();
            const now = new Date();
            const expiration = new Date();
            expiration.setMinutes(expiration.getMinutes() + 15);

            // Check for existing active trace flag — update its debug level if found
            const existing = await window.apiClient.toolingQuery(
                `SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${now.toISOString()} LIMIT 1`
            );

            if (existing.records && existing.records.length > 0) {
                const existingFlag = existing.records[0];
                // Update existing trace flag to use our live trace debug level
                if (existingFlag.DebugLevelId !== debugLevelId) {
                    console.log('[LiveTrace] Updating existing trace flag to use live trace debug level');
                    await window.apiClient.rest(`/services/data/${window.apiClient.apiVersion}/tooling/sobjects/TraceFlag/${existingFlag.Id}`, {
                        method: 'PATCH',
                        body: {
                            DebugLevelId: debugLevelId,
                            ExpirationDate: expiration.toISOString()
                        }
                    });
                }
            } else {
                await window.apiClient.rest(`/services/data/${window.apiClient.apiVersion}/tooling/sobjects/TraceFlag`, {
                    method: 'POST',
                    body: {
                        TracedEntityId: userId,
                        DebugLevelId: debugLevelId,
                        StartDate: now.toISOString(),
                        ExpirationDate: expiration.toISOString(),
                        LogType: 'DEVELOPER_LOG'
                    }
                });
            }

            this.liveTraceStartedAt = now.toISOString();

            // Arm network event capture in service worker (clear buffer + start accumulating)
            try {
                chrome.runtime.sendMessage({ action: 'arm-network-capture' });
            } catch (e) {}

            if (window.Terminal) window.Terminal.success(`Live trace armed. Perform your action in Salesforce, then click Capture.`);
            this.render();
        } catch (err) {
            console.error('[AutomationInspector] Failed to arm trace:', err);
            this.liveTraceState = 'idle';
            if (window.Terminal) window.Terminal.error(`Failed to arm trace: ${err.message}`);
            this.render();
        }
    },

    async captureLiveTrace() {
        this.liveTraceState = 'capturing';
        this.liveTraceProgress = { current: 0, total: 0, phase: 'Fetching logs...' };
        this.render();
        try {
            const logs = await window.apiClient.getLogsSince(this.liveTraceStartedAt);
            console.log('[LiveTrace] Logs returned:', logs.length, logs.map(l => ({ id: l.Id, op: l.Operation, status: l.Status, length: l.LogLength, start: l.StartTime })));

            if (!logs || logs.length === 0) {
                // Check if a client-side toast error was captured (JS error before any Apex call).
                // If so, show it even though no debug log was generated.
                try {
                    const earlyNetResp = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: 'get-network-events' }, (r) => resolve(r || {}));
                    });
                    const earlyUiErrors = earlyNetResp.uiErrors || [];
                    if (earlyUiErrors.length > 0) {
                        const syntheticResult = this._buildUiErrorResult(earlyUiErrors);
                        this.liveTraceLogId = null;
                        this.liveTraceResult = syntheticResult;
                        this.liveTraceState = 'results';
                        this.liveTraceActiveTab = 'summary';
                        this.liveTraceProgress = null;
                        if (window.Terminal) window.Terminal.warn(
                            `No server log — captured ${earlyUiErrors.length} client-side error(s) from LWC.`
                        );
                        this.render();
                        return;
                    }
                } catch (e) { /* ignore — fall through to normal no-logs message */ }

                this.liveTraceState = 'armed';
                this.liveTraceProgress = null;
                if (window.Terminal) window.Terminal.log('No new logs yet. Perform your action and try again.');
                this.render();
                return;
            }

            // Parse ALL logs individually, then stitch cross-log flow segments before merging.
            const allLogIds = [];
            const parsedLogs = [];

            for (let li = 0; li < logs.length; li++) {
                const log = logs[li];
                this.liveTraceProgress = { current: li + 1, total: logs.length, phase: `Parsing log ${li + 1} of ${logs.length}...` };
                this.render();
                try {
                    const logBody = await window.apiClient.getLogBody(log.Id);
                    allLogIds.push(log.Id);
                    const parsed = this._summarizeLiveLog(logBody);
                    parsed._logIndex = li;
                    parsedLogs.push(parsed);
                } catch (e) {
                    console.warn('[LiveTrace] Failed to parse log', log.Id, e.message);
                }
            }

            // Segment stitching: link flow interviews that span multiple log records
            // (Screen Flows, multi-screen interviews) before merging so cross-log
            // interview IDs are visible on both sides of the stitch.
            if (parsedLogs.length > 1) this._stitchFlowSegments(parsedLogs);

            // Merge all parsed results
            let mergedResult = null;
            for (const parsed of parsedLogs) {
                mergedResult = mergedResult ? this._mergeLiveResults(mergedResult, parsed) : parsed;
            }
            this.liveTraceProgress = null;

            if (!mergedResult) {
                this.liveTraceState = 'armed';
                if (window.Terminal) window.Terminal.error('Failed to parse any logs.');
                this.render();
                return;
            }

            mergedResult.allLogIds = allLogIds;

            // Fetch intercepted LWC/Aura Apex network calls + client-side UI errors from service worker
            try {
                const netResp = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'get-network-events' }, (r) => resolve(r || {}));
                });
                const networkEvents = netResp.events || [];
                const uiErrors = netResp.uiErrors || [];

                // Inject client-side toast errors (JS errors before any Apex call) at the top
                if (uiErrors.length > 0) {
                    mergedResult.uiErrors = uiErrors;
                    uiErrors.slice().reverse().forEach((e, i) => {
                        mergedResult.timeline.unshift({
                            order: -(200 + i),
                            type: 'ui-error',
                            name: e.title || 'Client Error',
                            detail: e.message || '',
                            lineNumber: null
                        });
                    });
                }

                if (networkEvents.length > 0) {
                    mergedResult.networkCalls = networkEvents.map(e => {
                        const isError = e.failed || (e.statusCode && e.statusCode >= 400) || e.statusCode === 0;
                        const statusLabel = e.failed ? 'ERR' : (e.statusCode || '?');
                        return {
                            name: e.className ? `${e.className}.${e.methodName || '?'}` : this._shortenUrl(e.url),
                            className: e.className || null,
                            methodName: e.methodName || null,
                            detail: `${statusLabel} · ${e.duration || 0}ms`,
                            statusCode: e.statusCode,
                            failed: !!e.failed,
                            isError,
                            duration: e.duration || 0,
                            timestamp: e.timestamp,
                            url: e.url
                        };
                    });

                    // Fallback: cross-reference with apex:// code units from the debug log.
                    // Duration matching is unreliable (round-trip vs server-side), so we use
                    // positional matching — the Nth unresolved network call maps to the Nth
                    // apex:// code unit in log order. Correct for the common case (1 button = 1 Apex call),
                    // and reasonable for multi-call cases since log order reflects invocation order.
                    const apexCodeUnits = (mergedResult.codeUnitTimings || []).filter(
                        cu => cu.name && cu.name.startsWith('apex://')
                    );
                    const unresolvedNCs = mergedResult.networkCalls.filter(nc => !nc.className);
                    unresolvedNCs.forEach((nc, i) => {
                        const cu = apexCodeUnits[i];
                        if (!cu) return;
                        const m = cu.name.match(/apex:\/\/([^/]+)\/ACTION\$(.+)/);
                        if (m) {
                            nc.className = m[1];
                            nc.methodName = m[2];
                            nc.name = `${m[1]}.${m[2]}`;
                        }
                    });

                    // Prepend to timeline as root-cause "User Action" entries (LWC caller added later async)
                    mergedResult.networkCalls.slice().reverse().forEach((nc, i) => {
                        mergedResult.timeline.unshift({
                            order: -(100 + i),
                            type: 'network',
                            name: nc.name,
                            detail: nc.detail,
                            lineNumber: null
                        });
                    });
                }
            } catch (e) {
                console.warn('[LiveTrace] Could not fetch network events:', e.message);
            }

            // Enrich network calls with LWC component names.
            // Search key = "ClassName.methodName" — matches LWC import path:
            //   import runAutomationTest from '@salesforce/apex/AccountController.runAutomationTest';
            // Tier 1: instant local search (lwcBundleCache + openTabs — no API call).
            // Tier 2: SOSL fallback only for keys not resolved locally.
            if (mergedResult.networkCalls?.length) {
                // Build "ClassName.methodName" keys — more unique than method name alone
                const searchKeys = [...new Set(
                    mergedResult.networkCalls
                        .filter(nc => nc.className && nc.methodName)
                        .map(nc => `${nc.className}.${nc.methodName}`)
                )];
                if (searchKeys.length) {
                    const callerMap = this._lookupLwcCallers(searchKeys);

                    // Fall back to SOSL for keys not resolved locally
                    const unresolved = searchKeys.filter(k => !callerMap[k]?.length);
                    if (unresolved.length) {
                        this.liveTraceProgress = { phase: 'Discovering components...' };
                        this.render();
                        try {
                            const remoteMap = await this._lookupLwcCallersRemote(unresolved);
                            for (const k in remoteMap) {
                                if (remoteMap[k]?.length) callerMap[k] = remoteMap[k];
                            }
                        } catch (e) {
                            console.warn('[LiveTrace] Remote component discovery failed:', e.message);
                        }
                        this.liveTraceProgress = null;
                    }

                    mergedResult.networkCalls.forEach(nc => {
                        if (!nc.className || !nc.methodName) return;
                        const key = `${nc.className}.${nc.methodName}`;
                        if (callerMap[key]?.length) nc.callerComponents = callerMap[key];
                    });
                    mergedResult.timeline.forEach(t => {
                        if (t.type !== 'network') return;
                        const nc = mergedResult.networkCalls.find(n => t.name === n.name);
                        if (nc?.callerComponents?.length) {
                            t.detail = nc.detail + ` ← ${nc.callerComponents[0]}.lwc`;
                        }
                    });
                }
            }

            // Deduplicate network calls: if the same method was called N times (e.g. button
            // clicked 4 times), collapse into one timeline entry with a ×N count badge.
            // Duration is averaged; the LWC caller detail is already on the timeline entry.
            if (mergedResult.networkCalls?.length > 1) {
                const seenNc = new Map();
                for (const nc of mergedResult.networkCalls) {
                    if (!seenNc.has(nc.name)) {
                        nc.count = 1;
                        seenNc.set(nc.name, nc);
                    } else {
                        const ex = seenNc.get(nc.name);
                        ex.count++;
                        // Running average of duration
                        ex.duration = Math.round(ex.duration + (nc.duration - ex.duration) / ex.count);
                        if (nc.isError) ex.isError = true;
                    }
                }
                mergedResult.networkCalls = [...seenNc.values()];

                // Keep only the first timeline entry per network call name, stamp count on it
                const seenTl = new Set();
                mergedResult.timeline = mergedResult.timeline.filter(t => {
                    if (t.type !== 'network') return true;
                    if (seenTl.has(t.name)) return false;
                    seenTl.add(t.name);
                    return true;
                });
                mergedResult.timeline.forEach(t => {
                    if (t.type !== 'network') return;
                    const nc = mergedResult.networkCalls.find(n => n.name === t.name);
                    if (nc?.count > 1) t.countBadge = nc.count;
                });
            }

            this.liveTraceLogId = allLogIds[0];
            this.liveTraceResult = mergedResult;
            this.liveTraceState = 'results';
            this.liveTraceActiveTab = 'summary';

            const s = this.liveTraceResult.stats;
            if (window.Terminal) window.Terminal.success(
                `Captured ${allLogIds.length} log(s): ${s.totalAutomations} automation(s), ${s.totalDml} DML, ${s.totalSoql} SOQL` +
                (s.hasFatalError ? ' [FATAL ERROR]' : s.totalExceptions > 0 ? ` [${s.totalExceptions} exception(s)]` : '')
            );
            mergedResult.traceWindow = {
                startTime: this.liveTraceStartedAt,
                endTime: new Date().toISOString(),
                userId: null,
                logCount: allLogIds.length
            };
            // Re-compute merged parserHealth coverage
            if (mergedResult.parserHealth?.totalLines > 0) {
                mergedResult.parserHealth.coveragePct = Math.round((1 - mergedResult.parserHealth.unknownLines / mergedResult.parserHealth.totalLines) * 100);
            }
            // Re-compute merged transactionFingerprint
            const mergedShapeTokens = mergedResult.timeline.map(t => `${t.type}:${t.name}`);
            const mergedShapeStr = mergedShapeTokens.join('|');
            mergedResult.transactionFingerprint = {
                shape: mergedShapeStr,
                hash: mergedShapeStr.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(16),
                eventCount: mergedShapeTokens.length,
                uniqueTypes: [...new Set(mergedResult.timeline.map(t => t.type))].length
            };
            // Performance budget violations (F4)
            mergedResult.budgetViolations = [];
            for (const [key, budget] of Object.entries(this.performanceBudgets)) {
                const limit = mergedResult.governorLimits[key];
                if (limit && limit.limit > 0) {
                    const pct = (limit.used / limit.limit) * 100;
                    if (pct > budget) {
                        mergedResult.budgetViolations.push({ metric: key, used: limit.used, limit: limit.limit, pct: Math.round(pct), budget });
                    }
                }
            }
            this._computeConfidence();
            this._computePrimarySuspects();
            this._computeImpactHints();
            this._computeIncidentFlags();
            this._computeTraceQuality();
            this._computeRecommendations();
            this.render();

            // Async record tracking + field changes + async log correlation
            this._fetchAffectedRecords().then(() => {
                this._computeConfidence();
                return this._correlateAsyncLogs();
            });

            // LWC enrichment already awaited above — results include component names from the start
        } catch (err) {
            console.error('[AutomationInspector] Capture failed:', err);
            this.liveTraceState = 'armed';
            if (window.Terminal) window.Terminal.error(`Capture failed: ${err.message}`);
            this.render();
        }
    },

    resetLiveTrace() {
        this.liveTraceState = 'idle';
        this.liveTraceStartedAt = null;
        this.liveTraceResult = null;
        this.liveTraceLogId = null;
        this.liveTraceActiveTab = 'summary';
        this.comparisonTrace = null;
        this.liveTraceProgress = null;
        this._lwcResourceCache = null; // clear so next trace fetches fresh data
        // savedTraces intentionally preserved across resets
        try { chrome.runtime.sendMessage({ action: 'disarm-network-capture' }); } catch (e) {}
        this.render();
    },

    // ─── Debug Log Parser ────────────────────────────────────

    _summarizeLiveLog(rawLog) {
        const result = {
            automations: [], dmlOps: [], soqlQueries: [], validations: [],
            duplicateRules: [], workflows: [], callouts: [], timeline: [],
            exceptions: [], userDebug: [], flowElements: [], codeUnitTimings: [],
            asyncOperations: [], transactions: [], recursionSignals: [], dmlCascade: [],
            primarySuspects: [], bulkSafetySignals: [], objectImpact: {},
            limitRisk: {}, logCompleteness: {}, traceWindow: {},
            governorLimits: {}, recordsAffected: [], allLogIds: [],
            confidence: {}, isLargeLog: false, totalLogLines: 0,
            parserHealth: {}, rawLogSnippets: {}, transactionFingerprint: {},
            budgetViolations: [], impactHints: [], incidentFlags: [],
            interactionRoot: {}, slowestUnit: null, automationDensity: [],
            limitSpikes: [], soqlCostSignals: [], debugLevelWarnings: [],
            nothingHappened: false, traceQuality: 100, asyncCorrelation: [],
            stats: {}
        };

        let pendingValidation = null;
        let soqlEndIdx = 0;
        const codeUnitStack = [];
        const MAX_LOG_LINES = 100000;
        const allLines = rawLog.split('\n');
        result.totalLogLines = allLines.length;
        result.isLargeLog = allLines.length > MAX_LOG_LINES;
        if (result.isLargeLog) console.warn(`[AutomationInspector] Large log: ${allLines.length} lines, truncating to ${MAX_LOG_LINES}`);
        const lines = result.isLargeLog ? allLines.slice(0, MAX_LOG_LINES) : allLines;

        let txnCounter = 0;
        let currentTxn = null;
        let unknownLines = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let lineMatched = false;
            // Transaction boundaries
            if (line.includes('|EXECUTION_STARTED')) {
                lineMatched = true;
                txnCounter++;
                currentTxn = { id: txnCounter, startLine: result.timeline.length, endLine: null, eventCount: 0 };
                result.transactions.push(currentTxn);
            }
            if (line.includes('|EXECUTION_FINISHED') && currentTxn) {
                lineMatched = true;
                currentTxn.endLine = result.timeline.length;
                currentTxn.eventCount = currentTxn.endLine - currentTxn.startLine;
                currentTxn = null;
            }
            // Trigger: CODE_UNIT_STARTED with "on ObjectName trigger event"
            if (line.includes('|CODE_UNIT_STARTED|')) {
                lineMatched = true;
                const triggerMatch = line.match(/\|(\w+)\s+on\s+(\w+)\s+trigger\s+event\s+(.+?)(?:\||$)/);
                if (triggerMatch) {
                    const entry = { type: 'trigger', name: triggerMatch[1], objectName: triggerMatch[2], events: triggerMatch[3].trim().split(/\s*,\s*/) };
                    if (!result.automations.find(a => a.name === entry.name && a.events.join() === entry.events.join())) {
                        result.automations.push(entry);
                        result.timeline.push({ order: result.timeline.length, type: 'trigger', name: entry.name, detail: `${entry.objectName} (${entry.events.join(', ')})`, lineNumber: i + 1 });
                    }
                }
                // Async detection within CODE_UNIT_STARTED
                const codeUnitBody = line.split('|CODE_UNIT_STARTED|')[1] || '';
                if (/queueable/i.test(codeUnitBody)) {
                    const cn = codeUnitBody.split('|').pop()?.trim() || 'Unknown';
                    result.asyncOperations.push({ type: 'Queueable', className: cn });
                } else if (/future/i.test(codeUnitBody)) {
                    const cn = codeUnitBody.split('|').pop()?.trim() || 'Unknown';
                    result.asyncOperations.push({ type: 'Future', className: cn });
                }

                // Timing stack
                const ns = this._extractNanos(line);
                const nameMatch = line.match(/\|CODE_UNIT_STARTED\|[^|]*\|(.+?)$/);
                if (nameMatch && ns !== null) codeUnitStack.push({ name: nameMatch[1].trim(), startNs: ns });
            }

            // CODE_UNIT_FINISHED — timing
            if (line.includes('|CODE_UNIT_FINISHED|')) {
                lineMatched = true;
                const ns = this._extractNanos(line);
                if (codeUnitStack.length > 0 && ns !== null) {
                    const unit = codeUnitStack.pop();
                    result.codeUnitTimings.push({ name: unit.name, startNs: unit.startNs, endNs: ns, durationMs: ((ns - unit.startNs) / 1000000).toFixed(2) });
                }
            }

            // Flow: FLOW_START_INTERVIEWS
            if (line.includes('|FLOW_START_INTERVIEWS|')) {
                lineMatched = true;
                const flowMatch = line.match(/\|FLOW_START_INTERVIEWS\|(.+?)(?:\||$)/);
                if (flowMatch) {
                    const name = flowMatch[1].trim();
                    result.automations.push({ type: 'flow', name, objectName: null, events: [] });
                    result.timeline.push({ order: result.timeline.length, type: 'flow', name, detail: '', lineNumber: i + 1 });
                }
            }

            // Flow alternative: FLOW_START_INTERVIEW_BEGIN (carries interview ID for stitching)
            if (line.includes('|FLOW_START_INTERVIEW_BEGIN|')) {
                lineMatched = true;
                // Format: timestamp|FLOW_START_INTERVIEW_BEGIN|?|flowApiName|interviewId
                const flowMatch = line.match(/\|FLOW_START_INTERVIEW_BEGIN\|[^|]*\|([^|]+)\|([^\s|]+)/);
                if (flowMatch) {
                    const name = flowMatch[1].trim();
                    const interviewId = flowMatch[2].trim();
                    if (!result.automations.find(a => a.type === 'flow' && a.name === name)) {
                        result.automations.push({ type: 'flow', name, objectName: null, events: [], interviewId });
                        result.timeline.push({ order: result.timeline.length, type: 'flow', name, detail: '', lineNumber: i + 1 });
                    } else {
                        const existing = result.automations.find(a => a.type === 'flow' && a.name === name);
                        if (existing && !existing.interviewId) existing.interviewId = interviewId;
                    }
                }
            }

            // Flow continuation across transactions (Screen Flows, long-running interviews)
            if (line.includes('|FLOW_RESUME_INTERVIEW_BEGIN|')) {
                lineMatched = true;
                // Same format as FLOW_START_INTERVIEW_BEGIN — same interview ID, different log
                const resumeMatch = line.match(/\|FLOW_RESUME_INTERVIEW_BEGIN\|[^|]*\|([^|]+)\|([^\s|]+)/);
                if (resumeMatch) {
                    const name = resumeMatch[1].trim();
                    const interviewId = resumeMatch[2].trim();
                    const existing = result.automations.find(a => a.type === 'flow' && (a.name === name || a.interviewId === interviewId));
                    if (existing) {
                        existing.isResumed = true;
                        if (!existing.interviewId) existing.interviewId = interviewId;
                    } else {
                        result.automations.push({ type: 'flow', name, objectName: null, events: [], interviewId, isResumed: true });
                        result.timeline.push({ order: result.timeline.length, type: 'flow', name, detail: 'resumed', lineNumber: i + 1 });
                    }
                }
            }

            // Flow element details
            if (line.includes('|FLOW_ELEMENT_BEGIN|')) {
                lineMatched = true;
                const feMatch = line.match(/\|FLOW_ELEMENT_BEGIN\|([^|]+)\|([^|]+)\|(.+?)$/);
                if (feMatch) result.flowElements.push({ flowName: feMatch[1].trim(), elementType: feMatch[2].trim(), elementName: feMatch[3].trim(), status: 'started' });
            }
            if (line.includes('|FLOW_ELEMENT_END|')) {
                lineMatched = true;
                const feMatch = line.match(/\|FLOW_ELEMENT_END\|([^|]+)\|([^|]+)\|(.+?)$/);
                if (feMatch) {
                    const elem = [...result.flowElements].reverse().find(e => e.flowName === feMatch[1].trim() && e.elementName === feMatch[3].trim());
                    if (elem) elem.status = 'completed';
                }
            }

            // Flow enrichment: decision outcomes, loop counts, fault paths
            if (window.FlowAnalysisHelper && window.FlowAnalysisHelper.processLine(line, result)) {
                lineMatched = true;
            }

            // DML: DML_BEGIN with Op:Type:Rows
            if (line.includes('|DML_BEGIN|')) {
                lineMatched = true;
                const dmlMatch = line.match(/Op:(\w+)\|Type:(\w+)\|Rows:(\d+)/);
                if (dmlMatch) {
                    const currentUnit = codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1].name : null;
                    result.dmlOps.push({ operation: dmlMatch[1], objectType: dmlMatch[2], rowCount: parseInt(dmlMatch[3], 10), logLine: i + 1, codeUnit: currentUnit });
                    result.timeline.push({ order: result.timeline.length, type: 'dml', name: `${dmlMatch[1]} ${dmlMatch[2]}`, detail: `${dmlMatch[3]} row(s)`, lineNumber: i + 1 });
                }
            }

            // SOQL: SOQL_EXECUTE_BEGIN
            if (line.includes('|SOQL_EXECUTE_BEGIN|')) {
                lineMatched = true;
                const soqlMatch = line.match(/\|SOQL_EXECUTE_BEGIN\|(?:\[\d+\]\|)?(?:Aggregations:\d+\|)?(.+?)$/);
                if (soqlMatch) {
                    const query = soqlMatch[1].trim();
                    const lineNumMatch = line.match(/\|SOQL_EXECUTE_BEGIN\|\[(\d+)\]/);
                    const currentUnit = codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1].name : null;
                    result.soqlQueries.push({ query, lineNumber: lineNumMatch ? parseInt(lineNumMatch[1], 10) : null, logLine: i + 1, codeUnit: currentUnit });
                }
            }

            // SOQL_EXECUTE_END — row counts
            if (line.includes('|SOQL_EXECUTE_END|')) {
                lineMatched = true;
                const endMatch = line.match(/Rows:(\d+)/);
                if (endMatch && soqlEndIdx < result.soqlQueries.length) {
                    result.soqlQueries[soqlEndIdx].rowCount = parseInt(endMatch[1]);
                    soqlEndIdx++;
                }
            }

            // Validation rule
            if (line.includes('|VALIDATION_RULE|')) {
                lineMatched = true;
                const vrMatch = line.match(/\|VALIDATION_RULE\|(.+?)(?:\||$)/);
                if (vrMatch) pendingValidation = vrMatch[1].trim();
            }
            if (line.includes('|VALIDATION_PASS') && pendingValidation) {
                lineMatched = true;
                result.validations.push({ ruleName: pendingValidation, outcome: 'PASS' });
                result.timeline.push({ order: result.timeline.length, type: 'validation', name: pendingValidation, detail: 'PASS', lineNumber: i + 1 });
                pendingValidation = null;
            }
            if (line.includes('|VALIDATION_FAIL') && pendingValidation) {
                lineMatched = true;
                result.validations.push({ ruleName: pendingValidation, outcome: 'FAIL' });
                result.timeline.push({ order: result.timeline.length, type: 'validation', name: pendingValidation, detail: 'FAIL', lineNumber: i + 1 });
                pendingValidation = null;
            }

            // Workflow: WF_RULE_FILTER
            if (line.includes('|WF_RULE_FILTER|')) {
                lineMatched = true;
                const wfMatch = line.match(/\|WF_RULE_FILTER\|(.+?)(?:\||$)/);
                if (wfMatch) {
                    result.workflows.push({ ruleName: wfMatch[1].trim() });
                    result.timeline.push({ order: result.timeline.length, type: 'workflow', name: wfMatch[1].trim(), detail: '', lineNumber: i + 1 });
                }
            }

            // Callout
            if (line.includes('|CALLOUT_REQUEST|')) {
                lineMatched = true;
                const callMatch = line.match(/\|CALLOUT_REQUEST\|.*?\|(.*?)$/);
                if (callMatch) result.callouts.push({ method: '', endpoint: callMatch[1].trim() });
            }

            // Duplicate Detection
            if (line.includes('|DUPLICATE_DETECTION_RULE_INVOCATION|')) {
                lineMatched = true;
                const dupMatch = line.match(/DuplicateRuleName:(.+?)\s*\|\s*DmlType:(\w+)/);
                if (dupMatch) result.duplicateRules.push({ ruleName: dupMatch[1].trim(), dmlType: dupMatch[2], outcome: 'EVALUATED', duplicatesFound: 0 });
            }
            if (line.includes('|DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|')) {
                lineMatched = true;
                const summaryMatch = line.match(/NumDuplicatesFound:(\d+)/);
                if (summaryMatch && result.duplicateRules.length > 0) {
                    const lastRule = result.duplicateRules[result.duplicateRules.length - 1];
                    lastRule.duplicatesFound = parseInt(summaryMatch[1], 10);
                    lastRule.outcome = lastRule.duplicatesFound > 0 ? 'DUPLICATES_FOUND' : 'CLEAN';
                }
            }
            if (line.includes('|DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|')) {
                lineMatched = true;
                const actionMatch = line.match(/ActionTaken:(.+?)\s*\|/);
                if (actionMatch && result.duplicateRules.length > 0) result.duplicateRules[result.duplicateRules.length - 1].action = actionMatch[1].trim();
            }

            // Exceptions
            if (line.includes('|EXCEPTION_THROWN|')) {
                lineMatched = true;
                const exMatch = line.match(/\|EXCEPTION_THROWN\|\[(\d+)\]\|(.+?):\s*(.+?)$/);
                if (exMatch) {
                    const exType = exMatch[2].trim();
                    const currentUnit = codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1].name : null;
                    result.exceptions.push({ type: exType, message: exMatch[3].trim(), lineNumber: parseInt(exMatch[1]), logLine: i + 1, isFatal: false, isLimitException: /limitexception/i.test(exType), codeUnit: currentUnit });
                    result.timeline.push({ order: result.timeline.length, type: 'exception', name: exType, detail: exMatch[3].trim(), lineNumber: i + 1 });
                }
            }
            if (line.includes('|FATAL_ERROR|')) {
                lineMatched = true;
                const fatalMatch = line.match(/\|FATAL_ERROR\|(.+?)$/);
                if (fatalMatch) {
                    const fatalMsg = fatalMatch[1].trim();
                    const currentUnit = codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1].name : null;
                    // If an EXCEPTION_THROWN entry already has the same message, upgrade it to fatal
                    // rather than adding a duplicate FATAL_ERROR card
                    const existing = result.exceptions.find(e => !e.isFatal && fatalMsg.includes(e.message));
                    if (existing) {
                        existing.isFatal = true;
                        existing.type = 'FATAL_ERROR';
                        if (!existing.codeUnit && currentUnit) existing.codeUnit = currentUnit;
                    } else {
                        // Only push if no identical FATAL_ERROR already recorded (Salesforce emits it multiple times)
                        const alreadyFatal = result.exceptions.some(e => e.isFatal && e.message === fatalMsg);
                        if (!alreadyFatal) {
                            result.exceptions.push({ type: 'FATAL_ERROR', message: fatalMsg, lineNumber: null, logLine: i + 1, isFatal: true, isLimitException: /limitexception/i.test(fatalMsg), codeUnit: currentUnit });
                            result.timeline.push({ order: result.timeline.length, type: 'exception', name: 'FATAL_ERROR', detail: fatalMsg, lineNumber: i + 1 });
                        }
                    }
                }
            }

            // USER_DEBUG
            if (line.includes('|USER_DEBUG|')) {
                lineMatched = true;
                const debugMatch = line.match(/\|USER_DEBUG\|\[(\d+)\]\|(\w+)\|(.+?)$/);
                if (debugMatch) {
                    const ts = line.match(/^([\d:.]+)/);
                    result.userDebug.push({ lineNumber: parseInt(debugMatch[1]), level: debugMatch[2], message: debugMatch[3].trim(), timestamp: ts ? ts[1] : null });
                }
            }

            // Async events (standalone)
            if (line.includes('|BATCH_APEX_EXECUTE_BEGIN|')) {
                lineMatched = true;
                const batchMatch = line.match(/\|BATCH_APEX_EXECUTE_BEGIN\|[^|]*\|(.+?)(?:\||$)/);
                result.asyncOperations.push({ type: 'Batch', className: batchMatch ? batchMatch[1].trim() : 'Unknown' });
            }
            if (line.includes('|SCHEDULED_APEX|')) {
                lineMatched = true;
                const schedMatch = line.match(/\|SCHEDULED_APEX\|(.+?)(?:\||$)/);
                result.asyncOperations.push({ type: 'Scheduled', className: schedMatch ? schedMatch[1].trim() : 'Unknown' });
            }
            if (line.includes('|FUTURE_HANDLER|')) {
                lineMatched = true;
                const futMatch = line.match(/\|FUTURE_HANDLER\|(.+?)(?:\||$)/);
                if (futMatch && !result.asyncOperations.find(a => a.type === 'Future' && a.className === futMatch[1].trim())) {
                    result.asyncOperations.push({ type: 'Future', className: futMatch[1].trim() });
                }
            }

            // Common log infrastructure lines (not "unknown")
            if (!lineMatched && (line.includes('|LIMIT_USAGE') || line.includes('|CUMULATIVE_LIMIT') || line.includes('|METHOD_ENTRY|') || line.includes('|METHOD_EXIT|') ||
                line.includes('|VARIABLE_SCOPE') || line.includes('|VARIABLE_ASSIGNMENT') || line.includes('|STATEMENT_EXECUTE') || line.includes('|HEAP_') ||
                line.includes('|SYSTEM_') || line.includes('|CONSTRUCTOR_') || line.includes('|DML_END|') || line.includes('|SOQL_EXECUTE_EXPLAIN') ||
                line.includes('Number of') || line.trim() === '' || /^\d{2}:\d{2}:\d{2}/.test(line))) {
                lineMatched = true;
            }

            if (!lineMatched && line.trim().length > 0) unknownLines++;
        }

        // Duplicate rules to timeline
        for (const dup of result.duplicateRules) {
            result.timeline.push({ order: result.timeline.length, type: 'duplicate', name: dup.ruleName, detail: dup.outcome === 'DUPLICATES_FOUND' ? `${dup.duplicatesFound} found` : 'Clean' });
        }

        // Governor limits
        result.governorLimits = this._parseGovernorLimits(rawLog);

        // Close any open transaction
        if (currentTxn) {
            currentTxn.endLine = result.timeline.length;
            currentTxn.eventCount = currentTxn.endLine - currentTxn.startLine;
        }

        // Recursion detection
        const autoCounts = {};
        result.automations.forEach(a => {
            const key = `${a.type}:${a.name}`;
            autoCounts[key] = (autoCounts[key] || 0) + 1;
        });
        result.recursionSignals = Object.entries(autoCounts)
            .filter(([_, count]) => count > 1)
            .map(([key, count]) => {
                const [type, ...nameParts] = key.split(':');
                return { automation: nameParts.join(':'), type, count, risk: count > 3 ? 'high' : 'medium' };
            });

        // DML cascade chain
        result.dmlCascade = [];
        let cascadeDepth = 0;
        const seenCascadeObjects = new Set();
        for (const evt of result.timeline) {
            if (evt.type === 'dml') {
                const parts = evt.name.split(' ');
                const op = parts[0];
                const obj = parts.slice(1).join(' ');
                if (obj && !seenCascadeObjects.has(obj)) {
                    seenCascadeObjects.add(obj);
                    result.dmlCascade.push({ depth: cascadeDepth, object: obj, operation: op });
                    cascadeDepth++;
                }
            }
        }

        // Infer initiating DML from trigger events
        // The platform's own DML (user clicking Save) doesn't appear as DML_BEGIN
        if (result.automations.length > 0) {
            const triggerAutos = result.automations.filter(a => a.type === 'trigger' && a.objectName && a.events?.length > 0);
            if (triggerAutos.length > 0) {
                const first = triggerAutos[0];
                const eventStr = (first.events[0] || '').toLowerCase();
                let operation = 'Update';
                if (eventStr.includes('insert')) operation = 'Insert';
                else if (eventStr.includes('delete')) operation = 'Delete';
                else if (eventStr.includes('undelete')) operation = 'Undelete';
                // Only add if this root object+operation isn't already in dmlOps
                const alreadyExists = result.dmlOps.some(d => d.objectType === first.objectName && d.operation === operation);
                if (!alreadyExists) {
                    result.dmlOps.unshift({
                        operation,
                        objectType: first.objectName,
                        rowCount: 1,
                        logLine: null,
                        inferred: true
                    });
                    result.timeline.unshift({
                        order: -1,
                        type: 'dml',
                        name: `${operation} ${first.objectName}`,
                        detail: '1 row(s) — inferred from trigger events (beta)',
                        lineNumber: null
                    });
                    if (result.stats) result.stats.totalDml = result.dmlOps.length;
                }
            }
        }

        // Bulk-safety signal detection
        result.bulkSafetySignals = [];
        const triggerNames = new Set(result.automations.filter(a => a.type === 'trigger').map(a => a.name));
        if (triggerNames.size > 0 && result.soqlQueries.length > triggerNames.size * 5) {
            result.bulkSafetySignals.push({ automation: [...triggerNames][0], risk: 'medium', reason: 'High SOQL count relative to triggers — possible SOQL in loop' });
        }
        if (triggerNames.size > 0 && result.dmlOps.length > triggerNames.size * 3) {
            result.bulkSafetySignals.push({ automation: [...triggerNames][0], risk: 'medium', reason: 'High DML count relative to triggers — possible DML in loop' });
        }

        // Cross-object impact graph
        const dmlObjects = new Set(result.dmlOps.map(d => d.objectType));
        const soqlObjects = new Set();
        result.soqlQueries.forEach(q => {
            const fromMatch = q.query.match(/FROM\s+(\w+)/i);
            if (fromMatch) soqlObjects.add(fromMatch[1]);
        });
        const allTouched = new Set([...dmlObjects, ...soqlObjects]);
        result.objectImpact = {
            rootObject: result.automations.find(a => a.objectName)?.objectName || [...dmlObjects][0] || null,
            touchedObjects: [...allTouched],
            dmlObjects: [...dmlObjects],
            queryObjects: [...soqlObjects],
            blastRadius: allTouched.size
        };

        // Partial log detection
        result.logCompleteness = { isComplete: true, warnings: [] };
        const hasExecStarted = rawLog.includes('EXECUTION_STARTED');
        const hasExecFinished = rawLog.includes('EXECUTION_FINISHED');
        const hasLimitBlock = rawLog.includes('LIMIT_USAGE_FOR_NS');
        if (hasExecStarted && !hasExecFinished) {
            result.logCompleteness.isComplete = false;
            result.logCompleteness.warnings.push('Missing EXECUTION_FINISHED — log may be truncated');
        }
        if (!hasLimitBlock && result.automations.length > 0) {
            result.logCompleteness.warnings.push('No governor limits block — debug level may be insufficient');
        }
        if (result.isLargeLog) {
            result.logCompleteness.warnings.push(`Log truncated to 100,000 of ${result.totalLogLines} lines`);
        }

        // Salesforce-side 5 MB truncation detection: the log body from the API is cut off
        // before EXECUTION_FINISHED if the raw log exceeds Salesforce's platform limit.
        // Heuristic: if the last 5 KB of the received payload has no EXECUTION_FINISHED and
        // no CUMULATIVE_LIMIT_USAGE_END, Salesforce silently clipped the log.
        const tail5k = rawLog.slice(-5000);
        result.isSalesforceTruncated = !tail5k.includes('EXECUTION_FINISHED') && !tail5k.includes('CUMULATIVE_LIMIT_USAGE_END');
        if (result.isSalesforceTruncated && !result.isLargeLog) {
            result.logCompleteness.isComplete = false;
            result.logCompleteness.warnings.push(
                `Log truncated by Salesforce (5 MB platform limit) — governor limits recovered from intermediate blocks`
            );
        }

        // Managed package isolation
        result.automations.forEach(a => {
            const nsMatch = a.name.match(/^(\w+)__/);
            a.isManagedPackage = !!nsMatch;
            a.namespace = nsMatch ? nsMatch[1] : null;
        });

        // Governor risk prediction
        result.limitRisk = {};
        for (const [key, val] of Object.entries(result.governorLimits)) {
            if (val.limit > 0) {
                const ratio = val.used / val.limit;
                result.limitRisk[key] = ratio >= 0.85 ? 'high' : ratio >= 0.7 ? 'medium' : 'low';
            }
        }

        // === v6: Post-parse heuristics ===

        // Interaction root detection (F1)
        result.interactionRoot = { type: 'unknown', name: null, confidence: 'low' };
        const firstTimelineEvent = result.timeline[0];
        if (firstTimelineEvent) {
            if (firstTimelineEvent.type === 'flow' && !result.automations.some(a => a.type === 'trigger')) {
                result.interactionRoot = { type: 'flow', name: firstTimelineEvent.name, confidence: 'high' };
            } else if (firstTimelineEvent.type === 'trigger') {
                result.interactionRoot = { type: 'trigger', name: firstTimelineEvent.name, confidence: 'high' };
            } else {
                const apexEntry = result.codeUnitTimings.find(t => /Controller|Action/i.test(t.name));
                if (apexEntry) {
                    result.interactionRoot = { type: 'apex', name: apexEntry.name, confidence: 'medium' };
                }
            }
        }

        // Slowest unit (F2)
        result.slowestUnit = result.codeUnitTimings.length > 0
            ? [...result.codeUnitTimings].sort((a, b) => parseFloat(b.durationMs) - parseFloat(a.durationMs))[0]
            : null;

        // Automation density (F3)
        const densityMap = {};
        result.automations.forEach(a => {
            const obj = a.objectName || 'Unknown';
            if (!densityMap[obj]) densityMap[obj] = { triggerCount: 0, flowCount: 0, total: 0 };
            densityMap[obj][a.type === 'trigger' ? 'triggerCount' : 'flowCount']++;
            densityMap[obj].total++;
        });
        result.automationDensity = Object.entries(densityMap)
            .map(([obj, d]) => ({ object: obj, ...d }))
            .filter(d => d.total >= 3)
            .sort((a, b) => b.total - a.total);

        // Limit spike alerts (F4)
        result.limitSpikes = [];
        if (result.governorLimits.cpuTime) {
            const ratio = result.governorLimits.cpuTime.used / result.governorLimits.cpuTime.limit;
            if (ratio > 0.7) result.limitSpikes.push({ metric: 'CPU', msg: `CPU usage at ${Math.round(ratio * 100)}% — late-stage processing detected`, severity: ratio > 0.85 ? 'high' : 'medium' });
        }
        if (result.governorLimits.heapSize) {
            const ratio = result.governorLimits.heapSize.used / result.governorLimits.heapSize.limit;
            if (ratio > 0.7) result.limitSpikes.push({ metric: 'Heap', msg: `Heap usage at ${Math.round(ratio * 100)}% — possible large data structures`, severity: ratio > 0.85 ? 'high' : 'medium' });
        }
        const triggerCountForSpike = result.automations.filter(a => a.type === 'trigger').length || 1;
        if (result.soqlQueries.length > triggerCountForSpike * 8) {
            result.limitSpikes.push({ metric: 'SOQL', msg: `${result.soqlQueries.length} SOQL queries for ${triggerCountForSpike} trigger(s) — rapid query growth`, severity: 'medium' });
        }

        // SOQL cost signals (F5)
        const soqlCostSeen = new Set();
        result.soqlCostSignals = [];
        result.soqlQueries.forEach(q => {
            const signals = [];
            if ((q.rowCount || 0) > 200) signals.push(`${q.rowCount} rows returned`);
            if (q.query && !/WHERE/i.test(q.query) && /FROM/i.test(q.query)) signals.push('No WHERE clause');
            const dupeCount = result.soqlQueries.filter(qq => qq.query === q.query).length;
            if (dupeCount > 2) signals.push(`Repeated ${dupeCount}x`);
            if (signals.length > 0 && !soqlCostSeen.has(q.query)) {
                soqlCostSeen.add(q.query);
                result.soqlCostSignals.push({ query: q.query, signals, rowCount: q.rowCount || 0, logLine: q.logLine });
            }
        });

        // Debug level warnings (F11)
        result.debugLevelWarnings = [];
        if (result.automations.length > 0 && result.flowElements.length === 0 && result.automations.some(a => a.type === 'flow')) {
            result.debugLevelWarnings.push('Flow detail not captured — set Workflow debug level to FINER');
        }
        if (Object.keys(result.governorLimits).length === 0 && result.automations.length > 0) {
            result.debugLevelWarnings.push('No governor limits captured — ensure Apex debug level is at least INFO');
        }
        if (result.userDebug.length === 0 && result.codeUnitTimings.length > 0) {
            result.debugLevelWarnings.push('No USER_DEBUG output — set Apex debug level to DEBUG for full visibility');
        }

        // "Nothing happened" detection (F6)
        result.nothingHappened = result.automations.length === 0 && result.dmlOps.length === 0 &&
            result.flowElements.length === 0 && result.exceptions.length === 0;

        // Raw log snippets for deep-link (F2)
        result.rawLogSnippets = {};
        result.timeline.forEach(t => {
            if (t.lineNumber && lines[t.lineNumber - 1]) {
                const start = Math.max(0, t.lineNumber - 3);
                const end = Math.min(lines.length, t.lineNumber + 2);
                result.rawLogSnippets[t.lineNumber] = lines.slice(start, end).join('\n');
            }
        });

        // Parser health metrics (F1)
        const totalParsedEvents = result.timeline.length + Object.keys(result.governorLimits).length;
        result.parserHealth = {
            totalLines: lines.length,
            parsedEvents: totalParsedEvents,
            unknownLines,
            coveragePct: lines.length > 0 ? Math.round((1 - unknownLines / lines.length) * 100) : 100,
            truncated: result.isLargeLog,
            salesforceTruncated: result.isSalesforceTruncated || false
        };

        // Transaction shape fingerprint (F3)
        const shapeTokens = result.timeline.map(t => `${t.type}:${t.name}`);
        const shapeStr = shapeTokens.join('|');
        result.transactionFingerprint = {
            shape: shapeStr,
            hash: shapeStr.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0).toString(16),
            eventCount: shapeTokens.length,
            uniqueTypes: [...new Set(result.timeline.map(t => t.type))].length
        };

        result.stats = {
            totalAutomations: result.automations.length,
            totalDml: result.dmlOps.length,
            totalSoql: result.soqlQueries.length,
            totalValidationFails: result.validations.filter(v => v.outcome === 'FAIL').length,
            totalCallouts: result.callouts.length,
            totalDuplicateRules: result.duplicateRules.length,
            totalExceptions: result.exceptions.length,
            hasFatalError: result.exceptions.some(e => e.isFatal),
            totalDebugLines: result.userDebug.length,
            totalFlowElements: result.flowElements.length,
            totalSoqlRows: result.soqlQueries.reduce((sum, q) => sum + (q.rowCount || 0), 0),
            totalAsyncOps: result.asyncOperations.length,
            totalTransactions: result.transactions.length || 1,
            hasRecursion: result.recursionSignals.length > 0,
            hasPartialLog: !result.logCompleteness.isComplete,
            blastRadius: result.objectImpact.blastRadius,
        };

        // Resolve any decision outcomes queued before their element was seen
        if (window.FlowAnalysisHelper) window.FlowAnalysisHelper.resolvePostParse(result);

        return result;
    },

    _extractNanos(line) {
        const match = line.match(/\((\d+)\)/);
        return match ? parseInt(match[1]) : null;
    },

    _parseGovernorLimits(rawLog) {
        const limits = {};
        const patterns = {
            soqlQueries: /Number of SOQL queries:\s*(\d+)\s*out of\s*(\d+)/,
            dmlStatements: /Number of DML statements:\s*(\d+)\s*out of\s*(\d+)/,
            cpuTime: /Maximum CPU time:\s*(\d+)\s*out of\s*(\d+)/,
            heapSize: /Maximum heap size:\s*(\d+)\s*out of\s*(\d+)/,
            dmlRows: /Number of DML rows:\s*(\d+)\s*out of\s*(\d+)/,
            soqlRows: /Number of query rows:\s*(\d+)\s*out of\s*(\d+)/,
            callouts: /Number of callouts:\s*(\d+)\s*out of\s*(\d+)/,
            futureCalls: /Number of future calls:\s*(\d+)\s*out of\s*(\d+)/,
            queueableJobs: /Number of queueable jobs added to the queue:\s*(\d+)\s*out of\s*(\d+)/,
            emailInvocations: /Number of Email Invocations:\s*(\d+)\s*out of\s*(\d+)/,
        };

        // Streaming: scan every LIMIT_USAGE_FOR_NS block emitted by each CUMULATIVE_LIMIT_USAGE
        // section and take the MAX used value across all of them.
        // Salesforce emits these blocks at every transaction boundary throughout the log, not
        // only at the final summary. Taking the MAX recovers correct governor limit data even
        // when Salesforce truncates the log at 5 MB before the final LIMIT_USAGE_FOR_NS block
        // (common with CPQ, FSL, and other heavy managed packages).
        const blockRegex = /LIMIT_USAGE_FOR_NS[\s\S]*?CUMULATIVE_LIMIT_USAGE_END/g;
        const blocks = [...rawLog.matchAll(blockRegex)];

        if (blocks.length > 0) {
            for (const block of blocks) {
                for (const [key, regex] of Object.entries(patterns)) {
                    const m = block[0].match(regex);
                    if (m) {
                        const used = parseInt(m[1]), limit = parseInt(m[2]);
                        if (!limits[key] || used > limits[key].used) limits[key] = { used, limit };
                    }
                }
            }
        } else {
            // No structured blocks — scan full raw text (very old log format or debug level too low).
            for (const [key, regex] of Object.entries(patterns)) {
                const m = rawLog.match(regex);
                if (m) limits[key] = { used: parseInt(m[1]), limit: parseInt(m[2]) };
            }
        }
        return limits;
    },

    // Segment stitching: when a multi-screen / long-running Flow interview spans more than
    // one Apex log record (e.g. user navigates across screens), this links all segments by
    // their shared interview ID so the UI can present them as a single connected flow rather
    // than separate unrelated automations.
    _stitchFlowSegments(parsedLogs) {
        // interviewId → [ { logIndex, flow } ]
        const interviewMap = new Map();
        parsedLogs.forEach((logResult, logIndex) => {
            (logResult.automations || []).forEach(auto => {
                if (auto.type === 'flow' && auto.interviewId) {
                    if (!interviewMap.has(auto.interviewId)) interviewMap.set(auto.interviewId, []);
                    interviewMap.get(auto.interviewId).push({ logIndex, flow: auto });
                }
            });
        });

        let stitchedCount = 0;
        for (const [, segments] of interviewMap.entries()) {
            if (segments.length < 2) continue;
            const logNums = segments.map(s => s.logIndex + 1); // 1-based for display
            segments.forEach((seg, idx) => {
                seg.flow.isStitched         = true;
                seg.flow.stitchSegmentIndex  = idx + 1;
                seg.flow.stitchTotalSegments = segments.length;
                seg.flow.stitchLogNums       = logNums;
            });
            stitchedCount++;
        }

        if (stitchedCount > 0 && window.Terminal) {
            window.Terminal.log(`[LiveTrace] Stitched ${stitchedCount} multi-log flow interview(s) across ${parsedLogs.length} log records.`);
        }
    },

    _mergeLiveResults(a, b) {
        const timeline = [...a.timeline, ...b.timeline];
        timeline.sort((x, y) => (x.order || 0) - (y.order || 0));
        timeline.forEach((evt, i) => evt.order = i + 1);

        const codeUnitTimings = [...a.codeUnitTimings, ...b.codeUnitTimings];
        codeUnitTimings.sort((x, y) => x.startNs - y.startNs);

        // Re-derive DML cascade from merged timeline
        const dmlCascade = [];
        let depth = 0;
        const seenObj = new Set();
        for (const evt of timeline) {
            if (evt.type === 'dml') {
                const parts = evt.name.split(' ');
                const op = parts[0], obj = parts.slice(1).join(' ');
                if (obj && !seenObj.has(obj)) { seenObj.add(obj); dmlCascade.push({ depth: depth++, object: obj, operation: op }); }
            }
        }

        // Re-derive recursion signals from merged automations
        const mergedAutos = [...a.automations, ...b.automations.filter(ba => !a.automations.find(aa => aa.name === ba.name && aa.type === ba.type))];
        const autoCounts = {};
        mergedAutos.forEach(au => { const k = `${au.type}:${au.name}`; autoCounts[k] = (autoCounts[k] || 0) + 1; });
        const recursionSignals = Object.entries(autoCounts)
            .filter(([_, c]) => c > 1)
            .map(([k, c]) => { const [type, ...n] = k.split(':'); return { automation: n.join(':'), type, count: c, risk: c > 3 ? 'high' : 'medium' }; });

        return {
            automations: mergedAutos,
            dmlOps: [...a.dmlOps, ...b.dmlOps],
            soqlQueries: [...a.soqlQueries, ...b.soqlQueries],
            validations: [...a.validations, ...b.validations],
            duplicateRules: [...a.duplicateRules, ...b.duplicateRules],
            workflows: [...a.workflows, ...b.workflows],
            callouts: [...a.callouts, ...b.callouts],
            timeline,
            exceptions: [...a.exceptions, ...b.exceptions],
            userDebug: [...a.userDebug, ...b.userDebug],
            flowElements: [...a.flowElements, ...b.flowElements],
            codeUnitTimings,
            asyncOperations: [...(a.asyncOperations || []), ...(b.asyncOperations || [])],
            transactions: [...(a.transactions || []), ...(b.transactions || [])],
            recursionSignals,
            dmlCascade,
            primarySuspects: [],  // re-computed after merge
            bulkSafetySignals: [...(a.bulkSafetySignals || []), ...(b.bulkSafetySignals || [])],
            objectImpact: {},     // re-computed after merge
            limitRisk: Object.keys(b.limitRisk || {}).length > Object.keys(a.limitRisk || {}).length ? (b.limitRisk || {}) : (a.limitRisk || {}),
            logCompleteness: { isComplete: (a.logCompleteness?.isComplete !== false) && (b.logCompleteness?.isComplete !== false), warnings: [...(a.logCompleteness?.warnings || []), ...(b.logCompleteness?.warnings || [])] },
            traceWindow: a.traceWindow || {},
            parserHealth: {
                totalLines: (a.parserHealth?.totalLines || 0) + (b.parserHealth?.totalLines || 0),
                parsedEvents: (a.parserHealth?.parsedEvents || 0) + (b.parserHealth?.parsedEvents || 0),
                unknownLines: (a.parserHealth?.unknownLines || 0) + (b.parserHealth?.unknownLines || 0),
                coveragePct: 0, // re-computed below
                truncated: a.parserHealth?.truncated || b.parserHealth?.truncated
            },
            rawLogSnippets: { ...(a.rawLogSnippets || {}), ...(b.rawLogSnippets || {}) },
            transactionFingerprint: {},  // re-computed after merge
            budgetViolations: [],        // re-computed after merge
            impactHints: [],             // re-computed after merge
            incidentFlags: [],           // re-computed after merge
            interactionRoot: a.interactionRoot || {},  // use first log's root
            slowestUnit: (a.slowestUnit && b.slowestUnit)
                ? (parseFloat(a.slowestUnit.durationMs) >= parseFloat(b.slowestUnit.durationMs) ? a.slowestUnit : b.slowestUnit)
                : (a.slowestUnit || b.slowestUnit || null),
            automationDensity: [],       // re-computed after merge via post-parse
            limitSpikes: [...(a.limitSpikes || []), ...(b.limitSpikes || [])],
            soqlCostSignals: [...(a.soqlCostSignals || []), ...(b.soqlCostSignals || [])],
            debugLevelWarnings: [...new Set([...(a.debugLevelWarnings || []), ...(b.debugLevelWarnings || [])])],
            nothingHappened: (a.nothingHappened !== false ? a.nothingHappened : false) && (b.nothingHappened !== false ? b.nothingHappened : false),
            traceQuality: 100,           // re-computed after merge
            recommendations: [],         // re-computed after merge
            asyncCorrelation: [],        // computed async after merge
            recordsAffected: [], allLogIds: [],
            confidence: {}, isLargeLog: a.isLargeLog || b.isLargeLog,
            totalLogLines: (a.totalLogLines || 0) + (b.totalLogLines || 0),
            governorLimits: (() => {
                // Take MAX used value across logs — governor limits are per-transaction in
                // Salesforce, so the worst-case single transaction is the actionable signal.
                // (Summing would be misleading: 4 txns × 3/100 SOQL does not mean you hit the limit.)
                const merged = {};
                const allKeys = new Set([...Object.keys(a.governorLimits || {}), ...Object.keys(b.governorLimits || {})]);
                for (const key of allKeys) {
                    const av = a.governorLimits?.[key], bv = b.governorLimits?.[key];
                    if (av && bv) merged[key] = { used: Math.max(av.used, bv.used), limit: Math.max(av.limit, bv.limit) };
                    else merged[key] = av || bv;
                }
                return merged;
            })(),
            stats: {
                totalAutomations: a.stats.totalAutomations + b.stats.totalAutomations,
                totalDml: a.stats.totalDml + b.stats.totalDml,
                totalSoql: a.stats.totalSoql + b.stats.totalSoql,
                totalValidationFails: a.stats.totalValidationFails + b.stats.totalValidationFails,
                totalCallouts: a.stats.totalCallouts + b.stats.totalCallouts,
                totalDuplicateRules: (a.stats.totalDuplicateRules || 0) + (b.stats.totalDuplicateRules || 0),
                totalExceptions: (a.stats.totalExceptions || 0) + (b.stats.totalExceptions || 0),
                hasFatalError: a.stats.hasFatalError || b.stats.hasFatalError,
                totalDebugLines: (a.stats.totalDebugLines || 0) + (b.stats.totalDebugLines || 0),
                totalFlowElements: (a.stats.totalFlowElements || 0) + (b.stats.totalFlowElements || 0),
                totalSoqlRows: (a.stats.totalSoqlRows || 0) + (b.stats.totalSoqlRows || 0),
                totalAsyncOps: (a.stats.totalAsyncOps || 0) + (b.stats.totalAsyncOps || 0),
                totalTransactions: (a.stats.totalTransactions || 1) + (b.stats.totalTransactions || 1),
                hasRecursion: recursionSignals.length > 0,
                hasPartialLog: (a.stats.hasPartialLog || false) || (b.stats.hasPartialLog || false),
                blastRadius: 0, // re-computed after merge
            }
        };
    },

    // ─── Helpers ──────────────────────────────────────────────

    _shortenUrl(url) {
        if (!url) return 'Unknown';
        try {
            const u = new URL(url);
            const path = u.pathname;
            if (path.includes('/apexrest/')) return path.replace(/.*\/apexrest\//, '/apexrest/');
            return path.split('?')[0];
        } catch (e) {
            return url.length > 60 ? url.substring(0, 60) + '…' : url;
        }
    },

    // Retained for reference — enrichment is now inlined in captureLiveTrace() (blocking, before render).
    async _enrichNetworkCallsWithLwc() {
        const r = this.liveTraceResult;
        if (!r || !r.networkCalls?.length) return;
        const methodNames = [...new Set(r.networkCalls.map(nc => nc.methodName).filter(Boolean))];
        if (!methodNames.length) return;
        try {
            const callerMap = await this._lookupLwcCallers(methodNames);
            let changed = false;
            r.networkCalls.forEach(nc => {
                if (nc.methodName && callerMap[nc.methodName]?.length) {
                    nc.callerComponents = callerMap[nc.methodName];
                    changed = true;
                }
            });
            if (changed && this.liveTraceState === 'results') {
                // Patch timeline entries for network type to include caller name
                r.timeline.forEach(t => {
                    if (t.type !== 'network') return;
                    const nc = r.networkCalls.find(n => t.name === n.name);
                    if (nc?.callerComponents?.length) {
                        t.detail = nc.detail + ` ← ${nc.callerComponents[0]}.lwc`;
                    }
                });
                this.render();
            }
        } catch (e) {
            console.warn('[LiveTrace] LWC enrichment failed:', e.message);
        }
    },

    // Search locally cached LWC source files for "ClassName.methodName" references — no API call, instant.
    // Build a minimal LiveTrace result object from UI errors only (no server log).
    // Used when a client-side JS error occurs before any Apex call is made.
    _buildUiErrorResult(uiErrors) {
        return {
            timeline: uiErrors.slice().reverse().map((e, i) => ({
                order: -(200 + i),
                type: 'ui-error',
                name: e.title || 'Client Error',
                detail: e.message || '',
                lineNumber: null
            })),
            uiErrors,
            networkCalls: [],
            stats: { totalAutomations: 0, totalDml: 0, totalSoql: 0, totalSoqlRows: 0, hasFatalError: false, totalExceptions: 0, totalValidationFails: 0, totalCallouts: 0, totalTransactions: 0 },
            dmlOps: [],
            recordsAffected: [],
            codeUnitTimings: [],
            allLogIds: [],
            traceWindow: {},
            fingerprint: {}
        };
    },

    // Keys are "ClassName.methodName" which matches the LWC Apex import pattern:
    //   import fn from '@salesforce/apex/AccountController.runAutomationTest';
    // Searches window.lwcBundleCache (all bundles fetched this session) and window.openTabs.
    _lookupLwcCallers(searchKeys) {
        const result = {};
        for (const key of searchKeys) result[key] = [];
        if (!searchKeys.length) return result;

        const componentFromPath = (filePath) => {
            if (!filePath) return null;
            const parts = filePath.replace(/\\/g, '/').split('/');
            const idx = parts.indexOf('lwc');
            return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : null;
        };

        // Search LWC bundle cache — all bundles fetched during this IDE session
        const cache = window.lwcBundleCache || {};
        for (const bundleId in cache) {
            for (const file of (cache[bundleId] || [])) {
                const src = file.Source || '';
                const comp = componentFromPath(file.FilePath);
                if (!comp || !src) continue;
                for (const key of searchKeys) {
                    if (src.includes(key) && !result[key].includes(comp)) {
                        result[key].push(comp);
                    }
                }
            }
        }

        // Also check open editor tabs in case content differs from cache
        for (const tab of (window.openTabs || [])) {
            if (tab.type !== 'LWC') continue;
            const src = tab.content || '';
            if (!src || src === 'Loading...') continue;
            const comp = tab.name ? tab.name.replace(/\.(js|html|css)$/, '') : null;
            if (!comp) continue;
            for (const key of searchKeys) {
                if (src.includes(key) && !result[key].includes(comp)) {
                    result[key].push(comp);
                }
            }
        }
        return result;
    },

    // Tooling API fallback: fetches all LWC JS files and filters client-side.
    // Neither SOSL (unsupported on LightningComponentResource) nor Source LIKE (not filterable)
    // work — so we fetch all JS resources once, cache them, then text-search in memory.
    async _lookupLwcCallersRemote(searchKeys) {
        const result = {};
        if (!searchKeys.length || !window.apiClient) return result;
        try {
            // Fetch all LWC JS files with their source — one query, shared across all keys
            if (!this._lwcResourceCache) {
                const soql = `SELECT Id, FilePath, Source FROM LightningComponentResource WHERE FilePath LIKE '%.js' LIMIT 500`;
                const resp = await window.apiClient.toolingQuery(soql);
                this._lwcResourceCache = resp?.records || [];
            }
            const files = this._lwcResourceCache;
            for (const key of searchKeys) {
                const components = files
                    .filter(r => r.Source && r.Source.includes(key))
                    .map(r => {
                        if (!r.FilePath) return null;
                        const parts = r.FilePath.replace(/\\/g, '/').split('/');
                        const idx = parts.indexOf('lwc');
                        return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : null;
                    })
                    .filter(Boolean);
                result[key] = [...new Set(components)];
            }
        } catch (e) {
            console.warn('[LiveTrace] Component lookup failed:', e.message);
        }
        return result;
    },

    // ─── Record Tracking ─────────────────────────────────────

    _buildFieldList(desc) {
        const COMPOUND_TYPES = ['address', 'location'];
        const queryable = (desc.fields || []).filter(f =>
            f.type !== 'base64' &&
            !COMPOUND_TYPES.includes(f.type) &&
            !(desc.fields || []).some(ch => ch.compoundFieldName === f.name && ch.name !== f.name)
        );
        queryable.sort((a, b) => {
            if (a.name === 'Name') return -1;
            if (b.name === 'Name') return 1;
            return (a.name.endsWith('__c') ? 1 : 0) - (b.name.endsWith('__c') ? 1 : 0) || a.name.localeCompare(b.name);
        });
        const names = queryable.slice(0, 100).map(f => f.name);
        if (!names.includes('Id')) names.unshift('Id');
        const labelMap = {};
        for (const f of queryable) labelMap[f.name] = f.label || f.name;
        return { names, labelMap };
    },

    _extractFieldDetail(record, labelMap) {
        const fieldList = [];
        for (const [key, val] of Object.entries(record)) {
            if (LIVE_TRACE_SYSTEM_FIELDS.has(key) || val == null) continue;
            const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
            fieldList.push({
                field: key,
                label: labelMap[key] || key,
                value: display.length > 200 ? display.substring(0, 200) + '…' : display
            });
        }
        return fieldList;
    },

    async _fetchAffectedRecords() {
        if (!window.apiClient || !this.liveTraceResult?.dmlOps?.length) return;
        try {
            const userId = await window.apiClient.getCurrentUserId();
            if (this.liveTraceResult.traceWindow) this.liveTraceResult.traceWindow.userId = userId;
            const traceTime = this.liveTraceStartedAt;
            const endTime = new Date(new Date().getTime() + 2000).toISOString();
            const objectTypes = [...new Set(this.liveTraceResult.dmlOps.map(op => op.objectType))];
            this.liveTraceResult.recordsAffected = [];
            const apiVersion = window.apiClient.apiVersion || 'v62.0';
            const useComposite = typeof window.apiClient.composite === 'function';

            // ── Round 1: Batch all describe calls (1 HTTP request) ──
            const describes = {};
            if (useComposite && objectTypes.length > 1) {
                try {
                    const descResult = await window.apiClient.composite(
                        objectTypes.map(obj => ({
                            method: 'GET',
                            url: `/services/data/${apiVersion}/sobjects/${obj}/describe`,
                            referenceId: `desc_${obj}`
                        }))
                    );
                    for (const resp of (descResult.compositeResponse || [])) {
                        const obj = resp.referenceId.replace('desc_', '');
                        if (resp.httpStatusCode === 200) describes[obj] = resp.body;
                    }
                } catch (e) {
                    console.debug('[LiveTrace] Composite describe failed, falling back:', e.message);
                }
            }

            // ── Build field metadata per object ──
            const fieldMeta = {};
            for (const objType of objectTypes) {
                const ops = this.liveTraceResult.dmlOps.filter(op => op.objectType === objType);
                let fieldNames = ['Id'];
                let labelMap = {};
                let desc = describes[objType];
                if (!desc) {
                    try { desc = await window.apiClient.describeSObject(objType); } catch (e) { /* skip */ }
                }
                if (desc) {
                    const fl = this._buildFieldList(desc);
                    fieldNames = fl.names;
                    labelMap = fl.labelMap;
                }
                fieldMeta[objType] = {
                    fieldNames, labelMap, ops,
                    isInsert: ops.some(op => op.operation === 'Insert'),
                    isUpdate: ops.some(op => op.operation === 'Update')
                };
            }

            // ── Round 2: Batch all record queries (1 HTTP request) ──
            const queryMap = {};
            if (useComposite && objectTypes.length > 1) {
                const subrequests = objectTypes.map(objType => {
                    const meta = fieldMeta[objType];
                    const where = meta.isInsert
                        ? `CreatedById = '${userId}' AND CreatedDate > ${traceTime} AND CreatedDate < ${endTime}`
                        : `LastModifiedById = '${userId}' AND LastModifiedDate > ${traceTime} AND LastModifiedDate < ${endTime}`;
                    const soql = `SELECT ${meta.fieldNames.join(', ')} FROM ${objType} WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT 20`;
                    return { method: 'GET', url: `/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`, referenceId: `query_${objType}` };
                });
                try {
                    const result = await window.apiClient.composite(subrequests);
                    for (const resp of (result.compositeResponse || [])) {
                        const obj = resp.referenceId.replace('query_', '');
                        if (resp.httpStatusCode === 200) queryMap[obj] = resp.body;
                    }
                } catch (e) {
                    console.debug('[LiveTrace] Composite query failed, falling back:', e.message);
                }
            }
            // Sequential fallback for single object or composite failure
            for (const objType of objectTypes) {
                if (queryMap[objType]) continue;
                const meta = fieldMeta[objType];
                const where = meta.isInsert
                    ? `CreatedById = '${userId}' AND CreatedDate > ${traceTime} AND CreatedDate < ${endTime}`
                    : `LastModifiedById = '${userId}' AND LastModifiedDate > ${traceTime} AND LastModifiedDate < ${endTime}`;
                const soql = `SELECT ${meta.fieldNames.join(', ')} FROM ${objType} WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT 20`;
                try { queryMap[objType] = await window.apiClient.query(soql); } catch (e) { /* skip */ }
            }

            // ── Round 3: Batch FieldHistory queries for Updates (1 HTTP request) ──
            const historyMap = {};
            const historyTypes = objectTypes.filter(obj => fieldMeta[obj].isUpdate && queryMap[obj]?.records?.length > 0);
            if (useComposite && historyTypes.length > 1) {
                const histRequests = historyTypes.map(objType => {
                    const ids = queryMap[objType].records.map(r => `'${r.Id}'`).join(',');
                    const soql = `SELECT ParentId, Field, OldValue, NewValue, CreatedDate FROM ${objType}History WHERE ParentId IN (${ids}) AND CreatedDate > ${traceTime} ORDER BY CreatedDate DESC LIMIT 50`;
                    return { method: 'GET', url: `/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`, referenceId: `hist_${objType}` };
                });
                try {
                    const result = await window.apiClient.composite(histRequests);
                    for (const resp of (result.compositeResponse || [])) {
                        const obj = resp.referenceId.replace('hist_', '');
                        if (resp.httpStatusCode === 200) historyMap[obj] = resp.body;
                    }
                } catch (e) { /* history is optional */ }
            }
            // Sequential fallback
            for (const objType of historyTypes) {
                if (historyMap[objType]) continue;
                const ids = queryMap[objType].records.map(r => `'${r.Id}'`).join(',');
                const soql = `SELECT ParentId, Field, OldValue, NewValue, CreatedDate FROM ${objType}History WHERE ParentId IN (${ids}) AND CreatedDate > ${traceTime} ORDER BY CreatedDate DESC LIMIT 50`;
                try { historyMap[objType] = await window.apiClient.query(soql); } catch (e) { /* skip */ }
            }

            // ── Assemble results ──
            for (const objType of objectTypes) {
                const qr = queryMap[objType];
                if (!qr?.records?.length) continue;
                const meta = fieldMeta[objType];
                const matchQuality = qr.records.length <= 5 ? 'high' : qr.records.length <= 15 ? 'medium' : 'low';
                const affected = {
                    objectType: objType,
                    operation: [...new Set(meta.ops.map(o => o.operation))].join(', '),
                    matchQuality,
                    records: qr.records.map(r => {
                        const rec = { Id: r.Id, Name: r.Name || r.Id };
                        const fieldList = this._extractFieldDetail(r, meta.labelMap);
                        if (meta.isInsert) rec.fieldsSet = fieldList;
                        else rec.currentFields = fieldList;
                        return rec;
                    }),
                    fieldChanges: []
                };
                const hr = historyMap[objType];
                if (hr?.records?.length > 0) {
                    affected.fieldChanges = hr.records.map(h => ({
                        recordId: h.ParentId,
                        field: h.Field,
                        oldValue: h.OldValue,
                        newValue: h.NewValue
                    }));
                }
                this.liveTraceResult.recordsAffected.push(affected);
            }
            if (this.liveTraceState === 'results') this.render();
        } catch (err) {
            console.warn('[LiveTrace] Record tracking failed:', err.message);
        }
    },

    // ─── Confidence Scoring ────────────────────────────────

    _computeConfidence() {
        const r = this.liveTraceResult;
        if (!r) return;
        const conf = {};
        const logCount = (r.allLogIds || []).length;
        const dmlCount = r.dmlOps?.length || 0;
        const recCount = r.recordsAffected?.length || 0;
        if (dmlCount === 0) conf.records = null;
        else if (logCount === 1 && recCount > 0 && recCount <= dmlCount * 2) conf.records = 'high';
        else if (recCount > 0) conf.records = 'medium';
        else conf.records = 'low';
        conf.timing = r.codeUnitTimings?.length > 0 ? 'high' : null;
        conf.cascade = (r.dmlCascade || []).length > 1 ? (logCount === 1 ? 'high' : 'medium') : null;
        conf.limits = Object.keys(r.governorLimits || {}).length > 0 ? 'high' : null;
        r.confidence = conf;
    },

    _getOverallConfidence() {
        const c = this.liveTraceResult?.confidence || {};
        const vals = Object.values(c).filter(v => v !== null);
        if (vals.length === 0) return null;
        if (vals.includes('low')) return 'low';
        if (vals.includes('medium')) return 'medium';
        return 'high';
    },

    // ─── Root Cause Analysis ────────────────────────────────

    _computePrimarySuspects() {
        const r = this.liveTraceResult;
        if (!r || !r.automations?.length) { if (r) r.primarySuspects = []; return; }
        const suspects = [];
        for (const a of r.automations) {
            const entry = { type: a.type, name: a.name, score: 0, reasons: [], evidence: [] };
            // Exception proximity
            if (r.exceptions.length > 0) {
                const exc = r.exceptions[0];
                entry.score += 0.3; entry.reasons.push('Exception thrown during execution');
                entry.evidence.push({ type: 'exception', detail: exc.message, lineNumber: exc.logLine || null });
            }
            // High CPU
            const timing = r.codeUnitTimings.find(t => t.name.includes(a.name));
            if (timing && parseFloat(timing.durationMs) > 500) {
                entry.score += 0.2; entry.reasons.push(`High CPU (${timing.durationMs}ms)`);
                entry.evidence.push({ type: 'timing', detail: `${timing.name}: ${timing.durationMs}ms`, lineNumber: null });
            }
            // Recursion
            const recurSig = (r.recursionSignals || []).find(s => s.automation === a.name);
            if (recurSig) {
                entry.score += 0.25; entry.reasons.push(`Recursive (${recurSig.count}x)`);
                entry.evidence.push({ type: 'recursion', detail: `${a.name} executed ${recurSig.count}x`, lineNumber: null });
            }
            // Failed validations
            if (r.stats?.totalValidationFails > 0) {
                const failedVr = r.validations.find(v => v.outcome === 'FAIL');
                entry.score += 0.1; entry.reasons.push('Validation failures detected');
                const vrTimeline = failedVr ? r.timeline.find(t => t.type === 'validation' && t.detail === 'FAIL') : null;
                entry.evidence.push({ type: 'validation', detail: failedVr?.ruleName || 'unknown', lineNumber: vrTimeline?.lineNumber || null });
            }
            // Bulk safety concern
            const bulkSig = (r.bulkSafetySignals || []).find(b => b.automation === a.name);
            if (bulkSig) {
                entry.score += 0.15; entry.reasons.push(bulkSig.reason);
                entry.evidence.push({ type: 'bulk', detail: bulkSig.reason, lineNumber: null });
            }
            // High DML fan-out
            if (r.objectImpact?.blastRadius > 3) {
                entry.score += 0.1; entry.reasons.push(`High blast radius (${r.objectImpact.blastRadius} objects)`);
            }
            // Large SOQL rows
            const bigSoql = r.soqlQueries.find(q => (q.rowCount || 0) > 100);
            if (bigSoql) {
                entry.score += 0.1; entry.reasons.push(`Large query result (${bigSoql.rowCount} rows)`);
            }
            if (entry.reasons.length > 0) suspects.push(entry);
        }
        suspects.sort((a, b) => b.score - a.score);
        suspects.forEach(s => s.score = Math.min(Math.round(s.score * 100), 99));
        r.primarySuspects = suspects.slice(0, 3);
    },

    // ─── Impact Hints ─────────────────────────────────────────

    _computeImpactHints() {
        const r = this.liveTraceResult;
        if (!r) return;
        r.impactHints = [];
        if ((r.bulkSafetySignals || []).length > 0) {
            r.impactHints.push({ severity: 'high', hint: 'Move SOQL/DML outside loops — use collections and bulk patterns', category: 'Apex Best Practice' });
        }
        if ((r.recursionSignals || []).length > 0) {
            r.impactHints.push({ severity: 'high', hint: 'Add static recursion guard (Set<Id> or Boolean flag) in trigger handler', category: 'Trigger Design' });
        }
        if (r.objectImpact?.blastRadius > 4) {
            r.impactHints.push({ severity: 'medium', hint: 'Consider async processing (Queueable/Platform Event) to reduce synchronous blast radius', category: 'Architecture' });
        }
        const highRiskLimits = Object.entries(r.limitRisk || {}).filter(([_, v]) => v === 'high');
        if (highRiskLimits.length > 0) {
            r.impactHints.push({ severity: 'high', hint: `Governor limit risk on: ${highRiskLimits.map(([k]) => k).join(', ')} — optimize or batch`, category: 'Governor Limits' });
        }
        const managedCount = r.automations.filter(a => a.isManagedPackage).length;
        if (managedCount > 2) {
            r.impactHints.push({ severity: 'low', hint: `${managedCount} managed package automations — check package settings to disable unnecessary triggers`, category: 'Org Hygiene' });
        }
        if (r.stats?.totalValidationFails > 0) {
            r.impactHints.push({ severity: 'medium', hint: 'Validation rule failures detected — check field defaults and data quality', category: 'Data Quality' });
        }
    },

    // ─── Incident Flags ─────────────────────────────────────

    _computeIncidentFlags() {
        const r = this.liveTraceResult;
        if (!r || this.savedTraces.length < 2) { if (r) r.incidentFlags = []; return; }
        r.incidentFlags = [];
        const avgSoql = this.savedTraces.reduce((s, t) => s + (t.result.stats?.totalSoql || 0), 0) / this.savedTraces.length;
        const avgDml = this.savedTraces.reduce((s, t) => s + (t.result.stats?.totalDml || 0), 0) / this.savedTraces.length;
        const avgExceptions = this.savedTraces.reduce((s, t) => s + (t.result.stats?.totalExceptions || 0), 0) / this.savedTraces.length;
        if (r.stats.totalSoql > avgSoql * 2 && avgSoql > 0) {
            r.incidentFlags.push({ metric: 'SOQL', current: r.stats.totalSoql, baseline: Math.round(avgSoql), severity: 'warning', msg: `SOQL count ${r.stats.totalSoql} is ${Math.round(r.stats.totalSoql / avgSoql)}x baseline (avg: ${Math.round(avgSoql)})` });
        }
        if (r.stats.totalDml > avgDml * 2 && avgDml > 0) {
            r.incidentFlags.push({ metric: 'DML', current: r.stats.totalDml, baseline: Math.round(avgDml), severity: 'warning', msg: `DML count ${r.stats.totalDml} is ${Math.round(r.stats.totalDml / avgDml)}x baseline` });
        }
        if (r.stats.totalExceptions > avgExceptions + 1) {
            r.incidentFlags.push({ metric: 'Exceptions', current: r.stats.totalExceptions, baseline: Math.round(avgExceptions), severity: 'critical', msg: `Exception spike: ${r.stats.totalExceptions} vs baseline ${Math.round(avgExceptions)}` });
        }
        const baselineShapes = this.savedTraces.map(t => t.fingerprint).filter(Boolean);
        if (r.transactionFingerprint?.hash && baselineShapes.length > 0 && !baselineShapes.includes(r.transactionFingerprint.hash)) {
            r.incidentFlags.push({ metric: 'Shape', severity: 'info', msg: 'Transaction shape differs from all saved baselines' });
        }
    },

    // ─── Trace Quality Score ──────────────────────────────

    _computeTraceQuality() {
        const r = this.liveTraceResult;
        if (!r) return;
        let score = 100;
        if (!r.logCompleteness?.isComplete) score -= 20;
        if (r.isLargeLog) score -= 10;
        const conf = this._getOverallConfidence();
        if (conf === 'low') score -= 20;
        else if (conf === 'medium') score -= 10;
        const coverage = r.parserHealth?.coveragePct || 100;
        if (coverage < 70) score -= 15;
        else if (coverage < 90) score -= 5;
        if (Object.keys(r.governorLimits || {}).length === 0 && r.automations.length > 0) score -= 10;
        if ((r.allLogIds || []).length > 3) score -= 5;
        r.traceQuality = Math.max(0, Math.min(100, score));
    },

    // ─── Recommendations Engine ───────────────────────────────────

    _computeRecommendations() {
        const r = this.liveTraceResult;
        if (!r) return;
        const recs = [];

        // Normalize SOQL for loop detection: strip bind var values, collapse whitespace
        const normalizeQuery = q => q.toLowerCase().replace(/:\s*\w+/g, ':?').replace(/\s+/g, ' ').trim();

        // ── R1: SOQL in loop ─────────────────────────────────────
        // Group by (normalizedQuery, codeUnit) — 3+ executions = looping
        const soqlGroups = new Map();
        (r.soqlQueries || []).forEach(q => {
            const key = `${normalizeQuery(q.query)}||${q.codeUnit || ''}`;
            if (!soqlGroups.has(key)) soqlGroups.set(key, { query: q.query, codeUnit: q.codeUnit, count: 0, totalRows: 0 });
            const g = soqlGroups.get(key);
            g.count++;
            g.totalRows += (q.rowCount || 0);
        });
        soqlGroups.forEach(g => {
            if (g.count >= 3) {
                recs.push({
                    id: 'soql-in-loop',
                    severity: g.count >= 10 ? 'critical' : 'high',
                    title: `SOQL inside loop (×${g.count})`,
                    detail: `"${g.query.length > 80 ? g.query.slice(0, 80) + '…' : g.query}" executed ${g.count} times${g.codeUnit ? ` in ${g.codeUnit}` : ''} — ${g.totalRows} total rows fetched`,
                    fix: 'Move query outside loop. Collect Ids into a Set, query once with WHERE Id IN :ids, then build a Map<Id, SObject> for lookup.',
                    codeUnit: g.codeUnit,
                    metric: 'soql'
                });
            }
        });

        // ── R2: DML in loop ──────────────────────────────────────
        const dmlGroups = new Map();
        (r.dmlOps || []).forEach(d => {
            const key = `${d.operation}||${d.objectType}||${d.codeUnit || ''}`;
            if (!dmlGroups.has(key)) dmlGroups.set(key, { operation: d.operation, objectType: d.objectType, codeUnit: d.codeUnit, count: 0 });
            dmlGroups.get(key).count++;
        });
        dmlGroups.forEach(g => {
            if (g.count >= 3) {
                recs.push({
                    id: 'dml-in-loop',
                    severity: g.count >= 8 ? 'critical' : 'high',
                    title: `DML inside loop (×${g.count})`,
                    detail: `${g.operation} ${g.objectType} DML executed ${g.count} times${g.codeUnit ? ` in ${g.codeUnit}` : ''}`,
                    fix: 'Collect records into a List<SObject>, then perform a single DML statement outside the loop.',
                    codeUnit: g.codeUnit,
                    metric: 'dml'
                });
            }
        });

        // ── R3: SOQL without WHERE clause ────────────────────────
        const noWhereQueries = (r.soqlQueries || []).filter(q => /FROM\s+\w+\s*(?:LIMIT|ORDER|$)/i.test(q.query));
        if (noWhereQueries.length > 0) {
            const example = noWhereQueries[0];
            recs.push({
                id: 'soql-no-where',
                severity: 'high',
                title: `SOQL without WHERE clause (${noWhereQueries.length} query${noWhereQueries.length !== 1 ? 'ies' : ''})`,
                detail: `"${example.query.length > 80 ? example.query.slice(0, 80) + '…' : example.query}"${noWhereQueries.length > 1 ? ` (+${noWhereQueries.length - 1} more)` : ''}`,
                fix: 'Add WHERE clause to limit scope. Full-table queries risk hitting the 50,000-row query-rows limit.',
                codeUnit: example.codeUnit,
                metric: 'soql'
            });
        }

        // ── R4: High row count ───────────────────────────────────
        const highRowQueries = (r.soqlQueries || []).filter(q => (q.rowCount || 0) >= 500);
        if (highRowQueries.length > 0) {
            highRowQueries.sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0));
            const worst = highRowQueries[0];
            recs.push({
                id: 'soql-high-rows',
                severity: (worst.rowCount || 0) >= 2000 ? 'critical' : 'high',
                title: `High-volume query result (${(worst.rowCount || 0).toLocaleString()} rows)`,
                detail: `"${worst.query.length > 80 ? worst.query.slice(0, 80) + '…' : worst.query}" returned ${(worst.rowCount || 0).toLocaleString()} rows`,
                fix: 'Add LIMIT clause, filter with WHERE, or use aggregate queries (COUNT, SUM) instead of fetching all records.',
                codeUnit: worst.codeUnit,
                metric: 'soql'
            });
        }

        // ── R5: Callout from trigger context ─────────────────────
        const hasTrigger = (r.automations || []).some(a => a.type === 'trigger');
        if (hasTrigger && (r.callouts || []).length > 0) {
            recs.push({
                id: 'callout-in-trigger',
                severity: 'high',
                title: `HTTP callout from trigger context (${r.callouts.length} callout${r.callouts.length !== 1 ? 's' : ''})`,
                detail: `Callout to: ${r.callouts.slice(0, 2).map(c => c.endpoint).join(', ')}${r.callouts.length > 2 ? ` (+${r.callouts.length - 2} more)` : ''}`,
                fix: 'Move callouts to @future(callout=true), Queueable, or Platform Events. Callouts in synchronous trigger context cause savepoints to roll back on timeout.',
                codeUnit: null,
                metric: 'callout'
            });
        }

        // ── R6: Trigger recursion ────────────────────────────────
        if ((r.recursionSignals || []).length > 0) {
            r.recursionSignals.forEach(sig => {
                recs.push({
                    id: 'recursion-' + sig.automation,
                    severity: 'high',
                    title: `Trigger recursion: ${sig.automation} (×${sig.count})`,
                    detail: `${sig.automation} fired ${sig.count} times in a single transaction — likely recursive trigger`,
                    fix: 'Add a static Boolean guard in your trigger handler: if (TriggerHandler.isRunning) return; Set it true at entry.',
                    codeUnit: sig.automation,
                    metric: 'trigger'
                });
            });
        }

        // ── R7: Automation density ───────────────────────────────
        (r.automationDensity || []).forEach(d => {
            if (d.total >= 5) {
                recs.push({
                    id: 'density-' + d.object,
                    severity: 'medium',
                    title: `High automation density on ${d.object} (${d.total} automations)`,
                    detail: `${d.triggerCount} trigger(s) + ${d.flowCount} flow(s) on ${d.object} — order of execution complexity is high`,
                    fix: 'Consolidate triggers into a single Trigger + Handler pattern. Review flow order and whether record-triggered flows can replace Apex triggers.',
                    codeUnit: null,
                    metric: 'trigger'
                });
            }
        });

        // ── R8: Governor limit approaching ───────────────────────
        (r.budgetViolations || []).forEach(v => {
            // Only add if not already in incidentFlags to avoid duplication
            if (v.pct >= 90) {
                recs.push({
                    id: 'limit-' + v.metric,
                    severity: v.pct >= 95 ? 'critical' : 'high',
                    title: `Governor limit critical: ${v.metric} at ${v.pct}%`,
                    detail: `${v.used} / ${v.limit} consumed — ${100 - v.pct}% headroom remaining`,
                    fix: v.metric === 'soqlQueries' ? 'Reduce queries with selective WHERE clauses and move queries outside loops.' :
                         v.metric === 'dmlStatements' ? 'Batch DML operations into collections to reduce statement count.' :
                         v.metric === 'cpuTime' ? 'Profile slow code units in the Timing tab. Avoid string concatenation in loops; use List.join().' :
                         'Reduce heap allocations — unset large collections when no longer needed.',
                    codeUnit: null,
                    metric: v.metric
                });
            }
        });

        // Sort: critical → high → medium → low
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        recs.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

        r.recommendations = recs;
    },

    // ─── Async Child Log Correlation ──────────────────────────────

    _correlateAsyncLogs() {
        const r = this.liveTraceResult;
        if (!r || !r.asyncOperations?.length || !window.apiClient) return Promise.resolve();
        r.asyncCorrelation = [];

        return window.apiClient.toolingQuery(
            `SELECT Id, Operation, LogLength, StartTime FROM ApexLog WHERE StartTime > ${r.traceWindow.endTime || new Date().toISOString()} ORDER BY StartTime ASC LIMIT 20`
        ).then(logResult => {
            const asyncLogs = (logResult.records || []).filter(l => {
                const opLower = (l.Operation || '').toLowerCase();
                return r.asyncOperations.some(ao =>
                    opLower.includes(ao.className.toLowerCase()) ||
                    opLower.includes('queueable') || opLower.includes('future') || opLower.includes('batch')
                );
            });
            r.asyncCorrelation = r.asyncOperations.map(ao => {
                const match = asyncLogs.find(l => (l.Operation || '').toLowerCase().includes(ao.className.toLowerCase()));
                return {
                    operation: ao,
                    status: match ? 'linked' : asyncLogs.length > 0 ? 'possible' : 'not_found',
                    logId: match?.Id || null,
                    logSize: match?.LogLength || null
                };
            });
            if (this.liveTraceState === 'results') this.render();
        }).catch(err => {
            console.debug('[LiveTrace] Async correlation failed:', err.message);
        });
    },

    // ─── Cross-Trace Comparison ──────────────────────────────

    _saveCurrentTrace(label) {
        const r = this.liveTraceResult;
        if (!r) return;
        const saved = JSON.parse(JSON.stringify(r));
        delete saved.rawLogSnippets; // Don't store raw snippets in saved traces (memory)
        this.savedTraces.unshift({
            label: label || `Trace ${new Date().toLocaleTimeString()}`,
            timestamp: new Date().toISOString(),
            result: saved,
            fingerprint: r.transactionFingerprint?.hash
        });
        if (this.savedTraces.length > 10) this.savedTraces.pop();
        this.render();
    },

    _compareTraces(savedIndex) {
        if (savedIndex >= 0 && savedIndex < this.savedTraces.length) {
            this.comparisonTrace = this.savedTraces[savedIndex];
            this.liveTraceActiveTab = 'comparison';
            this.render();
        }
    },

    // ─── Export ──────────────────────────────────────────────

    _downloadBlob(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        // Chrome extension: must append anchor to DOM for click to work
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    },

    _exportTrace(format) {
        const r = this.liveTraceResult;
        if (!r) return;
        const ts = new Date().toISOString().slice(0,19).replace(/:/g, '-');
        if (format === 'json') {
            this._downloadBlob(JSON.stringify(r, null, 2), `live-trace-${ts}.json`, 'application/json');
        } else if (format === 'csv') {
            let csv = 'Section,Type,Name,Detail\n';
            r.automations?.forEach(a => { csv += `Automation,${a.type},"${(a.name || '').replace(/"/g, '""')}","${(a.objectName || '').replace(/"/g, '""')}"\n`; });
            r.dmlOps?.forEach(d => { csv += `DML,${d.operation},"${d.objectType}","${d.rowCount} rows"\n`; });
            r.soqlQueries?.forEach(q => { csv += `SOQL,query,,"${(q.query || '').replace(/"/g, '""')}"\n`; });
            r.exceptions?.forEach(e => { csv += `Exception,${e.type},,"${(e.message || '').replace(/"/g, '""')}"\n`; });
            r.asyncOperations?.forEach(ao => { csv += `Async,${ao.type},"${ao.className}",\n`; });
            this._downloadBlob(csv, `live-trace-${ts}.csv`, 'text/csv');
        } else if (format === 'html') {
            const htmlReport = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Live Trace Report</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1a2e;color:#eee;padding:20px;max-width:1000px;margin:0 auto;}
h1{font-size:20px;margin-bottom:4px;} h2{font-size:14px;color:#888;margin-top:20px;text-transform:uppercase;letter-spacing:0.5px;}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;}
.stat{background:rgba(255,255,255,0.05);padding:12px;border-radius:6px;text-align:center;}
.stat-value{font-size:24px;font-weight:700;color:#3498db;display:block;}
.stat-label{font-size:11px;color:#888;margin-top:4px;display:block;}
.warn-banner{background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);border-radius:6px;padding:8px 12px;margin:8px 0;font-size:12px;color:#f39c12;}
.error-banner{background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:6px;padding:8px 12px;margin:8px 0;font-size:12px;color:#e74c3c;}
.root-cause{background:rgba(52,152,219,0.08);border:1px solid rgba(52,152,219,0.3);border-radius:8px;padding:12px 16px;margin:12px 0;}
.root-cause-title{font-size:11px;color:#888;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;}
.root-cause-name{font-size:14px;font-weight:600;color:#eee;}
.pill{padding:2px 8px;border-radius:3px;font-size:10px;background:rgba(255,255,255,0.06);color:#aaa;display:inline-block;margin:2px;}
.governor-bar{margin:6px 0;} .governor-label{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;}
.governor-track{height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;}
.governor-fill{height:100%;border-radius:3px;transition:width 0.3s;}
.timeline-item{padding:6px 12px;margin:2px 0;border-left:3px solid #888;background:rgba(255,255,255,0.02);font-size:12px;font-family:monospace;}
.hint{padding:6px 10px;margin:4px 0;border-radius:4px;font-size:11px;}
.hint-high{background:rgba(231,76,60,0.1);border-left:3px solid #e74c3c;color:#e74c3c;}
.hint-medium{background:rgba(243,156,18,0.1);border-left:3px solid #f39c12;color:#f39c12;}
.hint-low{background:rgba(46,204,113,0.1);border-left:3px solid #2ecc71;color:#2ecc71;}
.footer{margin-top:20px;padding:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:#666;font-family:monospace;}
.badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}
.badge-high{background:rgba(46,204,113,0.15);color:#2ecc71;}
.badge-medium{background:rgba(243,156,18,0.15);color:#f39c12;}
.badge-low{background:rgba(231,76,60,0.15);color:#e74c3c;}
</style></head><body>
<h1>Live Trace Report</h1>
<p style="color:#888;font-size:12px;">Generated ${new Date().toLocaleString()} | ${r.allLogIds?.length || 0} log(s) | Confidence: ${this._getOverallConfidence() || 'N/A'}</p>
${this._generateHtmlReportBody(r)}
</body></html>`;
            this._downloadBlob(htmlReport, `live-trace-${ts}.html`, 'text/html');
        }
    },

    _generateHtmlReportBody(r) {
        const s = r.stats || {};
        const gl = r.governorLimits || {};
        const suspects = r.primarySuspects || [];
        const hints = r.impactHints || [];
        const fp = r.transactionFingerprint || {};
        const tw = r.traceWindow || {};
        const esc = str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        let html = '';

        // Warnings
        if (s.hasFatalError) html += `<div class="error-banner">FATAL ERROR: ${esc(r.exceptions.find(e => e.isFatal)?.message)}</div>`;
        if (s.totalExceptions > 0 && !s.hasFatalError) html += `<div class="warn-banner">${s.totalExceptions} exception(s) thrown</div>`;
        if ((r.recursionSignals || []).length > 0) html += `<div class="warn-banner">Recursion: ${r.recursionSignals.map(s => `${esc(s.automation)} x${s.count}`).join(', ')}</div>`;
        if ((r.bulkSafetySignals || []).length > 0) html += `<div class="warn-banner">Bulk risk: ${r.bulkSafetySignals.map(b => esc(b.reason)).join('; ')}</div>`;

        // Root cause
        if (suspects.length > 0) {
            html += `<div class="root-cause"><div class="root-cause-title">Likely Root Cause</div>`;
            html += `<div><span class="root-cause-name">${esc(suspects[0].name)}</span> <span class="badge badge-${suspects[0].score >= 60 ? 'high' : suspects[0].score >= 30 ? 'medium' : 'low'}">${suspects[0].score}%</span></div>`;
            html += `<div>${suspects[0].reasons.map(r => `<span class="pill">${esc(r)}</span>`).join('')}</div></div>`;
        }

        // Stats
        html += `<h2>Summary</h2><div class="stat-grid">`;
        html += `<div class="stat"><span class="stat-value">${s.totalAutomations}</span><span class="stat-label">Automations</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalDml}</span><span class="stat-label">DML Ops</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalSoql}</span><span class="stat-label">SOQL</span></div>`;
        html += `<div class="stat"><span class="stat-value">${r.objectImpact?.blastRadius || 0}</span><span class="stat-label">Blast Radius</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalTransactions || 1}</span><span class="stat-label">Transactions</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalExceptions}</span><span class="stat-label">Exceptions</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalValidationFails}</span><span class="stat-label">Validation Fails</span></div>`;
        html += `<div class="stat"><span class="stat-value">${s.totalCallouts}</span><span class="stat-label">Callouts</span></div></div>`;

        // Governor limits
        if (Object.keys(gl).length > 0) {
            html += `<h2>Governor Limits</h2>`;
            for (const [key, val] of Object.entries(gl)) {
                const pct = Math.min((val.used / val.limit) * 100, 100);
                const color = pct > 80 ? '#e74c3c' : pct > 50 ? '#f39c12' : '#2ecc71';
                html += `<div class="governor-bar"><div class="governor-label"><span>${esc(key)}</span><span style="color:${color}">${val.used}/${val.limit}</span></div>`;
                html += `<div class="governor-track"><div class="governor-fill" style="width:${pct}%;background:${color};"></div></div></div>`;
            }
        }

        // Impact hints
        if (hints.length > 0) {
            html += `<h2>Suggestions</h2>`;
            hints.forEach(h => { html += `<div class="hint hint-${h.severity}"><strong>${esc(h.category)}:</strong> ${esc(h.hint)}</div>`; });
        }

        // Timeline (top 20)
        const timeline = r.timeline || [];
        if (timeline.length > 0) {
            html += `<h2>Timeline (${timeline.length} events)</h2>`;
            const colors = { trigger: '#3498db', flow: '#9b59b6', dml: '#8e44ad', validation: '#2ecc71', workflow: '#f39c12', exception: '#e74c3c' };
            timeline.slice(0, 20).forEach(t => {
                html += `<div class="timeline-item" style="border-color:${colors[t.type] || '#888'}">[${t.type}] ${esc(t.name)} ${t.detail ? '— ' + esc(t.detail) : ''}</div>`;
            });
            if (timeline.length > 20) html += `<p style="color:#888;font-size:11px;">... and ${timeline.length - 20} more events</p>`;
        }

        // Footer
        html += `<div class="footer">`;
        if (tw.startTime) html += `Trace: ${tw.startTime?.replace('T', ' ').slice(0, 19)} → ${tw.endTime?.replace('T', ' ').slice(0, 19)} | `;
        if (fp.hash) html += `Shape: #${fp.hash} (${fp.eventCount} events) | `;
        html += `SF Intel Studio</div>`;

        return html;
    },

    // ─── Live Trace Result Tabs ──────────────────────────────

    renderLiveTraceSummary() {
        const r = this.liveTraceResult;
        const s = r.stats;
        const gl = r.governorLimits || {};
        const lr = r.limitRisk || {};
        const overallConf = this._getOverallConfidence();
        const suspects = r.primarySuspects || [];
        const tw = r.traceWindow || {};
        const fp = r.transactionFingerprint || {};
        const hints = r.impactHints || [];
        const incidents = r.incidentFlags || [];
        const ph = r.parserHealth || {};
        const budgets = r.budgetViolations || [];

        // Timeline with noise filter profiles
        let timeline = r.timeline || [];
        if (this.noiseFilterLevel === 'balanced') {
            timeline = timeline.filter(t => !(t.type === 'validation' && t.detail === 'PASS'));
        } else if (this.noiseFilterLevel === 'minimal') {
            timeline = timeline.filter(t => {
                if (t.type === 'validation' && t.detail === 'PASS') return false;
                if (t.type === 'workflow') return false;
                if (t.type === 'duplicate' && t.detail === 'Clean') return false;
                return true;
            });
        } else if (this.noiseFilterLevel === 'key') {
            timeline = timeline.filter(t => ['trigger', 'flow', 'dml', 'exception', 'network', 'ui-error'].includes(t.type));
        }

        // Timeline heatmap: find max duration for relative sizing
        const maxDuration = r.codeUnitTimings?.length > 0
            ? Math.max(...r.codeUnitTimings.map(t => parseFloat(t.durationMs)))
            : 0;

        // "Nothing happened" — clean empty state
        if (r.nothingHappened) {
            return `
                <div class="auto-overview">
                    <div class="auto-nothing-happened">
                        <div class="auto-nothing-icon">&#10003;</div>
                        <h3>No Automations Executed</h3>
                        <p>No triggers, flows, DML, or exceptions detected in the captured log(s).</p>
                        <p style="font-size:11px;color:#888;">This is normal for read-only operations or actions that don't trigger automations.</p>
                    </div>
                    ${r.debugLevelWarnings?.length > 0 ? `
                        <div style="margin-top:12px;">
                            ${r.debugLevelWarnings.map(w => `<div class="auto-warning-banner"><span>${this.escapeHtml(w)}</span></div>`).join('')}
                        </div>
                    ` : ''}
                </div>`;
        }

        return `
            <div class="auto-overview">
                ${(r.logCompleteness?.warnings || []).length > 0 ? `
                    <div class="auto-warning-banner">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M8 1l7 14H1L8 1zM8 6v4M8 12v1"/></svg>
                        <span>${r.logCompleteness.warnings.map(w => this.escapeHtml(w)).join(' | ')}</span>
                    </div>
                ` : ''}
                ${(() => {
                    const stitched = (r.automations || []).filter(a => a.isStitched && a.stitchSegmentIndex === 1);
                    return stitched.length > 0 ? `
                        <div class="auto-warning-banner" style="border-left-color:#9b59b6;background:rgba(155,89,182,0.07);">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9b59b6" stroke-width="1.5"><path d="M2 8h12M8 2l6 6-6 6"/></svg>
                            <span>${stitched.length} multi-log flow interview${stitched.length > 1 ? 's' : ''} stitched across ${r.allLogIds?.length || '?'} log records &mdash; segments linked by interview ID</span>
                        </div>
                    ` : '';
                })()}

                ${incidents.length > 0 ? `
                    ${incidents.map(inc => `
                        <div class="auto-incident-flag ${inc.severity === 'critical' ? 'auto-error-banner' : 'auto-warning-banner'}">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${inc.severity === 'critical' ? '#e74c3c' : '#f39c12'}" stroke-width="1.5"><path d="M8 1l7 14H1L8 1zM8 6v4M8 12v1"/></svg>
                            <span>${this.escapeHtml(inc.msg)}</span>
                            <span class="auto-incident-badge">${this.escapeHtml(inc.metric)}</span>
                        </div>
                    `).join('')}
                ` : ''}

                ${budgets.length > 0 ? `
                    <div class="auto-warning-banner">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M2 14V2h12v12H2zM5 10V6M8 10V4M11 10V7"/></svg>
                        <span>Performance budget exceeded: ${budgets.map(b => `${this.escapeHtml(b.metric)} at ${b.pct}% (budget: ${b.budget}%)`).join(', ')}</span>
                    </div>
                ` : ''}

                ${s.totalExceptions > 0 ? (() => {
                    const esc = (v) => this.escapeHtml(v || '');
                    const allEx = r.exceptions || [];
                    const shown = allEx.slice(0, 3);
                    const overflow = allEx.length - shown.length;
                    const isFatal = s.hasFatalError;
                    return `
                    <div class="auto-exception-banner ${isFatal ? 'auto-exception-banner--fatal' : 'auto-exception-banner--warn'}">
                        <div class="auto-exception-banner-header">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${isFatal ? '#e74c3c' : '#f39c12'}" stroke-width="1.5"><path d="M8 1l7 14H1L8 1zM8 6v4M8 12v1"/></svg>
                            <span class="auto-exception-banner-title">${isFatal ? 'Fatal Error' : `${allEx.length} Exception${allEx.length !== 1 ? 's' : ''} Thrown`}</span>
                            <button class="auto-jump-debug-btn" data-jump-tab="debug">View in Debug →</button>
                        </div>
                        <div class="auto-exception-list">
                            ${shown.map(ex => `
                                <div class="auto-exception-row">
                                    <div class="auto-exception-row-top">
                                        ${ex.isLimitException ? `<span class="auto-ex-badge auto-ex-badge--limit">LIMIT</span>` : ''}
                                        ${ex.isFatal ? `<span class="auto-ex-badge auto-ex-badge--fatal">FATAL</span>` : ''}
                                        <span class="auto-exception-type-label">${esc(ex.type)}</span>
                                        ${ex.codeUnit ? `<span class="auto-exception-unit-label">in ${esc(ex.codeUnit)}</span>` : ''}
                                        ${ex.lineNumber ? `<span class="auto-exception-line-label">line ${ex.lineNumber}</span>` : ''}
                                    </div>
                                    <div class="auto-exception-msg-label">${esc(ex.message.length > 160 ? ex.message.slice(0, 160) + '…' : ex.message)}</div>
                                </div>
                            `).join('')}
                            ${overflow > 0 ? `<div class="auto-exception-overflow">+${overflow} more — open Debug tab</div>` : ''}
                        </div>
                    </div>`;
                })() : ''}

                ${(r.recursionSignals || []).length > 0 ? `
                    <div class="auto-warning-banner">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M4 8a4 4 0 108 0 4 4 0 00-8 0M12 4l1-1M12 12l1 1"/></svg>
                        <span>Recursion detected: ${r.recursionSignals.map(sig => `${this.escapeHtml(sig.automation)} x${sig.count}`).join(', ')}</span>
                    </div>
                ` : ''}

                ${(r.bulkSafetySignals || []).length > 0 ? `
                    <div class="auto-warning-banner">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M2 8h12M8 2v12"/></svg>
                        <span>Bulk risk: ${r.bulkSafetySignals.map(b => this.escapeHtml(b.reason)).join('; ')}</span>
                    </div>
                ` : ''}

                ${r.interactionRoot?.type !== 'unknown' ? `
                    <div class="auto-interaction-root">
                        <span class="auto-root-type">${this.escapeHtml(r.interactionRoot.type === 'flow' ? 'User-initiated Flow' : r.interactionRoot.type === 'trigger' ? 'Trigger-initiated' : 'Apex Controller')}</span>
                        <span class="auto-root-name">${this.escapeHtml(r.interactionRoot.name || '')}</span>
                        <span class="auto-confidence-badge confidence-${r.interactionRoot.confidence}">Confidence: ${r.interactionRoot.confidence}</span>
                    </div>
                ` : ''}

                ${r.slowestUnit ? `
                    <div class="auto-slowest-banner">
                        <span>Slowest step: <strong>${this.escapeHtml(r.slowestUnit.name)}</strong> (${parseFloat(r.slowestUnit.durationMs).toFixed(1)} ms)</span>
                    </div>
                ` : ''}

                ${(r.automationDensity || []).length > 0 ? `
                    ${r.automationDensity.map(d => `
                        <div class="auto-density-warning">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M8 1l7 14H1L8 1zM8 6v4M8 12v1"/></svg>
                            <span>${this.escapeHtml(d.object)} has heavy automation density (${d.total} automations: ${d.triggerCount} triggers, ${d.flowCount} flows)</span>
                        </div>
                    `).join('')}
                ` : ''}

                ${(r.limitSpikes || []).length > 0 ? `
                    ${r.limitSpikes.map(spike => `
                        <div class="auto-spike-alert ${spike.severity === 'high' ? 'auto-error-banner' : 'auto-warning-banner'}">
                            <span class="auto-spike-metric">${this.escapeHtml(spike.metric)}</span>
                            <span>${this.escapeHtml(spike.msg)}</span>
                        </div>
                    `).join('')}
                ` : ''}

                ${(r.debugLevelWarnings || []).length > 0 ? `
                    ${r.debugLevelWarnings.map(w => `
                        <div class="auto-warning-banner">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f39c12" stroke-width="1.5"><path d="M2 2h12v12H2zM5 6h6M5 9h4"/></svg>
                            <span>${this.escapeHtml(w)}</span>
                        </div>
                    `).join('')}
                ` : ''}

                ${(() => {
                    const recs = r.recommendations || [];
                    if (recs.length === 0) return '';
                    const esc = v => this.escapeHtml(v || '');
                    const SEVERITY_COLOR = { critical: '#e74c3c', high: '#e67e22', medium: '#f39c12', low: '#3498db' };
                    const METRIC_ICON = { soql: '🔍', dml: '✏️', trigger: '⚡', callout: '🌐', cpuTime: '⏱', heapSize: '💾', soqlQueries: '🔍', dmlStatements: '✏️' };
                    return `
                    <div class="auto-recommendations">
                        <div class="auto-section-header" style="margin-bottom:8px;">
                            <h4 class="auto-section-subtitle" style="display:flex;align-items:center;gap:6px;">
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#e67e22" stroke-width="1.8"><path d="M8 1l7 14H1L8 1zM8 6v4M8 12v1"/></svg>
                                Recommendations
                            </h4>
                            <span class="auto-section-count">${recs.length}</span>
                        </div>
                        ${recs.map(rec => `
                            <div class="auto-rec-card auto-rec-card--${rec.severity}">
                                <div class="auto-rec-card-header">
                                    <span class="auto-rec-icon">${METRIC_ICON[rec.metric] || '⚠'}</span>
                                    <span class="auto-rec-title">${esc(rec.title)}</span>
                                    <span class="auto-rec-severity" style="color:${SEVERITY_COLOR[rec.severity] || '#888'};">${rec.severity.toUpperCase()}</span>
                                </div>
                                <div class="auto-rec-detail">${esc(rec.detail)}</div>
                                <div class="auto-rec-fix">
                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#2ecc71" stroke-width="1.8"><path d="M3 8l4 4 6-7"/></svg>
                                    ${esc(rec.fix)}
                                </div>
                            </div>
                        `).join('')}
                    </div>`;
                })()}

                ${suspects.length > 0 ? `
                    <div class="auto-root-cause-card">
                        <div class="auto-root-cause-header">
                            <span class="auto-root-cause-icon">🎯</span>
                            <span>Likely Root Cause</span>
                        </div>
                        <div class="auto-root-cause-body">
                            <span class="auto-root-cause-name">${this.escapeHtml(suspects[0].name)}</span>
                            <span class="auto-confidence-badge ${suspects[0].score >= 60 ? 'confidence-high' : suspects[0].score >= 30 ? 'confidence-medium' : 'confidence-low'}">${suspects[0].score}%</span>
                        </div>
                        <div class="auto-root-cause-reasons">
                            ${suspects[0].reasons.map((reason, idx) => {
                                const ev = suspects[0].evidence?.[idx];
                                const hasEvidence = ev && ev.lineNumber && r.rawLogSnippets?.[ev.lineNumber];
                                return `<span class="auto-root-cause-reason ${hasEvidence ? 'auto-evidence-link' : ''}" ${hasEvidence ? `data-evidence-line="${ev.lineNumber}"` : ''}>${this.escapeHtml(reason)}${hasEvidence ? ' 📋' : ''}</span>`;
                            }).join('')}
                        </div>
                        <div class="auto-evidence-container" id="auto-evidence-container" style="display:none;margin-top:8px;"></div>
                        ${suspects.length > 1 ? `
                            <div style="margin-top: 8px; font-size: 11px; color: #777;">
                                ${suspects.slice(1).map(su => `<span style="margin-right:12px;">${this.escapeHtml(su.name)} (${su.score}%)</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

                ${hints.length > 0 ? `
                    <div class="auto-impact-hints" style="margin-bottom: 12px;">
                        <div class="auto-section-header"><h4 class="auto-section-subtitle">Suggestions</h4><span class="auto-section-count">${hints.length}</span></div>
                        ${hints.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] || 3) - ({ high: 0, medium: 1, low: 2 }[b.severity] || 3)).map(h => `
                            <div class="auto-impact-hint hint-${h.severity}">
                                <span class="auto-hint-category">${this.escapeHtml(h.category)}</span>
                                <span class="auto-hint-text">${this.escapeHtml(h.hint)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="auto-overview-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <h3 class="auto-section-title" style="margin:0;">Live Trace Results</h3>
                        ${r.allLogIds?.length > 1 ? `<span class="auto-section-count">${r.allLogIds.length} logs merged</span>` : ''}
                        ${overallConf ? `<span class="auto-confidence-badge confidence-${overallConf}">Confidence: ${overallConf}</span>` : ''}
                        ${r.traceQuality != null ? `<span class="auto-trace-quality ${r.traceQuality >= 80 ? 'quality-good' : r.traceQuality >= 50 ? 'quality-fair' : 'quality-poor'}">Quality: ${r.traceQuality}%</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div class="auto-noise-profiles">
                            <button class="auto-noise-btn ${this.noiseFilterLevel === 'key' ? 'active' : ''}" data-noise="key">Key</button>
                            <button class="auto-noise-btn ${this.noiseFilterLevel === 'minimal' ? 'active' : ''}" data-noise="minimal">Minimal</button>
                            <button class="auto-noise-btn ${this.noiseFilterLevel === 'balanced' ? 'active' : ''}" data-noise="balanced">Balanced</button>
                            <button class="auto-noise-btn ${this.noiseFilterLevel === 'full' ? 'active' : ''}" data-noise="full">Full</button>
                        </div>
                        <button class="auto-action-btn" data-export="json" style="padding:3px 8px;font-size:11px;">JSON</button>
                        <button class="auto-action-btn" data-export="csv" style="padding:3px 8px;font-size:11px;">CSV</button>
                        <button class="auto-action-btn" data-export="html" style="padding:3px 8px;font-size:11px;">HTML</button>
                        <button class="auto-action-btn" id="auto-save-trace-btn" style="padding:3px 8px;font-size:11px;">Save</button>
                        ${this.savedTraces.length > 0 ? `
                            <select id="auto-compare-select" style="padding:3px 6px;font-size:11px;background:#2a2a3e;color:#ccc;border:1px solid rgba(255,255,255,0.1);border-radius:3px;">
                                <option value="">Compare...</option>
                                ${this.savedTraces.map((t, i) => `<option value="${i}">${this.escapeHtml(t.label)}</option>`).join('')}
                            </select>
                        ` : ''}
                    </div>
                </div>

                ${(() => {
                    const dml = r.dmlOps || [];
                    if (dml.length === 0) return '';
                    const primary = dml[0];
                    const opVerb = { Insert: 'Created', Update: 'Updated', Delete: 'Deleted', Undelete: 'Restored' }[primary.operation] || primary.operation;
                    const otherOps = dml.length > 1 ? dml.slice(1) : [];
                    const cascadeSummary = otherOps.length > 0
                        ? ` <span class="auto-context-cascade">→ ${[...new Set(otherOps.map(o => `${o.operation} ${this.escapeHtml(o.objectType)}`))].slice(0, 3).join(', ')}${otherOps.length > 3 ? ` +${otherOps.length - 3} more` : ''}</span>`
                        : '';
                    return `
                    <div class="auto-record-context">
                        <span class="auto-context-op auto-context-op-${primary.operation.toLowerCase()}">${opVerb}</span>
                        <span class="auto-context-object">${this.escapeHtml(primary.objectType)}</span>
                        <span class="auto-context-rows">${primary.rowCount} row${primary.rowCount !== 1 ? 's' : ''}</span>
                        ${cascadeSummary}
                    </div>`;
                })()}

                <div class="auto-stats-grid">
                    <div class="auto-stat-card"><span class="auto-stat-value">${s.totalAutomations}</span><span class="auto-stat-label">Automations</span></div>
                    <div class="auto-stat-card"><span class="auto-stat-value">${s.totalDml}</span><span class="auto-stat-label">DML Ops</span></div>
                    <div class="auto-stat-card"><span class="auto-stat-value">${s.totalSoql}</span><span class="auto-stat-label">SOQL (${s.totalSoqlRows} rows)</span></div>
                    <div class="auto-stat-card"><span class="auto-stat-value">${r.objectImpact?.blastRadius || 0}</span><span class="auto-stat-label">Blast Radius</span></div>
                    <div class="auto-stat-card"><span class="auto-stat-value">${s.totalTransactions || 1}</span><span class="auto-stat-label">Transactions</span></div>
                    <div class="auto-stat-card ${s.totalExceptions > 0 ? 'auto-stat-warn' : ''}"><span class="auto-stat-value">${s.totalExceptions}</span><span class="auto-stat-label">Exceptions</span></div>
                    <div class="auto-stat-card ${s.totalValidationFails > 0 ? 'auto-stat-warn' : ''}"><span class="auto-stat-value">${s.totalValidationFails}</span><span class="auto-stat-label">Validation Fails</span></div>
                    <div class="auto-stat-card"><span class="auto-stat-value">${s.totalCallouts}</span><span class="auto-stat-label">Callouts</span></div>
                </div>

                ${Object.keys(gl).length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h4 class="auto-section-subtitle">Governor Limits</h4></div>
                    <div class="auto-governor-bars">
                        ${gl.soqlQueries ? this._renderGovernorBar('SOQL Queries', gl.soqlQueries, lr.soqlQueries) : ''}
                        ${gl.dmlStatements ? this._renderGovernorBar('DML Statements', gl.dmlStatements, lr.dmlStatements) : ''}
                        ${gl.cpuTime ? this._renderGovernorBar('CPU Time (ms)', gl.cpuTime, lr.cpuTime) : ''}
                        ${gl.heapSize ? this._renderGovernorBar('Heap Size', gl.heapSize, lr.heapSize) : ''}
                    </div>
                ` : ''}

                ${(r.asyncOperations || []).length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;">
                        <h4 class="auto-section-subtitle">Async Operations</h4>
                        <span class="auto-section-count">${r.asyncOperations.length}</span>
                    </div>
                    ${r.asyncOperations.map(op => {
                        const corr = (r.asyncCorrelation || []).find(c => c.operation?.className === op.className);
                        return `
                        <div class="auto-phase-card" style="--phase-color: #e67e22; margin-bottom: 4px;">
                            <div class="auto-automation-item" style="padding: 8px 12px;">
                                <span class="auto-automation-icon">⚡</span>
                                <span class="auto-automation-name">${this.escapeHtml(op.className)}</span>
                                <span class="auto-async-type-badge">${op.type}</span>
                                ${corr ? `<span class="auto-async-status status-${corr.status}">${corr.status === 'linked' ? 'Linked' : corr.status === 'possible' ? 'Possible' : 'Not found'}</span>${corr.logId ? ` <button class="auto-action-btn auto-async-view-log" data-log-id="${corr.logId}" style="padding:2px 6px;font-size:10px;">View</button>` : ''}` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                ` : ''}

                ${(r.dmlCascade || []).length > 1 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h4 class="auto-section-subtitle">DML Cascade</h4></div>
                    <div class="auto-dml-cascade-tree">
                        ${r.dmlCascade.map(c => `
                            <div class="auto-cascade-step" style="padding-left: ${c.depth * 20}px;">
                                ${c.depth > 0 ? '<span class="auto-cascade-arrow" style="color:#888;">↓</span>' : ''}
                                <span class="auto-cascade-object-name">${this.escapeHtml(c.object)}</span>
                                <span class="auto-operation-badge">${this.escapeHtml(c.operation)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                ${r.codeUnitTimings?.length > 0 ? (() => {
                    const sorted = Object.values(
                        r.codeUnitTimings.reduce((g, t) => {
                            if (!g[t.name]) g[t.name] = { name: t.name, totalMs: 0 };
                            g[t.name].totalMs += parseFloat(t.durationMs);
                            return g;
                        }, {})
                    ).sort((a, b) => b.totalMs - a.totalMs).slice(0, 3);
                    return `<div class="auto-slowest-banner" style="margin-top:12px;">
                        <span>Slowest: <strong>${this.escapeHtml(sorted[0].name.split('|').pop().trim())}</strong> (${sorted[0].totalMs.toFixed(1)}ms)</span>
                        <span style="margin-left:8px;font-size:10px;color:#888;">→ see <em>Timing</em> tab for full breakdown</span>
                    </div>`;
                })() : ''}

                ${timeline.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h4 class="auto-section-subtitle">Execution Timeline</h4></div>
                    <div class="auto-timeline">
                        ${timeline.map(t => {
                            const nc = t.type === 'network' ? r.networkCalls?.find(n => t.name === n.name) : null;
                            const networkFailed = nc?.isError;
                            const icons = { trigger: '⚡', flow: '🔀', dml: '💾', validation: '✓', workflow: '📋', duplicate: '🔍', exception: '⚠', network: networkFailed ? '⚠' : '🌐', 'ui-error': '⚠' };
                            const colors = { trigger: '#3498db', flow: '#9b59b6', dml: '#8e44ad', validation: t.detail === 'FAIL' ? '#e74c3c' : '#2ecc71', workflow: '#f39c12', duplicate: '#e67e22', exception: '#e74c3c', network: networkFailed ? '#e74c3c' : '#1abc9c', 'ui-error': '#e67e22' };
                            const badgeLabels = { trigger: 'TRIGGER', flow: 'FLOW', dml: 'DML', validation: 'VALIDATION', workflow: 'WORKFLOW', duplicate: 'DUPLICATE', exception: 'EXCEPTION', network: networkFailed ? 'APEX ERR' : 'APEX', 'ui-error': 'CLIENT ERR' };
                            // Timeline heatmap: find matching code unit timing
                            const matchTiming = maxDuration > 0 ? r.codeUnitTimings.find(cu => t.name && cu.name.includes(t.name)) : null;
                            const heatPct = matchTiming ? Math.max(4, Math.round((parseFloat(matchTiming.durationMs) / maxDuration) * 100)) : 0;
                            const heatColor = matchTiming ? (parseFloat(matchTiming.durationMs) > 1000 ? '#e74c3c' : parseFloat(matchTiming.durationMs) > 100 ? '#f39c12' : '#2ecc71') : '';
                            // For network entries, split detail into "200 · 1210ms" and "← lwcName.lwc"
                            let detailMain = t.detail || '';
                            let detailLwc = '';
                            if (t.type === 'network' && t.detail) {
                                const lwcIdx = t.detail.indexOf(' ← ');
                                if (lwcIdx !== -1) {
                                    detailMain = t.detail.slice(0, lwcIdx);
                                    detailLwc = t.detail.slice(lwcIdx + 3); // strip " ← "
                                }
                            }
                            return `
                                <div class="auto-phase-card" style="--phase-color: ${colors[t.type] || '#888'}; padding: 8px 12px; margin-bottom: 4px;">
                                    <div class="auto-automation-item" style="padding: 0;">
                                        <span class="auto-automation-icon">${icons[t.type] || '•'}</span>
                                        <span class="auto-node-type-badge" style="--badge-color: ${colors[t.type] || '#888'}">${badgeLabels[t.type] || t.type.toUpperCase()}</span>
                                        <span class="auto-automation-name">${this.escapeHtml(t.name)}</span>
                                        ${t.countBadge > 1 ? `<span style="font-size:10px;color:#aaa;font-family:monospace;font-weight:600;margin-left:2px;">×${t.countBadge}</span>` : ''}
                                        ${detailMain ? `<span class="auto-automation-events">${this.escapeHtml(detailMain)}</span>` : ''}
                                        ${detailLwc ? `<span style="font-size:11px;color:#1abc9c;font-family:monospace;margin-left:4px;">← ${this.escapeHtml(detailLwc)}</span>` : ''}
                                        ${heatPct > 0 ? `<span class="auto-timeline-heat" style="width:${heatPct}px;background:${heatColor};" title="${matchTiming.durationMs}ms"></span>` : ''}
                                        ${t.lineNumber && r.rawLogSnippets?.[t.lineNumber] ? `<span class="auto-log-jump" data-log-line="${t.lineNumber}" title="View log context">🔍</span>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="auto-empty-tab"><p>No automation events detected in this log.</p></div>'}
                <div class="auto-log-context-container" id="auto-log-context" style="display:none;"></div>

                ${ph.totalLines > 0 ? `
                    <div class="auto-parser-health" style="margin-top: 16px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:3px;">
                            <span>Parser Coverage</span>
                            <span style="color: ${ph.coveragePct >= 90 ? '#2ecc71' : ph.coveragePct >= 70 ? '#f39c12' : '#e74c3c'}; font-family: monospace;">${ph.coveragePct}% (${ph.unknownLines} unrecognized)</span>
                        </div>
                        <div style="height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; width: ${ph.coveragePct}%; background: ${ph.coveragePct >= 90 ? '#2ecc71' : ph.coveragePct >= 70 ? '#f39c12' : '#e74c3c'}; border-radius: 2px;"></div>
                        </div>
                    </div>
                ` : ''}

                ${tw.startTime ? `
                    <div class="auto-replay-footer">
                        Trace: ${tw.startTime?.replace('T', ' ').slice(0, 19)} → ${tw.endTime?.replace('T', ' ').slice(0, 19)} | User: ${tw.userId || 'resolving...'} | ${tw.logCount || 0} log(s)${fp.hash ? ` | Shape: <span class="auto-fingerprint">#${fp.hash}</span> (${fp.eventCount} events, ${fp.uniqueTypes} types)` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    },

    renderLiveTraceAutomations() {
        const r = this.liveTraceResult;
        const autos = r.automations || [];
        if (autos.length === 0 && !(r.flowElements?.length)) {
            return `<div class="auto-empty-tab"><p>No automations detected in this log.</p></div>`;
        }

        const triggers = autos.filter(a => a.type === 'trigger');
        const flows = autos.filter(a => a.type === 'flow');

        return `
            <div class="auto-exec-order">
                ${triggers.length > 0 ? `
                    <div class="auto-section-header"><h3 class="auto-section-title">Triggers</h3><span class="auto-section-count">${triggers.length}</span></div>
                    ${triggers.map(t => `
                        <div class="auto-phase-card" style="--phase-color: #3498db; margin-bottom: 6px;">
                            <div class="auto-automation-item" style="padding: 8px 12px;">
                                <span class="auto-automation-icon">⚡</span>
                                <span class="auto-automation-name">${this.escapeHtml(t.name)}</span>
                                ${t.isManagedPackage ? `<span class="auto-managed-badge">${this.escapeHtml(t.namespace)}</span>` : ''}
                                ${t.objectName ? `<span class="auto-automation-events">on ${this.escapeHtml(t.objectName)}</span>` : ''}
                                ${t.events.length > 0 ? `<span class="auto-automation-events">(${t.events.join(', ')})</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                ` : ''}
                ${flows.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h3 class="auto-section-title">Flows</h3><span class="auto-section-count">${flows.length}</span></div>
                    ${flows.map(f => {
                        const flowElements = window.FlowAnalysisHelper
                            ? window.FlowAnalysisHelper.renderFlowElements(f.name, r.flowElements || [], v => this.escapeHtml(v))
                            : '';
                        const hasFault = (r.flowElements || []).some(e => e.flowName === f.name && e.isFault);
                        return `
                        <div class="auto-phase-card" style="--phase-color: ${hasFault ? '#e74c3c' : '#9b59b6'}; margin-bottom: 6px;">
                            <div class="auto-automation-item" style="padding: 8px 12px;">
                                <span class="auto-automation-icon">${hasFault ? '💥' : '🔀'}</span>
                                <span class="auto-automation-name">${this.escapeHtml(f.name)}</span>
                                ${f.isManagedPackage ? `<span class="auto-managed-badge">${this.escapeHtml(f.namespace)}</span>` : ''}
                                ${f.isResumed && !f.isStitched ? `<span class="auto-stitch-badge" style="background:rgba(155,89,182,0.15);color:#9b59b6;border-color:rgba(155,89,182,0.3);">resumed</span>` : ''}
                                ${f.isStitched ? `<span class="auto-stitch-badge" title="This flow interview spans ${f.stitchTotalSegments} log records (${f.stitchLogNums.join(', ')})">seg ${f.stitchSegmentIndex}/${f.stitchTotalSegments}</span>` : ''}
                                ${hasFault ? `<span class="auto-ex-badge auto-ex-badge--fatal" style="margin-left:auto;">FAULT</span>` : ''}
                            </div>
                            ${f.isStitched ? `
                                <div style="padding: 0 12px 6px; font-size: 10px; color: #9b59b6; opacity: 0.75; letter-spacing: 0.3px;">
                                    Multi-log interview &nbsp;·&nbsp; log records ${f.stitchLogNums.join(' \u2192 ')}
                                </div>` : ''}
                            ${flowElements}
                        </div>`;
                    }).join('')}
                ` : ''}
            </div>
        `;
    },

    renderLiveTraceDml() {
        const r = this.liveTraceResult;
        const ops = r.dmlOps || [];
        if (ops.length === 0) return `<div class="auto-empty-tab"><p>No DML operations detected in this log.</p></div>`;

        const grouped = {};
        for (const op of ops) { if (!grouped[op.objectType]) grouped[op.objectType] = []; grouped[op.objectType].push(op); }

        return `
            <div class="auto-exec-order">
                ${(r.networkCalls?.length > 0 || r.uiErrors?.length > 0) ? `
                    <div class="auto-section-header"><h3 class="auto-section-title">User Actions <span class="auto-beta-badge">Beta</span></h3><span class="auto-section-count">${(r.networkCalls?.length || 0) + (r.uiErrors?.length || 0)} event${((r.networkCalls?.length || 0) + (r.uiErrors?.length || 0)) !== 1 ? 's' : ''}</span></div>
                    ${(r.uiErrors || []).map(e => `
                        <div class="auto-network-card" style="border-left-color: #e67e22;">
                            <span class="auto-network-icon">⚠</span>
                            <div class="auto-network-body">
                                <span class="auto-network-method" style="color:#e67e22;">${this.escapeHtml(e.title || 'Client Error')}</span>
                                ${e.message ? `<span class="auto-network-caller" style="color:#aaa;">${this.escapeHtml(e.message)}</span>` : ''}
                            </div>
                            <span class="auto-network-status err">${e.variant === 'warning' ? 'WARN' : 'ERR'}</span>
                        </div>
                    `).join('')}
                    ${(r.networkCalls || []).map(nc => `
                        <div class="auto-network-card">
                            <span class="auto-network-icon">🌐</span>
                            <div class="auto-network-body">
                                <span class="auto-network-method">${this.escapeHtml(nc.name)}</span>
                                ${nc.callerComponents?.length ? `<span class="auto-network-caller">← ${this.escapeHtml(nc.callerComponents[0])}.lwc</span>` : ''}
                            </div>
                            <span class="auto-network-status ${nc.statusCode >= 200 && nc.statusCode < 300 ? 'ok' : 'err'}">${nc.statusCode || '?'}</span>
                            <span class="auto-network-duration">${nc.duration}ms</span>
                        </div>
                    `).join('')}
                ` : ''}
                <div class="auto-section-header" ${r.networkCalls?.length > 0 ? 'style="margin-top:20px;"' : ''}><h3 class="auto-section-title">DML Operations</h3><span class="auto-section-count">${ops.length} operation${ops.length !== 1 ? 's' : ''}</span></div>
                ${Object.entries(grouped).map(([obj, objOps]) => `
                    <div class="auto-cascade-card">
                        <div class="auto-cascade-header"><div class="auto-cascade-object">
                            <span class="auto-cascade-icon">💾</span><span class="auto-cascade-name">${this.escapeHtml(obj)}</span><span class="auto-cascade-depth">${objOps.length} op${objOps.length !== 1 ? 's' : ''}</span>
                        </div></div>
                        <div class="auto-cascade-secondary">
                            ${objOps.map(op => `<div class="auto-cascade-secondary-item"><span class="auto-cascade-arrow">→</span><strong>${this.escapeHtml(op.operation)}</strong> — ${op.rowCount} row${op.rowCount !== 1 ? 's' : ''}${op.inferred ? ' <span class="auto-beta-badge">Inferred</span>' : ''}${op.logLine ? ` <span class="auto-log-jump" data-log-line="${op.logLine}" title="View in log">&#128269;</span>` : ''}</div>`).join('')}
                        </div>
                    </div>
                `).join('')}

                ${r.recordsAffected?.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 20px;"><h3 class="auto-section-title">Affected Records<span class="auto-beta-badge">Beta</span></h3><span class="auto-section-count">${r.recordsAffected.reduce((sum, ra) => sum + ra.records.length, 0)} record(s)</span></div>
                    ${r.recordsAffected.map(ra => `
                        <div class="auto-cascade-card">
                            <div class="auto-cascade-header"><div class="auto-cascade-object">
                                <span class="auto-cascade-icon">📋</span><span class="auto-cascade-name">${this.escapeHtml(ra.objectType)}</span><span class="auto-cascade-depth">${this.escapeHtml(ra.operation)}</span>${ra.matchQuality ? `<span class="auto-match-quality quality-${ra.matchQuality}">${ra.matchQuality}</span>` : ''}
                            </div></div>
                            <div class="auto-cascade-secondary">
                                ${ra.records.map(rec => `
                                    <div class="auto-cascade-secondary-item auto-record-link" data-record-id="${this.escapeHtml(rec.Id)}">
                                        <span class="auto-cascade-arrow">→</span>
                                        <span class="auto-record-name">${this.escapeHtml(rec.Name)}</span>
                                        <span class="auto-record-id">${this.escapeHtml(rec.Id)}</span>
                                    </div>
                                    ${(ra.fieldChanges || []).filter(fc => fc.recordId === rec.Id).map(fc => `
                                        <div class="auto-field-change">
                                            <span class="auto-field-name">${this.escapeHtml(fc.field)}</span>
                                            <span class="auto-field-old">${fc.oldValue != null ? this.escapeHtml(String(fc.oldValue)) : '<em>null</em>'}</span>
                                            <span class="auto-field-arrow">&rarr;</span>
                                            <span class="auto-field-new">${fc.newValue != null ? this.escapeHtml(String(fc.newValue)) : '<em>null</em>'}</span>
                                        </div>
                                    `).join('')}
                                    ${rec.fieldsSet?.length > 0 ? `
                                        <div class="auto-fields-toggle">
                                            <span class="auto-toggle-icon">▶</span>
                                            <span class="auto-fields-label">Fields Set (${rec.fieldsSet.length})<span class="auto-beta-badge">Beta</span></span>
                                        </div>
                                        <div class="auto-fields-detail collapsed">
                                            ${rec.fieldsSet.map(fs => `
                                                <div class="auto-field-set-row">
                                                    <span class="auto-field-set-name">${this.escapeHtml(fs.label)}</span>
                                                    <span class="auto-field-set-eq">=</span>
                                                    <span class="auto-field-set-val">${this.escapeHtml(fs.value)}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                    ${rec.currentFields?.length > 0 ? `
                                        <div class="auto-fields-toggle">
                                            <span class="auto-toggle-icon">▶</span>
                                            <span class="auto-fields-label">Current Values (${rec.currentFields.length})<span class="auto-beta-badge">Beta</span></span>
                                        </div>
                                        <div class="auto-fields-detail collapsed">
                                            ${rec.currentFields.map(cf => `
                                                <div class="auto-field-set-row">
                                                    <span class="auto-field-set-name">${this.escapeHtml(cf.label)}</span>
                                                    <span class="auto-field-set-eq">=</span>
                                                    <span class="auto-field-set-val">${this.escapeHtml(cf.value)}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                ` : ops.length > 0 && !(r.recordsAffected?.length) ? `
                    <div style="margin-top: 16px; color: #666; font-size: 12px; padding: 8px;">Loading affected records...</div>
                ` : ''}
            </div>
        `;
    },

    renderLiveTraceSoql() {
        const queries = this.liveTraceResult.soqlQueries || [];
        if (queries.length === 0) return `<div class="auto-empty-tab"><p>No SOQL queries detected in this log.</p></div>`;

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header"><h3 class="auto-section-title">SOQL Queries</h3><span class="auto-section-count">${queries.length} quer${queries.length !== 1 ? 'ies' : 'y'} (${this.liveTraceResult.stats.totalSoqlRows} rows)</span>${(this.liveTraceResult.soqlCostSignals || []).length > 0 ? `<span class="auto-soql-cost-count">${this.liveTraceResult.soqlCostSignals.length} flagged</span>` : ''}</div>
                <div class="auto-preflight-table">
                    <div class="auto-table-header">
                        <span class="auto-table-col" style="width: 30px;">#</span>
                        <span class="auto-table-col" style="flex: 1;">Query</span>
                        <span class="auto-table-col" style="width: 45px;">Line</span>
                        <span class="auto-table-col" style="width: 45px;">Rows</span>
                        <span class="auto-table-col" style="width: 30px;"></span>
                    </div>
                    ${queries.map((q, i) => {
                        const costSignal = (this.liveTraceResult.soqlCostSignals || []).find(cs => cs.query === q.query);
                        return `
                        <div class="auto-table-row ${costSignal ? 'auto-soql-flagged' : ''}">
                            <span class="auto-table-col" style="width: 30px; color: #888;">${i + 1}</span>
                            <span class="auto-table-col wrap" style="flex: 1; font-family: monospace; font-size: 11px;">${this.escapeHtml(q.query)}${costSignal ? `<span class="auto-soql-cost">${costSignal.signals.map(s => this.escapeHtml(s)).join(' · ')}</span>` : ''}</span>
                            <span class="auto-table-col" style="width: 45px; color: #888;">${q.lineNumber || '—'}</span>
                            <span class="auto-table-col" style="width: 45px; color: #aaa;">${q.rowCount !== undefined ? q.rowCount : '—'}</span>
                            <span class="auto-table-col" style="width: 30px;">${q.logLine ? `<span class="auto-log-jump" data-log-line="${this.escapeHtml(String(q.logLine))}" title="View in log">&#128269;</span>` : ''}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    },

    renderLiveTraceLimits() {
        const gl = this.liveTraceResult.governorLimits || {};
        if (Object.keys(gl).length === 0) return `<div class="auto-empty-tab"><p>No governor limit data found in this log. Ensure the debug level includes System logging.</p></div>`;

        const logCount = this.liveTraceResult.allLogIds?.length || 1;
        const labels = { soqlQueries: 'SOQL Queries', dmlStatements: 'DML Statements', cpuTime: 'CPU Time (ms)', heapSize: 'Heap Size (bytes)', dmlRows: 'DML Rows', soqlRows: 'Query Rows', callouts: 'Callouts', futureCalls: 'Future Calls', queueableJobs: 'Queueable Jobs', emailInvocations: 'Email Invocations' };
        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Governor Limits Usage</h3>
                    ${logCount > 1 ? `<span style="font-size:11px;color:#888;margin-left:8px;">worst single transaction of ${logCount}</span>` : ''}
                </div>
                <div class="auto-governor-bars" style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
                    ${Object.entries(gl).map(([key, val]) => this._renderGovernorBar(labels[key] || key, val)).join('')}
                </div>
            </div>
        `;
    },

    renderLiveTraceDebug() {
        const r = this.liveTraceResult;
        const exceptions = r.exceptions || [];
        const debugLines = r.userDebug || [];
        if (exceptions.length === 0 && debugLines.length === 0) return `<div class="auto-empty-tab"><p>No debug output or exceptions in this log.</p></div>`;

        return `
            <div class="auto-exec-order">
                ${exceptions.length > 0 ? `
                    <div class="auto-section-header"><h3 class="auto-section-title">Exceptions</h3><span class="auto-section-count" style="color: #e74c3c;">${exceptions.length}</span></div>
                    ${exceptions.map(ex => {
                        const color = ex.isFatal ? '#e74c3c' : ex.isLimitException ? '#9b59b6' : '#f39c12';
                        return `
                        <div class="auto-phase-card" style="--phase-color: ${color}; margin-bottom: 6px;">
                            <div class="auto-automation-item" style="padding: 8px 12px; flex-wrap: wrap; gap: 4px;">
                                <span class="auto-automation-icon">${ex.isFatal ? '💀' : ex.isLimitException ? '🚫' : '⚠'}</span>
                                <span class="auto-automation-name">${this.escapeHtml(ex.type)}</span>
                                ${ex.isFatal ? `<span class="auto-ex-badge auto-ex-badge--fatal">FATAL</span>` : ''}
                                ${ex.isLimitException ? `<span class="auto-ex-badge auto-ex-badge--limit">GOVERNOR LIMIT</span>` : ''}
                                ${ex.lineNumber ? `<span class="auto-automation-events">line ${ex.lineNumber}</span>` : ''}
                                ${ex.codeUnit ? `<span class="auto-automation-events" style="color:#8fa8c8;margin-left:auto;">↳ ${this.escapeHtml(ex.codeUnit)}</span>` : ''}
                            </div>
                            <div style="padding: 4px 12px 8px 36px; color: #ccc; font-size: 12px; font-family: monospace; word-break: break-all;">${this.escapeHtml(ex.message)}</div>
                        </div>`;
                    }).join('')}
                ` : ''}

                ${debugLines.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: ${exceptions.length > 0 ? '16px' : '0'};"><h3 class="auto-section-title">System.debug() Output</h3><span class="auto-section-count">${debugLines.length} line(s)</span></div>
                    <div class="auto-preflight-table">
                        <div class="auto-table-header">
                            <span class="auto-table-col" style="width: 45px;">Line</span>
                            <span class="auto-table-col" style="width: 55px;">Level</span>
                            <span class="auto-table-col" style="flex: 1;">Message</span>
                        </div>
                        ${debugLines.map(d => `
                            <div class="auto-table-row">
                                <span class="auto-table-col" style="width: 45px; color: #888;">${d.lineNumber}</span>
                                <span class="auto-table-col" style="width: 55px;"><span style="padding: 1px 5px; border-radius: 3px; font-size: 10px; background: ${d.level === 'ERROR' ? 'rgba(231,76,60,0.2)' : d.level === 'WARN' ? 'rgba(243,156,18,0.2)' : 'rgba(52,152,219,0.15)'}; color: ${d.level === 'ERROR' ? '#e74c3c' : d.level === 'WARN' ? '#f39c12' : '#3498db'};">${d.level}</span></span>
                                <span class="auto-table-col wrap" style="flex: 1; font-family: monospace; font-size: 11px; color: #ccc;">${this.escapeHtml(d.message)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    },

    renderLiveTraceValidations() {
        const vals = this.liveTraceResult.validations || [];
        const dups = this.liveTraceResult.duplicateRules || [];
        if (vals.length === 0 && dups.length === 0) {
            return `<div class="auto-empty-tab"><div class="auto-empty-tab-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg></div><p>No validation or duplicate rules evaluated in this log.</p></div>`;
        }
        return `
            <div class="auto-exec-order">
                ${vals.length > 0 ? `
                    <div class="auto-section-header"><h3 class="auto-section-title">Validation Rules</h3><span class="auto-section-count">${vals.length} rule${vals.length !== 1 ? 's' : ''}</span></div>
                    ${vals.map(v => `
                        <div class="auto-phase-card" style="--phase-color: ${v.outcome === 'FAIL' ? '#e74c3c' : '#2ecc71'}; margin-bottom: 6px;">
                            <div class="auto-automation-item" style="padding: 8px 12px;">
                                <span class="auto-automation-icon">${v.outcome === 'FAIL' ? '✗' : '✓'}</span>
                                <span class="auto-automation-name">${this.escapeHtml(v.ruleName)}</span>
                                <span class="auto-risk-badge" style="--risk-color: ${v.outcome === 'FAIL' ? '#e74c3c' : '#2ecc71'}; font-size: 11px; padding: 2px 8px;"><span class="auto-risk-dot"></span>${v.outcome}</span>
                            </div>
                        </div>
                    `).join('')}
                ` : ''}
                ${dups.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: ${vals.length > 0 ? '16px' : '0'};"><h3 class="auto-section-title">Duplicate Rules</h3><span class="auto-section-count">${dups.length} rule${dups.length !== 1 ? 's' : ''}</span></div>
                    ${dups.map(d => {
                        const color = d.outcome === 'DUPLICATES_FOUND' ? '#e67e22' : '#2ecc71';
                        const label = d.outcome === 'DUPLICATES_FOUND' ? `${d.duplicatesFound} duplicate(s)` : 'Clean';
                        return `
                            <div class="auto-phase-card" style="--phase-color: ${color}; margin-bottom: 6px;">
                                <div class="auto-automation-item" style="padding: 8px 12px;">
                                    <span class="auto-automation-icon">${d.outcome === 'DUPLICATES_FOUND' ? '⚠' : '✓'}</span>
                                    <span class="auto-automation-name">${this.escapeHtml(d.ruleName)}</span>
                                    ${d.action ? `<span class="auto-automation-events">${this.escapeHtml(d.action)}</span>` : ''}
                                    <span class="auto-risk-badge" style="--risk-color: ${color}; font-size: 11px; padding: 2px 8px;"><span class="auto-risk-dot"></span>${label}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                ` : ''}
            </div>
        `;
    },

    renderLiveTraceTiming() {
        const timings = this.liveTraceResult.codeUnitTimings || [];
        if (timings.length === 0) return `<div class="auto-empty-tab"><p>No code unit timing data found in this log.</p></div>`;

        // Group by name, sum durations, sort slowest first
        const grouped = {};
        timings.forEach(t => {
            if (!grouped[t.name]) grouped[t.name] = { name: t.name, totalMs: 0, count: 0 };
            grouped[t.name].totalMs += parseFloat(t.durationMs);
            grouped[t.name].count++;
        });
        const sorted = Object.values(grouped).sort((a, b) => b.totalMs - a.totalMs);
        const maxMs = sorted[0]?.totalMs || 1;

        return `
            <div class="auto-exec-order">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Code Unit Timings</h3>
                    <span class="auto-section-count">${sorted.length} unit${sorted.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="auto-preflight-table">
                    <div class="auto-table-header">
                        <span class="auto-table-col" style="flex: 1;">Code Unit</span>
                        <span class="auto-table-col" style="width: 110px;">Duration</span>
                    </div>
                    ${sorted.map(t => {
                        const color = t.totalMs > 1000 ? '#e74c3c' : t.totalMs > 100 ? '#f39c12' : '#2ecc71';
                        const barPct = Math.max(2, Math.round((t.totalMs / maxMs) * 100));
                        return `
                        <div class="auto-table-row">
                            <span class="auto-table-col wrap" style="flex: 1; font-family: monospace; font-size: 11px;">${this.escapeHtml(t.name)}${t.count > 1 ? ` <span style="color:#888;font-size:10px;">×${t.count}</span>` : ''}</span>
                            <span class="auto-table-col" style="width: 110px; font-family: monospace; color: ${color}; display:flex; align-items:center; gap:6px;">
                                <span style="display:inline-block;height:4px;width:${barPct * 0.6}px;max-width:60px;background:${color};border-radius:2px;opacity:0.7;flex-shrink:0;"></span>
                                ${t.totalMs.toFixed(2)}ms
                            </span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    },

    renderLiveTraceComparison() {
        const r = this.liveTraceResult;
        const c = this.comparisonTrace;
        if (!r || !c) return `<div class="auto-empty-tab"><p>No comparison trace selected.</p></div>`;
        const cs = c.result.stats || {};
        const rs = r.stats || {};

        const diff = (cur, base) => {
            const d = cur - base;
            return d === 0 ? `<span style="color:#888;">—</span>` : d > 0 ? `<span style="color:#e74c3c;">+${d}</span>` : `<span style="color:#2ecc71;">${d}</span>`;
        };

        const shapeMatch = r.transactionFingerprint?.hash === c.fingerprint;

        // Find new/removed automations
        const curAutoNames = new Set((r.automations || []).map(a => a.name));
        const baseAutoNames = new Set((c.result.automations || []).map(a => a.name));
        const newAutos = [...curAutoNames].filter(n => !baseAutoNames.has(n));
        const removedAutos = [...baseAutoNames].filter(n => !curAutoNames.has(n));

        return `
            <div class="auto-overview">
                <div class="auto-section-header">
                    <h3 class="auto-section-title">Comparison: Current vs "${this.escapeHtml(c.label)}"</h3>
                    <span class="auto-section-count">${c.timestamp?.replace('T', ' ').slice(0, 19)}</span>
                </div>

                <div class="auto-comparison-shape" style="margin: 12px 0; padding: 8px 12px; border-radius: 6px; background: ${shapeMatch ? 'rgba(46,204,113,0.08)' : 'rgba(243,156,18,0.08)'}; border: 1px solid ${shapeMatch ? 'rgba(46,204,113,0.3)' : 'rgba(243,156,18,0.3)'};">
                    <span style="font-size: 12px; color: ${shapeMatch ? '#2ecc71' : '#f39c12'};">
                        ${shapeMatch ? '✓ Same transaction shape' : '⚠ Different transaction shape'}
                    </span>
                </div>

                <div class="auto-preflight-table">
                    <div class="auto-table-header">
                        <span class="auto-table-col" style="flex: 1;">Metric</span>
                        <span class="auto-table-col" style="width: 80px;">Current</span>
                        <span class="auto-table-col" style="width: 80px;">Baseline</span>
                        <span class="auto-table-col" style="width: 60px;">Diff</span>
                    </div>
                    ${[
                        ['Automations', rs.totalAutomations, cs.totalAutomations],
                        ['DML Ops', rs.totalDml, cs.totalDml],
                        ['SOQL Queries', rs.totalSoql, cs.totalSoql],
                        ['Exceptions', rs.totalExceptions, cs.totalExceptions],
                        ['Validation Fails', rs.totalValidationFails, cs.totalValidationFails],
                        ['Callouts', rs.totalCallouts, cs.totalCallouts],
                        ['Blast Radius', rs.blastRadius || 0, cs.blastRadius || 0],
                    ].map(([label, cur, base]) => `
                        <div class="auto-table-row">
                            <span class="auto-table-col" style="flex: 1;">${label}</span>
                            <span class="auto-table-col" style="width: 80px; font-family: monospace;">${cur}</span>
                            <span class="auto-table-col" style="width: 80px; font-family: monospace;">${base}</span>
                            <span class="auto-table-col" style="width: 60px; font-family: monospace;">${diff(cur, base)}</span>
                        </div>
                    `).join('')}
                </div>

                ${newAutos.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h4 class="auto-section-subtitle">New Automations</h4></div>
                    ${newAutos.map(n => `<div class="auto-phase-card" style="--phase-color: #2ecc71; margin-bottom: 4px;"><div class="auto-automation-item" style="padding: 6px 12px;"><span style="color: #2ecc71;">+ ${this.escapeHtml(n)}</span></div></div>`).join('')}
                ` : ''}

                ${removedAutos.length > 0 ? `
                    <div class="auto-section-header" style="margin-top: 16px;"><h4 class="auto-section-subtitle">Removed Automations</h4></div>
                    ${removedAutos.map(n => `<div class="auto-phase-card" style="--phase-color: #e74c3c; margin-bottom: 4px;"><div class="auto-automation-item" style="padding: 6px 12px;"><span style="color: #e74c3c;">- ${this.escapeHtml(n)}</span></div></div>`).join('')}
                ` : ''}

                ${newAutos.length === 0 && removedAutos.length === 0 ? `
                    <p style="color: #888; font-size: 12px; margin-top: 12px;">No automation changes detected.</p>
                ` : ''}
            </div>
        `;
    },

    _renderGovernorBar(label, val, risk) {
        const pct = Math.min((val.used / val.limit) * 100, 100);
        const color = pct > 80 ? '#e74c3c' : pct > 50 ? '#f39c12' : '#2ecc71';
        return `
            <div class="auto-governor-bar-item">
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
                    <span style="color: #ccc;">${this.escapeHtml(label)}${risk && risk !== 'low' ? ` <span class="auto-limit-risk risk-${risk}">⚠ ${risk} risk</span>` : ''}</span>
                    <span style="color: ${color}; font-family: monospace;">${val.used} / ${val.limit}</span>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 3px; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
    },

    // ─── Helpers ─────────────────────────────────────────────
    escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

// ─── Export & Init ──────────────────────────────────────────
window.AutomationInspector = AutomationInspector;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AutomationInspector.init());
} else {
    AutomationInspector.init();
}
