/**
 * SF-Intel Studio - Code Analysis Module
 * Analyzes Apex class methods, dependencies, and execution flow
 *
 * @module FlowAnalysis
 * @version 1.0.0
 */

const FlowAnalysis = {
    // State
    activeTab: 'methods',
    currentClassName: null,
    currentMethodName: null,
    flowData: null,
    architectureData: null,
    enhancedArchitectureData: null,  // Enhanced data with edges/nodes
    architectureMode: 'direct',       // 'direct' or 'transitive'
    methodIntelligence: null,
    filter: 'all',
    sortBy: 'name',

    /**
     * Initialize the module
     */
    init() {
        console.log('[FlowAnalysis] Initialized');
        window.renderFlowAnalysis = () => this.render();
    },

    /**
     * Render the full UI to the utility container
     */
    render() {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        // Hide utility header (we use our own)
        const header = document.getElementById('utility-header');
        if (header) header.style.display = 'none';

        // Hide editor/resizer for this utility
        const editorContainer = document.getElementById('utility-monaco-container');
        const resizer = document.getElementById('utility-resizer');
        if (editorContainer) editorContainer.style.display = 'none';
        if (resizer) resizer.style.display = 'none';

        container.style.display = 'flex';
        container.innerHTML = this.getShellHTML();
        this.bindEvents();
    },

    /**
     * Get the main shell HTML structure
     */
    getShellHTML() {
        return `
            <div class="flow-analysis-shell">
                <div class="flow-input-pane">
                    <div class="flow-input-group">
                        <label class="flow-input-label">CLASS NAME</label>
                        <input type="text" id="flow-class-input"
                               placeholder="e.g. AccountService"
                               value="${this.escapeHtml(this.currentClassName || '')}">
                    </div>
                    <div class="flow-input-group">
                        <label class="flow-input-label">METHOD (Optional)</label>
                        <input type="text" id="flow-method-input"
                               placeholder="e.g. processAccounts"
                               value="${this.escapeHtml(this.currentMethodName || '')}">
                    </div>
                    <button id="flow-analyze-btn" class="btn-primary enabled">
                        Analyze Flow
                    </button>
                </div>

                <div class="flow-tabs">
                    <button class="flow-tab ${this.activeTab === 'dashboard' ? 'active' : ''}"
                            data-tab="dashboard">Dashboard</button>
                    <button class="flow-tab ${this.activeTab === 'methods' ? 'active' : ''}"
                            data-tab="methods">Methods</button>
                    <button class="flow-tab ${this.activeTab === 'dependencies' ? 'active' : ''}"
                            data-tab="dependencies">Dependencies</button>
                    <button class="flow-tab ${this.activeTab === 'architecture' ? 'active' : ''}"
                            data-tab="architecture">Architecture</button>
                    <button class="flow-tab ${this.activeTab === 'method-intel' ? 'active' : ''}"
                            data-tab="method-intel">Method Intelligence</button>
                </div>

                <div class="flow-content">
                    ${this.renderTabContent()}
                </div>
            </div>
        `;
    },

    /**
     * Render content based on active tab
     */
    renderTabContent() {
        if (!this.flowData && this.activeTab !== 'method-intel') {
            return '<div class="flow-placeholder">Enter a class name and click Analyze Flow</div>';
        }

        switch (this.activeTab) {
            case 'dashboard':
                return this.renderDashboard();
            case 'methods':
                return this.renderMethodsList();
            case 'dependencies':
                return this.renderDependencies();
            case 'architecture':
                return this.renderArchitecture();
            case 'method-intel':
                return this.renderMethodIntelligence();
            default:
                return '';
        }
    },

    /**
     * Dashboard tab - summary statistics
     */
    renderDashboard() {
        const data = this.flowData;
        const methods = data.methods || [];
        const totalSoql = methods.reduce((sum, m) => sum + (m.soql_count || 0), 0);
        const totalDml = methods.reduce((sum, m) => sum + (m.dml_count || 0), 0);
        const calloutCount = methods.filter(m => m.has_callout).length;

        return `
            <div class="flow-dashboard">
                <h3 class="flow-section-title">Class: ${this.escapeHtml(data.class_name || this.currentClassName)}</h3>

                <div class="flow-stats-grid">
                    <div class="flow-stat-card">
                        <span class="flow-stat-value">${methods.length}</span>
                        <span class="flow-stat-label">Methods</span>
                    </div>
                    <div class="flow-stat-card">
                        <span class="flow-stat-value">${totalSoql}</span>
                        <span class="flow-stat-label">SOQL Queries</span>
                    </div>
                    <div class="flow-stat-card">
                        <span class="flow-stat-value">${totalDml}</span>
                        <span class="flow-stat-label">DML Operations</span>
                    </div>
                    <div class="flow-stat-card">
                        <span class="flow-stat-value">${calloutCount}</span>
                        <span class="flow-stat-label">Callouts</span>
                    </div>
                </div>

                ${data.governor_limits ? this.renderGovernorLimits(data.governor_limits) : ''}

                <div class="flow-section">
                    <h4 class="flow-section-subtitle">Quick Actions</h4>
                    <div class="flow-quick-actions">
                        <button class="flow-action-btn" data-action="view-methods">View All Methods</button>
                        <button class="flow-action-btn" data-action="view-deps">View Dependencies</button>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Render governor limits section
     */
    renderGovernorLimits(limits) {
        return `
            <div class="flow-section">
                <h4 class="flow-section-subtitle">Governor Limits Analysis</h4>
                <div class="flow-limits-list">
                    ${limits.soql_queries !== undefined ? `
                        <div class="flow-limit-item">
                            <span class="limit-name">SOQL Queries</span>
                            <span class="limit-value ${limits.soql_queries > 50 ? 'warning' : ''}">${limits.soql_queries}/100</span>
                        </div>
                    ` : ''}
                    ${limits.dml_statements !== undefined ? `
                        <div class="flow-limit-item">
                            <span class="limit-name">DML Statements</span>
                            <span class="limit-value ${limits.dml_statements > 75 ? 'warning' : ''}">${limits.dml_statements}/150</span>
                        </div>
                    ` : ''}
                    ${limits.callouts !== undefined ? `
                        <div class="flow-limit-item">
                            <span class="limit-name">Callouts</span>
                            <span class="limit-value ${limits.callouts > 50 ? 'warning' : ''}">${limits.callouts}/100</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    /**
     * Methods tab - list with filters
     */
    renderMethodsList() {
        const methods = this.getFilteredMethods();
        const total = this.flowData?.methods?.length || 0;

        return `
            <div class="flow-methods-pane">
                <div class="flow-methods-toolbar">
                    <input type="text" id="flow-method-search"
                           class="flow-search-input"
                           placeholder="Search methods...">

                    <div class="flow-filters">
                        <span class="filter-label">Filter:</span>
                        <button class="flow-filter-chip ${this.filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
                        <button class="flow-filter-chip ${this.filter === 'soql' ? 'active' : ''}" data-filter="soql">Has SOQL</button>
                        <button class="flow-filter-chip ${this.filter === 'dml' ? 'active' : ''}" data-filter="dml">Has DML</button>
                        <button class="flow-filter-chip ${this.filter === 'callout' ? 'active' : ''}" data-filter="callout">Has Callout</button>
                        <button class="flow-filter-chip ${this.filter === 'complex' ? 'active' : ''}" data-filter="complex">Complex</button>
                    </div>

                    <select id="flow-sort-select" class="flow-sort-dropdown">
                        <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>Name (A-Z)</option>
                        <option value="complexity" ${this.sortBy === 'complexity' ? 'selected' : ''}>Complexity</option>
                        <option value="soql" ${this.sortBy === 'soql' ? 'selected' : ''}>SOQL Count</option>
                    </select>
                </div>

                <div class="flow-methods-header">
                    <h4>Methods: ${this.escapeHtml(this.currentClassName)}</h4>
                    <span class="flow-methods-count">Showing ${methods.length} of ${total} methods</span>
                </div>

                <div class="flow-methods-list">
                    ${methods.map(m => this.renderMethodCard(m)).join('')}
                    ${methods.length === 0 ? '<div class="flow-empty">No methods match the current filter</div>' : ''}
                </div>
            </div>
        `;
    },

    /**
     * Single method card
     */
    renderMethodCard(method) {
        const soqlCount = method.soql_count || 0;
        const dmlCount = method.dml_count || 0;
        const hasCallout = method.has_callout || false;
        const complexity = method.complexity || 0;
        const visibility = method.visibility || 'unknown';

        // Determine indicator color
        let indicatorClass = 'green';
        if (complexity > 20 || soqlCount > 3 || dmlCount > 3) indicatorClass = 'red';
        else if (complexity > 10 || soqlCount > 1 || dmlCount > 1) indicatorClass = 'yellow';

        // Visibility icon and styling
        const visibilityConfig = {
            'global': { icon: '🌐', class: 'visibility-global', label: 'Global' },
            'public': { icon: '📢', class: 'visibility-public', label: 'Public' },
            'protected': { icon: '🛡️', class: 'visibility-protected', label: 'Protected' },
            'private': { icon: '🔒', class: 'visibility-private', label: 'Private' },
            'unknown': { icon: '❓', class: 'visibility-unknown', label: 'Unknown' }
        };
        const vis = visibilityConfig[visibility] || visibilityConfig['unknown'];

        return `
            <div class="flow-method-card" data-method="${this.escapeHtml(method.name)}">
                <div class="flow-method-header">
                    <span class="flow-visibility-badge ${vis.class}" title="${vis.label} method">${vis.icon}</span>
                    <span class="flow-method-indicator ${indicatorClass}"></span>
                    <span class="flow-method-name">${this.escapeHtml(this.currentClassName)}.${this.escapeHtml(method.name)}()</span>
                    <div class="flow-method-badges">
                        ${soqlCount > 0 ? `<span class="flow-badge soql">${soqlCount}</span>` : ''}
                        ${dmlCount > 0 ? `<span class="flow-badge dml">${dmlCount}</span>` : ''}
                        ${hasCallout ? '<span class="flow-badge callout">Callout</span>' : ''}
                    </div>
                </div>
                ${method.signature ? `<div class="flow-method-signature">${this.escapeHtml(method.signature)}</div>` : ''}
            </div>
        `;
    },

    /**
     * Dependencies tab
     */
    renderDependencies() {
        const deps = this.flowData?.dependencies || {};
        const dependents = this.flowData?.dependents || [];
        const dependencies = this.flowData?.class_dependencies || [];

        return `
            <div class="flow-dependencies-pane">
                <div class="flow-deps-section">
                    <h4 class="flow-section-subtitle">Depends On (${dependencies.length})</h4>
                    ${dependencies.length > 0 ? `
                        <div class="flow-deps-list">
                            ${dependencies.map(d => `
                                <div class="flow-dep-item" data-class="${this.escapeHtml(d)}">
                                    <span class="flow-dep-icon">→</span>
                                    <span class="flow-dep-name">${this.escapeHtml(d)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="flow-empty">No dependencies found</div>'}
                </div>

                <div class="flow-deps-section">
                    <h4 class="flow-section-subtitle">Dependents (${dependents.length})</h4>
                    ${dependents.length > 0 ? `
                        <div class="flow-deps-list">
                            ${dependents.map(d => `
                                <div class="flow-dep-item" data-class="${this.escapeHtml(d)}">
                                    <span class="flow-dep-icon">←</span>
                                    <span class="flow-dep-name">${this.escapeHtml(d)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="flow-empty">No dependents found</div>'}
                </div>
            </div>
        `;
    },

    /**
     * Architecture tab
     */
    renderArchitecture() {
        if (!this.architectureData) {
            return `
                <div class="flow-architecture-pane">
                    <div class="flow-placeholder">
                        <p>Loading architecture data...</p>
                        <p class="flow-placeholder-hint">Architecture analysis will appear here</p>
                    </div>
                </div>
            `;
        }

        const arch = this.architectureData;
        const metrics = arch.metrics || {};
        const calledBy = arch.called_by || [];
        const dependsOn = arch.depends_on || [];

        // Determine isolation level
        const couplingScore = metrics.coupling_score || 0;
        const isolationScore = metrics.isolation_score || 1;
        let isolationLevel = 'Isolated';
        if (couplingScore > 0.5) isolationLevel = 'Highly Coupled';
        else if (couplingScore > 0.2) isolationLevel = 'Moderately Coupled';
        else if (metrics.total_consumers > 0 || metrics.total_dependencies > 0) isolationLevel = 'Well Connected';

        return `
            <div class="flow-architecture-pane">
                <h3 class="flow-section-title">Class Architecture: ${this.escapeHtml(this.currentClassName)}</h3>

                <!-- Mode Toggle -->
                <div class="flow-arch-mode-toggle">
                    <button class="arch-mode-btn ${this.architectureMode === 'direct' ? 'active' : ''}" 
                            data-mode="direct">Direct Only</button>
                    <button class="arch-mode-btn ${this.architectureMode === 'transitive' ? 'active' : ''}" 
                            data-mode="transitive">Transitive</button>
                </div>

                <!-- Metrics Grid -->
                <div class="flow-arch-metrics">
                    <div class="flow-arch-metric-card consumers">
                        <span class="flow-arch-metric-value">${metrics.total_consumers || 0}</span>
                        <span class="flow-arch-metric-label">Consumers</span>
                        <span class="flow-arch-metric-hint">Classes calling this</span>
                    </div>
                    <div class="flow-arch-metric-card dependencies">
                        <span class="flow-arch-metric-value">${metrics.total_dependencies || 0}</span>
                        <span class="flow-arch-metric-label">Dependencies</span>
                        <span class="flow-arch-metric-hint">Classes this calls</span>
                    </div>
                    <div class="flow-arch-metric-card coupling">
                        <span class="flow-arch-metric-value">${couplingScore.toFixed(2)}</span>
                        <span class="flow-arch-metric-label">Coupling Score</span>
                        <span class="flow-arch-metric-hint">Lower is better</span>
                    </div>
                    <div class="flow-arch-metric-card isolation">
                        <span class="flow-arch-metric-value">${isolationScore.toFixed(2)}</span>
                        <span class="flow-arch-metric-label">Isolation Score</span>
                        <span class="flow-arch-metric-hint">Higher is better</span>
                    </div>
                    ${metrics.bulk_risk_count !== undefined ? `
                        <div class="flow-arch-metric-card bulk-risk ${metrics.bulk_risk_count > 0 ? 'warning' : ''}">
                            <span class="flow-arch-metric-value">${metrics.bulk_risk_count}</span>
                            <span class="flow-arch-metric-label">Bulk Risks</span>
                            <span class="flow-arch-metric-hint">Calls in loops over collections</span>
                        </div>
                    ` : ''}
                    ${metrics.looped_count !== undefined ? `
                        <div class="flow-arch-metric-card looped ${metrics.looped_count > 0 ? 'caution' : ''}">
                            <span class="flow-arch-metric-value">${metrics.looped_count}</span>
                            <span class="flow-arch-metric-label">Loop Calls</span>
                            <span class="flow-arch-metric-hint">Calls inside loops</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Architecture Status -->
                <div class="flow-arch-status ${couplingScore > 0.3 ? 'warning' : 'good'}">
                    <span class="flow-arch-status-icon">${couplingScore > 0.3 ? '⚠️' : '✅'}</span>
                    <span class="flow-arch-status-text">${isolationLevel}</span>
                </div>

                <!-- Visual Diagram -->
                <div class="flow-arch-diagram">
                    <!-- Consumers (top) -->
                    ${calledBy.length > 0 ? `
                        <div class="arch-diagram-row consumers-row">
                            ${calledBy.map(c => `
                                <div class="arch-diagram-node consumer-node" data-class="${this.escapeHtml(c.class_name || c)}">
                                    <span class="node-name">${this.escapeHtml(c.class_name || c)}</span>
                                    ${c.call_count ? `<span class="node-count">${c.call_count} call${c.call_count > 1 ? 's' : ''}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                        <div class="arch-diagram-arrows down">
                            ${calledBy.map(() => '<span class="arrow-down">↓</span>').join('')}
                        </div>
                    ` : ''}

                    <!-- Current Class (center) -->
                    <div class="arch-diagram-row current-row">
                        <div class="arch-diagram-node current-node">
                            <span class="node-name">${this.escapeHtml(this.currentClassName)}</span>
                            <span class="node-label">Current Class</span>
                        </div>
                    </div>

                    <!-- Dependencies (bottom) - Transitive nested under parent -->
                    ${(() => {
                        const directDeps = dependsOn.filter(c => !c.depth || c.depth === 1);
                        const transitiveDeps = dependsOn.filter(c => c.depth && c.depth > 1);
                        
                        // Group transitive deps by their parent
                        const transitiveByParent = {};
                        transitiveDeps.forEach(c => {
                            const parent = c.via_class || 'unknown';
                            if (!transitiveByParent[parent]) transitiveByParent[parent] = [];
                            transitiveByParent[parent].push(c);
                        });
                        
                        let html = '';
                        
                        if (directDeps.length > 0 || transitiveDeps.length > 0) {
                            // Arrows from current class to direct deps
                            html += `
                                <div class="arch-diagram-arrows down">
                                    ${directDeps.map(() => '<span class="arrow-down">↓</span>').join('')}
                                </div>
                            `;
                            
                            // Direct deps row - each direct dep can have nested transitive children
                            html += `<div class="arch-diagram-row dependencies-row direct-deps">`;
                            
                            directDeps.forEach(c => {
                                const children = transitiveByParent[c.class_name] || [];
                                
                                html += `
                                    <div class="arch-diagram-node-group" data-parent="${this.escapeHtml(c.class_name || c)}">
                                        <div class="arch-diagram-node dependency-node direct" data-class="${this.escapeHtml(c.class_name || c)}">
                                            <span class="node-name">${this.escapeHtml(c.class_name || c)}</span>
                                            ${c.call_count ? `<span class="node-count">${c.call_count} call${c.call_count > 1 ? 's' : ''}</span>` : ''}
                                            <span class="node-type-badge direct">DIRECT</span>
                                        </div>
                                        ${children.length > 0 ? `
                                            <div class="transitive-children">
                                                <div class="transitive-arrow">⤵</div>
                                                ${children.map(child => `
                                                    <div class="arch-diagram-node dependency-node transitive" data-class="${this.escapeHtml(child.class_name)}">
                                                        <span class="node-name">${this.escapeHtml(child.class_name)}</span>
                                                        <span class="node-via">via ${this.escapeHtml(child.via_class || '?')}</span>
                                                        <span class="node-type-badge transitive">TRANSITIVE</span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                            });
                            
                            html += `</div>`;
                        }
                        
                        return html;
                    })()}

                    ${calledBy.length === 0 && dependsOn.length === 0 ? `
                        <div class="arch-diagram-isolated">
                            <span class="isolated-icon">🏝️</span>
                            <span class="isolated-text">No relationships detected</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Called By Section -->
                <div class="flow-arch-section">
                    <h4 class="flow-section-subtitle">Called By (${calledBy.length})</h4>
                    ${calledBy.length > 0 ? `
                        <div class="flow-arch-class-list">
                            ${calledBy.map(c => `
                                <div class="flow-arch-class-item consumer" data-class="${this.escapeHtml(c.class_name || c)}">
                                    <span class="flow-arch-class-icon">←</span>
                                    <span class="flow-arch-class-name">${this.escapeHtml(c.class_name || c)}</span>
                                    ${c.call_count ? `<span class="flow-arch-class-count">${c.call_count} call${c.call_count > 1 ? 's' : ''}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="flow-empty">No consumers found</div>'}
                </div>

                <!-- Depends On Section - Split direct vs transitive -->
                <div class="flow-arch-section">
                    <h4 class="flow-section-subtitle">Depends On (${dependsOn.length})</h4>
                    ${(() => {
                        const directDeps = dependsOn.filter(c => !c.depth || c.depth === 1);
                        const transitiveDeps = dependsOn.filter(c => c.depth && c.depth > 1);
                        
                        let html = '';
                        
                        if (directDeps.length > 0) {
                            html += `
                                <div class="flow-arch-class-group">
                                    <h5 class="flow-arch-group-title">Direct (${directDeps.length})</h5>
                                    <div class="flow-arch-class-list">
                                        ${directDeps.map(c => `
                                            <div class="flow-arch-class-item dependency direct" data-class="${this.escapeHtml(c.class_name || c)}">
                                                <span class="flow-arch-class-icon">→</span>
                                                <span class="flow-arch-class-name">${this.escapeHtml(c.class_name || c)}</span>
                                                ${c.call_count ? `<span class="flow-arch-class-count">${c.call_count} call${c.call_count > 1 ? 's' : ''}</span>` : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }
                        
                        if (transitiveDeps.length > 0) {
                            html += `
                                <div class="flow-arch-class-group transitive">
                                    <h5 class="flow-arch-group-title">Transitive (${transitiveDeps.length})</h5>
                                    <div class="flow-arch-class-list">
                                        ${transitiveDeps.map(c => `
                                            <div class="flow-arch-class-item dependency transitive" data-class="${this.escapeHtml(c.class_name || c)}">
                                                <span class="flow-arch-class-icon dashed">⤵</span>
                                                <span class="flow-arch-class-name">${this.escapeHtml(c.class_name || c)}</span>
                                                <span class="flow-arch-via">via ${this.escapeHtml(c.via_class || '?')}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }
                        
                        if (dependsOn.length === 0) {
                            html = '<div class="flow-empty">No dependencies found</div>';
                        }
                        
                        return html;
                    })()}
                </div>

                ${(calledBy.length === 0 && dependsOn.length === 0) ? `
                    <div class="flow-arch-isolated-notice">
                        <span class="notice-icon">🏝️</span>
                        <p>This class appears to be isolated (no relationships detected)</p>
                        <p class="notice-hint">Run <code>sf-intel sync</code> to ensure the database is up to date</p>
                    </div>
                ` : ''}
            </div>
        `;
    },

    /**
     * Method Intelligence tab
     */
    renderMethodIntelligence() {
        if (!this.methodIntelligence) {
            return '<div class="flow-placeholder">Click on a method in the Methods tab to view its intelligence</div>';
        }

        const intel = this.methodIntelligence;
        const intent = intel.derived_intent || {};
        const grouped = intel.grouped_dependencies || {};

        return `
            <div class="flow-intel-pane">
                <div class="flow-intel-header">
                    <h4>${this.escapeHtml(intel.method_signature || '')}</h4>
                    <span class="flow-intel-confidence">${this.getConfidenceLabel(intel.architectural_confidence)}</span>
                </div>

                <div class="flow-intel-section">
                    <h5 class="flow-section-subtitle">Derived Intent</h5>
                    <p class="flow-intel-description">${this.escapeHtml(intent.description || 'No intent derived')}</p>
                    <div class="flow-intel-meta">
                        <span>Confidence: ${Math.round((intent.confidence || 0) * 100)}%</span>
                        <span>Method: ${this.escapeHtml(intent.derivation_method || 'Unknown')}</span>
                    </div>
                </div>

                ${this.renderGroupedDeps('Business Flow', grouped.business_flow)}
                ${this.renderGroupedDeps('Data Access', grouped.data_access)}
                ${this.renderGroupedDeps('Transaction Impact', grouped.transaction_impact)}
                ${this.renderGroupedDeps('Hidden Operations', grouped.hidden_operations, true)}
            </div>
        `;
    },

    /**
     * Render grouped dependencies section
     */
    renderGroupedDeps(title, items, collapsed = false) {
        if (!items || items.length === 0) return '';

        return `
            <div class="flow-intel-section ${collapsed ? 'collapsed' : ''}">
                <h5 class="flow-section-subtitle">${title} (${items.length})</h5>
                <ul class="flow-grouped-deps">
                    ${items.map(item => {
                        if (typeof item === 'string') {
                            return `<li class="flow-dep-entry">${this.escapeHtml(item)}</li>`;
                        }
                        const call = item.call || item;
                        const label = call.class_name ? `${call.class_name}.${call.method_name}()` : (item.description || JSON.stringify(item));
                        return `
                            <li class="flow-dep-entry ${item.is_violation ? 'violation' : ''}">
                                <span class="dep-label">${this.escapeHtml(label)}</span>
                                ${item.category ? `<span class="dep-category">${this.escapeHtml(item.category)}</span>` : ''}
                                ${item.weight ? `<span class="dep-weight ${item.weight.toLowerCase()}">${item.weight}</span>` : ''}
                            </li>
                        `;
                    }).join('')}
                </ul>
            </div>
        `;
    },

    /**
     * Get confidence label from enum
     */
    getConfidenceLabel(confidence) {
        switch (confidence) {
            case 'Clean': return 'Clean Architecture';
            case 'MixedResponsibilities': return 'Mixed Responsibilities';
            case 'HighRisk': return 'High Risk';
            default: return confidence || 'Unknown';
        }
    },

    /**
     * Filter and sort methods
     */
    getFilteredMethods() {
        let methods = this.flowData?.methods || [];

        // Apply search filter
        const searchInput = document.getElementById('flow-method-search');
        const searchTerm = searchInput?.value?.toLowerCase() || '';
        if (searchTerm) {
            methods = methods.filter(m =>
                (m.name || '').toLowerCase().includes(searchTerm) ||
                (m.signature || '').toLowerCase().includes(searchTerm)
            );
        }

        // Apply category filter
        if (this.filter !== 'all') {
            methods = methods.filter(m => {
                switch (this.filter) {
                    case 'soql': return (m.soql_count || 0) > 0;
                    case 'dml': return (m.dml_count || 0) > 0;
                    case 'callout': return m.has_callout;
                    case 'complex': return (m.complexity || 0) > 10;
                    default: return true;
                }
            });
        }

        // Apply sort
        methods = [...methods].sort((a, b) => {
            switch (this.sortBy) {
                case 'complexity': return (b.complexity || 0) - (a.complexity || 0);
                case 'soql': return (b.soql_count || 0) - (a.soql_count || 0);
                default: return (a.name || '').localeCompare(b.name || '');
            }
        });

        return methods;
    },

    /**
     * Bind all event handlers
     */
    bindEvents() {
        // Analyze button
        const analyzeBtn = document.getElementById('flow-analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.onclick = () => this.analyzeFlow();
        }

        // Enter key on inputs
        const classInput = document.getElementById('flow-class-input');
        const methodInput = document.getElementById('flow-method-input');
        if (classInput) {
            classInput.onkeypress = (e) => { if (e.key === 'Enter') this.analyzeFlow(); };
        }
        if (methodInput) {
            methodInput.onkeypress = (e) => { if (e.key === 'Enter') this.analyzeFlow(); };
        }

        // Tab switching
        document.querySelectorAll('.flow-tab').forEach(tab => {
            tab.onclick = () => this.switchTab(tab.dataset.tab);
        });

        // Filter chips
        document.querySelectorAll('.flow-filter-chip').forEach(chip => {
            chip.onclick = () => {
                this.filter = chip.dataset.filter;
                this.refreshMethodsList();
            };
        });

        // Sort dropdown
        const sortSelect = document.getElementById('flow-sort-select');
        if (sortSelect) {
            sortSelect.onchange = () => {
                this.sortBy = sortSelect.value;
                this.refreshMethodsList();
            };
        }

        // Search input
        const searchInput = document.getElementById('flow-method-search');
        if (searchInput) {
            searchInput.oninput = () => this.refreshMethodsList();
        }

        // Method card clicks
        document.querySelectorAll('.flow-method-card').forEach(card => {
            card.onclick = () => this.loadMethodIntelligence(card.dataset.method);
        });

        // Dependency item clicks (to analyze that class)
        document.querySelectorAll('.flow-dep-item').forEach(item => {
            item.onclick = () => {
                const className = item.dataset.class;
                if (className) {
                    this.currentClassName = className;
                    const input = document.getElementById('flow-class-input');
                    if (input) input.value = className;
                    this.analyzeFlow();
                }
            };
        });

        // Quick action buttons
        document.querySelectorAll('.flow-action-btn').forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.action;
                if (action === 'view-methods') this.switchTab('methods');
                if (action === 'view-deps') this.switchTab('dependencies');
            };
        });

        // Architecture class item clicks (to analyze that class)
        document.querySelectorAll('.flow-arch-class-item').forEach(item => {
            item.onclick = () => {
                const className = item.dataset.class;
                if (className) {
                    this.currentClassName = className;
                    const input = document.getElementById('flow-class-input');
                    if (input) input.value = className;
                    this.analyzeFlow();
                }
            };
        });

        // Architecture diagram node clicks
        document.querySelectorAll('.arch-diagram-node').forEach(node => {
            node.onclick = () => {
                const className = node.dataset.class;
                if (className && !node.classList.contains('current-node')) {
                    this.currentClassName = className;
                    const input = document.getElementById('flow-class-input');
                    if (input) input.value = className;
                    this.analyzeFlow();
                }
            };
        });

        // Mode toggle buttons
        document.querySelectorAll('.arch-mode-btn').forEach(btn => {
            btn.onclick = () => {
                const mode = btn.dataset.mode;
                if (mode && mode !== this.architectureMode) {
                    this.architectureMode = mode;
                    this.fetchEnhancedArchitectureData();
                }
            };
        });
    },

    /**
     * Switch active tab
     */
    switchTab(tabName) {
        this.activeTab = tabName;

        // Fetch architecture data when switching to architecture tab
        if (tabName === 'architecture' && this.currentClassName && !this.architectureData) {
            this.fetchArchitectureData();
        }

        this.render();
    },

    /**
     * Fetch class relationships for architecture tab
     */
    async fetchArchitectureData() {
        if (!this.currentClassName) return;

        try {
            if (window.Terminal) window.Terminal.log(`Loading architecture for ${this.currentClassName}...`);

            const response = await fetch(
                `http://127.0.0.1:3000/api/class-relationships/${encodeURIComponent(this.currentClassName)}`
            );

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            this.architectureData = await response.json();

            if (window.Terminal) window.Terminal.success(`Architecture loaded for ${this.currentClassName}`);

            // Re-render if still on architecture tab
            if (this.activeTab === 'architecture') {
                this.render();
            }

        } catch (error) {
            console.error('[FlowAnalysis] Architecture fetch failed:', error);
            if (window.Terminal) window.Terminal.error(`Failed to load architecture: ${error.message}`);
        }
    },

    /**
     * Fetch enhanced class relationships with mode support
     */
    async fetchEnhancedArchitectureData() {
        if (!this.currentClassName) return;

        try {
            if (window.Terminal) window.Terminal.log(`Loading ${this.architectureMode} architecture for ${this.currentClassName}...`);

            const url = `http://127.0.0.1:3000/api/class-relationships-enhanced/${encodeURIComponent(this.currentClassName)}?mode=${this.architectureMode}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            const data = await response.json();
            
            // Store enhanced data and also update regular architecture data for backwards compat
            this.enhancedArchitectureData = data;
            
            // Build via_class map from edges
            const viaClassMap = {};
            for (const edge of (data.edges || [])) {
                if (edge.via_class) {
                    viaClassMap[edge.to] = edge.via_class;
                }
            }
            
            // Convert to format with depth and via_class
            this.architectureData = {
                current_class: data.current_class,
                called_by: data.nodes
                    .filter(n => n.role === 'Caller')
                    .map(n => ({ class_name: n.class_name, call_count: n.outbound_count, depth: n.depth || 1 })),
                depends_on: data.nodes
                    .filter(n => n.role === 'Callee')
                    .map(n => ({ 
                        class_name: n.class_name, 
                        call_count: n.inbound_count, 
                        depth: n.depth || 1,
                        via_class: viaClassMap[n.class_name]
                    })),
                metrics: data.metrics,
                edges: data.edges
            };

            if (window.Terminal) window.Terminal.success(`${this.architectureMode === 'transitive' ? 'Transitive' : 'Direct'} architecture loaded`);

            // Re-render if still on architecture tab
            if (this.activeTab === 'architecture') {
                this.render();
            }

        } catch (error) {
            console.error('[FlowAnalysis] Enhanced architecture fetch failed:', error);
            if (window.Terminal) window.Terminal.error(`Failed to load enhanced architecture: ${error.message}`);
        }
    },

    /**
     * Refresh just the methods list (for filter/sort changes)
     */
    refreshMethodsList() {
        const listContainer = document.querySelector('.flow-methods-list');
        const headerCount = document.querySelector('.flow-methods-count');

        if (listContainer) {
            const methods = this.getFilteredMethods();
            const total = this.flowData?.methods?.length || 0;

            listContainer.innerHTML = methods.map(m => this.renderMethodCard(m)).join('') ||
                '<div class="flow-empty">No methods match the current filter</div>';

            if (headerCount) {
                headerCount.textContent = `Showing ${methods.length} of ${total} methods`;
            }

            // Re-bind method card clicks
            document.querySelectorAll('.flow-method-card').forEach(card => {
                card.onclick = () => this.loadMethodIntelligence(card.dataset.method);
            });

            // Update filter chip states
            document.querySelectorAll('.flow-filter-chip').forEach(chip => {
                chip.classList.toggle('active', chip.dataset.filter === this.filter);
            });
        }
    },

    /**
     * Fetch flow analysis from CLI API
     */
    async analyzeFlow() {
        const classInput = document.getElementById('flow-class-input');
        const methodInput = document.getElementById('flow-method-input');

        if (!classInput || !classInput.value.trim()) {
            if (window.Terminal) window.Terminal.error('Please enter a class name');
            return;
        }

        this.currentClassName = classInput.value.trim();
        this.currentMethodName = methodInput?.value.trim() || null;

        const analyzeBtn = document.getElementById('flow-analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = 'Analyzing...';
        }

        try {
            if (window.Terminal) window.Terminal.log(`Analyzing flow for ${this.currentClassName}...`);

            // Fetch from CLI backend
            const response = await fetch(`http://127.0.0.1:3000/api/flow/${encodeURIComponent(this.currentClassName)}`);

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            const rawData = await response.json();

            if (rawData.error) {
                throw new Error(rawData.error);
            }

            // Transform API response to expected format
            this.flowData = this.transformApiResponse(rawData);

            if (window.Terminal) window.Terminal.success(`Flow analysis complete: ${this.flowData.methods?.length || 0} methods found`);

            // Reset state and render
            this.methodIntelligence = null;
            this.architectureData = null;
            this.activeTab = 'dashboard';
            this.render();

        } catch (error) {
            console.error('[FlowAnalysis] Analysis failed:', error);
            if (window.Terminal) window.Terminal.error(`Flow analysis failed: ${error.message}`);

            // Show error in UI
            const container = document.getElementById('utility-view-container');
            if (container) {
                container.innerHTML = `
                    <div class="flow-analysis-shell">
                        <div class="flow-error">
                            <h4>Analysis Failed</h4>
                            <p>${this.escapeHtml(error.message)}</p>
                            <p class="flow-error-hint">Make sure the SF-Intel CLI server is running on port 3000</p>
                        </div>
                    </div>
                `;
            }
        } finally {
            if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = 'Analyze Flow';
            }
        }
    },

    /**
     * Fetch method intelligence from CLI API
     */
    async loadMethodIntelligence(methodName) {
        if (!this.currentClassName || !methodName) return;

        try {
            if (window.Terminal) window.Terminal.log(`Loading intelligence for ${methodName}...`);

            const response = await fetch(
                `http://127.0.0.1:3000/api/method-dependencies/${encodeURIComponent(this.currentClassName)}/${encodeURIComponent(methodName)}`
            );

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            this.methodIntelligence = await response.json();
            this.activeTab = 'method-intel';
            this.render();

            if (window.Terminal) window.Terminal.success(`Loaded intelligence for ${methodName}`);

        } catch (error) {
            console.error('[FlowAnalysis] Method intelligence failed:', error);
            if (window.Terminal) window.Terminal.error(`Failed to load method intelligence: ${error.message}`);
        }
    },

    /**
     * Transform API response from tree structure to expected format
     */
    transformApiResponse(rawData) {
        const tree = rawData.tree || [];
        const methods = [];

        for (const node of tree) {
            if (node.type === 'method') {
                // Extract method name from full qualified name like "ClassName.methodName()"
                const fullName = node.name || '';
                const match = fullName.match(/\.(\w+)\(\)$/);
                const methodName = match ? match[1] : fullName.replace(/\(\)$/, '');

                // Count SOQL and DML from children
                let soqlCount = 0;
                let dmlCount = 0;
                let hasCallout = false;

                for (const child of (node.children || [])) {
                    if (child.type === 'soql') soqlCount++;
                    else if (child.type === 'dml') dmlCount++;
                    else if (child.type === 'callout') hasCallout = true;
                }

                methods.push({
                    name: methodName,
                    signature: fullName,
                    soql_count: soqlCount,
                    dml_count: dmlCount,
                    has_callout: hasCallout,
                    complexity: soqlCount + dmlCount + (node.children?.length || 0),
                    visibility: node.visibility || 'unknown',
                    children: node.children || []
                });
            }
        }

        return {
            class_name: rawData.class_name,
            methods: methods,
            governor_limits: rawData.governor_limits,
            dependencies: rawData.dependencies || {},
            class_dependencies: rawData.class_dependencies || [],
            dependents: rawData.dependents || [],
            architecture: rawData.architecture || {},
            tree: tree
        };
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

// Export to window
window.FlowAnalysis = FlowAnalysis;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FlowAnalysis.init());
} else {
    FlowAnalysis.init();
}
