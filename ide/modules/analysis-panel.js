/**
 * Analysis Panel Module
 * Provides comprehensive code analysis features by communicating with sf-intel CLI via HTTP
 */

class AnalysisPanel {
    constructor() {
        this.container = null;
        this.activeView = 'entrypoints';
        this.panel = null;
    }

    init() {
        this.createPanel();
        this.bindEvents();
        console.log('[AnalysisPanel] Initialized');
    }

    createPanel() {
        const workspace = document.getElementById('analysis-workspace');
        if (!workspace) return;

        const panel = document.createElement('div');
        panel.id = 'analysis-panel';
        panel.className = 'analysis-panel';
        panel.innerHTML = `
            <div class="analysis-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <h3>⚡ CODE VISUALIZER</h3>
                    <button class="dashboard-link-btn" title="Open Full Dashboard" style="background: rgba(79, 172, 254, 0.1); border: 1px solid #4facfe; color: #4facfe; font-size: 9px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">DASHBOARD</button>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="refresh-btn" title="Refresh Analysis">🔄</button>
                    <button class="close-visualizer-btn" title="Close Visualizer" style="background: none; border: none; color: #888; cursor: pointer; font-size: 16px;">×</button>
                </div>
            </div>
            
            <div class="analysis-tabs">
                <button class="analysis-tab active" data-view="entrypoints">Entry Points</button>
                <button class="analysis-tab" data-view="flow">Execution Flow</button>
                <button class="analysis-tab" data-view="impact">Impact</button>
                <button class="analysis-tab" data-view="context">Context</button>
                <button class="analysis-tab" data-view="roles">Roles</button>
                <button class="analysis-tab" data-view="reports">Reports</button>
            </div>
            
            <div class="analysis-content">
                <div id="analysis-entrypoints" class="analysis-view active">
                    <div class="loading">Loading entry points...</div>
                </div>
                <div id="analysis-flow" class="analysis-view">
                    <div class="placeholder">Select a class to analyze execution flow</div>
                </div>
                <div id="analysis-impact" class="analysis-view">
                    <div class="placeholder">Select a class to analyze impact</div>
                </div>
                <div id="analysis-context" class="analysis-view">
                    <div class="placeholder">Select a class to analyze context</div>
                </div>
                <div id="analysis-roles" class="analysis-view">
                    <div class="loading">Loading architectural roles...</div>
                </div>
                <div id="analysis-reports" class="analysis-view">
                    <div class="reports-container">
                        <h4>Interactive Reports</h4>
                        <button class="report-btn" data-report="impact">
                            <span class="icon">🔗</span>
                            Dependency Graph
                        </button>
                        <button class="report-btn" data-report="soql">
                            <span class="icon">📊</span>
                            SOQL Performance
                        </button>
                    </div>
                </div>
            </div>
        `;

        workspace.appendChild(panel);
        this.panel = panel;
    }

    bindEvents() {
        // Tab switching
        this.panel.querySelectorAll('.analysis-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.view));
        });

        // Refresh button
        const refreshBtn = this.panel.querySelector('.refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshCurrentView());
        }

        // Report buttons
        this.panel.querySelectorAll('.report-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openReport(btn.dataset.report));
        });

        // Close button
        const closeBtn = this.panel.querySelector('.close-visualizer-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Dashboard button
        const dashBtn = this.panel.querySelector('.dashboard-link-btn');
        if (dashBtn) {
            dashBtn.addEventListener('click', () => this.openDashboard());
        }

        // Auto-load entry points and roles on init
        setTimeout(() => {
            this.loadEntryPoints();
            this.loadRoles();
        }, 100);
    }

    switchTab(viewName) {
        this.activeView = viewName;

        // Update active tab
        this.panel.querySelectorAll('.analysis-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });

        // Update active view
        this.panel.querySelectorAll('.analysis-view').forEach(view => {
            view.classList.remove('active');
        });
        const targetView = this.panel.querySelector(`#analysis-${viewName}`);
        if (targetView) {
            targetView.classList.add('active');
        }
    }

    async refreshCurrentView() {
        // this.cache.delete(this.currentView); // Cache is removed, so this line is no longer needed
        
        switch (this.activeView) {
            case 'flow':
                await this.refreshFlow();
                break;
            case 'entrypoints':
                await this.loadEntryPoints();
                break;
            case 'roles':
                await this.loadRoles();
                break;
            default:
                console.log('[AnalysisPanel] No auto-refresh for this view');
        }
    }

    // API Communication Methods (Chrome Web Store approved HTTP requests)
    async loadEntryPoints() {
        const view = this.panel.querySelector('#analysis-entrypoints');
        
        try {
            view.innerHTML = '<div class="loading">Loading entry points...</div>';
            
            const data = await window.sfIntelAPI.getEntryPoints();
            
            let html = '<div class="analysis-results">';
            html += `<div class="stats-summary">`;
            html += `<div class="stat-card"><span class="count">${data.counts.total}</span><span class="label">Total Entry Points</span></div>`;
            html += `<div class="stat-card"><span class="count">${data.counts.ui}</span><span class="label">UI Controllers</span></div>`;
            html += `<div class="stat-card"><span class="count">${data.counts.triggers}</span><span class="label">Triggers</span></div>`;
            html += `<div class="stat-card"><span class="count">${data.counts.async}</span><span class="label">Async Workers</span></div>`;
            html += `</div>`;
            
            // UI Controllers
            if (data.ui_controllers && data.ui_controllers.length > 0) {
                html += '<div class="section"><h4>🎯 UI Controllers</h4><ul class="entry-list">';
                data.ui_controllers.slice(0, 20).forEach(item => {
                    html += `<li class="entry-item">${this.escapeHtml(item)}</li>`;
                });
                if (data.ui_controllers.length > 20) {
                    html += `<li class="more-indicator">... and ${data.ui_controllers.length - 20} more</li>`;
                }
                html += '</ul></div>';
            }
            
            // Triggers
            if (data.triggers && data.triggers.length > 0) {
                html += '<div class="section"><h4>⚡ Triggers</h4><ul class="entry-list">';
                data.triggers.slice(0, 20).forEach(item => {
                    html += `<li class="entry-item">${this.escapeHtml(item)}</li>`;
                });
                if (data.triggers.length > 20) {
                    html += `<li class="more-indicator">... and ${data.triggers.length - 20} more</li>`;
                }
                html += '</ul></div>';
            }
            
            // Async Workers
            if (data.async_workers && data.async_workers.length > 0) {
                html += '<div class="section"><h4>🔄 Async Workers</h4><ul class="entry-list">';
                data.async_workers.forEach(item => {
                    html += `<li class="entry-item">${this.escapeHtml(item)}</li>`;
                });
                html += '</ul></div>';
            }
            
            html += '</div>';
            view.innerHTML = html;
            
        } catch (error) {
            view.innerHTML = `<div class="error-state">
                ❌ Failed to load entry points<br>
                <small>${this.escapeHtml(error.message)}</small><br>
                <small>Make sure sf-intel server is running: <code>sf-intel ui --port 3000</code></small>
            </div>`;
        }
    }

    // Architectural Roles Analysis
    async openReport(reportType) {
        const view = this.panel.querySelector('#analysis-reports');
        view.innerHTML = '<div class="loading">Generating visual report...</div>'; // Clear previous content and show loading

        try {
            if (reportType === 'impact') {
                // Get active class from workspace or use a default
                const activeTab = window.openTabs.find(t => t.id === window.activeTabId);
                const className = activeTab ? activeTab.name.replace('.cls', '') : null;

                if (!className) {
                    view.innerHTML = '<div class="placeholder">Select an Apex class in the editor to see its dependency graph.</div>';
                    return;
                }

                view.innerHTML = `
                    <div class="section">
                        <h4>Dependency Graph: ${className}</h4>
                        <div id="impact-graph-container" style="height: 300px; background: #1a1a1b; border-radius: 4px;"></div>
                    </div>
                `;
                
                const data = await window.sfIntelAPI._fetchWithCache(`/api/report/impact/data/${className}`);
                if (window.ReportsViewer) {
                    window.ReportsViewer.renderDependencyGraph('impact-graph-container', data);
                }
            } 
            else if (reportType === 'soql') {
                view.innerHTML = `
                    <div class="section">
                        <h4>SOQL Performance Audit</h4>
                        <canvas id="soql-chart-canvas" style="max-height: 250px;"></canvas>
                        <div id="soql-stats-container" style="margin-top: 15px;"></div>
                    </div>
                `;
                
                const data = await window.sfIntelAPI._fetchWithCache('/api/report/soql/data');
                if (window.ReportsViewer && data.summary) {
                    window.ReportsViewer.renderAuditChart('soql-chart-canvas', data);
                    
                    const stats = document.getElementById('soql-stats-container');
                    stats.innerHTML = `
                        <div class="stats-summary">
                            <div class="stat-card">
                                <span class="count">${data.total_queries}</span>
                                <span class="label">Total Queries</span>
                            </div>
                            <div class="stat-card">
                                <span class="count">${data.avg_score}%</span>
                                <span class="label">Avg Score</span>
                            </div>
                        </div>
                    `;
                }
            }
        } catch (err) {
            view.innerHTML = `<div class="error-state">Failed to load report: ${err.message}</div>`;
        }
    }

    openDashboard(className = null) {
        console.log(`[AnalysisPanel] Launching Intelligence Dashboard for: ${className || 'Overview'}`);
        let url = chrome.runtime.getURL('ide/intelligence-dashboard.html');
        if (className) url += `?class=${encodeURIComponent(className)}`;
        window.open(url, '_blank');
    }
    async loadRoles() {
        const view = this.panel.querySelector('#analysis-roles');
        
        try {
            view.innerHTML = '<div class="loading">Loading architectural roles...</div>';
            
            const data = await window.sfIntelAPI.getRoles();
            
            let html = '<div class="analysis-results">';
            html += `<div class="total-count">Total Classes: ${data.total}</div>`;
            
            const roleCategories = [
                { key: 'controllers', icon: '🎮', label: 'Controllers', desc: 'UI Entry Points' },
                { key: 'services', icon: '⚙️', label: 'Services', desc: 'Business Logic' },
                { key: 'selectors', icon: '🔍', label: 'Selectors', desc: 'Data Access' },
                { key: 'callout_clients', icon: '🌐', label: 'Callout Clients', desc: 'External Integration' },
                { key: 'handlers', icon: '🎯', label: 'Handlers', desc: 'Trigger Logic' },
                { key: 'async_workers', icon: '🔄', label: 'Async Workers', desc: 'Background Jobs' },
                { key: 'utilities', icon: '🔧', label: 'Utilities', desc: 'Helper Classes' }
            ];
            
            roleCategories.forEach(({ key, icon, label, desc }) => {
                const items = data[key] || [];
                if (items.length > 0) {
                    html += `<div class="role-section">`;
                    html += `<h4>${icon} ${label} <span class="count">(${items.length})</span></h4>`;
                    html += `<div class="role-desc">${desc}</div>`;
                    html += `<ul class="role-list">`;
                    items.slice(0, 15).forEach(item => {
                        html += `<li class="role-item clickable" data-class="${this.escapeHtml(item)}">${this.escapeHtml(item)}</li>`;
                    });
                    if (items.length > 15) {
                        html += `<li class="more-indicator">... and ${items.length - 15} more</li>`;
                    }
                    html += `</ul></div>`;
                }
            });
            
            html += '</div>';
            view.innerHTML = html;
            
            // Bind click events to class items
            view.querySelectorAll('.role-item.clickable').forEach(item => {
                item.addEventListener('click', () => {
                    const className = item.dataset.class;
                    this.analyzeClass(className);
                });
            });
            
        } catch (error) {
            view.innerHTML = `<div class="error-state">
                ❌ Failed to load roles<br>
                <small>${this.escapeHtml(error.message)}</small>
            </div>`;
        }
    }

    // Analyze specific class (flow, impact, context)
    async analyzeClass(className = null) {
        if (!className) {
            const activeTab = window.openTabs.find(t => t.id === window.activeTabId);
            className = activeTab ? activeTab.name.replace('.cls', '') : null;
        }
        
        if (!className) {
             console.log('[AnalysisPanel] No class selected for analysis');
             this.switchTab('roles');
             return;
        }

        console.log(`[AnalysisPanel] Analyzing class: ${className}`);
        
        // Switch to impact tab and load data
        this.switchTab('impact');
        await this.loadImpact(className);
    }

    async loadImpact(className) {
        const view = this.panel.querySelector('#analysis-impact');
        
        try {
            view.innerHTML = '<div class="loading">Analyzing architecture...</div>';
            
            // Use advanced relationship API
            const data = await window.sfIntelAPI._fetchWithCache(`/api/class-relationships/${className}`);
            
            let html = `<div class="analysis-results">`;
            html += `<div class="class-header">
                <h4>Architecture: ${this.escapeHtml(data.current_class)}</h4>
                <div class="metrics-summary" style="display: flex; gap: 10px; margin-bottom: 15px; font-size: 11px;">
                    <div class="metric">Coupling: <span style="color: ${data.metrics.coupling_score > 0.5 ? '#f59e0b' : '#10b981'}">${data.metrics.coupling_score.toFixed(2)}</span></div>
                    <div class="metric">Isolation: <span style="color: ${data.metrics.isolation_score < 0.5 ? '#f59e0b' : '#10b981'}">${data.metrics.isolation_score.toFixed(2)}</span></div>
                </div>
            </div>`;
            
            // Graph Container
            html += `<div id="panel-relationship-graph" style="height: 350px; background: #1a1a1b; border-radius: 6px; margin-bottom: 20px; border: 1px solid #333;"></div>`;
            
            // Legacy Callers List for context
            if (data.called_by.length > 0) {
                html += `<div class="section">`;
                html += `<h5>Consumers (${data.called_by.length})</h5>`;
                html += `<ul class="dependency-list">`;
                data.called_by.forEach(rel => {
                    html += `<li class="dependency-item">
                        <span class="name">${this.escapeHtml(rel.class_name)}</span>
                        <span class="edge-type">${rel.call_count} calls</span>
                    </li>`;
                });
                html += `</ul></div>`;
            }
            
            html += `</div>`;
            view.innerHTML = html;
            
            // Render the graph
            if (window.ReportsViewer) {
                setTimeout(() => {
                    window.ReportsViewer.renderAdvancedRelationshipGraph('panel-relationship-graph', data);
                }, 50);
            }
            
        } catch (error) {
            view.innerHTML = `<div class="error-state">
                ❌ Failed to analyze class impact<br>
                <small>${this.escapeHtml(error.message)}</small>
            </div>`;
        }
    }

    async refreshFlow() {
        const activeTab = window.openTabs.find(t => t.id === window.activeTabId);
        const className = activeTab ? activeTab.name.replace('.cls', '') : null;
        if (className) await this.loadFlow(className);
    }

    async loadFlow(className) {
        const view = this.panel.querySelector('#analysis-flow');
        try {
            view.innerHTML = '<div class="loading">Analyzing execution flow...</div>';
            const data = await window.sfIntelAPI._fetchWithCache(`/api/flow/${className}`);
            
            if (data.error) {
                view.innerHTML = `<div class="error-state">${this.escapeHtml(data.error)}</div>`;
                return;
            }

            let html = `<div class="analysis-results">`;
            html += `<div class="class-header">
                <h4>Method Flow: ${this.escapeHtml(data.class_name)}</h4>
            </div>`;
            
            html += `<div id="flow-tree-container" style="height: 500px; background: #1a1a1b; border-radius: 6px; margin-bottom: 20px; border: 1px solid #333;"></div>`;
            
            html += `<div class="section">
                <h5>Governor Limits (Estimated)</h5>
                <div class="stats-summary">
                    <div class="stat-card">
                        <span class="count">${data.governor_limits.soql_queries}</span>
                        <span class="label">SOQL</span>
                    </div>
                    <div class="stat-card">
                        <span class="count">${data.governor_limits.dml_statements}</span>
                        <span class="label">DML</span>
                    </div>
                </div>
            </div>`;
            
            html += `</div>`;
            view.innerHTML = html;

            if (window.ReportsViewer && window.ReportsViewer.renderFlowTree) {
                setTimeout(() => {
                    window.ReportsViewer.renderFlowTree('flow-tree-container', data.tree);
                }, 50);
            } else {
                view.innerHTML += '<div class="info">Flow tree visualization pending update in ReportsViewer...</div>';
            }
        } catch (err) {
            view.innerHTML = `<div class="error-state">Failed to load flow: ${err.message}</div>`;
        }
    }

    getRiskIcon(level) {
        const icons = {
            'LOW': '🟢',
            'MEDIUM': '🟡',
            'HIGH': '🟠',
            'CRITICAL': '🔴'
        };
        return icons[level] || '⚪';
    }

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    show() {
        const editorArea = document.getElementById('editor-area');
        const workspace = document.getElementById('analysis-workspace');
        if (editorArea && workspace) {
            editorArea.classList.add('split-view');
            workspace.classList.remove('hidden');
            // Trigger refresh if needed
            const activeTab = window.openTabs.find(t => t.id === window.activeTabId);
            if (activeTab) {
                const className = activeTab.name.replace('.cls', '');
                if (this.activeView === 'impact') this.loadImpact(className);
                else if (this.activeView === 'flow') this.loadFlow(className);
            }
        }
    }

    hide() {
        const editorArea = document.getElementById('editor-area');
        const workspace = document.getElementById('analysis-workspace');
        if (editorArea && workspace) {
            editorArea.classList.remove('split-view');
            workspace.classList.add('hidden');
        }
    }

    toggle() {
        const editorArea = document.getElementById('editor-area');
        if (editorArea && editorArea.classList.contains('split-view')) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// Global instance
window.AnalysisPanel = new AnalysisPanel();
