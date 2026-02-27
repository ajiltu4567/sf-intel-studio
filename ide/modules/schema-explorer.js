/**
 * SF-Intel Studio — Schema Explorer
 * Interactive D3 force-directed graph for Salesforce object relationships
 * Supports Lookup, Master-Detail, and Child relationship types
 */

const SCHEMA_ICONS = {
    search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85a1.007 1.007 0 00-.115-.1zM12 6.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z"/></svg>',
    fitView: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>',
    zoomIn: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5" fill="none"/><path d="M7 4.5v5M4.5 7h5"/><path d="M11 11l3.5 3.5"/></svg>',
    zoomOut: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5" fill="none"/><path d="M4.5 7h5"/><path d="M11 11l3.5 3.5"/></svg>',
    chevron: '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" class="chevron"><path d="M3 2l4 3-4 3V2z"/></svg>',
    relationship: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#555" stroke-width="1.2"><circle cx="12" cy="12" r="5"/><circle cx="28" cy="12" r="5"/><circle cx="20" cy="28" r="5"/><line x1="16" y1="14" x2="18" y2="24"/><line x1="24" y1="14" x2="22" y2="24"/><line x1="17" y1="12" x2="23" y2="12"/></svg>',
    emptyGraph: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="#444" stroke-width="1.5"><circle cx="28" cy="16" r="8"/><circle cx="12" cy="40" r="6"/><circle cx="44" cy="40" r="6"/><line x1="22" y1="22" x2="15" y2="35" stroke-dasharray="3,2"/><line x1="34" y1="22" x2="41" y2="35" stroke-dasharray="3,2"/></svg>',
    objectIcon: '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="4" x2="11" y2="4" stroke="currentColor" stroke-width="1"/></svg>',
};

const SchemaExplorer = {
    // State
    selectedObject: null,
    graphData: { nodes: [], links: [] },
    graphCache: new Map(),
    simulation: null,
    svg: null,
    zoom: null,
    graphLayer: null,
    selectedNode: null,
    objectList: [],
    searchFilter: '',
    depth: 1,
    showLookups: true,
    showMasterDetail: true,
    showChildren: true,
    isLoading: false,
    _rendered: false,

    init() {
        console.log('[SchemaExplorer] Initialized');
    },

    async render() {
        const workspace = document.getElementById('schema-workspace');
        if (!workspace) return;

        // Destroy previous graph to avoid stale references
        this.destroy();

        workspace.innerHTML = this.getShellHTML();
        this._rendered = true;
        this.bindEvents();

        if (this.objectList.length === 0) {
            await this.loadObjectList();
        }

        if (this.selectedObject) {
            await this.exploreObject(this.selectedObject);
        }
    },

    getShellHTML() {
        return `
            <div class="schema-explorer-shell">
                <div class="schema-toolbar">
                    <div class="schema-toolbar-section">
                        <div class="schema-object-picker">
                            <span class="schema-picker-search-icon">${SCHEMA_ICONS.search}</span>
                            <input type="text" class="schema-picker-input" id="schema-obj-input"
                                   placeholder="Search objects..." autocomplete="off" spellcheck="false"
                                   value="${this.selectedObject || ''}">
                            <div class="schema-picker-dropdown" id="schema-picker-dropdown"></div>
                        </div>
                    </div>

                    <div class="schema-toolbar-divider"></div>

                    <div class="schema-toolbar-section">
                        <span class="schema-toolbar-label">Depth</span>
                        <div class="schema-depth-group">
                            <button class="schema-depth-btn ${this.depth === 1 ? 'active' : ''}" data-depth="1">1</button>
                            <button class="schema-depth-btn ${this.depth === 2 ? 'active' : ''}" data-depth="2">2</button>
                        </div>
                    </div>

                    <div class="schema-toolbar-divider"></div>

                    <div class="schema-toolbar-section">
                        <button class="schema-toggle-btn ${this.showLookups ? 'active' : ''}" id="schema-toggle-lookups">
                            <span class="schema-toggle-dot" style="background:#4a90d9;"></span>Lookups
                        </button>
                        <button class="schema-toggle-btn ${this.showMasterDetail ? 'active' : ''}" id="schema-toggle-md">
                            <span class="schema-toggle-dot" style="background:#e74c3c;"></span>Master-Detail
                        </button>
                        <button class="schema-toggle-btn ${this.showChildren ? 'active' : ''}" id="schema-toggle-children">
                            <span class="schema-toggle-dot" style="background:#27ae60;"></span>Children
                        </button>
                    </div>

                    <div class="schema-toolbar-section right">
                        <span class="schema-node-count" id="schema-node-count"></span>
                        <button class="schema-toolbar-btn" id="schema-fit-btn" title="Fit to View">${SCHEMA_ICONS.fitView}</button>
                    </div>
                </div>

                <div class="schema-content">
                    <div class="schema-rel-panel" id="schema-rel-panel">
                        ${this.selectedNode ? this.getRelPanelHTML(this.selectedNode) : this.getPanelHintHTML()}
                    </div>
                    <div class="schema-graph-container" id="schema-graph-container">
                        ${!this.selectedObject ? this.getEmptyStateHTML() : ''}
                    </div>
                </div>
            </div>
        `;
    },

    getEmptyStateHTML() {
        return `
            <div class="schema-empty-state" id="schema-empty-state">
                ${SCHEMA_ICONS.emptyGraph}
                <div class="schema-empty-title">Select an Object</div>
                <div class="schema-empty-desc">Search for a Salesforce object above to visualize its relationships and dependencies</div>
            </div>
        `;
    },

    getPanelHintHTML() {
        return `
            <div class="schema-panel-hint">
                ${SCHEMA_ICONS.relationship}
                <div class="schema-panel-hint-title">Relationship Details</div>
                <div class="schema-panel-hint-desc">Click a node in the graph to inspect its fields and relationships</div>
            </div>
        `;
    },

    getRelPanelHTML(objName) {
        const cached = window.SchemaCache?._objectCache?.get(objName);
        if (!cached) {
            return `
                <div class="schema-rel-header">
                    <span class="schema-rel-obj-name">${_escapeHtml(objName)}</span>
                </div>
                <div class="schema-rel-body">
                    <div class="schema-rel-empty">Loading details...</div>
                </div>
            `;
        }

        const fields = cached.fields || [];
        const masterDetailFields = fields.filter(f => f.isRelationship && f.referenceTo && f.isMasterDetail);
        const lookupFields = fields.filter(f => f.isRelationship && f.referenceTo && !f.isMasterDetail);
        const childRels = cached.childRelationships || [];
        const isCustom = objName.endsWith('__c');

        // Separate master-detail children (cascadeDelete) from lookup children
        const mdChildren = childRels.filter(cr => cr.cascadeDelete);
        const lookupChildren = childRels.filter(cr => !cr.cascadeDelete);

        return `
            <div class="schema-rel-header">
                <span class="schema-rel-obj-name">${_escapeHtml(objName)}</span>
                <span class="schema-badge ${isCustom ? 'custom-obj' : 'standard-obj'}">${isCustom ? 'Custom' : 'Standard'}</span>
            </div>
            <div class="schema-rel-body">
                ${masterDetailFields.length > 0 ? `
                <div class="schema-rel-section">
                    <div class="schema-rel-section-header" data-section="md">
                        ${SCHEMA_ICONS.chevron}
                        <span>Master-Detail (${masterDetailFields.length})</span>
                        <span class="schema-rel-count-badge md">${masterDetailFields.length}</span>
                    </div>
                    <div class="schema-rel-section-body" data-section-body="md">
                        ${masterDetailFields.map(f => `
                            <div class="schema-rel-item" data-navigate="${f.referenceTo}">
                                <span class="schema-rel-field-name">${_escapeHtml(f.apiName)}</span>
                                <span class="schema-badge master-detail">MD</span>
                                <span class="schema-rel-target">${_escapeHtml(f.referenceTo)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
                <div class="schema-rel-section">
                    <div class="schema-rel-section-header" data-section="lookups">
                        ${SCHEMA_ICONS.chevron}
                        <span>Lookups (${lookupFields.length})</span>
                        <span class="schema-rel-count-badge lookup">${lookupFields.length}</span>
                    </div>
                    <div class="schema-rel-section-body" data-section-body="lookups">
                        ${lookupFields.length === 0 ? '<div class="schema-rel-empty">No lookup relationships</div>' :
                            lookupFields.map(f => `
                                <div class="schema-rel-item" data-navigate="${f.referenceTo}">
                                    <span class="schema-rel-field-name">${_escapeHtml(f.apiName)}</span>
                                    <span class="schema-badge lookup">LKP</span>
                                    <span class="schema-rel-target">${_escapeHtml(f.referenceTo)}</span>
                                </div>
                            `).join('')}
                    </div>
                </div>
                <div class="schema-rel-section">
                    <div class="schema-rel-section-header" data-section="children">
                        ${SCHEMA_ICONS.chevron}
                        <span>Children (${childRels.length})</span>
                        <span class="schema-rel-count-badge child">${childRels.length}</span>
                    </div>
                    <div class="schema-rel-section-body" data-section-body="children">
                        ${childRels.length === 0 ? '<div class="schema-rel-empty">No child relationships</div>' :
                            childRels.slice(0, 50).map(cr => `
                                <div class="schema-rel-item" data-navigate="${cr.childObject}">
                                    <span class="schema-rel-field-name">${_escapeHtml(cr.field)}</span>
                                    <span class="schema-badge ${cr.cascadeDelete ? 'master-detail' : 'child'}">${cr.cascadeDelete ? 'MD' : 'CHILD'}</span>
                                    <span class="schema-rel-target">${_escapeHtml(cr.childObject)}</span>
                                </div>
                            `).join('')}
                        ${childRels.length > 50 ? `<div class="schema-rel-empty">...and ${childRels.length - 50} more</div>` : ''}
                    </div>
                </div>
                <div class="schema-rel-section">
                    <div class="schema-rel-section-header collapsed" data-section="fields">
                        ${SCHEMA_ICONS.chevron}
                        <span>Fields (${fields.length})</span>
                        <span class="schema-rel-count-badge field">${fields.length}</span>
                    </div>
                    <div class="schema-rel-section-body collapsed" data-section-body="fields">
                        ${fields.slice(0, 40).map(f => `
                            <div class="schema-rel-item" style="cursor:default;">
                                <span class="schema-rel-field-name">${_escapeHtml(f.apiName)}</span>
                                <span class="schema-rel-type-badge">${_escapeHtml(f.type)}</span>
                            </div>
                        `).join('')}
                        ${fields.length > 40 ? `<div class="schema-rel-empty">...and ${fields.length - 40} more fields</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    },

    bindEvents() {
        const input = document.getElementById('schema-obj-input');
        const dropdown = document.getElementById('schema-picker-dropdown');
        if (!input || !dropdown) return;

        let debounce = null;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                this.searchFilter = input.value.trim();
                this.renderObjectPicker();
            }, 150);
        });

        input.addEventListener('focus', () => {
            this.renderObjectPicker();
            dropdown.classList.add('open');
        });

        // Enter key to select first result
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = dropdown.querySelector('.schema-picker-item');
                if (first) {
                    first.click();
                }
            } else if (e.key === 'Escape') {
                dropdown.classList.remove('open');
                input.blur();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.schema-object-picker')) {
                dropdown.classList.remove('open');
            }
        });

        // Depth buttons
        document.querySelectorAll('.schema-depth-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const d = parseInt(btn.dataset.depth);
                if (d !== this.depth) {
                    this.depth = d;
                    document.querySelectorAll('.schema-depth-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (this.selectedObject) {
                        this.graphCache.delete(`${this.selectedObject}_d${this.depth}`);
                        this.exploreObject(this.selectedObject);
                    }
                }
            });
        });

        // Toggle filters
        const lookupsBtn = document.getElementById('schema-toggle-lookups');
        const mdBtn = document.getElementById('schema-toggle-md');
        const childrenBtn = document.getElementById('schema-toggle-children');

        if (lookupsBtn) {
            lookupsBtn.addEventListener('click', () => {
                this.showLookups = !this.showLookups;
                lookupsBtn.classList.toggle('active', this.showLookups);
                this.applyFilters();
            });
        }

        if (mdBtn) {
            mdBtn.addEventListener('click', () => {
                this.showMasterDetail = !this.showMasterDetail;
                mdBtn.classList.toggle('active', this.showMasterDetail);
                this.applyFilters();
            });
        }

        if (childrenBtn) {
            childrenBtn.addEventListener('click', () => {
                this.showChildren = !this.showChildren;
                childrenBtn.classList.toggle('active', this.showChildren);
                this.applyFilters();
            });
        }

        // Fit to view
        const fitBtn = document.getElementById('schema-fit-btn');
        if (fitBtn) {
            fitBtn.addEventListener('click', () => this.fitToView());
        }

        this.bindRelPanelEvents();
    },

    bindRelPanelEvents() {
        const panel = document.getElementById('schema-rel-panel');
        if (!panel) return;

        panel.querySelectorAll('.schema-rel-section-header').forEach(h => {
            h.addEventListener('click', () => {
                const section = h.dataset.section;
                const body = panel.querySelector(`[data-section-body="${section}"]`);
                if (body) {
                    h.classList.toggle('collapsed');
                    body.classList.toggle('collapsed');
                }
            });
        });

        panel.querySelectorAll('.schema-rel-item[data-navigate]').forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.navigate;
                if (target) {
                    this.exploreObject(target);
                    const input = document.getElementById('schema-obj-input');
                    if (input) input.value = target;
                }
            });
        });
    },

    renderObjectPicker() {
        const dropdown = document.getElementById('schema-picker-dropdown');
        if (!dropdown) return;

        const filter = this.searchFilter.toLowerCase();
        const filtered = this.objectList.filter(obj =>
            obj.name.toLowerCase().includes(filter) ||
            obj.label.toLowerCase().includes(filter)
        ).slice(0, 60);

        if (filtered.length === 0) {
            dropdown.innerHTML = '<div class="schema-picker-empty">No objects found</div>';
            dropdown.classList.add('open');
            return;
        }

        dropdown.innerHTML = filtered.map(obj => `
            <div class="schema-picker-item ${obj.name === this.selectedObject ? 'selected' : ''}" data-obj="${obj.name}">
                <span class="schema-picker-obj-icon">${SCHEMA_ICONS.objectIcon}</span>
                <span class="schema-picker-obj-name">${_escapeHtml(obj.name)}</span>
                ${obj.isCustom ? '<span class="obj-badge custom">Custom</span>' : ''}
                <span class="obj-label">${_escapeHtml(obj.label !== obj.name ? obj.label : '')}</span>
            </div>
        `).join('');

        dropdown.classList.add('open');

        dropdown.querySelectorAll('.schema-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.obj;
                const input = document.getElementById('schema-obj-input');
                if (input) input.value = name;
                dropdown.classList.remove('open');
                this.exploreObject(name);
            });
        });
    },

    async loadObjectList() {
        if (!window.SchemaCache) {
            console.warn('[SchemaExplorer] SchemaCache not available');
            return;
        }
        try {
            this.objectList = await window.SchemaCache.getObjectList();
        } catch (err) {
            console.error('[SchemaExplorer] Failed to load object list:', err);
        }
    },

    async exploreObject(objName) {
        if (!objName) return;

        this.selectedObject = objName;
        this.isLoading = true;

        const emptyEl = document.getElementById('schema-empty-state');
        if (emptyEl) emptyEl.remove();

        const container = document.getElementById('schema-graph-container');
        if (!container) return;

        let loadingEl = container.querySelector('.schema-loading-overlay');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.className = 'schema-loading-overlay';
            loadingEl.innerHTML = `
                <div class="schema-spinner"></div>
                <div class="schema-loading-text">Discovering relationships for <strong>${_escapeHtml(objName)}</strong>...</div>
            `;
            container.appendChild(loadingEl);
        } else {
            loadingEl.querySelector('.schema-loading-text').innerHTML = `Discovering relationships for <strong>${_escapeHtml(objName)}</strong>...`;
            loadingEl.style.display = 'flex';
        }

        try {
            await this.buildGraph(objName);
            this.isLoading = false;
            loadingEl.style.display = 'none';

            // Stats
            this.updateStats();

            if (!this.svg) {
                this.initGraph(container);
            }
            this.updateGraph();
            this.selectNode(objName);

        } catch (err) {
            console.error('[SchemaExplorer] Failed to explore:', err);
            this.isLoading = false;
            loadingEl.innerHTML = `<div class="schema-empty-title" style="color:#e74c3c;">Failed to load ${_escapeHtml(objName)}</div><div class="schema-empty-desc">${_escapeHtml(err.message)}</div>`;
        }
    },

    async buildGraph(objName) {
        const cacheKey = `${objName}_d${this.depth}`;
        if (this.graphCache.has(cacheKey)) {
            this.graphData = this.graphCache.get(cacheKey);
            return;
        }

        const nodes = new Map();
        const links = [];
        const visited = new Set();

        const addObject = async (name, depthRemaining, isCenter) => {
            if (visited.has(name) || depthRemaining < 0) return;
            visited.add(name);

            await window.SchemaCache.getFields(name);
            const cached = window.SchemaCache._objectCache.get(name);
            if (!cached) return;

            const isCustom = name.endsWith('__c');
            if (!nodes.has(name)) {
                nodes.set(name, { id: name, isCustom, isCenter: isCenter || false });
            }

            // Lookup and Master-Detail relationships (outgoing)
            const refFields = (cached.fields || []).filter(f => f.isRelationship && f.referenceTo);
            for (const f of refFields) {
                const target = f.referenceTo;
                if (!target || target === name) continue;
                if (!nodes.has(target)) {
                    nodes.set(target, { id: target, isCustom: target.endsWith('__c'), isCenter: false });
                }
                links.push({
                    source: name,
                    target: target,
                    type: f.isMasterDetail ? 'master-detail' : 'lookup',
                    field: f.apiName,
                    relName: f.relationshipName || f.apiName
                });
            }

            // Child relationships (incoming)
            const childRels = (cached.childRelationships || []).slice(0, 30);
            for (const cr of childRels) {
                if (!cr.childObject || cr.childObject === name) continue;
                if (!nodes.has(cr.childObject)) {
                    nodes.set(cr.childObject, { id: cr.childObject, isCustom: cr.childObject.endsWith('__c'), isCenter: false });
                }
                links.push({
                    source: cr.childObject,
                    target: name,
                    type: 'child',
                    field: cr.field,
                    relName: cr.name
                });
            }

            if (depthRemaining > 0) {
                const neighbors = new Set();
                refFields.forEach(f => { if (f.referenceTo && f.referenceTo !== name) neighbors.add(f.referenceTo); });
                childRels.forEach(cr => { if (cr.childObject && cr.childObject !== name) neighbors.add(cr.childObject); });
                const limited = Array.from(neighbors).slice(0, 8);
                for (const n of limited) {
                    await addObject(n, depthRemaining - 1, false);
                }
            }
        };

        await addObject(objName, this.depth - 1, true);

        // Deduplicate links
        const linkSet = new Set();
        const uniqueLinks = [];
        for (const l of links) {
            const key = `${typeof l.source === 'object' ? l.source.id : l.source}->${typeof l.target === 'object' ? l.target.id : l.target}::${l.field}`;
            if (!linkSet.has(key)) {
                linkSet.add(key);
                uniqueLinks.push(l);
            }
        }

        this.graphData = {
            nodes: Array.from(nodes.values()),
            links: uniqueLinks
        };

        this.graphCache.set(cacheKey, {
            nodes: this.graphData.nodes.map(n => ({ ...n })),
            links: this.graphData.links.map(l => ({ ...l }))
        });
    },

    initGraph(container) {
        const rect = container.getBoundingClientRect();
        const width = rect.width || 800;
        const height = rect.height || 600;

        const existing = container.querySelector('svg');
        if (existing) existing.remove();

        this.svg = d3.select(container)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${width} ${height}`);

        const defs = this.svg.append('defs');

        // Arrow markers per relationship type
        const markers = [
            { id: 'arrow-lookup', color: '#4a90d9' },
            { id: 'arrow-master-detail', color: '#e74c3c' },
            { id: 'arrow-child', color: '#27ae60' },
        ];

        markers.forEach(m => {
            defs.append('marker')
                .attr('id', m.id)
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 24)
                .attr('refY', 0)
                .attr('markerWidth', 7)
                .attr('markerHeight', 7)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-4L8,0L0,4Z')
                .attr('fill', m.color);
        });

        // Glow filter for selected nodes
        const glowFilter = defs.append('filter')
            .attr('id', 'node-glow')
            .attr('x', '-50%').attr('y', '-50%')
            .attr('width', '200%').attr('height', '200%');
        glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
        glowFilter.append('feMerge').selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .enter().append('feMergeNode')
            .attr('in', d => d);

        // Drop shadow for nodes
        const shadow = defs.append('filter')
            .attr('id', 'node-shadow')
            .attr('x', '-30%').attr('y', '-30%')
            .attr('width', '160%').attr('height', '160%');
        shadow.append('feDropShadow')
            .attr('dx', '0').attr('dy', '2')
            .attr('stdDeviation', '3')
            .attr('flood-color', 'rgba(0,0,0,0.4)');

        // Grid pattern for background
        const gridPattern = defs.append('pattern')
            .attr('id', 'grid')
            .attr('width', 40).attr('height', 40)
            .attr('patternUnits', 'userSpaceOnUse');
        gridPattern.append('path')
            .attr('d', 'M 40 0 L 0 0 0 40')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(255,255,255,0.03)')
            .attr('stroke-width', '1');

        // Background rect with grid
        this.svg.append('rect')
            .attr('width', '100%').attr('height', '100%')
            .attr('fill', 'url(#grid)');

        // Zoom behavior
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.graphLayer.attr('transform', event.transform);
            });

        this.svg.call(this.zoom);

        // Disable double-click zoom (we use dblclick for navigation)
        this.svg.on('dblclick.zoom', null);

        this.graphLayer = this.svg.append('g').attr('class', 'graph-layer');

        this.renderOverlays(container);
    },

    renderOverlays(container) {
        // Remove existing
        container.querySelectorAll('.schema-legend, .schema-controls').forEach(el => el.remove());

        // Legend
        const legend = document.createElement('div');
        legend.className = 'schema-legend';
        legend.innerHTML = `
            <div class="schema-legend-title">LEGEND</div>
            <div class="schema-legend-group">
                <div class="schema-legend-subtitle">Nodes</div>
                <div class="schema-legend-item">
                    <span class="schema-legend-dot" style="background:#007acc;box-shadow:0 0 6px rgba(0,122,204,0.4);"></span>
                    <span>Selected / Center</span>
                </div>
                <div class="schema-legend-item">
                    <span class="schema-legend-dot" style="background:#4facfe;"></span>
                    <span>Standard Object</span>
                </div>
                <div class="schema-legend-item">
                    <span class="schema-legend-dot" style="background:#f39c12;"></span>
                    <span>Custom Object</span>
                </div>
            </div>
            <div class="schema-legend-group">
                <div class="schema-legend-subtitle">Edges</div>
                <div class="schema-legend-item">
                    <span class="schema-legend-line" style="border-top:2px dashed #4a90d9;"></span>
                    <span>Lookup</span>
                </div>
                <div class="schema-legend-item">
                    <span class="schema-legend-line" style="border-top:2.5px solid #e74c3c;"></span>
                    <span>Master-Detail</span>
                </div>
                <div class="schema-legend-item">
                    <span class="schema-legend-line" style="border-top:1.5px solid #27ae60;"></span>
                    <span>Child</span>
                </div>
            </div>
        `;
        container.appendChild(legend);

        // Zoom controls
        const controls = document.createElement('div');
        controls.className = 'schema-controls';
        controls.innerHTML = `
            <button class="schema-zoom-btn" id="schema-zoom-in" title="Zoom In">${SCHEMA_ICONS.zoomIn}</button>
            <button class="schema-zoom-btn" id="schema-zoom-out" title="Zoom Out">${SCHEMA_ICONS.zoomOut}</button>
            <button class="schema-zoom-btn" id="schema-zoom-fit" title="Fit to View">${SCHEMA_ICONS.fitView}</button>
        `;
        container.appendChild(controls);

        document.getElementById('schema-zoom-in')?.addEventListener('click', () => {
            this.svg.transition().duration(300).call(this.zoom.scaleBy, 1.4);
        });
        document.getElementById('schema-zoom-out')?.addEventListener('click', () => {
            this.svg.transition().duration(300).call(this.zoom.scaleBy, 0.7);
        });
        document.getElementById('schema-zoom-fit')?.addEventListener('click', () => {
            this.fitToView();
        });
    },

    updateGraph() {
        if (!this.graphLayer) return;

        const container = document.getElementById('schema-graph-container');
        const rect = container?.getBoundingClientRect();
        const width = rect?.width || 800;
        const height = rect?.height || 600;

        // Filter based on toggles
        const filteredLinks = this.graphData.links.filter(l => {
            if (l.type === 'lookup' && !this.showLookups) return false;
            if (l.type === 'master-detail' && !this.showMasterDetail) return false;
            if (l.type === 'child' && !this.showChildren) return false;
            return true;
        });

        const connectedNodes = new Set();
        filteredLinks.forEach(l => {
            connectedNodes.add(typeof l.source === 'object' ? l.source.id : l.source);
            connectedNodes.add(typeof l.target === 'object' ? l.target.id : l.target);
        });

        const centerNode = this.graphData.nodes.find(n => n.isCenter);
        if (centerNode) connectedNodes.add(centerNode.id);

        const filteredNodes = this.graphData.nodes.filter(n => connectedNodes.has(n.id));

        // Detect parallel links (same node pair) and assign spread positions
        const pairGroups = new Map();
        filteredLinks.forEach((l, i) => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            const pairKey = [src, tgt].sort().join('::');
            if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, []);
            pairGroups.get(pairKey).push(i);
        });
        filteredLinks.forEach((l, i) => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            const pairKey = [src, tgt].sort().join('::');
            const group = pairGroups.get(pairKey);
            l._pIdx = group.indexOf(i);
            l._pTotal = group.length;
        });

        // Clear previous
        this.graphLayer.selectAll('*').remove();

        // Links
        const linkGroup = this.graphLayer.append('g').attr('class', 'links');
        const linkSelection = linkGroup.selectAll('line')
            .data(filteredLinks)
            .enter()
            .append('line')
            .attr('class', d => `schema-link ${d.type}`)
            .attr('marker-end', d => `url(#arrow-${d.type})`);

        // Link labels (hidden by default, shown on hover)
        const linkLabelGroup = this.graphLayer.append('g').attr('class', 'link-labels');
        const linkLabels = linkLabelGroup.selectAll('text')
            .data(filteredLinks)
            .enter()
            .append('text')
            .attr('class', 'schema-link-label')
            .text(d => d.field);

        // Nodes
        const nodeGroup = this.graphLayer.append('g').attr('class', 'nodes');
        const nodeSelection = nodeGroup.selectAll('g')
            .data(filteredNodes, d => d.id)
            .enter()
            .append('g')
            .attr('class', d => {
                let cls = 'schema-node';
                if (d.isCenter) cls += ' center';
                else if (d.isCustom) cls += ' custom';
                else cls += ' standard';
                if (d.id === this.selectedNode) cls += ' selected';
                return cls;
            })
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) this.simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) this.simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                })
            );

        // Outer ring (glow effect for center)
        nodeSelection.filter(d => d.isCenter).append('circle')
            .attr('r', 32)
            .attr('class', 'schema-node-glow')
            .attr('fill', 'none')
            .attr('stroke', '#007acc')
            .attr('stroke-width', '1')
            .attr('opacity', '0.3');

        // Main circle with shadow
        nodeSelection.append('circle')
            .attr('r', d => d.isCenter ? 26 : 16)
            .attr('filter', 'url(#node-shadow)');

        // Icon inside circle — small abbreviation
        nodeSelection.append('text')
            .attr('class', 'schema-node-abbr')
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('font-size', d => d.isCenter ? '10px' : '7px')
            .attr('fill', '#fff')
            .attr('font-weight', '600')
            .attr('pointer-events', 'none')
            .text(d => this.getAbbreviation(d.id));

        // Label below
        nodeSelection.append('text')
            .attr('class', 'schema-node-label')
            .attr('dy', d => d.isCenter ? 40 : 28)
            .text(d => this.formatLabel(d.id));

        // Click to select
        nodeSelection.on('click', (event, d) => {
            event.stopPropagation();
            this.selectNode(d.id);
            this.highlightConnections(d.id);
        });

        // Double-click to navigate
        nodeSelection.on('dblclick', (event, d) => {
            event.stopPropagation();
            event.preventDefault();
            const input = document.getElementById('schema-obj-input');
            if (input) input.value = d.id;
            this.exploreObject(d.id);
        });

        // Hover to show link labels
        nodeSelection.on('mouseenter', (event, d) => {
            linkLabels.classed('visible', l => {
                const src = typeof l.source === 'object' ? l.source.id : l.source;
                const tgt = typeof l.target === 'object' ? l.target.id : l.target;
                return src === d.id || tgt === d.id;
            });
        });

        nodeSelection.on('mouseleave', () => {
            linkLabels.classed('visible', false);
        });

        // Background click to deselect
        this.svg.on('click', () => {
            this.clearHighlight();
        });

        // Force simulation
        if (this.simulation) this.simulation.stop();

        this.simulation = d3.forceSimulation(filteredNodes)
            .force('link', d3.forceLink(filteredLinks).id(d => d.id).distance(d => {
                // Shorter distance for master-detail (tighter coupling)
                return 120;
            }))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide(d => d.isCenter ? 40 : 28))
            .alphaDecay(0.04)
            .on('tick', () => {
                linkSelection
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);

                // Position labels with perpendicular offset for parallel links
                linkLabels
                    .attr('x', d => {
                        const mx = (d.source.x + d.target.x) / 2;
                        if (d._pTotal <= 1) return mx;
                        const dx = d.target.x - d.source.x;
                        const dy = d.target.y - d.source.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpX = -dy / len;
                        const offset = (d._pIdx - (d._pTotal - 1) / 2) * 14;
                        return mx + perpX * offset;
                    })
                    .attr('y', d => {
                        const my = (d.source.y + d.target.y) / 2;
                        if (d._pTotal <= 1) return my;
                        const dx = d.target.x - d.source.x;
                        const dy = d.target.y - d.source.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpY = dx / len;
                        const offset = (d._pIdx - (d._pTotal - 1) / 2) * 14;
                        return my + perpY * offset;
                    });

                nodeSelection
                    .attr('transform', d => `translate(${d.x},${d.y})`);
            });

        setTimeout(() => this.fitToView(), 1200);
    },

    applyFilters() {
        if (this.selectedObject) {
            this.updateGraph();
            this.updateStats();
        }
    },

    updateStats() {
        const countEl = document.getElementById('schema-node-count');
        if (!countEl) return;
        const links = this.graphData.links;
        const mdCount = links.filter(l => l.type === 'master-detail').length;
        const lkpCount = links.filter(l => l.type === 'lookup').length;
        const childCount = links.filter(l => l.type === 'child').length;
        const nodeCount = this.graphData.nodes.length;
        countEl.textContent = `${nodeCount} objects \u00b7 ${lkpCount} lookups \u00b7 ${mdCount} MD \u00b7 ${childCount} children`;
    },

    selectNode(objName) {
        this.selectedNode = objName;

        const panel = document.getElementById('schema-rel-panel');
        if (panel) {
            panel.innerHTML = this.getRelPanelHTML(objName);
            this.bindRelPanelEvents();

            const cached = window.SchemaCache?._objectCache?.get(objName);
            if (!cached) {
                window.SchemaCache?.getFields(objName).then(() => {
                    panel.innerHTML = this.getRelPanelHTML(objName);
                    this.bindRelPanelEvents();
                });
            }
        }

        this.graphLayer?.selectAll('.schema-node')
            .classed('selected', d => d.id === objName);
    },

    highlightConnections(objName) {
        if (!this.graphLayer) return;

        const connected = new Set([objName]);
        this.graphData.links.forEach(l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            if (src === objName) connected.add(tgt);
            if (tgt === objName) connected.add(src);
        });

        this.graphLayer.selectAll('.schema-node')
            .classed('dimmed', d => !connected.has(d.id));

        this.graphLayer.selectAll('.schema-link')
            .classed('dimmed', d => {
                const src = typeof d.source === 'object' ? d.source.id : d.source;
                const tgt = typeof d.target === 'object' ? d.target.id : d.target;
                return src !== objName && tgt !== objName;
            });
    },

    clearHighlight() {
        if (!this.graphLayer) return;
        this.graphLayer.selectAll('.schema-node').classed('dimmed', false);
        this.graphLayer.selectAll('.schema-link').classed('dimmed', false);
    },

    fitToView() {
        if (!this.svg || !this.graphLayer) return;

        const container = document.getElementById('schema-graph-container');
        const rect = container?.getBoundingClientRect();
        if (!rect) return;

        const bounds = this.graphLayer.node()?.getBBox();
        if (!bounds || bounds.width === 0) return;

        const padding = 80;
        const scale = Math.min(
            (rect.width - padding * 2) / bounds.width,
            (rect.height - padding * 2) / bounds.height,
            1.5
        );

        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;

        this.svg.transition().duration(600).call(
            this.zoom.transform,
            d3.zoomIdentity
                .translate(rect.width / 2, rect.height / 2)
                .scale(scale)
                .translate(-cx, -cy)
        );
    },

    getAbbreviation(name) {
        if (!name) return '';
        // Extract uppercase letters or first 2-3 chars
        const clean = name.replace(/__c$/, '').replace(/__/g, '');
        const uppers = clean.replace(/[a-z0-9]/g, '');
        if (uppers.length >= 2 && uppers.length <= 4) return uppers;
        return clean.substring(0, 2).toUpperCase();
    },

    formatLabel(name) {
        if (!name) return '';
        let label = name.replace(/__c$/, '');
        if (label.length > 20) {
            label = label.substring(0, 18) + '...';
        }
        return label;
    },

    destroy() {
        if (this.simulation) {
            this.simulation.stop();
            this.simulation = null;
        }
        this.svg = null;
        this.graphLayer = null;
        this.graphCache.clear();
        this._rendered = false;
    }
};

window.SchemaExplorer = SchemaExplorer;
