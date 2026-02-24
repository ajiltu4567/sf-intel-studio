/**
 * SF-Intel Intelligence Dashboard Controller
 */
class IntelligenceDashboard {
    constructor() {
        this.data = null;
        this.init();
    }

    async init() {
        console.log('[SF-Intel] Dashboard initializing...');
        try {
            // Check for class in URL params (SIP-1.1 Deep Linking)
            const urlParams = new URLSearchParams(window.location.search);
            const targetClass = urlParams.get('class');

            await this.loadStats();
            await this.loadSOQLReport();
            await this.loadRoles();
            await this.populateClassSelector();
            
            // Listen for class selection
            document.getElementById('class-selector').addEventListener('change', (e) => {
                if (e.target.value) this.loadImpact(e.target.value);
            });

            // Initial graph: URL target or common fallback
            const defaultClass = targetClass || 'AccountTriggerHandler';
            this.loadImpact(defaultClass);
            if (targetClass) {
                document.getElementById('class-selector').value = targetClass;
            }

        } catch (err) {
            console.error('Dashboard initialization failed:', err);
        }
    }

    async loadStats() {
        try {
            const stats = await window.sfIntelAPI.getStats();
            const entryPoints = await window.sfIntelAPI.getEntryPoints();
            const soqlData = await window.sfIntelAPI.getSoqlData();
            
            // Map data from nested structures (SIP-1.1 Backend Compliance)
            document.getElementById('total-classes').textContent = stats.total_classes || 0;
            document.getElementById('entry-points').textContent = (entryPoints.counts && entryPoints.counts.total) || 0;
            
            if (soqlData.summary) {
                document.getElementById('avg-soql-score').textContent = `${soqlData.summary.avg_score}%`;
                document.getElementById('critical-risks').textContent = soqlData.summary.distribution.critical || 0;
            }
        } catch (err) {
            console.warn('Stats load failed:', err);
        }
    }

    async loadSOQLReport() {
        try {
            const data = await window.sfIntelAPI.getSoqlData();
            if (window.ReportsViewer && data.summary) {
                window.ReportsViewer.renderAuditChart('soql-chart-canvas', data);
            }
        } catch (err) {
            console.error('SOQL report failed:', err);
        }
    }

    async loadImpact(className) {
        if (!className) return;
        const container = document.getElementById('impact-graph');
        container.querySelector('.loading-overlay')?.classList.remove('hidden');

        // Update card title to reflect advanced analysis
        const cardTitle = container.closest('.dash-card')?.querySelector('h2');
        if (cardTitle) cardTitle.textContent = 'Architecture Visualizer';

        try {
            const data = await window.sfIntelAPI.getClassRelationships(className);
            if (window.ReportsViewer) {
                window.ReportsViewer.renderAdvancedRelationshipGraph('impact-graph', data);
            }
            container.querySelector('.loading-overlay')?.classList.add('hidden');
        } catch (err) {
            console.error('Advanced impact analysis failed:', err);
            container.innerHTML = `<div class="error-state">Analysis failed. Ensure Cross-Class Analysis is enabled.</div>`;
        }
    }

    async loadRoles() {
        const container = document.getElementById('role-sunburst');
        container.querySelector('.loading-overlay')?.classList.remove('hidden');

        try {
            const data = await window.sfIntelAPI.getRoles();
            if (window.ReportsViewer) {
                window.ReportsViewer.renderRolesSunburst('role-sunburst', data);
            }
            container.querySelector('.loading-overlay')?.classList.add('hidden');
        } catch (err) {
            console.error('Role sunburst failed:', err);
            container.innerHTML = `<div class="error-state">Classification failed</div>`;
        }
    }

    async populateClassSelector() {
        try {
            const data = await window.sfIntelAPI.getClasses();
            const selector = document.getElementById('class-selector');
            
            // Fix: Use data.classes and handle as strings (SIP-1.1 Compliance)
            if (data && data.classes) {
                selector.innerHTML = '<option value="">Select a class to analyze...</option>';
                data.classes.slice(0, 500).forEach(className => {
                    const opt = document.createElement('option');
                    opt.value = className;
                    opt.textContent = className;
                    selector.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn('Class list failed:', err);
        }
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new IntelligenceDashboard();
});
