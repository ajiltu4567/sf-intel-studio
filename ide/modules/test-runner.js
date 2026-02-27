/**
 * SF-Intel Studio - Test Runner Module (v2.0)
 * Enterprise-grade test execution with polished UI.
 */

// --- SVG Icon Constants ---
const TEST_ICONS = {
    pass: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.22 4.22a.75.75 0 00-1.06 0L7 8.38 5.84 7.22a.75.75 0 10-1.06 1.06l1.7 1.7a.75.75 0 001.06 0l3.68-3.7a.75.75 0 000-1.06z"/></svg>',
    fail: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm2.16 4.22a.75.75 0 00-1.06 0L8 6.32 6.9 5.22a.75.75 0 10-1.06 1.06L6.94 7.4 5.84 8.5a.75.75 0 101.06 1.06L8 8.44l1.1 1.12a.75.75 0 101.06-1.06L9.06 7.4l1.1-1.12a.75.75 0 000-1.06z"/></svg>',
    pending: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    running: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="test-icon-spin"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z" opacity="0.2"/><path d="M8 0a8 8 0 018 8h-1.5A6.5 6.5 0 008 1.5V0z"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2a.5.5 0 00-.5.5V5h-2.5a.5.5 0 000 1H14a.5.5 0 00.5-.5v-3a.5.5 0 00-.5-.5z"/><path d="M12.76 4.05A5.5 5.5 0 002.05 8a.5.5 0 01-1 0 6.5 6.5 0 0112.66-2.12l.05.17z"/><path d="M2.5 14a.5.5 0 00.5-.5V11h2.5a.5.5 0 000-1H2a.5.5 0 00-.5.5v3a.5.5 0 00.5.5z"/><path d="M3.24 11.95A5.5 5.5 0 0013.95 8a.5.5 0 011 0 6.5 6.5 0 01-12.66 2.12l-.05-.17z"/></svg>',
    play: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5v11l9-5.5-9-5.5z"/></svg>',
    timer: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM2 8a6 6 0 1112 0A6 6 0 012 8z"/><path d="M8 5a.5.5 0 01.5.5V8h2a.5.5 0 010 1H8a.5.5 0 01-.5-.5v-3A.5.5 0 018 5z"/><path d="M6.5 1h3v1.5h-3V1z"/></svg>',
    beaker: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.5L5 19h14l-5-9.5V3"/><path d="M7 15h10" opacity="0.5"/></svg>',
    beakerSmall: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.5L5 19h14l-5-9.5V3"/></svg>',
    playLarge: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>',
    coverage: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 11H2v3h2v-3zm5-4H7v7h2V7zm5-5h-2v12h2V2z"/></svg>',
    impact: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v4M8 11v4M1 8h4M11 8h4" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="8" cy="8" r="2.5"/></svg>',
    results: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2zm0 3h8v1H2zm0 3h10v1H2zm0 3h6v1H2z"/></svg>',
};

const TestRunner = {
    testClasses: [],
    selectedClassId: null,
    testHistory: new Map(),
    coveredClassIds: new Set(),
    activeJobId: null,
    isRunning: false,
    activeTab: 'results',
    state: 'IDLE',
    filter: '',
    _runStartTime: null,
    _runTimer: null,
    _discoveredSoFar: 0,

    async init() {
        console.log('[TestRunner] Initializing...');
        await this.loadTestClasses();
        window.renderTestSuite = () => this.render();
        window.runSelectedTests = () => this.runSelected();
    },

    async loadTestClasses() {
        if (!window.apiClient) return;
        try {
            this.state = 'LOADING';
            this._discoveredSoFar = 0;
            if (window.Terminal) window.Terminal.log('Starting intelligent test discovery...');

            const query = "SELECT Id, Name, LastModifiedDate FROM ApexClass ORDER BY Name";
            const result = await window.apiClient.toolingQuery(query);
            const candidates = result.records || [];

            this.testClasses = [];

            const batchSize = 100;
            for (let i = 0; i < candidates.length; i += batchSize) {
                const batch = candidates.slice(i, i + batchSize);
                const ids = batch.map(c => `'${c.Id}'`).join(',');

                const bodyResult = await window.apiClient.toolingQuery(`SELECT Id, Body FROM ApexClass WHERE Id IN (${ids})`);
                const bodies = bodyResult.records || [];
                const bodyMap = new Map(bodies.map(b => [b.Id, b.Body]));

                batch.forEach(c => {
                    const body = bodyMap.get(c.Id) || '';
                    if (this.isTestClass(body)) {
                        this.testClasses.push(c);
                    }
                });

                this._discoveredSoFar = this.testClasses.length;
                if (this.isPanelOpen()) {
                    this.renderList();
                }
            }

            this.state = 'IDLE';
            if (window.Terminal) window.Terminal.success(`Discovery complete. Identified ${this.testClasses.length} test classes.`);
        } catch (error) {
            this.state = 'FAILED';
            console.error('[TestRunner] Discovery failed:', error);
            if (window.Terminal) window.Terminal.error(`Discovery Error: ${error.message}`);
        }
    },

    isTestClass(body) {
        if (!body) return false;
        const cleanBody = body.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        return /@isTest/i.test(cleanBody);
    },

    isPanelOpen() {
        const container = document.getElementById('utility-view-container');
        return container && container.innerHTML.includes('test-runner-shell');
    },

    // --- Helpers ---

    _relativeTime(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 30) return `${days}d ago`;
        return `${Math.floor(days / 30)}mo ago`;
    },

    _formatDuration(ms) {
        if (ms == null) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    },

    _getListStats() {
        let pass = 0, fail = 0;
        this.testClasses.forEach(c => {
            const history = this.testHistory.get(c.LastJobId);
            if (history) {
                if (history.failed > 0) fail++;
                else pass++;
            }
        });
        return { total: this.testClasses.length, pass, fail };
    },

    // --- Rendering ---

    render() {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        const header = document.getElementById('utility-header');
        if (header) header.style.display = 'none';

        const stats = this._getListStats();

        container.style.display = 'flex';
        container.innerHTML = `
            <div class="test-runner-shell">
                <div class="test-list-pane">
                    <div class="test-list-toolbar">
                        <div class="test-search-wrap">
                            <span class="test-search-icon">${TEST_ICONS.search}</span>
                            <input type="text" id="test-search" placeholder="Filter tests..." value="${this.filter}">
                        </div>
                        <button id="test-refresh-btn" class="test-toolbar-btn" title="Refresh test list">${TEST_ICONS.refresh}</button>
                    </div>
                    <div class="test-list-summary">
                        <span class="summary-total">${stats.total} tests</span>
                        ${stats.pass > 0 ? `<span class="summary-pass">${stats.pass} pass</span>` : ''}
                        ${stats.fail > 0 ? `<span class="summary-fail">${stats.fail} fail</span>` : ''}
                    </div>
                    <div class="test-class-scroll" id="test-list-scroll">
                        ${this.renderListItems()}
                    </div>
                </div>
                <div class="test-detail-pane" id="test-detail-pane">
                    ${this.renderDetails()}
                </div>
            </div>
        `;

        this.bindEvents();
    },

    renderList() {
        const scroll = document.getElementById('test-list-scroll');
        if (scroll) {
            scroll.innerHTML = this.renderListItems();
            this.bindListEvents();
        }
        // Update summary
        const summaryEl = document.querySelector('.test-list-summary');
        if (summaryEl) {
            const stats = this._getListStats();
            summaryEl.innerHTML = `
                <span class="summary-total">${stats.total} tests</span>
                ${stats.pass > 0 ? `<span class="summary-pass">${stats.pass} pass</span>` : ''}
                ${stats.fail > 0 ? `<span class="summary-fail">${stats.fail} fail</span>` : ''}
            `;
        }
    },

    renderListItems() {
        const filterStr = this.filter.toLowerCase();
        const filtered = this.testClasses.filter(c => c.Name.toLowerCase().includes(filterStr));

        if (filtered.length === 0) {
            if (this.state === 'LOADING') {
                return `
                    <div class="test-discovering">
                        <span class="test-icon-spin">${TEST_ICONS.running}</span>
                        <span>Discovering tests...</span>
                        ${this._discoveredSoFar > 0 ? `<span class="discovering-count">Found ${this._discoveredSoFar} so far</span>` : ''}
                    </div>
                `;
            }
            return `<div class="test-empty-list">No test classes found</div>`;
        }

        return filtered.map(c => {
            const history = this.testHistory.get(c.LastJobId);
            const status = history ? (history.failed > 0 ? 'fail' : 'pass') : 'pending';
            const isSelected = this.selectedClassId === c.Id;

            const modified = new Date(c.LastModifiedDate);
            const isRecent = (Date.now() - modified.getTime()) < (2 * 60 * 60 * 1000);
            const relTime = this._relativeTime(c.LastModifiedDate);

            const statusIcon = status === 'pass' ? TEST_ICONS.pass :
                               status === 'fail' ? TEST_ICONS.fail : TEST_ICONS.pending;

            return `
                <div class="test-class-row ${isSelected ? 'selected' : ''}" data-id="${c.Id}">
                    <span class="test-row-icon ${status}">${statusIcon}</span>
                    <div class="test-row-info">
                        <span class="test-row-name">${_escapeHtml(c.Name)}</span>
                        <span class="test-row-meta">${relTime}</span>
                    </div>
                    <div class="test-row-badges">
                        ${isRecent ? '<span class="badge modified">MODIFIED</span>' : ''}
                        ${c.coverage != null ? `<span class="badge coverage ${this.getCoverageClass(c.coverage)}">${c.coverage}%</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderDetails() {
        if (!this.selectedClassId) {
            return `
                <div class="test-empty-state">
                    ${TEST_ICONS.beaker}
                    <div class="empty-title">Select a Test Class</div>
                    <div class="empty-desc">Choose from the list to view results and run tests</div>
                </div>
            `;
        }

        const cls = this.testClasses.find(c => c.Id === this.selectedClassId);
        if (!cls) return '';

        const history = this.testHistory.get(cls.LastJobId);

        // Build status pill
        let statusPill = '';
        if (history) {
            const total = history.methods.length;
            const passed = total - history.failed;
            if (history.failed > 0) {
                statusPill = `<span class="test-detail-status fail">${passed} Passed, ${history.failed} Failed</span>`;
            } else {
                statusPill = `<span class="test-detail-status pass">${total}/${total} Passed</span>`;
            }
        }

        return `
            <div class="test-detail-header">
                <div class="test-detail-title">
                    ${TEST_ICONS.beakerSmall}
                    <span class="test-class-name">${_escapeHtml(cls.Name)}</span>
                </div>
                ${statusPill}
            </div>
            <div class="test-tabs">
                <div class="test-tab ${this.activeTab === 'results' ? 'active' : ''}" data-tab="results">
                    ${TEST_ICONS.results}<span>Results</span>
                </div>
                <div class="test-tab ${this.activeTab === 'coverage' ? 'active' : ''}" data-tab="coverage">
                    ${TEST_ICONS.coverage}<span>Coverage</span>
                </div>
                <div class="test-tab ${this.activeTab === 'impact' ? 'active' : ''}" data-tab="impact">
                    ${TEST_ICONS.impact}<span>Impact</span>
                </div>
                <div class="test-tab-actions">
                    <button id="run-selected-btn" class="test-run-btn ${this.isRunning ? 'running' : ''}" ${this.isRunning ? 'disabled' : ''}>
                        ${this.isRunning ? TEST_ICONS.running : TEST_ICONS.play}
                        <span>${this.isRunning ? 'RUNNING' : 'RUN'}</span>
                    </button>
                </div>
            </div>
            <div class="test-tab-content">
                ${this.renderTabContent(cls, history)}
            </div>
        `;
    },

    renderTabContent(cls, history) {
        if (this.isRunning) {
            return `
                <div class="test-running-view">
                    <div class="running-ring"></div>
                    <div class="running-class">${_escapeHtml(cls.Name)}</div>
                    <div class="running-status">Executing tests...</div>
                    <div class="running-elapsed" id="test-elapsed">0s</div>
                </div>
            `;
        }

        if (!history) {
            return `
                <div class="test-no-data">
                    ${TEST_ICONS.playLarge}
                    <div class="no-data-title">No Results Yet</div>
                    <div class="no-data-desc">Click Run to execute this test class</div>
                </div>
            `;
        }

        if (this.activeTab === 'results') {
            const passed = history.methods.length - history.failed;
            const durationStr = history.duration ? this._formatDuration(history.duration) : '';

            return `
                <div class="test-results-summary">
                    <div class="summary-card pass">
                        <span class="summary-card-icon pass">${TEST_ICONS.pass}</span>
                        <span class="summary-card-value">${passed} Passed</span>
                    </div>
                    ${history.failed > 0 ? `
                        <div class="summary-card fail">
                            <span class="summary-card-icon fail">${TEST_ICONS.fail}</span>
                            <span class="summary-card-value">${history.failed} Failed</span>
                        </div>
                    ` : ''}
                    ${durationStr ? `
                        <div class="summary-card time">
                            ${TEST_ICONS.timer}
                            <span class="summary-card-value">${durationStr}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="test-results-list">
                    ${history.methods.map(m => {
                        const isPass = m.Outcome !== 'Fail';
                        const dur = m.RunTime != null ? this._formatDuration(m.RunTime) : '';
                        return `
                            <div class="test-method-row ${isPass ? 'pass' : 'fail'}">
                                <span class="method-icon ${isPass ? 'pass' : 'fail'}">${isPass ? TEST_ICONS.pass : TEST_ICONS.fail}</span>
                                <div class="method-info">
                                    <span class="method-name">${_escapeHtml(m.MethodName)}</span>
                                    ${dur ? `<span class="method-duration">${dur}</span>` : ''}
                                </div>
                                <span class="method-outcome ${isPass ? 'pass' : 'fail'}">${_escapeHtml(m.Outcome.toUpperCase())}</span>
                            </div>
                            ${!isPass ? `
                                <div class="method-error-wrap">
                                    ${m.Message ? `<div class="method-error-msg">${_escapeHtml(m.Message)}</div>` : ''}
                                    ${m.StackTrace ? `<div class="method-error-stack">${_escapeHtml(m.StackTrace)}</div>` : ''}
                                </div>
                            ` : ''}
                        `;
                    }).join('')}
                    ${history.methods.length === 0 ? '<div class="test-empty-list">No methods found in results</div>' : ''}
                </div>
            `;
        }

        if (this.activeTab === 'coverage') {
            return `
                <div class="cov-grid">
                    <div class="cov-grid-header">
                        <span>Exercised Class</span>
                        <span>Trust</span>
                        <span class="cov-stat-cell">COVERED</span>
                        <span class="cov-stat-cell">UNCOVERED</span>
                        <span class="cov-stat-cell">COVERAGE</span>
                    </div>
                    <div class="cov-grid-body">
                    ${history.coverage.map(c => {
                        const total = c.covered + c.uncovered;
                        const pct = total === 0 ? 0 : Math.round((c.covered / total) * 100);
                        const isPartial = c.covered > 0 && c.uncovered === 0 && pct < 100;
                        const badgeClass = isPartial ? 'partial' : (this.lastTestRunId ? 'scoped' : 'aggregate');
                        const badgeLabel = isPartial ? 'PARTIAL' : (this.lastTestRunId ? 'SCOPED' : 'AGGREGATE');
                        const progressClass = pct >= 90 ? 'high' : (pct >= 75 ? 'medium' : 'low');

                        return `
                            <div class="cov-grid-row cov-drilldown" data-id="${_escapeHtml(c.Id)}" data-name="${_escapeHtml(c.Name)}">
                                <span class="class-name">${_escapeHtml(c.Name)}</span>
                                <span><span class="test-cov-badge ${badgeClass}">${badgeLabel}</span></span>
                                <span class="cov-stat-cell cvred-text">${c.covered}</span>
                                <span class="cov-stat-cell uncvred-text">${c.uncovered}</span>
                                <div class="cov-pct-cell">
                                    <span class="${this.getCoverageClass(pct)}">${pct}%</span>
                                    <div class="cov-progress-container">
                                        <div class="cov-progress-bar ${progressClass}" style="width: ${pct}%"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    </div>
                    <div class="cov-grid-footer">
                        <span>${this.lastTestRunId ? 'Showing fresh results for this run.' : 'Showing org-wide aggregate coverage.'}</span>
                        ${history.coverage.some(c => c.covered > 0 && c.uncovered === 0 && Math.round((c.covered / (c.covered + c.uncovered)) * 100) < 100) ?
                            '<span class="cov-partial-warn">Partial data detected</span>' : ''}
                    </div>
                </div>
            `;
        }

        if (this.activeTab === 'impact') {
            return `
                <div class="impact-view">
                    <div class="impact-header">
                        Impacted Dependencies (${history.coverage.length})
                    </div>
                    <div class="impact-list">
                        ${history.coverage.map(c => `
                            <div class="impact-row cov-drilldown" data-id="${c.Id}" data-name="${c.Name}">
                                <div class="impact-row-info">
                                    <span class="impact-arrow">&#8627;</span>
                                    <span class="class-name">${c.Name}</span>
                                </div>
                                <div class="cov-pct-cell compact">
                                    <span class="${this.getCoverageClass(c.pct)}">${c.pct}%</span>
                                    <div class="cov-progress-container compact">
                                        <div class="cov-progress-bar ${c.pct >= 90 ? 'high' : (c.pct >= 75 ? 'medium' : 'low')}" style="width: ${c.pct}%"></div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                        ${history.coverage.length === 0 ? '<div class="test-empty-list">No external class dependencies detected for this run</div>' : ''}
                    </div>
                    <div class="impact-footer">
                        Impact analysis shows which classes were exercised during the last test execution.
                    </div>
                </div>
            `;
        }

        return '';
    },

    getCoverageClass(pct) {
        if (pct >= 80) return 'high';
        if (pct >= 50) return 'mid';
        return 'low';
    },

    // --- Event Binding ---

    bindEvents() {
        this.bindListEvents();

        const search = document.getElementById('test-search');
        if (search) {
            search.oninput = (e) => {
                this.filter = e.target.value;
                this.renderList();
            };
        }

        const refreshBtn = document.getElementById('test-refresh-btn');
        if (refreshBtn) {
            refreshBtn.onclick = () => this.loadTestClasses();
        }

        const runBtn = document.getElementById('run-selected-btn');
        if (runBtn) {
            runBtn.onclick = () => this.runSelected();
        }

        const tabs = document.querySelectorAll('.test-tab[data-tab]');
        tabs.forEach(tab => {
            tab.onclick = () => {
                this.activeTab = tab.dataset.tab;
                this.renderDetailsPane();
            };
        });

        const drilldowns = document.querySelectorAll('.cov-drilldown');
        drilldowns.forEach(d => {
            d.onclick = () => this.openClassWithCoverage(d.dataset.id, d.dataset.name);
        });
    },

    bindListEvents() {
        const rows = document.querySelectorAll('.test-class-row');
        rows.forEach(row => {
            row.onclick = () => this.selectClass(row.dataset.id);
        });
    },

    renderDetailsPane() {
        const pane = document.getElementById('test-detail-pane');
        if (pane) {
            pane.innerHTML = this.renderDetails();
            this.bindEvents();
        }
    },

    async selectClass(classId) {
        this.selectedClassId = classId;
        this.render();
    },

    // --- Execution ---

    _startElapsedTimer() {
        this._runStartTime = Date.now();
        if (this._runTimer) clearInterval(this._runTimer);
        this._runTimer = setInterval(() => {
            const el = document.getElementById('test-elapsed');
            if (el) {
                const elapsed = Math.floor((Date.now() - this._runStartTime) / 1000);
                el.textContent = `${elapsed}s`;
            }
        }, 1000);
    },

    _stopElapsedTimer() {
        if (this._runTimer) {
            clearInterval(this._runTimer);
            this._runTimer = null;
        }
    },

    async runSelected() {
        if (!this.selectedClassId || this.isRunning) return;

        const cls = this.testClasses.find(c => c.Id === this.selectedClassId);
        if (!cls) return;

        this.isRunning = true;
        this.state = 'RUNNING';
        this.render();
        this._startElapsedTimer();

        if (window.Terminal) {
            window.Terminal.open();
            window.Terminal.log(`Starting execution: ${cls.Name}`);
        }

        window.latestCoverageRunId = Date.now();
        this.lastTestRunId = window.latestCoverageRunId;

        if (window.sendToEditor) {
            window.sendToEditor({ type: 'SYNC_RUN_ID', runId: window.latestCoverageRunId });
        }

        try {
            const jobId = await window.apiClient.runTests([this.selectedClassId]);
            this.activeJobId = jobId;
            cls.LastJobId = jobId;

            await this.pollRun(jobId, cls);
        } catch (err) {
            this.state = 'FAILED';
            if (window.Terminal) window.Terminal.error(`Run Failed: ${err.message}`);
            this.isRunning = false;
            this._stopElapsedTimer();
            this.render();
        }
    },

    async runCurrentClass() {
        const activeTab = window.openTabs.find(t => t.id === window.activeTabId);
        if (!activeTab || (activeTab.type !== 'ApexClass' && activeTab.type !== 'ApexTrigger')) {
            if (window.Terminal) window.Terminal.error('Active tab is not an Apex class/trigger.');
            return;
        }

        let testCls = this.testClasses.find(c => c.Id === activeTab.id || c.Name === activeTab.name);
        if (!testCls) {
            if (window.Terminal) window.Terminal.error('Active class is not recognized as a test class.');
            return;
        }

        this.selectedClassId = testCls.Id;
        if (window.UtilsPanel) window.UtilsPanel.open('tests');
        await this.runSelected();
    },

    async pollRun(jobId, cls) {
        let finished = false;
        while (!finished) {
            await new Promise(r => setTimeout(r, 2000));
            const job = await window.apiClient.toolingQuery(`SELECT Status FROM AsyncApexJob WHERE Id = '${jobId}'`);
            const status = job.records[0]?.Status;

            if (window.Terminal) window.Terminal.log(`Status: ${status}`);

            // Update running status text
            const statusEl = document.querySelector('.running-status');
            if (statusEl) statusEl.textContent = `Status: ${status}...`;

            if (status === 'Completed' || status === 'Aborted' || status === 'Failed') {
                finished = true;
                const duration = this._runStartTime ? Date.now() - this._runStartTime : null;
                this._stopElapsedTimer();

                const results = await window.apiClient.getTestResults(jobId);
                const coverage = await this.processCoverage(cls.Id);

                this.testHistory.set(jobId, {
                    methods: results,
                    failed: results.filter(r => r.Outcome === 'Fail').length,
                    coverage: coverage,
                    duration: duration
                });

                // Track which classes have coverage data
                coverage.forEach(c => this.coveredClassIds.add(c.Id));
                // The test class itself also has coverage context
                this.coveredClassIds.add(cls.Id);

                this.refreshCoverageForActiveTab();

                cls.coverage = coverage.length > 0 ? coverage[0].pct : 0;
                this.isRunning = false;
                this.activeJobId = null;
                this.state = 'COMPLETED';
                this.render();

                // Show coverage button now that data exists
                const activeTab = window.openTabs?.find(t => t.id === window.activeTabId);
                if (activeTab && typeof window.checkTestContext === 'function') {
                    window.checkTestContext(activeTab);
                }
            }
        }
    },

    // --- Coverage ---

    async processCoverage(testClassId) {
        try {
            const touchedQuery = `SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name FROM ApexCodeCoverage WHERE ApexTestClassId = '${testClassId}'`;
            const touchedResult = await window.apiClient.toolingQuery(touchedQuery);
            const touchedIds = (touchedResult.records || []).map(r => r.ApexClassOrTriggerId);

            if (touchedIds.length === 0) return [];

            const idsString = touchedIds.map(id => `'${id}'`).join(',');
            const aggregateQuery = `SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId IN(${idsString})`;
            const aggregateResult = await window.apiClient.toolingQuery(aggregateQuery);

            return (aggregateResult.records || []).map(r => {
                const total = r.NumLinesCovered + r.NumLinesUncovered;
                return {
                    Id: r.ApexClassOrTriggerId,
                    Name: r.ApexClassOrTrigger.Name,
                    covered: r.NumLinesCovered,
                    uncovered: r.NumLinesUncovered,
                    pct: total > 0 ? Math.round((r.NumLinesCovered / total) * 100) : 0
                };
            });
        } catch (err) {
            console.error('[TestRunner] Coverage processing failed:', err);
            return [];
        }
    },

    async openClassWithCoverage(id, name) {
        const type = id.startsWith('01q') ? 'ApexTrigger' : 'ApexClass';
        if (window.openItem) {
            window.openItem(id, name, type);
        } else if (window.MetadataExplorer && window.MetadataExplorer.openItem) {
            await window.MetadataExplorer.openItem(type, id, name);
        }
        await this.fetchAndDisplayCoverage(id);
    },

    async fetchAndDisplayCoverage(classId) {
        if (!window.isCoverageEnabled) {
            if (window.toggleCoverage) window.toggleCoverage(true);
        }

        try {
            const records = await window.apiClient.getLineCodeCoverage(classId);
            if (!records || records.length === 0) return;

            let covered = new Set();
            let uncovered = new Set();

            records.forEach(r => {
                if (r.Coverage) {
                    (r.Coverage.coveredLines || []).forEach(l => covered.add(l));
                    (r.Coverage.uncoveredLines || []).forEach(l => uncovered.add(l));
                }
            });

            uncovered.forEach(l => { if (covered.has(l)) uncovered.delete(l); });

            if (window.sendToEditor) {
                window.sendToEditor({
                    type: 'SHOW_COVERAGE',
                    covered: Array.from(covered),
                    uncovered: Array.from(uncovered),
                    runId: window.latestCoverageRunId,
                    modelId: classId
                });
            }
        } catch (err) {
            console.error('[TestRunner] Coverage fetch failed:', err);
        }
    },

    async refreshCoverageForActiveTab() {
        const tab = window.openTabs.find(t => t.id === window.activeTabId);
        if (!tab || (tab.type !== 'ApexClass' && tab.type !== 'ApexTrigger')) return;

        if (this.testHistory.size > 0) {
            await this.fetchAndDisplayCoverage(tab.id);
        }
    }
};

window.TestRunner = TestRunner;
TestRunner.init();
